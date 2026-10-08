// Treiber für Bambu Lab Drucker über das lokale MQTT-Protokoll (LAN).
//
// Abgedeckt: X1/X1C/X1E, P1P/P1S, A1/A1 mini, H2D, X2D (und Nachfolger, solange
// Bambu das MQTT-Format beibehält).
//
// Voraussetzungen am Drucker:
//  - LAN-Modus bzw. "LAN Only" aktiv; bei neueren Firmwares zusätzlich der
//    Entwicklermodus, damit Drittsoftware steuern darf
//  - Access Code (Druckermenü → Netzwerk) und Seriennummer
//
// Konfiguration: { host, serial, accessCode }

const net = require('net');
const crypto = require('crypto');
const fs = require('fs');
const mqtt = require('mqtt');
const ftp = require('basic-ftp');
const { BaseDriver, temp, netError } = require('./base');

const STATE_MAP = {
  IDLE: 'idle',
  PREPARE: 'preparing',
  SLICING: 'preparing',
  RUNNING: 'printing',
  PAUSE: 'paused',
  FINISH: 'finished',
  FAILED: 'error',
};

class BambuDriver extends BaseDriver {
  static meta = {
    id: 'bambu',
    label: 'Bambu Lab (LAN)',
    hint: 'X1, P1, A1, H2D, X2D – LAN-Modus bzw. Entwicklermodus muss aktiv sein',
    fields: [
      { key: 'host', label: 'IP-Adresse', required: true },
      { key: 'serial', label: 'Seriennummer', required: true },
      { key: 'accessCode', label: 'Access Code', required: true, secret: true },
      {
        key: 'cameraMode',
        label: 'Kamera',
        type: 'select',
        default: 'auto',
        options: [
          { value: 'auto', label: 'Automatisch erkennen' },
          { value: 'rtsps', label: 'RTSPS, Port 322 (X1, H2D, H2S, X2D)' },
          { value: 'tcp', label: 'JPEG-Stream, Port 6000 (P1, A1)' },
          { value: 'off', label: 'Keine Kamera' },
        ],
      },
    ],
  };

  async start() {
    this.raw = {}; // P1/A1 senden nur Änderungen – wir führen den Gesamtstand selbst
    const { host, serial, accessCode } = this.config;
    this.client = mqtt.connect(`mqtts://${host}:8883`, {
      username: 'bblp',
      password: String(accessCode || ''),
      rejectUnauthorized: false, // Drucker nutzt ein selbstsigniertes Zertifikat
      reconnectPeriod: 10000,
      connectTimeout: 8000,
      clientId: `printdock_${Math.random().toString(16).slice(2, 10)}`,
    });

    this.client.on('connect', () => {
      this.client.subscribe(`device/${serial}/report`);
      this.pushAll();
      // Vollabzug alle 5 Minuten, falls Teilnachrichten verloren gingen
      clearInterval(this.pushTimer);
      this.pushTimer = setInterval(() => this.pushAll(), 5 * 60 * 1000);
    });

    this.client.on('message', (_topic, payload) => {
      try {
        const msg = JSON.parse(payload.toString());
        if (msg.print) {
          deepMerge(this.raw, msg.print);
          this.publishStatus();
        }
      } catch {
        /* defekte Nachricht ignorieren */
      }
    });

    const offline = (reason) => this.setOffline(reason);
    this.client.on('error', (err) => {
      const m = /Not authorized|Bad username/i.test(err.message)
        ? 'Zugriff verweigert – Access Code prüfen bzw. Entwicklermodus aktivieren'
        : netError(err);
      offline(m);
    });
    this.client.on('offline', () => offline(this.status.message || 'Drucker nicht erreichbar'));
    this.client.on('close', () => {
      if (this.status.online) offline('Verbindung getrennt');
    });
  }

  async stop() {
    await super.stop();
    clearInterval(this.pushTimer);
    if (this.client) this.client.end(true);
  }

  send(print) {
    if (!this.client?.connected) throw new Error('Keine Verbindung zum Drucker');
    const topic = `device/${this.config.serial}/request`;
    this.client.publish(topic, JSON.stringify({ print: { sequence_id: String(Date.now() % 100000), ...print } }));
  }

  pushAll() {
    if (!this.client?.connected) return;
    this.client.publish(
      `device/${this.config.serial}/request`,
      JSON.stringify({ pushing: { sequence_id: '0', command: 'pushall' } })
    );
  }

  async diagnostics() {
    return { raw: this.raw || null };
  }

  publishStatus() {
    const p = this.raw;
    let state = STATE_MAP[p.gcode_state] || 'idle';
    const hms = Array.isArray(p.hms) ? p.hms : [];
    let message = null;
    if (p.print_error && p.print_error !== 0) {
      message = `Druckerfehler 0x${Number(p.print_error).toString(16).toUpperCase().padStart(8, '0')}`;
    } else if (hms.length) {
      message = `${hms.length} HMS-Meldung(en) – Details am Drucker oder in Bambu Handy`;
    }

    this.update({
      online: true,
      state,
      file: p.subtask_name || p.gcode_file || null,
      progress: state === 'idle' ? null : p.mc_percent ?? null,
      remainingSec: p.mc_remaining_time != null && state !== 'idle' ? p.mc_remaining_time * 60 : null,
      elapsedSec: null,
      layer: p.layer_num ?? null,
      totalLayers: p.total_layer_num ?? null,
      nozzles: this.readNozzles(p),
      bed: temp(p.bed_temper, p.bed_target_temper),
      chamber: p.chamber_temper != null ? temp(p.chamber_temper, null) : null,
      message,
      camera: this.config.cameraMode !== 'off',
      ...this.readFilament(p),
      wifi: parseInt(p.wifi_signal, 10) || null,
      hms: hms.map((h) => {
        const a = (Number(h.attr) >>> 0).toString(16).toUpperCase().padStart(8, '0');
        const c = (Number(h.code) >>> 0).toString(16).toUpperCase().padStart(8, '0');
        const code = `${a.slice(0, 4)}_${a.slice(4)}_${c.slice(0, 4)}_${c.slice(4)}`;
        return { code, text: `HMS ${code} – Details in Bambu Handy oder im Bambu-Wiki (Code suchen)`, url: null };
      }),
      fans: [
        ['Bauteil', p.cooling_fan_speed],
        ['Hilfslüfter', p.big_fan1_speed],
        ['Bauraum', p.big_fan2_speed],
      ].filter(([, v]) => v != null).map(([name, v]) => ({ name, pct: Math.round((Number(v) / 15) * 10) * 10 })),
      light: Array.isArray(p.lights_report) ? (p.lights_report.find((l) => l.node === 'chamber_light')?.mode ?? 'off') !== 'off' : null,
      speed: p.spd_lvl ? { level: Number(p.spd_lvl), pct: Number(p.spd_mag) || null } : null,
      nozzleDiameter: Number(p.nozzle_diameter) || null,
      capabilities: ['light', 'speed'],
    });
  }

  /**
   * AMS-Fächer und externe Spule. Schlüssel: "ams<Einheit>-<Fach>" bzw. "ext".
   * Bambu nummeriert global: Fach-ID = Einheit * 4 + Fach; 254/255 = externe Spule.
   */
  readFilament(p) {
    const slots = [];
    const tray = (t, key, label, unit) => {
      if (!t) return;
      const uid = t.tag_uid && !/^0+$/.test(t.tag_uid) ? t.tag_uid : t.tray_uuid && !/^0+$/.test(t.tray_uuid) ? t.tray_uuid : null;
      slots.push({
        key,
        label,
        unit,
        material: t.tray_type || null,
        color: /^[0-9a-f]{6}/i.test(t.tray_color || '') ? `#${t.tray_color.slice(0, 6).toUpperCase()}` : null,
        remainPct: Number(t.remain) >= 0 && t.tray_type ? Number(t.remain) : null,
        uid,
        brand: t.tray_sub_brands || null,
        weight: Number(t.tray_weight) || null,
      });
    };
    const units = Array.isArray(p.ams?.ams) ? p.ams.ams : [];
    const unitInfo = units.map((u, ui) => ({
      name: `AMS ${Number(u.id ?? ui) + 1}`,
      humidity: u.humidity != null ? Number(u.humidity) : null,
      humidityPct: u.humidity_raw != null ? Number(u.humidity_raw) : null,
      temp: u.temp != null ? Number(u.temp) : null,
    }));
    units.forEach((u, ui) => {
      const amsId = Number(u.id ?? ui);
      (u.tray || []).forEach((t, ti) => {
        const trayId = Number(t.id ?? ti);
        tray(t, `ams${amsId}-${trayId}`, `AMS ${amsId + 1} · ${trayId + 1}`, `AMS ${amsId + 1}`);
      });
    });
    // Externe Spule(n): ältere Modelle "vt_tray", H2D/X2D teils "vir_slot" (je Düse eine)
    if (Array.isArray(p.vir_slot)) p.vir_slot.forEach((t, i) => tray(t, i ? `ext${i}` : 'ext', p.vir_slot.length > 1 ? `Außen ${i + 1}` : 'Außen', 'Extern'));
    else if (p.vt_tray) tray(p.vt_tray, 'ext', 'Außen', 'Extern');

    const now = Number(p.ams?.tray_now);
    let activeSlot = null;
    if (Number.isFinite(now) && now !== 255) activeSlot = now === 254 ? 'ext' : `ams${Math.floor(now / 4)}-${now % 4}`;
    return { filament: slots, activeSlot, filamentUnits: unitInfo };
  }

  /** Filament-Index im Druck → Platz-Schlüssel (für die Abbuchung). */
  static slotForMapping(globalId) {
    const g = Number(globalId);
    if (!Number.isFinite(g) || g < 0) return null;
    if (g >= 254) return 'ext';
    return `ams${Math.floor(g / 4)}-${g % 4}`;
  }

  readNozzles(p) {
    // Zwei-Düsen-Modelle (H2D, X2D) melden je Extruder einen Eintrag in
    // device.extruder.info. Die Temperatur ist dort gepackt:
    // untere 16 Bit = Ist-Wert, obere 16 Bit = Soll-Wert.
    // EXPERIMENTELL – bitte mit echtem Gerät prüfen.
    const info = p.device?.extruder?.info;
    if (Array.isArray(info) && info.length > 1) {
      return info.map((e, i) => {
        const packed = Number(e.temp);
        const cur = Number.isFinite(packed) ? packed & 0xffff : null;
        const tgt = Number.isFinite(packed) ? (packed >>> 16) & 0xffff : null;
        return { name: `Düse ${i + 1}`, ...temp(cur, tgt) };
      });
    }
    return [{ name: 'Düse', ...temp(p.nozzle_temper, p.nozzle_target_temper) }];
  }

  canPrint(file) {
    if (file.kind !== '3mf' || !file.printable) {
      return 'Bambu-Drucker brauchen eine geslicte .gcode.3mf (in Bambu Studio/Orca: „Plate-Datei exportieren“)';
    }
    return null;
  }

  /**
   * EXPERIMENTELL: Datei per FTPS (Port 990) in das Wurzelverzeichnis laden und
   * über MQTT starten. Erfordert LAN- bzw. Entwicklermodus.
   * job.options: { plate = 1, useAms = true, amsMapping = "0,1,...", bedLevel = true, timelapse = false }
   */
  async startPrint(job) {
    const { host, accessCode } = this.config;
    const opts = job.options || {};
    const remoteName = job.name.replace(/[^\w.\-]+/g, '_');
    const client = new ftp.Client(60_000);
    try {
      await client.access({
        host,
        port: 990,
        user: 'bblp',
        password: String(accessCode),
        secure: 'implicit',
        secureOptions: { rejectUnauthorized: false },
      });
      await client.uploadFrom(job.path, remoteName);
    } catch (err) {
      throw new Error(`Übertragung zum Drucker fehlgeschlagen: ${err.message}`);
    } finally {
      client.close();
    }

    const plate = Number(opts.plate) || 1;
    const materials = job.meta?.materials?.length || 1;
    const mapping = String(opts.amsMapping || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
      .map(Number);
    const md5 = await md5File(job.path);
    this.send({
      command: 'project_file',
      param: `Metadata/plate_${plate}.gcode`,
      url: `ftp:///${remoteName}`,
      md5,
      subtask_name: job.name.replace(/\.gcode\.3mf$|\.3mf$/i, ''),
      project_id: '0',
      profile_id: '0',
      task_id: '0',
      subtask_id: '0',
      timelapse: Boolean(opts.timelapse),
      bed_type: 'auto',
      bed_levelling: opts.bedLevel !== false,
      flow_cali: false,
      vibration_cali: false,
      layer_inspect: false,
      use_ams: opts.useAms !== false,
      ams_mapping: mapping.length ? mapping : Array.from({ length: materials }, (_, i) => i),
    });
  }

  async cameraSource() {
    let mode = this.config.cameraMode || 'auto';
    if (mode === 'off') return null;
    if (mode === 'auto') {
      // Einmal erkennen und merken: RTSPS (X1/H2/X2) hat Port 322 offen, P1/A1 Port 6000
      if (!this.detectedCamera) {
        if (await portOpen(this.config.host, 322)) this.detectedCamera = 'rtsps';
        else if (await portOpen(this.config.host, 6000)) this.detectedCamera = 'tcp';
        else throw new Error('Keine Bambu-Kamera gefunden – ist „LAN-Liveview“ am Drucker aktiviert?');
      }
      mode = this.detectedCamera;
    }
    const { host, accessCode } = this.config;
    if (mode === 'tcp') return { type: 'bambu-tcp', host, accessCode };
    return {
      type: 'ffmpeg',
      inputArgs: ['-rtsp_transport', 'tcp', '-timeout', '10000000'],
      input: `rtsps://bblp:${encodeURIComponent(accessCode)}@${host}:322/streaming/live/1`,
    };
  }

  async command(cmd, args = {}) {
    if (cmd === 'light') {
      if (!this.client?.connected) throw new Error('Keine Verbindung zum Drucker');
      this.client.publish(`device/${this.config.serial}/request`, JSON.stringify({
        system: { sequence_id: String(Date.now() % 100000), command: 'ledctrl', led_node: 'chamber_light', led_mode: args.on ? 'on' : 'off', led_on_time: 500, led_off_time: 500, loop_times: 0, interval_time: 0 },
      }));
      return;
    }
    if (cmd === 'speed') {
      const level = Math.max(1, Math.min(4, Number(args.level) || 2));
      this.send({ command: 'print_speed', param: String(level) });
      return;
    }
    const map = { pause: 'pause', resume: 'resume', cancel: 'stop' };
    if (!map[cmd]) return super.command(cmd);
    this.send({ command: map[cmd], param: '' });
  }
}

function md5File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('md5');
    fs.createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex').toUpperCase()))
      .on('error', reject);
  });
}

function portOpen(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (ok) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

function deepMerge(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!target[k] || typeof target[k] !== 'object') target[k] = {};
      deepMerge(target[k], v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

module.exports = BambuDriver;
