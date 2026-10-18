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
      // Modulliste (welches AMS-Modell – nur AMS 2 Pro und AMS HT können trocknen)
      this.client.publish(`device/${serial}/request`, JSON.stringify({ info: { sequence_id: '0', command: 'get_version' } }));
      // Vollabzug alle 5 Minuten, falls Teilnachrichten verloren gingen
      clearInterval(this.pushTimer);
      this.pushTimer = setInterval(() => this.pushAll(), 5 * 60 * 1000);
    });

    this.client.on('message', (_topic, payload) => {
      try {
        const msg = JSON.parse(payload.toString());
        if (msg.print) {
          // Antwort auf einen Befehl merken (z. B. Trocknen abgelehnt) – für Rückmeldungen in der Oberfläche
          if (msg.print.command && msg.print.result) {
            this.cmdResults ||= {};
            this.cmdResults[msg.print.command] = { result: String(msg.print.result), reason: msg.print.reason ? String(msg.print.reason) : null, at: Date.now() };
            if (/fail/i.test(msg.print.result)) console.warn(`[${this.config.name || 'Bambu'}] ${msg.print.command}: ${msg.print.result}${msg.print.reason ? ` (${msg.print.reason})` : ''}`);
          }
          deepMerge(this.raw, msg.print);
          this.publishStatus();
        }
        if (Array.isArray(msg.info?.module)) {
          // ams/0 = AMS, ams_f1/0 = AMS lite, n3f/0 = AMS 2 Pro, n3s/128 = AMS HT
          this.amsModels = {};
          for (const m of msg.info.module) {
            const k = String(m.name || '').match(/^(ams|ams_f1|n3f|n3s)\/(\d+)$/);
            if (k) this.amsModels[Number(k[2])] = { ams: 'AMS', ams_f1: 'AMS lite', n3f: 'AMS 2 Pro', n3s: 'AMS HT' }[k[1]];
          }
          if (this.raw?.ams) this.publishStatus();
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
        present: trayLoaded(t),
        brand: t.tray_sub_brands || null,
        weight: Number(t.tray_weight) || null,
      });
    };
    const units = Array.isArray(p.ams?.ams) ? p.ams.ams : [];
    const unitName = (id) => (id >= 128 ? `AMS HT ${id - 127}` : `AMS ${id + 1}`);
    const unitInfo = units.map((u, ui) => {
      const id = Number(u.id ?? ui);
      const model = this.amsModels?.[id] || (id >= 128 ? 'AMS HT' : null);
      // Trocknen: AMS 2 Pro (bis 65 °C) und AMS HT (bis 85 °C); ohne Modulliste erkennbar am Feld dry_time
      const canDry = model ? ['AMS 2 Pro', 'AMS HT'].includes(model) : u.dry_time !== undefined && u.humidity_raw !== undefined;
      const remain = Number(u.dry_time) || 0;
      return {
        name: unitName(id),
        id,
        model,
        humidity: u.humidity != null ? Number(u.humidity) : null,
        humidityPct: u.humidity_raw != null ? Number(u.humidity_raw) : null,
        temp: u.temp != null ? Number(u.temp) : null,
        dryer: canDry ? {
          maxTemp: model === 'AMS HT' || id >= 128 ? 85 : 65, minTemp: 45, maxHours: 24, active: remain > 0, remainMin: remain || null,
          targetTemp: Number(u.dry_setting?.dry_temperature) > 0 ? Number(u.dry_setting.dry_temperature) : null,
          // Bambu trocknet nicht, solange Filament aus dieser Einheit geladen ist (steckt im AMS-Ausgang)
          loaded: this.loadedFrom(p, id).length > 0,
          unloadTemp: this.loadedFrom(p, id).length ? this.unloadTemp(p, id, this.loadedFrom(p, id)[0].slot) : null,
          preparing: this.dryPrep?.[id]?.step || false,
        } : null,
      };
    });
    units.forEach((u, ui) => {
      const amsId = Number(u.id ?? ui);
      (u.tray || []).forEach((t, ti) => {
        const trayId = Number(t.id ?? ti);
        tray(t, `ams${amsId}-${trayId}`, `${unitName(amsId)} · ${trayId + 1}`, unitName(amsId));
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

  /**
   * Fächer einer AMS-Einheit, deren Filament gerade geladen ist (bis zur Düse bzw. im AMS-Ausgang).
   * ams.tray_now = global (AMS-Nr. × 4 + Fach); Zwei-Düsen-Modelle melden je Extruder "snow" = AMS-Nr. × 256 + Fach.
   */
  loadedFrom(p, amsId) {
    const out = [];
    const info = p.device?.extruder?.info;
    if (Array.isArray(info) && info.length > 1) {
      // Zwei Düsen (H2D, X2D): tray_now ist hier unzuverlässig, je Extruder zählt "snow"
      for (const e of info) {
        const v = Number(e.snow);
        if (!Number.isFinite(v) || v === 0xffff) continue;
        if (v >> 8 === amsId) out.push({ slot: v & 0xff, extruder: Number(e.id) });
      }
      return out;
    }
    const now = Number(p.ams?.tray_now);
    if (Number.isFinite(now) && now < 254) {
      if (amsId < 128 && Math.floor(now / 4) === amsId) out.push({ slot: now % 4, extruder: null });
      if (amsId >= 128 && now === amsId) out.push({ slot: 0, extruder: null });
    }
    return out;
  }

  /** Ist-Temperatur einer Düse (bei zwei Düsen aus device.extruder.info) */
  nozzleTemp(p, extruder) {
    const info = p.device?.extruder?.info;
    if (extruder != null && Array.isArray(info)) {
      const e = info.find((x, i) => Number(x.id ?? i) === extruder);
      const packed = Number(e?.temp);
      return Number.isFinite(packed) ? packed & 0xffff : 0;
    }
    return Number(p.nozzle_temper) || 0;
  }

  /** Temperatur zum Entladen: obere Drucktemperatur des Filaments laut AMS (190–300 °C) */
  unloadTemp(p, amsId, slot) {
    const unit = (p.ams?.ams || []).find((u, i) => Number(u.id ?? i) === amsId);
    const tr = (unit?.tray || []).find((x, i) => Number(x.id ?? i) === slot);
    return Math.max(190, Math.min(300, Number(tr?.nozzle_temp_max) || 250));
  }

  coolDown(extruder) {
    try { this.send({ command: 'gcode_line', param: `M104 ${extruder != null ? `T${extruder} ` : ''}S0\n` }); } catch {}
  }

  /** Filament ins AMS zurückziehen (je Düse), warten bis frei, dann trocknen (Bambu lässt sonst nicht trocknen) */
  async unloadThenDry(amsId, dryCmd) {
    this.dryPrep ||= {};
    this.dryPrep[amsId] = { at: Date.now(), step: 'heating' };
    this.publishStatus();
    const fail = (reason) => {
      this.cmdResults ||= {};
      this.cmdResults.ams_filament_drying = { result: 'fail', reason, at: Date.now() };
    };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      for (let round = 0; round < 3; round++) {
        const cur = this.loadedFrom(this.raw, amsId)[0];
        if (!cur) break;
        const temp = this.unloadTemp(this.raw, amsId, cur.slot);
        // wie Bambu Studio: Entladen = target/slot_id 255, ams_id der Einheit, bei zwei Düsen extruder_id;
        // der Drucker heizt die Düse dafür selbst auf curr_temp/tar_temp
        // Erst die Düse heizen und abwarten: kaltes Filament klebt in der Düse und reißt beim Zurückziehen
        const heat = `M104 ${cur.extruder != null ? `T${cur.extruder} ` : ''}S${temp}\n`;
        this.send({ command: 'gcode_line', param: heat });
        this.dryPrep[amsId] = { at: this.dryPrep[amsId]?.at || Date.now(), step: 'heating', temp };
        this.publishStatus();
        const heatUntil = Date.now() + 5 * 60_000;
        while (this.nozzleTemp(this.raw, cur.extruder) < temp - 5) {
          if (Date.now() > heatUntil) return fail('heat_timeout');
          await sleep(3000);
          if (!this.dryPrep?.[amsId]) return this.coolDown(cur.extruder);
          if (!this.client?.connected) return fail('offline');
          if (Date.now() % 15_000 < 3000) this.pushAll();
        }
        await sleep(10_000); // kurz durchwärmen lassen
        if (!this.dryPrep?.[amsId]) return this.coolDown(cur.extruder);
        this.dryPrep[amsId] = { ...this.dryPrep[amsId], step: 'unloading' };
        this.publishStatus();
        const cmd = { command: 'ams_change_filament', ams_id: amsId, slot_id: 255, target: 255, curr_temp: temp, tar_temp: temp };
        if (cur.extruder != null) cmd.extruder_id = cur.extruder;
        const sentAt = Date.now();
        this.send(cmd);
        console.log(`[${this.config.name || 'Bambu'}] Trocknen: Filament aus ${amsId < 128 ? `AMS ${amsId + 1}` : 'AMS HT'} Fach ${cur.slot + 1} wird entladen${cur.extruder != null ? ` (Düse ${cur.extruder + 1})` : ''}`);
        const until = Date.now() + 4 * 60_000;
        let freed = false;
        while (Date.now() < until) {
          await sleep(5000);
          if (!this.dryPrep?.[amsId]) return this.coolDown(cur.extruder); // in PrintDock abgebrochen
          if (!this.client?.connected) return fail('offline');
          const r = this.cmdResults?.ams_change_filament;
          if (r && r.at >= sentAt && /fail/i.test(r.result)) return fail(r.reason ? `unload_refused:${r.reason}` : 'unload_refused');
          const still = this.loadedFrom(this.raw, amsId);
          if (!still.some((x) => x.extruder === cur.extruder && x.slot === cur.slot)) { freed = true; break; }
          if (Date.now() % 20_000 < 5000) this.pushAll();
        }
        if (!freed) return fail('unload_failed');
        this.coolDown(cur.extruder);
      }
      if (this.loadedFrom(this.raw, amsId).length) return fail('unload_failed');
      await sleep(3000);
      this.send(dryCmd);
      setTimeout(() => this.pushAll(), 3000);
    } catch (err) {
      fail(err.message);
    } finally {
      delete this.dryPrep[amsId];
      this.publishStatus();
    }
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
    let remotePath = remoteName;
    try {
      await client.access({
        host,
        port: 990,
        user: 'bblp',
        password: String(accessCode),
        secure: 'implicit',
        secureOptions: { rejectUnauthorized: false },
      });
      try {
        await client.uploadFrom(job.path, remoteName);
      } catch (err) {
        // 553 „Could not create file“: Wurzel nicht beschreibbar (je nach Modell/Firmware) – bekannte Ordner probieren
        if (!/^55[03]/.test(String(err.code || err.message))) throw err;
        const dirs = (await client.list('/').catch(() => [])).filter((x) => x.isDirectory).map((x) => x.name);
        const tryDirs = ['cache', 'sdcard', 'usb', 'udisk', 'model'].filter((d) => dirs.includes(d));
        let ok = false;
        for (const d of tryDirs) {
          try {
            await client.uploadFrom(job.path, `/${d}/${remoteName}`);
            remotePath = `${d}/${remoteName}`;
            ok = true;
            break;
          } catch {}
        }
        if (!ok) {
          const e = new Error(`${err.message} – der Drucker lässt keine Datei anlegen. Steckt eine SD-Karte bzw. ein USB-Stick und ist noch Platz frei?${dirs.length ? ` (Ordner auf dem Drucker: ${dirs.slice(0, 8).join(', ')})` : ''}`);
          throw e;
        }
      }
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
      url: `ftp:///${remotePath}`,
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

  /**
   * Laufende Datei per FTPS von der SD-Karte holen (z. B. aus Bambu Studio direkt gesendet).
   * Bambu Studio legt sie als „<Aufgabe>.gcode.3mf“ bzw. „.3mf“ in /cache oder im Wurzelordner ab.
   * Welche Platte gedruckt wird, steht in gcode_file („Metadata/plate_2.gcode“).
   */
  async fetchCurrentFile(dest, { maxBytes = 500 * 1024 ** 2 } = {}) {
    const p = this.raw || {};
    const task = String(p.subtask_name || '').trim();
    const gfile = String(p.gcode_file || '');
    const plate = Number((gfile.match(/plate_(\d+)\.gcode/i) || [])[1]) || null;
    const direct = /\.3mf$/i.test(gfile) ? gfile.replace(/^(ftp|file):\/\/\/?/i, '').replace(/^\/?sdcard\//, '') : null;
    if (!task && !direct) return null;
    const { host, accessCode } = this.config;
    const client = new ftp.Client(60_000);
    try {
      await client.access({ host, port: 990, user: 'bblp', password: String(accessCode), secure: 'implicit', secureOptions: { rejectUnauthorized: false } });
      const want = new Set([`${task}.gcode.3mf`, `${task}.3mf`, task.replace(/[^\w.\-]+/g, '_') + '.gcode.3mf', task.replace(/[^\w.\-]+/g, '_') + '.3mf'].map((x) => x.toLowerCase()));
      let found = null;
      if (direct) found = { path: direct.startsWith('/') ? direct : `/${direct}`, size: 0 };
      for (const dir of found ? [] : ['/cache', '/', '/model', '/sdcard', '/usb', '/udisk']) {
        const list = await client.list(dir).catch(() => []);
        const hits = list.filter((x) => x.isFile && want.has(x.name.toLowerCase())).sort((a, b) => (b.modifiedAt?.getTime?.() || 0) - (a.modifiedAt?.getTime?.() || 0));
        if (hits[0]) {
          found = { path: `${dir === '/' ? '' : dir}/${hits[0].name}`, size: hits[0].size };
          break;
        }
      }
      if (!found) throw new Error(`„${task}“ nicht auf der SD-Karte gefunden`);
      if (found.size > maxBytes) throw new Error(`Datei zu groß (${Math.round(found.size / 1024 ** 2)} MB)`);
      await client.downloadTo(dest, found.path);
      const name = found.path.split('/').pop();
      return { name: /\.gcode\.3mf$/i.test(name) ? name : name.replace(/\.3mf$/i, '.gcode.3mf'), plate };
    } finally {
      client.close();
    }
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
    if (cmd === 'dry') {
      // AMS 2 Pro / AMS HT trocknen (wie in Bambu Studio bzw. am Drucker); mode 0 = beenden
      const amsId = Number(args.unitId);
      if (!Number.isInteger(amsId)) throw new Error('Unbekannte AMS-Einheit');
      if (args.stop) {
        if (this.dryPrep) delete this.dryPrep[amsId];
        this.send({ command: 'ams_filament_drying', ams_id: amsId, temp: 0, cooling_temp: 0, duration: 0, humidity: 0, mode: 0, rotate_tray: false, filament: '', close_power_conflict: false });
        setTimeout(() => this.pushAll(), 3000);
        return;
      }
      const max = amsId >= 128 ? 85 : 65;
      const t = Math.round(Number(args.temp));
      const h = Math.round(Number(args.hours));
      if (!(t >= 45 && t <= max)) throw new Error(`Temperatur ${t} °C geht nicht (45–${max} °C)`);
      if (!(h >= 1 && h <= 24)) throw new Error('Dauer 1–24 Stunden');
      const dryCmd = { command: 'ams_filament_drying', ams_id: amsId, temp: t, cooling_temp: 45, duration: h, humidity: 0, mode: 1, rotate_tray: Boolean(args.rotate), filament: '', close_power_conflict: false };
      if (this.loadedFrom(this.raw || {}, amsId).length) {
        // Geladenes Filament blockiert das Trocknen – im Leerlauf zuerst zurückziehen
        const st = STATE_MAP[this.raw?.gcode_state] || 'idle';
        if (st === 'printing' || st === 'paused') throw new Error('Aus dieser Einheit wird gerade gedruckt – Bambu trocknet eine Einheit nicht, während ihr Filament im Druckkopf steckt. Eine andere AMS-Einheit lässt sich während des Drucks trocknen, wenn der Drucker das unterstützt; diese nach dem Druck.');
        if (this.dryPrep?.[amsId]) return;
        if (!args.unload) throw new Error('Aus dieser Einheit ist Filament geladen – Bambu trocknet dann nicht. Bitte am Drucker entladen oder „Filament vorher entladen“ wählen.');
        this.unloadThenDry(amsId, dryCmd);
        return;
      }
      this.send(dryCmd);
      // gleich nachfragen, damit der neue Zustand (dry_time) schnell ankommt
      setTimeout(() => this.pushAll(), 3000);
      return;
    }
    if (cmd === 'filament_setting') {
      // Material und Farbe eines AMS-Fachs bzw. der externen Spule setzen (wie in Bambu Studio)
      const m = String(args.key || '').match(/^ams(\d+)-(\d+)$|^ext(\d*)$/);
      if (!m) throw new Error(`Unbekannter Platz ${args.key}`);
      const material = String(args.material || 'PLA').toUpperCase();
      const idx = GENERIC_IDX.find(([re]) => re.test(material))?.[1];
      if (!idx) throw new Error(`Für ${args.material} kennt PrintDock kein Bambu-Profil`);
      const amsId = m[1] != null ? Number(m[1]) : 255;
      const trayId = m[1] != null ? Number(m[2]) : Number(m[3] || 0);
      this.send({
        command: 'ams_filament_setting', ams_id: amsId, tray_id: trayId, slot_id: trayId,
        tray_info_idx: idx, tray_color: `${String(args.color || '#FFFFFF').replace('#', '').toUpperCase()}FF`,
        nozzle_temp_min: Number(args.tempMin) || 190, nozzle_temp_max: Number(args.tempMax) || 240,
        tray_type: material.replace(/ .*/, ''),
      });
      return;
    }
    const map = { pause: 'pause', resume: 'resume', cancel: 'stop' };
    if (!map[cmd]) return super.command(cmd);
    this.send({ command: map[cmd], param: '' });
  }
}

/** Steckt eine Spule im Fach? Bevorzugt das „state“-Bitfeld (Bit 0 Spule, Bit 3 ruhig), sonst Filamentangaben. */
function trayLoaded(t) {
  if (t.state != null && t.state !== '') {
    const st = Number(t.state);
    if (!(st & 1)) return false;
    return st <= 3 ? st === 3 : Boolean(st & 8);
  }
  return Boolean(t.tray_info_idx || (t.tray_type && t.tray_type !== 'Empty'));
}

// Generische Bambu-Filamentprofile (tray_info_idx) je Material
const GENERIC_IDX = [
  [/^PLA[- ]?CF/, 'GFL98'], [/^PLA.*SILK/, 'GFL96'], [/^PLA/, 'GFL99'],
  [/^PETG[- ]?HF/, 'GFG96'], [/^(PETG|PCTG)/, 'GFG99'],
  [/^ABS/, 'GFB99'], [/^ASA/, 'GFB98'], [/^TPU/, 'GFU99'], [/^PC/, 'GFC99'], [/^PA/, 'GFN99'], [/^PVA/, 'GFS99'],
];

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
