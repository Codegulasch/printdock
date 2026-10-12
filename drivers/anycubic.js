// Anycubic im LAN-Modus (Kobra S1, Kobra X und weitere mit „LAN-Modus“ am Drucker) – ohne Cloud.
//
// Ablauf (Protokoll dokumentiert von anycubic-lan, MIT, github.com/Nino6689/anycubic-lan):
//   1. GET  http://<drucker>:18910/info            → Discovery mit token, ctrlInfoUrl, modelId
//   2. POST <ctrlInfoUrl>?ts&nonce&sign&did        → verschlüsselte Zugangsdaten
//      sign = md5(md5(token[0:16]) + ts + nonce), AES-128-CBC mit token[16:32], IV = data.token
//   3. MQTT über TLS zum Broker des Druckers (selbstsigniert), Berichte auf
//      anycubic/anycubicCloud/v1/printer/public/<modelId>/<deviceId>/#,
//      Abfragen und Befehle auf …/web/printer/<modelId>/<deviceId>/<art>
// Der Drucker schickt nicht alles von sich aus – PrintDock fragt alle 15 s nach.
//
// Unterstützt: Status, Temperaturen, Lüfter, Licht, Pause/Weiter/Stopp, Kamera (HTTP-FLV über ffmpeg),
// ACE: Belegung, Temperatur, Trocknen (an/aus mit Temperatur und Dauer), Material/Farbe eines Fachs setzen.
const crypto = require('crypto');
const mqtt = require('mqtt');
const { BaseDriver, temp, netError, fileBlob, postForm, downloadTo } = require('./base');

const PREFIX = 'anycubic/anycubicCloud/v1';
const QUERIES = { info: 'query', tempature: 'query', fan: 'query', light: 'query', multiColorBox: 'getInfo', print: 'query', peripherie: 'query' };
const MODELS = { 20025: 'Kobra S1', 20030: 'Kobra X' };
const ACE_MODELS = { 40001: 'ACE Pro', 40002: 'ACE 2 Pro' };

const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');
const rand = (alphabet, n) => Array.from(crypto.randomBytes(n), (b) => alphabet[b % alphabet.length]).join('');

/** Zugangsdaten zum Broker holen (Schritt 1 und 2). */
async function handshake(host) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const disc = await fetch(`http://${host}:18910/info`, { signal: ctrl.signal }).then((r) => r.text()).then((t) => JSON.parse(t));
    if (disc.ctrlType === 'cloud') throw new Error('Am Drucker ist der LAN-Modus aus (Einstellungen → Netzwerk → LAN-Modus einschalten)');
    if (disc.ctrlType !== 'lan' || typeof disc.token !== 'string' || disc.token.length !== 32 || !disc.ctrlInfoUrl) throw new Error('Dieser Drucker unterstützt den Anycubic-LAN-Modus nicht (älteres Modell?)');
    const ts = Date.now();
    const nonce = rand('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 6);
    const sign = md5(md5(disc.token.slice(0, 16)) + ts + nonce);
    const did = rand('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 32);
    const sep = disc.ctrlInfoUrl.includes('?') ? '&' : '?';
    const res = await fetch(`${disc.ctrlInfoUrl}${sep}ts=${ts}&nonce=${nonce}&sign=${sign}&did=${did}`, { method: 'POST', signal: ctrl.signal }).then((r) => r.text()).then((t) => JSON.parse(t));
    if (res.code !== 200 || !res.data?.info || !res.data?.token) throw new Error(`Drucker lehnt die Anmeldung ab${res.message ? `: ${res.message}` : ''}`);
    const iv = Buffer.alloc(16);
    Buffer.from(String(res.data.token), 'utf8').copy(iv, 0, 0, 16);
    const decipher = crypto.createDecipheriv('aes-128-cbc', Buffer.from(disc.token.slice(16, 32), 'ascii'), iv);
    const plain = Buffer.concat([decipher.update(Buffer.from(res.data.info, 'base64')), decipher.final()]).toString('utf8');
    const cred = JSON.parse(plain);
    const u = new URL(cred.broker);
    return {
      modelId: Number(disc.modelId), modelName: disc.modelName || MODELS[Number(disc.modelId)] || 'Anycubic',
      serial: disc.cn || null, url: `${u.protocol === 'mqtt:' ? 'mqtt' : 'mqtts'}://${u.hostname}:${u.port || 9883}`,
      username: cred.username, password: cred.password, deviceId: cred.deviceId,
    };
  } finally {
    clearTimeout(timer);
  }
}

const hex = (rgb) => (Array.isArray(rgb) && rgb.length >= 3 ? `#${rgb.slice(0, 3).map((v) => Math.max(0, Math.min(255, Number(v) || 0)).toString(16).padStart(2, '0')).join('').toUpperCase()}` : null);
const rgb = (h) => String(h || '#FFFFFF').replace('#', '').match(/../g).map((x) => parseInt(x, 16));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

class AnycubicDriver extends BaseDriver {
  static meta = {
    id: 'anycubic',
    label: 'Anycubic (LAN-Modus)',
    hint: 'Kobra S1, Kobra X und weitere mit LAN-Modus – am Drucker unter Einstellungen → Netzwerk → LAN-Modus einschalten. Ohne Cloud, mit ACE (Belegung, Trocknen) und Kamera. Drucke starten: mit Rinkhals den Moonraker-Port eintragen.',
    fields: [
      { key: 'host', label: 'IP-Adresse des Druckers', required: true },
      // Zweigleisig: Status, ACE und Trocknen über den LAN-Modus, Drucke über Moonraker (Rinkhals)
      { key: 'moonrakerPort', label: 'Drucken über Moonraker (Rinkhals): Port, z. B. 7125 – leer = aus', type: 'number' },
    ],
  };

  async start() {
    this.raw = { info: {}, temp: {}, fan: {}, light: null, boxes: {}, project: null, peripherals: {} };
    this.connect();
  }

  async stop() {
    await super.stop();
    clearInterval(this.queryTimer);
    clearTimeout(this.retryTimer);
    this.client?.end(true);
  }

  async connect() {
    if (this.stopped) return;
    try {
      this.conn = await handshake(this.config.host);
    } catch (err) {
      this.setOffline(err.name === 'AbortError' || err.cause ? netError(err.cause || err) : err.message);
      this.retryTimer = setTimeout(() => this.connect(), 20_000);
      return;
    }
    const c = this.conn;
    this.client = mqtt.connect(c.url, {
      username: c.username, password: c.password, rejectUnauthorized: false, protocolVersion: 4,
      clientId: `printdock-${crypto.randomBytes(6).toString('hex')}`, keepalive: 60, connectTimeout: 15_000,
      reconnectPeriod: 0, // nach einem Abbruch neu anmelden – die Zugangsdaten wechseln beim Neustart des Druckers
    });
    this.client.on('connect', () => {
      this.client.subscribe(`${PREFIX}/printer/public/${c.modelId}/${c.deviceId}/#`);
      this.queryAll();
      clearInterval(this.queryTimer);
      this.queryTimer = setInterval(() => this.queryAll(), 15_000);
    });
    this.client.on('message', (topic, payload) => this.onMessage(topic, payload));
    this.client.on('error', (err) => this.setOffline(/Not authorized|Bad user/i.test(err.message) ? 'Anmeldung am Drucker abgelehnt' : netError(err)));
    this.client.on('close', () => {
      clearInterval(this.queryTimer);
      if (this.status.online) this.setOffline('Verbindung getrennt');
      if (!this.stopped) this.retryTimer = setTimeout(() => this.connect(), 10_000);
    });
  }

  publish(type, payload) {
    if (!this.client?.connected) throw new Error('Keine Verbindung zum Drucker');
    this.client.publish(`${PREFIX}/web/printer/${this.conn.modelId}/${this.conn.deviceId}/${type}`, JSON.stringify(payload));
  }

  queryAll() {
    for (const [type, action] of Object.entries(QUERIES)) {
      try { this.publish(type, { type, action, data: {} }); } catch { /* offline */ }
    }
  }

  command_(type, action, data) {
    const msgid = crypto.randomUUID();
    this.publish(type, { type, action, timestamp: Date.now(), msgid, data: data === undefined ? {} : data });
    return msgid;
  }

  onMessage(topic, payload) {
    let m;
    try { m = JSON.parse(payload.toString()); } catch { return; }
    if (!m || typeof m !== 'object') return;
    const type = m.type || (topic.split('/').reverse().find((s) => QUERIES[s] || s === 'video') ?? '');
    if (!type) return;
    // Antworten auf Befehle merken (z. B. setDry abgelehnt)
    if (m.action && m.action !== 'report' && m.action !== 'query' && m.action !== 'getInfo' && m.state) {
      this.cmdResults ||= {};
      const failed = m.state === 'failed' || (m.code != null && m.code !== 200);
      this.cmdResults[m.action] = { result: failed ? 'fail' : 'ok', reason: failed ? m.msg || null : null, at: Date.now() };
      if (failed) console.warn(`[${this.config.name || 'Anycubic'}] ${type}/${m.action}: ${m.msg || m.state}`);
    }
    const d = m.data;
    const r = this.raw;
    if (type === 'info' && d && typeof d === 'object') {
      Object.assign(r.info, d);
      if (d.temp) Object.assign(r.temp, d.temp);
      for (const k of ['fan_speed_pct', 'aux_fan_speed_pct', 'box_fan_level']) if (d[k] != null) r.fan[k] = d[k];
      if ('project' in d) r.project = d.project ? { ...(r.project?.task_id === d.project.task_id ? r.project : {}), ...d.project } : null;
      r.infoCode = m.code !== 200 ? m.msg || null : null;
    } else if (type === 'tempature' && d) Object.assign(r.temp, d);
    else if (type === 'fan' && d) Object.assign(r.fan, d);
    else if (type === 'light' && d) {
      const list = Array.isArray(d.lights) ? d.lights : [d];
      const l = list.find((x) => Number(x?.type) === 2) || list[0];
      if (l && l.status != null) r.light = Number(l.status) === 1;
    } else if (type === 'multiColorBox' && Array.isArray(d?.multi_color_box)) {
      for (const b of d.multi_color_box) {
        if (b?.id == null) continue;
        const prev = r.boxes[b.id] || {};
        r.boxes[b.id] = { ...prev, ...b, drying_status: { ...(prev.drying_status || {}), ...(b.drying_status || {}) }, slots: b.slots || prev.slots || [] };
      }
    } else if (type === 'peripherie' && d) Object.assign(r.peripherals, d);
    else if (type === 'print' && d && typeof d === 'object' && d.task_id != null) r.project = { ...(r.project || {}), ...d };
    else return;
    this.publishStatus();
  }

  publishStatus() {
    const r = this.raw;
    const p = r.project;
    const i = r.info;
    let state = 'idle';
    if (p) {
      const st = String(p.state || '').toLowerCase();
      const ps = Number(p.print_status);
      if (Number(p.pause) === 1 || /paus/.test(st)) state = 'paused';
      else if (ps === 2 || st === 'finished') state = 'finished';
      else if (ps === 3 || /cancel|stop/.test(st)) state = 'cancelled';
      else if (st === 'failed') state = 'error';
      else if ([4, 5, 6, 7, 9].includes(ps) || /level|preheat|check|download/.test(st)) state = 'preparing';
      else state = 'printing';
    } else if (i.state === 'busy') state = 'preparing';
    const active = ['printing', 'paused', 'preparing'].includes(state);
    const file = p?.filename ? String(p.filename).split('/').pop().replace(/\.(gcode|3mf)$/i, '') : null;
    if (p?.filename) this.rawFile = String(p.filename).split('/').pop();
    const t = r.temp;
    // ACE-Einheiten
    const boxes = Object.values(r.boxes).sort((a, b) => a.id - b.id);
    const filament = [];
    const units = [];
    let activeSlot = null;
    for (const b of boxes) {
      const unit = `ACE ${Number(b.id) + 1}`;
      for (const s of b.slots || []) {
        const empty = Number(s.edit_status) === 2 || !s.type;
        const key = `ace${b.id}-${s.index}`;
        filament.push({ key, label: `${unit} · ${Number(s.index) + 1}`, unit, material: empty ? null : String(s.type), color: empty ? null : hex(s.color), remainPct: null, uid: null, brand: s.sku || null, present: !empty });
        if (Number(s.status) === 5 && active) activeSlot = key;
      }
      if (Number(b.loaded_slot) >= 0 && active) activeSlot = `ace${b.id}-${b.loaded_slot}`;
      const ds = b.drying_status || {};
      const model = ACE_MODELS[b.model_id] || 'ACE';
      units.push({
        name: unit, id: Number(b.id), model,
        humidity: null, humidityPct: num(b.humidity) > 0 ? b.humidity : null, temp: num(b.temp),
        dryer: { maxTemp: b.model_id === 40002 ? 65 : 55, minTemp: 35, maxHours: 24, active: Number(ds.status) > 0, remainMin: Number(ds.remain_time) > 0 ? Number(ds.remain_time) : null, targetTemp: Number(ds.target_temp) > 0 ? Number(ds.target_temp) : null, replyCommand: 'setDry' },
      });
    }
    const fans = [['Bauteil', r.fan.fan_speed_pct], ['Hilfslüfter', r.fan.aux_fan_speed_pct]].filter(([, v]) => v != null).map(([name, v]) => ({ name, pct: Math.round(Number(v)) }));
    this.update({
      online: true,
      state,
      file,
      progress: p ? num(p.progress) : null,
      remainingSec: p && num(p.remain_time) != null ? p.remain_time * 60 : null,
      elapsedSec: p && num(p.print_time) != null ? p.print_time * 60 : null,
      layer: p ? num(p.curr_layer) : null,
      totalLayers: p ? num(p.total_layers) : null,
      nozzles: t.curr_nozzle_temp != null ? [{ name: 'Düse', ...temp(t.curr_nozzle_temp, t.target_nozzle_temp) }] : [],
      bed: temp(t.curr_hotbed_temp, t.target_hotbed_temp),
      chamber: Number(t.curr_chamber_temp) > 0 ? temp(t.curr_chamber_temp, t.target_chamber_temp) : null,
      message: r.infoCode,
      camera: Number(r.peripherals.camera) === 1 || Boolean(i.urls?.rtspUrl),
      filament,
      activeSlot,
      filamentUsedMm: p ? num(p.supplies_usage) : null,
      filamentUnits: units,
      fans,
      light: r.light,
      speed: num(i.print_speed_mode) ? { level: Math.min(3, Number(i.print_speed_mode)), pct: null } : null,
      capabilities: ['light'],
    });
  }

  async command(cmd, args = {}) {
    const taskid = () => {
      if (this.raw.project?.task_id == null) throw new Error('Kein laufender Druck');
      return { taskid: String(this.raw.project.task_id) };
    };
    if (cmd === 'pause') return void this.command_('print', 'pause', taskid());
    if (cmd === 'resume') return void this.command_('print', 'resume', taskid());
    if (cmd === 'cancel') return void this.command_('print', 'stop', taskid());
    if (cmd === 'light') {
      this.command_('light', 'control', { type: 2, status: args.on ? 1 : 0, brightness: args.on ? 100 : 0 });
      setTimeout(() => this.queryAll(), 1500);
      return;
    }
    if (cmd === 'dry') {
      // ACE trocknen: Temperatur °C, Dauer in Minuten; Stopp = status 0. Immer die Box angeben.
      const id = Number(args.unitId);
      if (!Number.isInteger(id)) throw new Error('Unbekannte ACE-Einheit');
      const drying = args.stop ? { status: 0, target_temp: 0, duration: 0, remain_time: null }
        : { status: 1, target_temp: Math.round(Number(args.temp)), duration: Math.round(Number(args.hours) * 60), remain_time: null };
      this.command_('multiColorBox', 'setDry', { multi_color_box: [{ id, drying_status: drying }] });
      setTimeout(() => { try { this.publish('multiColorBox', { type: 'multiColorBox', action: 'getInfo', data: {} }); } catch {} }, 3000);
      return;
    }
    if (cmd === 'filament_setting') {
      // Material und Farbe eines ACE-Fachs eintragen (wie am Drucker)
      const m = String(args.key || '').match(/^ace(\d+)-(\d+)$/);
      if (!m) throw new Error(`Unbekannter Platz ${args.key}`);
      this.command_('multiColorBox', 'setInfo', { multi_color_box: [{ id: Number(m[1]), slots: [{ index: Number(m[2]), type: String(args.material || 'PLA').toUpperCase().replace(/ .*/, ''), color: rgb(args.color) }] }] });
      setTimeout(() => { try { this.publish('multiColorBox', { type: 'multiColorBox', action: 'getInfo', data: {} }); } catch {} }, 2000);
      return;
    }
    return super.command(cmd);
  }

  async cameraSource() {
    const url = this.raw.info?.urls?.rtspUrl;
    if (!url) throw new Error('Der Drucker meldet keine Kamera');
    // Stream erst anfordern – danach liefert der Drucker HTTP-FLV
    try { this.command_('video', 'startCapture', {}); } catch {}
    await new Promise((r) => setTimeout(r, 1500));
    return { type: 'ffmpeg', input: url, inputArgs: ['-fflags', 'nobuffer'] };
  }

  canPrint(file) {
    if (!this.config.moonrakerPort) return 'Druckstart braucht Moonraker (Rinkhals) – beim Drucker unter „Drucken über Moonraker“ den Port eintragen (meist 7125). Ohne Rinkhals bitte am Drucker oder im Slicer starten.';
    if (file?.kind !== 'gcode') return 'Anycubic über Moonraker braucht eine .gcode-Datei';
    return null;
  }

  /** Druck über Moonraker (Rinkhals) hochladen und starten – Status, ACE und Trocknen bleiben im LAN-Modus */
  async startPrint(job) {
    const form = new FormData();
    form.append('root', 'gcodes');
    form.append('print', 'true');
    form.append('file', await fileBlob(job.path), job.name);
    try {
      await postForm(`http://${this.config.host}:${Number(this.config.moonrakerPort)}/server/files/upload`, form, {});
    } catch (err) {
      throw new Error(`Moonraker (Rinkhals) auf Port ${this.config.moonrakerPort} nicht erreichbar: ${err.message}`);
    }
  }

  /** Laufende Datei holen – nur mit Rinkhals (Moonraker); der LAN-Modus selbst bietet keinen Download */
  async fetchCurrentFile(dest, { maxBytes } = {}) {
    if (!this.config.moonrakerPort || !this.status.file) return null;
    const base = `http://${this.config.host}:${Number(this.config.moonrakerPort)}/server/files/gcodes/`;
    const names = [...new Set([this.rawFile, `${this.status.file}.gcode`].filter(Boolean))];
    let last = null;
    for (const n of names) {
      try {
        await downloadTo(base + encodeURIComponent(n), dest, { maxBytes });
        return { name: n };
      } catch (err) {
        last = err;
      }
    }
    throw last || new Error('Datei nicht gefunden');
  }

  async diagnostics() {
    const info = { ...this.raw.info };
    if (info.urls) info.urls = { ...info.urls, fileUploadurl: '***' };
    return { connection: this.conn ? { modelId: this.conn.modelId, modelName: this.conn.modelName, broker: this.conn.url } : null, info, temp: this.raw.temp, boxes: this.raw.boxes, project: this.raw.project, peripherals: this.raw.peripherals, cmdResults: this.cmdResults || {} };
  }
}

module.exports = AnycubicDriver;
