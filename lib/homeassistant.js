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
    return require('./hostinfo').directUrl(this.ctx.port, db.data.publicUrl);
  }

  /** Adresse, unter der Home Assistant selbst PrintDock erreicht (Kamerabilder). */
  get coreUrl() {
    // Als Add-on erreicht Home Assistant uns immer über das interne Netz – auch wenn der Port nach außen zu ist
    if (ADDON && !db.data.publicUrl) return `http://${require('./hostinfo').localIp()}:${this.ctx.port}`;
    return this.directUrl;
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
      cardInstalled: Boolean(this.cardInstalled),
      card: this.card || null,
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
    if (ADDON && enabled() && !this.cardInstalled && this.card?.state !== 'working') this.installCard().catch((err) => console.warn(`PrintDock-Karte: ${err.message}`));
    this.pollPower();
    this.connectMqtt();
  }

  // ================================================================ Lovelace-Karte (Add-on)

  /**
   * Als Add-on: Karte nach /homeassistant/www/printdock kopieren und als Dashboard-Ressource
   * eintragen (bzw. Version aktualisieren). Danach steht „PrintDock Card“ in der Kartenauswahl.
   */
  async installCard() {
    const fs = require('fs');
    const path = require('path');
    const version = require('../package.json').version;
    this.card = { state: 'working', error: null };
    try {
      // Konfigurationsordner: /homeassistant (map homeassistant_config) oder /config (ältere Supervisor-Versionen)
      const root = ['/homeassistant', '/config'].find((p) => fs.existsSync(path.join(p, 'configuration.yaml')));
      if (!root) throw new Error(tr('Konfigurationsordner von Home Assistant nicht gefunden (/homeassistant)'));
      const wwwExisted = fs.existsSync(path.join(root, 'www'));
      const dir = path.join(root, 'www', 'printdock');
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(path.join(__dirname, '..', 'dist', 'printdock-card.js'), path.join(dir, 'printdock-card.js'));
      const url = `/local/printdock/printdock-card.js?v=${version}`;
      let yaml = false;
      await this.ws(async (call) => {
        let list;
        try { list = await call({ type: 'lovelace/resources' }); } catch (err) { yaml = true; return; }
        const found = (list || []).find((r) => /printdock-card\.js/.test(r.url));
        try {
          if (!found) await call({ type: 'lovelace/resources/create', res_type: 'module', url });
          else if (found.url !== url) await call({ type: 'lovelace/resources/update', resource_id: found.id, res_type: 'module', url });
        } catch (err) {
          if (/yaml|not supported|storage/i.test(err.message)) yaml = true; else throw err;
        }
      });
      // /local/ gibt es in Home Assistant nur, wenn der Ordner www beim Start schon da war
      const reachable = await this.localReachable(url);
      this.card = {
        state: yaml ? 'yaml' : reachable === false ? 'restart' : 'ok',
        error: null,
        url,
        wwwCreated: !wwwExisted,
      };
      this.cardInstalled = this.card.state === 'ok';
      if (this.card.state === 'restart') this.watchCard(url);
      console.log(`PrintDock-Karte: ${{ ok: 'in Home Assistant eingerichtet', restart: 'kopiert – Home Assistant einmal neu starten, damit /local/ verfügbar ist', yaml: 'kopiert – Dashboards im YAML-Modus: Ressource von Hand eintragen' }[this.card.state]}`);
    } catch (err) {
      this.card = { state: 'error', error: err.message };
      this.cardInstalled = false;
      throw err;
    }
  }

  /** Nach dem Neustart von Home Assistant: sobald /local/ antwortet, gilt die Karte als eingerichtet. */
  watchCard(url) {
    clearInterval(this.cardTimer);
    this.cardTimer = setInterval(async () => {
      if (this.card?.state !== 'restart') return clearInterval(this.cardTimer);
      if (await this.localReachable(url)) {
        clearInterval(this.cardTimer);
        this.card = { ...this.card, state: 'ok' };
        this.cardInstalled = true;
        console.log('PrintDock-Karte: Home Assistant liefert sie jetzt aus');
        this.ctx.broadcast?.('ha', null);
      }
    }, 20_000);
    this.cardTimer.unref?.();
  }

  /** Prüft, ob Home Assistant die Datei unter /local/ ausliefert (null = nicht prüfbar). */
  async localReachable(url) {
    for (const base of ['http://homeassistant:8123', 'http://supervisor/core']) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(base + url, { signal: ctrl.signal, headers: base.includes('supervisor') ? { Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}` } : {} });
        clearTimeout(t);
        if (res.ok) return true;
        if (res.status === 404 && !base.includes('supervisor')) return false;
      } catch {}
    }
    return null;
  }

  /** Home Assistant neu starten (nach dem ersten Anlegen von /config/www nötig). */
  async restartCore() {
    // Home Assistant beendet dabei die Verbindung – das ist hier kein Fehler
    await this.rest('services/homeassistant/restart', { method: 'POST', body: {} }).catch((err) => {
      if (err.status === 400) throw err;
    });
    return { ok: true };
  }

  /** Kurze WebSocket-Sitzung mit Home Assistant (Add-on: über den Supervisor). */
  ws(fn) {
    const WS = globalThis.WebSocket || (() => { try { return require('ws'); } catch { return null; } })();
    if (!WS) return Promise.reject(new Error('WebSocket nicht verfügbar'));
    const url = ADDON ? 'ws://supervisor/core/websocket' : `${this.restUrl.replace(/^http/, 'ws')}/api/websocket`;
    return new Promise((resolve, reject) => {
      const sock = new WS(url);
      let n = 0;
      const pending = new Map();
      const timer = setTimeout(() => { try { sock.close(); } catch {} reject(new Error('Zeitüberschreitung')); }, 15000);
      const call = (msg) => new Promise((res, rej) => {
        const id = ++n;
        pending.set(id, { res, rej });
        sock.send(JSON.stringify({ id, ...msg }));
      });
      const onMessage = async (raw) => {
        const msg = JSON.parse(typeof raw === 'string' ? raw : raw.data ?? raw.toString());
        if (msg.type === 'auth_required') sock.send(JSON.stringify({ type: 'auth', access_token: this.restToken }));
        else if (msg.type === 'auth_invalid') { clearTimeout(timer); reject(new Error('Home Assistant lehnt den Token ab')); sock.close(); }
        else if (msg.type === 'auth_ok') {
          try { resolve(await fn(call)); } catch (err) { reject(err); } finally { clearTimeout(timer); sock.close(); }
        } else if (msg.type === 'result' && pending.has(msg.id)) {
          const p = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.success) p.res(msg.result);
          else p.rej(new Error(msg.error?.message || 'Fehler'));
        }
      };
      if (sock.addEventListener) {
        sock.addEventListener('message', (e) => onMessage(e.data));
        sock.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Home Assistant nicht erreichbar')); });
      } else {
        sock.on('message', onMessage);
        sock.on('error', (err) => { clearTimeout(timer); reject(err); });
      }
    });
  }

  /** Ohne Add-on: Karte über die Home-Assistant-Verbindung als Ressource eintragen (URL von PrintDock). */
  async registerCardResource() {
    const version = require('../package.json').version;
    const url = `${this.directUrl}/printdock-card.js?v=${version}`;
    await this.ws(async (call) => {
      const list = await call({ type: 'lovelace/resources' });
      const found = (list || []).find((r) => /printdock-card\.js/.test(r.url));
      if (!found) await call({ type: 'lovelace/resources/create', res_type: 'module', url });
      else if (found.url !== url) await call({ type: 'lovelace/resources/update', resource_id: found.id, res_type: 'module', url });
    });
    return { url };
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
  // ================================================================ Benachrichtigungen über Home Assistant

  /** Mögliche Ziele: notify.* (Companion-Apps, Gruppen …) und die Meldungsglocke von Home Assistant. */
  async notifyServices() {
    const list = [{ id: 'persistent_notification', name: tr('Home Assistant (Meldungen in der Seitenleiste)') }];
    const services = await this.rest('services');
    const notify = (services || []).find((d) => d.domain === 'notify');
    for (const [name, def] of Object.entries(notify?.services || {})) {
      if (['send_message', 'persistent_notification'].includes(name)) continue;
      list.push({ id: `notify.${name}`, name: def?.name && def.name !== name ? `${def.name} (${name})` : name.replace(/^mobile_app_/, tr('Handy-App: ')) });
    }
    return list;
  }

  /** Bild-Entität der Kamera eines Druckers (für das Bild in der Handy-Benachrichtigung). */
  async cameraEntity(printerId) {
    this.camEntities ||= { at: 0, map: {} };
    if (Date.now() - this.camEntities.at > 10 * 60_000) {
      try {
        const list = await this.ws((call) => call({ type: 'config/entity_registry/list' }));
        this.camEntities = { at: Date.now(), map: Object.fromEntries((list || []).filter((e) => /^printdock_.+_camera$/.test(e.unique_id || '')).map((e) => [e.unique_id.slice(10, -7), e.entity_id])) };
      } catch {}
    }
    return this.camEntities.map[printerId] || null;
  }

  /**
   * Bild für eine Meldung: als Add-on das Kamerabild vom Moment des Ereignisses unter /local ablegen
   * (zufälliger Name, nach 2 Tagen gelöscht), sonst das aktuelle Bild der Kamera-Entität.
   * Die Companion-App lädt beides über Home Assistant – klappt auch unterwegs.
   */
  async notifyImage(image, printerId) {
    if (!image) return null;
    if (ADDON && Buffer.isBuffer(image) && image.length && this.card?.state !== 'restart') {
      try {
        const fs = require('fs');
        const path = require('path');
        const root = ['/homeassistant', '/config'].find((p) => fs.existsSync(path.join(p, 'configuration.yaml')));
        if (root && fs.existsSync(path.join(root, 'www'))) {
          const dir = path.join(root, 'www', 'printdock', 'snap');
          fs.mkdirSync(dir, { recursive: true });
          for (const f of fs.readdirSync(dir)) {
            const full = path.join(dir, f);
            if (Date.now() - fs.statSync(full).mtimeMs > 2 * 864e5) fs.rmSync(full, { force: true });
          }
          const name = `${require('crypto').randomBytes(12).toString('hex')}.jpg`;
          fs.writeFileSync(path.join(dir, name), image);
          return `/local/printdock/snap/${name}`;
        }
      } catch (err) {
        console.warn(`Kamerabild für Home Assistant: ${err.message}`);
      }
    }
    const cam = printerId ? await this.cameraEntity(printerId) : null;
    return cam ? `/api/image_proxy/${cam}` : null;
  }

  /**
   * Meldung über Home Assistant verschicken.
   * service: "notify.mobile_app_xyz" oder "persistent_notification"
   */
  async notify(service, msg, { image = false, priority = 3 } = {}) {
    if (!service) throw httpError(400, 'Kein Ziel gewählt');
    if (service === 'persistent_notification') {
      const img = await this.notifyImage(image, msg.printer?.id);
      await this.rest('services/persistent_notification/create', {
        method: 'POST',
        body: { title: msg.title, message: img ? `${msg.body}\n\n![](${img})` : msg.body, notification_id: `printdock_${msg.printer?.id || 'app'}_${msg.event}` },
      });
      return;
    }
    const m = /^notify\.([\w-]+)$/.exec(service);
    if (!m) throw httpError(400, 'Ungültiges Ziel');
    const data = { group: 'printdock', tag: `printdock_${msg.printer?.id || 'app'}` };
    const img = await this.notifyImage(image, msg.printer?.id);
    if (img) data.image = img;
    // Antippen öffnet PrintDock in Home Assistant (Add-on) bzw. die PrintDock-Adresse
    const slug = require('./hostinfo').info.slug;
    const open = ADDON && slug ? `/hassio/ingress/${slug}` : this.directUrl;
    data.url = open; // iOS
    data.clickAction = open; // Android
    if (priority >= 5) {
      data.priority = 'high';
      data.ttl = 0;
      data.push = { 'interruption-level': 'time-sensitive' };
    }
    await this.rest(`services/notify/${m[1]}`, { method: 'POST', body: { title: msg.title, message: msg.body, data } });
  }

  /** Schaltbare Entitäten für die Steckdosen-Auswahl, mit Bereich (sofern Home Assistant ihn liefert). */
  async entities(domains = ['switch', 'light', 'input_boolean']) {
    const states = await this.rest('states');
    let areaOf = {};
    const own = new Set();
    try {
      areaOf = await this.ws(async (call) => {
        const [ents, devs, areas] = await Promise.all([
          call({ type: 'config/entity_registry/list' }),
          call({ type: 'config/device_registry/list' }),
          call({ type: 'config/area_registry/list' }),
        ]);
        const areaName = Object.fromEntries((areas || []).map((a) => [a.area_id, a.name]));
        const devArea = Object.fromEntries((devs || []).map((d) => [d.id, d.area_id]));
        // Eigene PrintDock-Entitäten (z. B. Licht-Schalter) sind keine Steckdosen
        for (const e of ents || []) if (String(e.unique_id || '').startsWith('printdock_')) own.add(e.entity_id);
        return Object.fromEntries((ents || []).map((e) => [e.entity_id, areaName[e.area_id || devArea[e.device_id]] || '']));
      });
    } catch {}
    return states
      .filter((s) => domains.includes(s.entity_id.split('.')[0]) && !own.has(s.entity_id))
      .map((s) => ({ entity_id: s.entity_id, name: s.attributes?.friendly_name || s.entity_id, state: s.state, area: areaOf[s.entity_id] || '' }))
      .sort((a, b) => (a.area || '\uffff').localeCompare(b.area || '\uffff') || a.name.localeCompare(b.name));
  }

  async pollPower() {
    this.pollHumidity().catch(() => {});
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

  /** Feuchtesensoren aus Home Assistant, die einer Messstelle (AMS/ACE ohne Messung, Trockenbox) zugeordnet sind. */
  async pollHumidity() {
    const fil = this.ctx.filament;
    const list = (fil ? require('./filament').db.data.humSources : []).filter((x) => x.kind === 'ha' && x.entity);
    if (!enabled() || !list.length || !this.restUrl || !this.restToken) return;
    for (const src of list) {
      try {
        const s = await this.rest(`states/${encodeURIComponent(src.entity)}`);
        const pct = parseFloat(s.state);
        if (!src.name && s.attributes?.friendly_name) src.name = String(s.attributes.friendly_name).slice(0, 40);
        if (Number.isFinite(pct)) fil.recordSource(src, pct, null);
      } catch {}
    }
  }

  /** Feuchtesensoren für die Auswahl bei den Messstellen. */
  async humiditySensors() {
    const states = await this.rest('states');
    return states.filter((s) => /^sensor\./.test(s.entity_id) && (s.attributes?.device_class === 'humidity' || /humid|feucht/i.test(s.entity_id)))
      .map((s) => ({ entity_id: s.entity_id, name: s.attributes?.friendly_name || s.entity_id, state: `${s.state}${s.attributes?.unit_of_measurement || ''}`, area: '' }));
  }

  /**
   * Eine Entität bedienen – für Trockner: Schalter/Steckdose an/aus, Taste drücken, Skript starten,
   * Zahl setzen (Temperatur, Dauer).
   */
  async callEntity(entity, action, value) {
    const domain = String(entity).split('.')[0];
    if (!/^[a-z_]+\.[\w]+$/.test(String(entity))) throw httpError(400, `Ungültige Entität ${entity}`);
    if (action === 'set') {
      if (!['number', 'input_number'].includes(domain)) throw httpError(400, `${entity} ist keine Zahl-Entität`);
      return this.rest(`services/${domain}/set_value`, { method: 'POST', body: { entity_id: entity, value } });
    }
    if (domain === 'button' || domain === 'input_button') return this.rest(`services/${domain}/press`, { method: 'POST', body: { entity_id: entity } });
    if (domain === 'script') return this.rest(`services/script/${action === 'off' ? 'turn_off' : 'turn_on'}`, { method: 'POST', body: { entity_id: entity } });
    if (['switch', 'light', 'input_boolean', 'fan', 'climate', 'humidifier'].includes(domain)) return this.rest(`services/${domain}/${action === 'off' ? 'turn_off' : 'turn_on'}`, { method: 'POST', body: { entity_id: entity } });
    throw httpError(400, `${entity} lässt sich nicht schalten`);
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
    // Übersicht für die PrintDock-Übersichtskarte: alle Drucker, Warteschlange, Aufträge, Spulen, Wartung als Attribute
    pub('sensor', 'server_overview', {
      name: tr('Übersicht'), unique_id: 'printdock_server_overview', state_topic: `${this.base}/overview`, value_template: '{{ value_json.printing }}',
      json_attributes_topic: `${this.base}/overview`, icon: 'mdi:printer-3d', unit_of_measurement: tr('Drucke'), availability: avail, device: server,
    });

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
        this.client.publish(`${this.base}/printer/${id}/camera_url`, `${this.coreUrl}/api/printers/${id}/camera.jpg${app.authEnabled ? `?k=${app.apiKey}` : ''}`, { retain: true });
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
    const card = this.cardData(cfg, s, summary);
    const payload = {
      ...card,
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
    // Kamerabild: Adresse mit Zeitstempel neu senden, damit Home Assistant ein frisches Bild holt
    if (s.camera && s.online && app.moduleOn('camera') && Date.now() - (this.camAt?.[cfg.id] || 0) > 10000) {
      (this.camAt ||= {})[cfg.id] = Date.now();
      const k = app.authEnabled ? `k=${app.apiKey}&` : '';
      this.client.publish(`${this.base}/printer/${cfg.id}/camera_url`, `${this.coreUrl}/api/printers/${cfg.id}/camera.jpg?${k}t=${Date.now()}`, { retain: true });
    }
    this.publishOverview();
  }

  /** Alle Drucker neu veröffentlichen (z. B. nach Änderungen an Warteschlange oder Filament). */
  publishAllStates() {
    for (const cfg of this.ctx.printers()) this.publishState(cfg);
  }

  /** Ampel wie in PrintDock: free, run, wait, fault, off */
  category(cfg, s, summary) {
    const sending = this.ctx.production.queueView().some((q) => q.printerId === cfg.id && q.status === 'sending');
    if (!s.online) return ['off', tr('Offline')];
    if (s.state === 'error') return ['fault', tr('Störung')];
    if (s.state === 'paused') return ['wait', tr('Pausiert')];
    if (s.state === 'printing' || s.state === 'preparing') return ['run', tr(STATE_DE[s.state])];
    if (sending) return ['run', tr('Überträgt')];
    if (['idle', 'finished', 'cancelled'].includes(s.state) && summary.plate?.[cfg.id] === false) return ['wait', tr('Platte räumen')];
    return ['free', tr('Frei')];
  }

  /** Alles, was die PrintDock-Karte in Home Assistant zum Zeichnen braucht. */
  cardData(cfg, s, summary) {
    const [category, lamp] = this.category(cfg, s, summary);
    const noz = s.nozzles || [];
    const activeTool = s.activeSlot?.startsWith('T') ? Number(s.activeSlot.slice(1)) : null;
    const temps = [
      ...noz.map((n, i) => ({ label: noz.length > 1 ? tr('Düse {n}', { n: tr(n.name) }) : tr('Düse'), current: n.current ?? null, target: n.target || null, active: activeTool === i })),
      ...(s.bed ? [{ label: tr('Bett'), current: s.bed.current ?? null, target: s.bed.target || null }] : []),
      ...(s.chamber ? [{ label: tr('Kammer'), current: s.chamber.current ?? null, target: s.chamber.target || null }] : []),
    ];
    let slots = [];
    if (app.moduleOn('filament') && this.ctx.filament) {
      const fv = this.ctx.filament.view();
      const fp = fv.printers.find((x) => x.id === cfg.id);
      const spools = fv.spools;
      slots = (fp?.slots || []).map((sl) => {
        const sp = sl.spoolId ? spools.find((x) => x.id === sl.spoolId) : null;
        return {
          label: tr(sl.label), unit: tr(sl.unit || 'Spulen'), material: sp?.material || sl.material || null, color: sp?.color || sl.color || null,
          amount: sp ? `${Math.round(sp.remaining)} g` : sl.remainPct != null ? `${sl.remainPct} %` : '', spool: sp?.nr || null, low: Boolean(sp?.low), active: fp.activeSlot === sl.key,
        };
      });
    } else {
      slots = (s.filament || []).map((sl) => ({ label: tr(sl.label), unit: tr(sl.unit || 'Spulen'), material: sl.material || null, color: sl.color || null, amount: sl.remainPct != null ? `${sl.remainPct} %` : '', spool: null, low: false, active: s.activeSlot === sl.key }));
    }
    // Feuchte je Einheit: was AMS/ACE selbst melden, dazu zugeordnete Sensoren (Home Assistant, PrintDock Station)
    const fil = this.ctx.filament;
    const humUnits = (s.filamentUnits || []).filter((u) => u.humidityPct != null)
      .map((u) => ({ unit: u.name, pct: u.humidityPct, temp: u.temp ?? null, level: fil?.humLevel(u.humidityPct) || null, source: 'builtin' }));
    for (const h of fil?.humidityView().filter((x) => x.printerId === cfg.id && !x.stale) || []) if (!humUnits.some((u) => u.unit === h.unit)) humUnits.push(h);
    humUnits.sort((a, b) => ({ alarm: 0, warn: 1 }[a.level] ?? 2) - ({ alarm: 0, warn: 1 }[b.level] ?? 2));
    const queue = this.ctx.production.queueView();
    const nextId = summary.next?.[cfg.id];
    const next = nextId ? queue.find((q) => q.id === nextId) : null;
    const current = queue.find((q) => q.printerId === cfg.id && ['printing', 'sending'].includes(q.status));
    return {
      printdock: cfg.id,
      printer_name: cfg.name,
      printer_state: s.state,
      model: cfg.settings?.model || '',
      category,
      lamp,
      temps,
      fans: (s.fans || []).map((f) => ({ name: tr(f.name), pct: f.pct })),
      filament: slots,
      filament_units: humUnits.map((u) => ({ name: tr(u.unit), humidity: u.pct, temp: u.temp, level: u.level, external: u.source !== 'builtin' })),
      humidity_alert: humUnits.filter((u) => u.level === 'warn' || u.level === 'alarm').map((u) => ({ name: tr(u.unit), humidity: Math.round(u.pct), level: u.level }))[0] || null,
      job_order: current?.order ? `${current.order.nr} · ${current.order.title}` : null,
      next_job: next?.file?.name || null,
      queued: queue.filter((q) => q.status === 'queued' && q.printerId === cfg.id).length,
      hms: (s.hms || []).length,
      elapsed_min: s.elapsedSec != null ? Math.round(s.elapsedSec / 60) : null,
      layer: s.layer ?? null,
      total_layers: s.totalLayers ?? null,
      nozzle_diameter: s.nozzleDiameter || null,
      speed_options: Object.values(speedLabels()),
      can_light: Boolean(s.capabilities?.includes('light')),
      can_speed: Boolean(s.capabilities?.includes('speed')),
      can_power: Boolean(cfg.settings?.powerEntity),
      power_entity: cfg.settings?.powerEntity || null,
      cmd_topic: `${this.base}/printer/${cfg.id}/cmd`,
      url: this.directUrl,
    };
  }

  /** Übersicht aller Drucker und Listen für die Übersichtskarte (gedrosselt). */
  publishOverview(force = false) {
    if (!this.client?.connected) return;
    if (!force && Date.now() - (this.lastOverview || 0) < 4000) {
      clearTimeout(this.ovTimer);
      this.ovTimer = setTimeout(() => this.publishOverview(true), 4000);
      return;
    }
    this.lastOverview = Date.now();
    const summary = this.ctx.production.summary();
    const queue = this.ctx.production.queueView();
    const printers = this.ctx.printers().map((cfg) => {
      const s = this.ctx.runtime.get(cfg.id)?.driver.status || { state: 'offline' };
      const [category, lamp] = this.category(cfg, s, summary);
      const active = ['printing', 'preparing', 'paused'].includes(s.state);
      return {
        id: cfg.id, name: cfg.name, model: cfg.settings?.model || '', category, lamp,
        progress: active ? Math.floor(s.progress ?? 0) : null,
        remaining_min: active && s.remainingSec != null ? Math.round(s.remainingSec / 60) : null,
        file: active ? s.file : null,
      };
    });
    const fil = app.moduleOn('filament') && this.ctx.filament ? this.ctx.filament.view() : null;
    const maint = app.moduleOn('maintenance') ? this.ctx.production.maintenanceView() : null;
    const today = new Date().toISOString().slice(0, 10);
    const orders = app.moduleOn('orders') ? this.ctx.production.orders().filter((o) => !o.closed && o.status !== 'fertig') : [];
    const pname = (id) => this.ctx.printers().find((p) => p.id === id)?.name || '';
    const payload = {
      printing: printers.filter((p) => p.category === 'run').length,
      counts: Object.fromEntries(['free', 'run', 'wait', 'fault', 'off'].map((c) => [c, printers.filter((p) => p.category === c).length])),
      printers,
      queue: app.moduleOn('queue') ? queue.filter((q) => ['queued', 'sending', 'printing'].includes(q.status)).slice(0, 12).map((q) => ({
        file: q.file?.name || '–', printer: pname(q.printerId) || tr('Passender Drucker'), order: q.order?.nr || null,
        status: q.status, status_text: tr({ queued: 'wartet', sending: 'überträgt', printing: 'druckt' }[q.status] || q.status),
      })) : null,
      queued: queue.filter((q) => q.status === 'queued').length,
      orders: app.moduleOn('orders') ? orders.slice(0, 10).map((o) => ({ nr: o.nr, title: o.title, due: o.due || null, late: Boolean(o.due && o.due < today), done: o.done, qty: o.qty })) : null,
      spools_low: fil ? fil.spools.filter((x) => x.low && !x.archived).slice(0, 10).map((x) => ({ nr: x.nr, material: x.material, color: x.color, color_name: tr(x.colorName || ''), remaining: Math.round(x.remaining) })) : null,
      maintenance: maint ? maint.tasks.filter((x) => x.state !== 'ok').sort((a, b) => b.ratio - a.ratio).slice(0, 10).map((x) => ({ printer: pname(x.printerId), title: tr(x.title), due: x.state === 'due' })) : null,
      url: this.directUrl,
      lang: app.lang,
    };
    this.client.publish(`${this.base}/overview`, JSON.stringify(payload), { retain: true });
  }

  publishSummary() {
    if (!this.client?.connected) return;
    this.publishOverview();
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
