// Home Assistant – in beide Richtungen:
//
//  1. PrintDock schaltet Drucker über Home Assistant (Steckdosen, Relais):
//     REST-API mit Langzeit-Token. Ein/Aus aus PrintDock, optional automatisch
//     aus, wenn ein Druck fertig und die Düse abgekühlt ist.
//
//  2. PrintDock erscheint in Home Assistant: per MQTT-Discovery wird jeder
//     Drucker zu einem Gerät mit Sensoren (Status, Fortschritt, Restzeit,
//     Temperaturen …), Knöpfen (Pause, Fortsetzen, Abbrechen, Platte frei),
//     Licht, Geschwindigkeit und Kamerabild.
//
// Läuft PrintDock als Home-Assistant-Add-on, richtet sich beides selbst ein
// (Supervisor-Token und MQTT-Zugang des Mosquitto-Add-ons).

const os = require('os');
const mqtt = require('mqtt');
const { store } = require('./store');
const { tr } = require('./i18n');
const app = require('./app');

const db = store('homeassistant.json', {});
db.data.mqtt ??= { enabled: false, url: '', username: '', password: '', discoveryPrefix: 'homeassistant', baseTopic: 'printdock' };
db.data.url ??= '';
db.data.token ??= '';
db.data.publicUrl ??= '';

const MASK = '••••••';
const ADDON = Boolean(process.env.SUPERVISOR_TOKEN);
const STATE_DE = { offline: 'Nicht erreichbar', idle: 'Bereit', preparing: 'Bereitet vor', printing: 'Druckt', paused: 'Pausiert', finished: 'Fertig', cancelled: 'Abgebrochen', error: 'Störung' };
const SPEED_DE = { 1: 'Leise', 2: 'Standard', 3: 'Sport', 4: 'Turbo' };
const speedLabels = () => Object.fromEntries(Object.entries(SPEED_DE).map(([k, v]) => [k, tr(v)]));
const enabled = () => app.moduleOn('homeassistant');

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function localIp() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return 'localhost';
}

class HomeAssistant {
  /**
   * @param ctx { printers(), runtime, broadcast(event), production, summary(), port }
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.power = {}; // printerId -> 'on' | 'off' | 'unavailable' | null
    this.status = { rest: null, mqtt: null }; // Fehlermeldungen bzw. 'ok'
    this.offTimers = new Map();
    this.lastPublish = new Map();
    this.published = new Set(); // Discovery-Topics, die wir gesetzt haben
    this.pollTimer = setInterval(() => this.pollPower(), 20_000);
    this.pollTimer.unref();
    setTimeout(() => this.init(), 1500);
  }

  // ================================================================ Einstellungen

  get directUrl() {
    return db.data.publicUrl || `http://${localIp()}:${this.ctx.port}`;
  }

  get restUrl() {
    return ADDON ? 'http://supervisor/core' : String(db.data.url || '').replace(/\/+$/, '');
  }

  get restToken() {
    return ADDON ? process.env.SUPERVISOR_TOKEN : db.data.token;
  }

  publicSettings() {
    const m = db.data.mqtt;
    return {
      addon: ADDON,
      url: db.data.url,
      token: db.data.token ? MASK : '',
      publicUrl: db.data.publicUrl,
      directUrl: this.directUrl,
      mqtt: { ...m, password: m.password ? MASK : '' },
      mqttAuto: this.mqttAuto ? { host: this.mqttAuto.host } : null,
      status: this.status,
    };
  }

  async saveSettings(body) {
    if (!ADDON) {
      if (body.url !== undefined) db.data.url = String(body.url).trim().replace(/\/+$/, '');
      if (body.token !== undefined && body.token !== MASK) db.data.token = String(body.token).trim();
    }
    if (body.publicUrl !== undefined) db.data.publicUrl = String(body.publicUrl).trim().replace(/\/+$/, '');
    if (body.mqtt) {
      const m = db.data.mqtt;
      for (const k of ['enabled', 'url', 'username', 'discoveryPrefix', 'baseTopic']) if (body.mqtt[k] !== undefined) m[k] = k === 'enabled' ? Boolean(body.mqtt[k]) : String(body.mqtt[k]).trim();
      if (body.mqtt.password !== undefined && body.mqtt.password !== MASK) m.password = String(body.mqtt.password);
      m.discoveryPrefix ||= 'homeassistant';
      m.baseTopic ||= 'printdock';
    }
    db.save();
    await this.init();
    return this.publicSettings();
  }

  async init() {
    if (ADDON && !this.mqttAuto) this.mqttAuto = await this.supervisorMqtt();
    this.pollPower();
    this.connectMqtt();
  }

  // ================================================================ REST (Steckdosen)

  async rest(path, { method = 'GET', body } = {}) {
    if (!this.restUrl || !this.restToken) throw httpError(400, 'Home Assistant ist nicht eingerichtet (Adresse und Token unter Einstellungen → Home Assistant)');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(`${this.restUrl}/api/${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.restToken}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      if (res.status === 401) throw httpError(502, 'Home Assistant lehnt den Token ab');
      if (res.status === 404) throw httpError(502, 'Nicht gefunden – Entität oder Adresse prüfen');
      if (!res.ok) throw httpError(502, `Home Assistant antwortet mit HTTP ${res.status}`);
      return res.json();
    } catch (err) {
      if (err.status) throw err;
      throw httpError(502, err.name === 'AbortError' ? 'Home Assistant antwortet nicht' : `Home Assistant nicht erreichbar (${err.cause?.code || err.message})`);
    } finally {
      clearTimeout(t);
    }
  }

  async test() {
    const r = await this.rest('');
    this.status.rest = 'ok';
    return { ok: true, message: r?.message || 'Verbunden' };
  }

  /** Schaltbare Entitäten für die Auswahl beim Drucker. */
  async entities() {
    const states = await this.rest('states');
    return states
      .filter((s) => /^(switch|light|input_boolean)\./.test(s.entity_id))
      .map((s) => ({ entity_id: s.entity_id, name: s.attributes?.friendly_name || s.entity_id, state: s.state }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async pollPower() {
    const list = this.ctx.printers().filter((p) => p.settings?.powerEntity);
    if (!enabled() || !list.length || !this.restUrl || !this.restToken) return;
    let changed = false;
    for (const p of list) {
      let st = null;
      try {
        const s = await this.rest(`states/${encodeURIComponent(p.settings.powerEntity)}`);
        st = s.state === 'on' ? 'on' : s.state === 'off' ? 'off' : 'unavailable';
        this.status.rest = 'ok';
      } catch (err) {
        this.status.rest = err.message;
      }
      if (this.power[p.id] !== st) {
        this.power[p.id] = st;
        changed = true;
      }
    }
    if (changed) this.ctx.broadcast('power', null);
  }

  async setPower(printerId, on) {
    const p = this.ctx.printers().find((x) => x.id === printerId);
    if (!p) throw httpError(404, 'Drucker nicht gefunden');
    const entity = p.settings?.powerEntity;
    if (!entity) throw httpError(400, 'Für diesen Drucker ist keine Steckdose hinterlegt');
    if (!on) {
      const st = this.ctx.runtime.get(printerId)?.driver.status;
      if (st && ['printing', 'preparing', 'paused'].includes(st.state)) throw httpError(409, 'Der Drucker druckt gerade – erst den Druck beenden');
    }
    const domain = entity.split('.')[0];
    await this.rest(`services/${domain === 'light' ? 'light' : domain === 'input_boolean' ? 'input_boolean' : 'switch'}/${on ? 'turn_on' : 'turn_off'}`, { method: 'POST', body: { entity_id: entity } });
    this.power[printerId] = on ? 'on' : 'off';
    this.ctx.broadcast('power', null);
    console.log(`[${p.name}] Steckdose ${on ? 'ein' : 'aus'}geschaltet (${entity})`);
    setTimeout(() => this.pollPower(), 3000);
  }

  /** Nach Druckende: automatisch ausschalten, sobald abgekühlt. */
  onJobEnd(cfg) {
    const s = cfg.settings || {};
    if (!s.powerEntity || !s.autoOff) return;
    clearTimeout(this.offTimers.get(cfg.id));
    const delay = Math.max(1, Number(s.autoOffDelay) || 10) * 60_000;
    const started = Date.now();
    const check = async () => {
      const st = this.ctx.runtime.get(cfg.id)?.driver.status;
      if (!st || ['printing', 'preparing', 'paused'].includes(st.state)) return; // neuer Druck → nicht ausschalten
      const hot = (st.nozzles || []).some((n) => (n.current || 0) > (Number(s.autoOffMaxTemp) || 50));
      if (hot && Date.now() - started < delay + 60 * 60_000) {
        this.offTimers.set(cfg.id, setTimeout(check, 60_000));
        return;
      }
      try {
        await this.setPower(cfg.id, false);
      } catch (err) {
        console.warn(`[${cfg.name}] Auto-Aus fehlgeschlagen: ${err.message}`);
      }
    };
    this.offTimers.set(cfg.id, setTimeout(check, delay));
    console.log(`[${cfg.name}] Auto-Aus in ${Math.round(delay / 60000)} min (sobald Düse unter ${Number(s.autoOffMaxTemp) || 50} °C)`);
  }

  cancelAutoOff(printerId) {
    clearTimeout(this.offTimers.get(printerId));
    this.offTimers.delete(printerId);
  }

  // ================================================================ MQTT-Discovery

  async supervisorMqtt() {
    try {
      const res = await fetch('http://supervisor/services/mqtt', { headers: { Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}` } });
      if (!res.ok) return null;
      const { data } = await res.json();
      return data?.host ? data : null;
    } catch {
      return null;
    }
  }

  mqttTarget() {
    const m = db.data.mqtt;
    if (!m.enabled || !enabled()) return null;
    if (this.mqttAuto && !m.url) {
      const a = this.mqttAuto;
      return { url: `${a.ssl ? 'mqtts' : 'mqtt'}://${a.host}:${a.port || 1883}`, username: a.username, password: a.password };
    }
    if (!m.url) return null;
    return { url: m.url.includes('://') ? m.url : `mqtt://${m.url}`, username: m.username || undefined, password: m.password || undefined };
  }

  get base() {
    return db.data.mqtt.baseTopic || 'printdock';
  }

  get prefix() {
    return db.data.mqtt.discoveryPrefix || 'homeassistant';
  }

  connectMqtt() {
    if (this.client) {
      this.client.end(true);
      this.client = null;
    }
    const target = this.mqttTarget();
    if (!target) {
      this.status.mqtt = db.data.mqtt.enabled ? 'Kein MQTT-Broker eingetragen' : null;
      return;
    }
    this.status.mqtt = 'Verbinde …';
    const client = mqtt.connect(target.url, {
      username: target.username,
      password: target.password,
      clientId: `printdock_${Math.random().toString(16).slice(2, 8)}`,
      reconnectPeriod: 15_000,
      connectTimeout: 8000,
      will: { topic: `${this.base}/status`, payload: 'offline', retain: true, qos: 1 },
    });
    this.client = client;
    client.on('connect', () => {
      this.status.mqtt = 'ok';
      client.publish(`${this.base}/status`, 'online', { retain: true, qos: 1 });
      client.subscribe([`${this.base}/printer/+/cmd`, `${this.prefix}/status`]);
      this.publishDiscovery();
      this.ctx.broadcast('ha', null);
    });
    client.on('message', (topic, payload) => this.onMqttMessage(topic, payload.toString()));
    client.on('error', (err) => {
      this.status.mqtt = /Not authorized|Bad user/i.test(err.message) ? 'MQTT-Broker lehnt Benutzer/Passwort ab' : `MQTT: ${err.code || err.message}`;
      this.ctx.broadcast('ha', null);
    });
    client.on('offline', () => {
      if (this.status.mqtt === 'ok') this.status.mqtt = 'MQTT-Broker nicht erreichbar';
      this.ctx.broadcast('ha', null);
    });
  }

  device(cfg) {
    return {
      identifiers: [`printdock_${cfg.id}`],
      name: cfg.name,
      manufacturer: 'PrintDock',
      model: cfg.settings?.model || cfg.driver,
      configuration_url: this.directUrl,
      via_device: 'printdock_server',
    };
  }

  /** Alle Entitäten neu ankündigen (und entfernte Drucker abmelden). */
  publishDiscovery() {
    if (!this.client?.connected) return;
    const now = new Set();
    const pub = (component, objectId, config) => {
      const topic = `${this.prefix}/${component}/printdock/${objectId}/config`;
      now.add(topic);
      this.client.publish(topic, JSON.stringify(config), { retain: true });
    };
    const avail = [{ topic: `${this.base}/status` }];

    // Server-Gerät mit Gesamtkennzahlen
    const server = { identifiers: ['printdock_server'], name: 'PrintDock', manufacturer: 'PrintDock', model: tr('Druckerverwaltung'), configuration_url: this.directUrl };
    const sumTopic = `${this.base}/summary`;
    for (const [key, name, icon, unit] of [
      ['queued', 'Warteschlange', 'mdi:tray-full', 'Drucke'],
      ['printing', 'Drucker aktiv', 'mdi:printer-3d-nozzle', null],
      ['ordersLate', 'Aufträge überfällig', 'mdi:calendar-alert', null],
      ['spoolsLow', 'Spulen knapp', 'mdi:printer-3d-nozzle-alert', null],
      ['maintDue', 'Wartungen fällig', 'mdi:wrench-clock', null],
    ]) {
      pub('sensor', `server_${key}`, {
        name: tr(name), unique_id: `printdock_server_${key}`, state_topic: sumTopic, value_template: `{{ value_json.${key} }}`,
        icon, unit_of_measurement: unit ? tr(unit) : undefined, state_class: 'measurement', availability: avail, device: server,
      });
    }

    for (const cfg of this.ctx.printers()) {
      const id = cfg.id;
      const obj = (k) => `${id.slice(0, 8)}_${k}`;
      const st = `${this.base}/printer/${id}/state`;
      const cmd = `${this.base}/printer/${id}/cmd`;
      const dev = this.device(cfg);
      const base = (k, name) => ({ name: tr(name), unique_id: `printdock_${id}_${k}`, availability: avail, device: dev });
      const status = this.ctx.runtime.get(id)?.driver.status || {};

      pub('sensor', obj('status'), { ...base('status', 'Status'), state_topic: st, value_template: '{{ value_json.state_text }}', icon: 'mdi:printer-3d', json_attributes_topic: st });
      pub('sensor', obj('progress'), { ...base('progress', 'Fortschritt'), state_topic: st, value_template: '{{ value_json.progress }}', unit_of_measurement: '%', icon: 'mdi:progress-clock', state_class: 'measurement' });
      pub('sensor', obj('remaining'), { ...base('remaining', 'Restzeit'), state_topic: st, value_template: '{{ value_json.remaining_min }}', unit_of_measurement: 'min', device_class: 'duration' });
      pub('sensor', obj('finish'), { ...base('finish', 'Fertig um'), state_topic: st, value_template: '{{ value_json.finish_at or None }}', device_class: 'timestamp' });
      pub('sensor', obj('file'), { ...base('file', 'Datei'), state_topic: st, value_template: '{{ value_json.file or "–" }}', icon: 'mdi:file-cad' });
      pub('sensor', obj('layer'), { ...base('layer', 'Schicht'), state_topic: st, value_template: '{{ value_json.layer_text }}', icon: 'mdi:layers-triple' });
      (status.nozzles?.length ? status.nozzles : [{ name: 'Düse' }]).forEach((n, i) => {
        pub('sensor', obj(`nozzle${i}`), { ...base(`nozzle${i}`, status.nozzles?.length > 1 ? tr('Düse {n}', { n: n.name }) : 'Düse'), state_topic: st, value_template: `{{ value_json.nozzle${i} }}`, unit_of_measurement: '°C', device_class: 'temperature', state_class: 'measurement' });
      });
      pub('sensor', obj('bed'), { ...base('bed', 'Bett'), state_topic: st, value_template: '{{ value_json.bed }}', unit_of_measurement: '°C', device_class: 'temperature', state_class: 'measurement' });
      if (status.chamber) pub('sensor', obj('chamber'), { ...base('chamber', 'Bauraum'), state_topic: st, value_template: '{{ value_json.chamber }}', unit_of_measurement: '°C', device_class: 'temperature', state_class: 'measurement' });
      pub('binary_sensor', obj('online'), { ...base('online', 'Verbunden'), state_topic: st, value_template: "{{ 'ON' if value_json.online else 'OFF' }}", device_class: 'connectivity' });
      pub('binary_sensor', obj('printing'), { ...base('printing', 'Druckt'), state_topic: st, value_template: "{{ 'ON' if value_json.printing else 'OFF' }}", device_class: 'running' });
      pub('binary_sensor', obj('plate'), { ...base('plate', 'Platte räumen'), state_topic: st, value_template: "{{ 'ON' if value_json.needs_clear else 'OFF' }}", device_class: 'problem', icon: 'mdi:tray-alert' });
      for (const [k, name, icon] of [['pause', 'Pause', 'mdi:pause'], ['resume', 'Fortsetzen', 'mdi:play'], ['cancel', 'Abbrechen', 'mdi:stop'], ['plate_clear', 'Platte ist frei', 'mdi:check-circle']]) {
        pub('button', obj(k), { ...base(k, name), command_topic: cmd, payload_press: k, icon });
      }
      if (status.capabilities?.includes('light')) {
        pub('switch', obj('light'), { ...base('light', 'Licht'), state_topic: st, value_template: "{{ 'ON' if value_json.light else 'OFF' }}", command_topic: cmd, payload_on: 'light_on', payload_off: 'light_off', state_on: 'ON', state_off: 'OFF', icon: 'mdi:lightbulb' });
      }
      if (status.capabilities?.includes('speed')) {
        pub('select', obj('speed'), { ...base('speed', 'Geschwindigkeit'), state_topic: st, value_template: '{{ value_json.speed }}', command_topic: cmd, command_template: '{{ "speed_" ~ value }}', options: Object.values(speedLabels()), icon: 'mdi:speedometer' });
      }
      if (status.camera) {
        pub('image', obj('camera'), { ...base('camera', 'Kamera'), url_topic: `${this.base}/printer/${id}/camera_url` });
        this.client.publish(`${this.base}/printer/${id}/camera_url`, `${this.directUrl}/api/printers/${id}/camera.jpg${app.authEnabled ? `?k=${app.apiKey}` : ''}`, { retain: true });
      }
      this.publishState(cfg, true);
    }
    // Abgemeldete Drucker entfernen
    for (const t of this.published) if (!now.has(t)) this.client.publish(t, '', { retain: true });
    this.published = now;
    this.publishSummary();
  }

  /** Zustand eines Druckers veröffentlichen (gedrosselt). */
  publishState(cfg, force = false) {
    if (!this.client?.connected) return;
    const last = this.lastPublish.get(cfg.id) || 0;
    if (!force && Date.now() - last < 3000) {
      clearTimeout(this[`t_${cfg.id}`]);
      this[`t_${cfg.id}`] = setTimeout(() => this.publishState(cfg, true), 3000);
      return;
    }
    this.lastPublish.set(cfg.id, Date.now());
    const s = this.ctx.runtime.get(cfg.id)?.driver.status || { state: 'offline' };
    const summary = this.ctx.production.summary();
    const active = ['printing', 'preparing', 'paused'].includes(s.state);
    const payload = {
      state: s.state,
      state_text: STATE_DE[s.state] ? tr(STATE_DE[s.state]) : s.state,
      online: Boolean(s.online),
      printing: active,
      needs_clear: summary.plate?.[cfg.id] === false && ['finished', 'cancelled', 'idle'].includes(s.state),
      progress: active || s.state === 'finished' ? Math.floor(s.progress ?? 0) : 0,
      remaining_min: s.remainingSec != null && active ? Math.round(s.remainingSec / 60) : 0,
      finish_at: s.remainingSec != null && active ? new Date(Date.now() + s.remainingSec * 1000).toISOString() : null,
      file: active || s.state === 'finished' ? s.file : null,
      layer_text: s.layer != null && s.totalLayers ? `${s.layer} / ${s.totalLayers}` : '–',
      bed: s.bed?.current ?? null,
      chamber: s.chamber?.current ?? null,
      light: s.light ?? null,
      speed: s.speed?.level ? speedLabels()[s.speed.level] : null,
      message: s.message || null,
      power: this.power[cfg.id] ?? null,
    };
    (s.nozzles || []).forEach((n, i) => (payload[`nozzle${i}`] = n.current ?? null));
    this.client.publish(`${this.base}/printer/${cfg.id}/state`, JSON.stringify(payload), { retain: true });
  }

  publishSummary() {
    if (!this.client?.connected) return;
    const s = this.ctx.summary();
    const printing = this.ctx.printers().filter((p) => ['printing', 'preparing'].includes(this.ctx.runtime.get(p.id)?.driver.status.state)).length;
    this.client.publish(`${this.base}/summary`, JSON.stringify({ ...s, printing, plate: undefined, next: undefined }), { retain: true });
  }

  async onMqttMessage(topic, payload) {
    if (topic === `${this.prefix}/status`) {
      if (payload === 'online') setTimeout(() => this.publishDiscovery(), 2000); // HA neu gestartet
      return;
    }
    const m = topic.match(/\/printer\/([^/]+)\/cmd$/);
    if (!m) return;
    const id = m[1];
    const rt = this.ctx.runtime.get(id);
    if (!rt) return;
    try {
      if (['pause', 'resume', 'cancel'].includes(payload)) await rt.driver.command(payload);
      else if (payload === 'plate_clear') this.ctx.production.setPlateClear(id, true);
      else if (payload === 'light_on' || payload === 'light_off') await rt.driver.command('light', { on: payload === 'light_on' });
      else if (payload.startsWith('speed_')) {
        const level = Number(Object.entries(speedLabels()).find(([, l]) => l === payload.slice(6))?.[0]);
        if (level) await rt.driver.command('speed', { level });
      }
      console.log(`Home Assistant: ${payload} für ${id.slice(0, 8)}`);
    } catch (err) {
      console.warn(`Home Assistant-Befehl fehlgeschlagen: ${err.message}`);
    }
  }
}

module.exports = { HomeAssistant, ADDON };
