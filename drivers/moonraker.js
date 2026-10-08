// Treiber für Klipper-Drucker mit Moonraker-API.
//
// Abgedeckt u. a.:
//  - Snapmaker U1 (Moonraker ab Werk, Port 7125)
//  - Anycubic Kobra 3 / S1 / S1 Max mit Community-Firmware "Rinkhals"
//  - Voron, Creality K1/K2 (gerootet), Sovol, Elegoo mit Klipper, ...
//
// Konfiguration: { host, port = 7125, apiKey? }

const { BaseDriver, SPEED_LEVELS, temp, fetchJson, fileBlob, postForm, netError } = require('./base');
const { normalize: normColor } = require('../lib/colors');

const FAN_RE = /^(fan|fan_generic .+|heater_fan .+|controller_fan .+|temperature_fan .+)$/;
const FAN_ORDER = (o) => (o === 'fan' ? 0 : o.startsWith('fan_generic') ? 1 : o.startsWith('temperature_fan') ? 2 : o.startsWith('controller_fan') ? 3 : 4);
/** Lüftername für die Anzeige: "fan" → Bauteil, "heater_fan hotend_fan" → "Hotend". */
function fanName(o) {
  if (o === 'fan') return 'Bauteil';
  const n = o.replace(/^(fan_generic|heater_fan|controller_fan|temperature_fan) /, '').replace(/_?fan$/i, '').replace(/_/g, ' ').trim();
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : o;
}
const EMPTY_MAT = /^(|none|null|unknown|-|\?)$/i;

const STATE_MAP = {
  standby: 'idle',
  printing: 'printing',
  paused: 'paused',
  complete: 'finished',
  cancelled: 'cancelled',
  error: 'error',
};

class MoonrakerDriver extends BaseDriver {
  static meta = {
    id: 'moonraker',
    label: 'Klipper / Moonraker',
    hint: 'Snapmaker U1, Anycubic mit Rinkhals, Voron und alle anderen Klipper-Drucker',
    fields: [
      { key: 'host', label: 'IP-Adresse oder Hostname', required: true },
      { key: 'port', label: 'Port', default: 7125, type: 'number' },
      { key: 'apiKey', label: 'API-Key (nur falls Moonraker-Autorisierung aktiv)', secret: true },
      { key: 'cameraUrl', label: 'Kamera-Snapshot-URL (leer = automatisch aus Moonraker)' },
      { key: 'lightPin', label: 'Licht: Name des output_pin/LED (leer = automatisch erkennen)' },
    ],
  };

  get base() {
    return `http://${this.config.host}:${this.config.port || 7125}`;
  }

  get headers() {
    return this.config.apiKey ? { 'X-Api-Key': this.config.apiKey } : {};
  }

  async start() {
    this.objects = null; // Liste der Heizungen wird beim ersten Kontakt ermittelt
    this.cameraUrl = null;
    this.loop();
  }

  async stop() {
    await super.stop();
    clearTimeout(this.timer);
  }

  async loop() {
    if (this.stopped) return;
    try {
      if (!this.objects) await this.discover();
      await this.poll();
    } catch (err) {
      this.objects = null;
      this.setOffline(netError(err));
    }
    const interval = this.config.pollMs || 2000;
    this.timer = setTimeout(() => this.loop(), this.status.online ? interval : interval * 5);
  }

  async discover() {
    const list = await fetchJson(`${this.base}/printer/objects/list`, { headers: this.headers });
    const objs = list?.result?.objects || [];
    // extruder, extruder1, extruder2 ... (U1 hat vier Werkzeugköpfe)
    this.extruders = objs.filter((o) => /^extruder\d*$/.test(o)).sort();
    this.hasBed = objs.includes('heater_bed');
    // Bauraumtemperatur: gängige Namen
    this.chamberObj =
      objs.find((o) => /^(heater_generic|temperature_sensor) chamber/i.test(o)) || null;
    this.objects = objs;
    this.fanObjs = objs.filter((o) => FAN_RE.test(o)).sort((a, b) => FAN_ORDER(a) - FAN_ORDER(b)).slice(0, 8);
    // Filament-Belegung: Snapmaker U1 (print_task_config), Anycubic ACE über Rinkhals (filament_hub),
    // Happy Hare / Rinkhals-MMU (mmu), ACE-Klipper-Fork (ace_instance_N)
    this.filObjs = ['print_task_config', 'filament_detect', 'filament_hub', 'mmu', 'ace'].filter((o) => objs.includes(o));
    this.filObjs.push(...objs.filter((o) => /^ace_instance_\d+$/.test(o)));
    // Licht: fest eingestellt, sonst automatisch (Name mit light/led/lamp/caselight …)
    const lightTypes = /^(output_pin|led|neopixel|dotstar|pca9533|pca9632) /;
    const lights = objs.filter((o) => lightTypes.test(o) && !/beeper|buzzer|status|toolhead_led|sb_leds|logo|nozzle|fan/i.test(o));
    const want = String(this.config.lightPin || '').trim();
    this.lightObj = want
      ? objs.find((o) => lightTypes.test(o) && o.split(' ').slice(1).join(' ') === want) || null
      : lights.find((o) => /light|lamp|caselight|chamber|cavity|case|box|illum/i.test(o)) || lights.find((o) => /led/i.test(o)) || null;
    this.powerLight = null;
    if (!this.lightObj) {
      // Moonraker-Schaltgerät (z. B. Creality, Rinkhals): /machine/device_power
      try {
        const pw = await fetchJson(`${this.base}/machine/device_power/devices`, { headers: this.headers });
        const dev = (pw?.result?.devices || []).find((d) => (want ? d.device === want : /light|lamp|led/i.test(d.device)));
        if (dev) this.powerLight = { device: dev.device, on: dev.status === 'on' };
      } catch { /* kein device_power */ }
    }
    this.pollCount = 0;
    this.macroLight = null;
    try {
      const cfg = await fetchJson(`${this.base}/printer/objects/query?configfile=settings`, { headers: this.headers });
      const settings = cfg?.result?.status?.configfile?.settings || {};
      this.nozzleDiameter = Number(settings.extruder?.nozzle_diameter) || null;
      // Licht über Makros, z. B. LIGHT_ON/LIGHT_OFF, CASE_LIGHT_ON/…, LED_ON/LED_OFF
      if (!this.lightObj && !this.powerLight) {
        const macros = Object.keys(settings).filter((k) => k.startsWith('gcode_macro ')).map((k) => k.slice(12).toUpperCase());
        const base = macros.map((m) => m.match(/^(.*(?:LIGHT|LED|LAMP).*?)_?ON$/)?.[1]).find((b) => b && (macros.includes(`${b}_OFF`) || macros.includes(`${b}OFF`)));
        if (base) this.macroLight = { on: macros.includes(`${base}_ON`) ? `${base}_ON` : `${base}ON`, off: macros.includes(`${base}_OFF`) ? `${base}_OFF` : `${base}OFF`, state: null };
      }
    } catch {
      this.nozzleDiameter = null;
    }

    try {
      const cams = await fetchJson(`${this.base}/server/webcams/list`, { headers: this.headers });
      const cam = (cams?.result?.webcams || []).find((c) => c.enabled !== false);
      if (cam?.snapshot_url) {
        this.cameraUrl = cam.snapshot_url.startsWith('http')
          ? cam.snapshot_url
          : `http://${this.config.host}${cam.snapshot_url.startsWith('/') ? '' : '/'}${cam.snapshot_url}`;
      }
    } catch {
      /* Kamera optional */
    }
  }

  async poll() {
    const query = ['print_stats', 'virtual_sdcard', 'display_status', 'webhooks', 'toolhead', 'gcode_move', ...this.extruders, ...(this.fanObjs || []), ...(this.filObjs || [])];
    if (this.lightObj) query.push(this.lightObj);
    if (this.hasBed) query.push('heater_bed');
    if (this.chamberObj) query.push(this.chamberObj);
    const qs = query.map(encodeURIComponent).join('&');
    if (this.powerLight && this.pollCount++ % 5 === 0) {
      try {
        const st = await fetchJson(`${this.base}/machine/device_power/device?device=${encodeURIComponent(this.powerLight.device)}`, { headers: this.headers });
        this.powerLight.on = st?.result?.[this.powerLight.device] === 'on';
      } catch { /* egal */ }
    }
    const data = await fetchJson(`${this.base}/printer/objects/query?${qs}`, { headers: this.headers });
    const s = data?.result?.status || {};

    const ps = s.print_stats || {};
    const klippyState = s.webhooks?.state;
    let state = STATE_MAP[ps.state] || 'idle';
    let message = ps.message || null;
    if (klippyState && klippyState !== 'ready') {
      state = 'error';
      message = s.webhooks?.state_message || `Klipper: ${klippyState}`;
    }

    const progressRaw = s.virtual_sdcard?.progress ?? s.display_status?.progress;
    const progress = progressRaw == null ? null : Math.round(progressRaw * 1000) / 10;
    const elapsed = ps.print_duration ?? null;
    let remaining = null;
    if (state === 'printing' && progressRaw > 0.01 && elapsed) {
      remaining = Math.max(0, Math.round(elapsed / progressRaw - elapsed));
    }

    const nozzles = this.extruders.map((name, i) => ({
      name: this.extruders.length > 1 ? `T${i}` : 'Düse',
      ...temp(s[name]?.temperature, s[name]?.target),
    }));

    const chamberData = this.chamberObj ? s[this.chamberObj] : null;

    this.update({
      online: true,
      state,
      file: ps.filename || null,
      progress: ['idle'].includes(state) ? null : progress,
      remainingSec: remaining,
      elapsedSec: elapsed,
      layer: ps.info?.current_layer ?? null,
      totalLayers: ps.info?.total_layer ?? null,
      nozzles,
      bed: this.hasBed ? temp(s.heater_bed?.temperature, s.heater_bed?.target) : null,
      chamber: chamberData ? temp(chamberData.temperature, chamberData.target) : null,
      message,
      camera: Boolean(this.config.cameraUrl || this.cameraUrl),
      filamentUsedMm: ps.filament_used != null ? Math.round(ps.filament_used) : null,
      fans: (this.fanObjs || []).filter((o) => s[o]).map((o) => ({ name: fanName(o), pct: Math.round((s[o].speed || 0) * 100) })),
      speed: s.gcode_move?.speed_factor != null ? { level: null, pct: Math.round(s.gcode_move.speed_factor * 100) } : null,
      light: this.lightObj ? Boolean(s[this.lightObj]?.value ?? (s[this.lightObj]?.color_data?.[0]?.some((v) => v > 0))) : this.powerLight ? this.powerLight.on : this.macroLight ? Boolean(this.macroLight.state) : null,
      nozzleDiameter: this.nozzleDiameter,
      capabilities: ['speed', ...(this.lightObj || this.powerLight || this.macroLight ? ['light'] : [])],
      ...this.readFilament(s),
    });
  }

  /**
   * Filament-Plätze aus den druckerspezifischen Objekten.
   * Schlüssel: U1 "T0"–"T3" (je Werkzeugkopf), ACE "ace<Einheit>-<Fach>", MMU "gate<n>".
   */
  readFilament(s) {
    const toolSlot = this.extruders.length > 1 && s.toolhead?.extruder ? `T${Math.max(0, this.extruders.indexOf(s.toolhead.extruder))}` : null;
    const mat = (v) => (v == null || EMPTY_MAT.test(String(v).trim()) ? null : String(v).trim());
    const slots = [];
    const units = [];
    let activeSlot = toolSlot;

    // Snapmaker U1: je Werkzeugkopf Material, Farbe, Hersteller; RFID über filament_detect
    const ptc = s.print_task_config;
    if (ptc && ptc.filament_type && typeof ptc.filament_type === 'object') {
      const n = Math.max(this.extruders.length, Object.keys(ptc.filament_type).length);
      for (let i = 0; i < Math.min(n, 8); i++) {
        const exists = ptc.filament_exist && typeof ptc.filament_exist === 'object' ? ptc.filament_exist[i] !== false && ptc.filament_exist[i] !== 0 : true;
        const info = s.filament_detect?.info?.[i] || {};
        const sub = ptc.filament_sub_type && typeof ptc.filament_sub_type === 'object' ? mat(ptc.filament_sub_type[i]) : null;
        const material = exists ? mat(ptc.filament_type[i]) : null;
        slots.push({
          key: `T${i}`, label: `Werkzeug ${i + 1}`, unit: 'Werkzeug',
          material: material && sub && !material.includes(sub) ? `${material} ${sub}` : material,
          color: material ? normColor(ptc.filament_color_rgba?.[i] ?? ptc.filament_color?.[i]) : null,
          vendor: material ? mat(ptc.filament_vendor?.[i]) : null,
          uid: material ? (mat(info.UID ?? info.CARD_UID ?? info.uid ?? ptc.filament_sku?.[i]) || null) : null,
          weight: Number(info.WEIGHT) || null,
          remainPct: null,
        });
      }
      return { filament: slots, activeSlot, filamentUnits: units };
    }

    // Anycubic ACE über Rinkhals/GoKlipper: filament_hub.filament_hubs[].slots[]
    const hub = s.filament_hub;
    if (hub && Array.isArray(hub.filament_hubs)) {
      hub.filament_hubs.forEach((h, hi) => {
        const id = Number(h.id ?? hi);
        const name = `ACE ${id + 1}`;
        units.push({ name, temp: Number(h.temp) || null, humidityPct: Number(h.humidity) || null, humidity: null });
        (h.slots || []).forEach((sl, si) => {
          const idx = Number(sl.index ?? si);
          const empty = ['empty', 'runout'].includes(String(sl.status)) || sl.source === 3;
          const material = empty ? null : mat(sl.type ?? sl.material);
          slots.push({ key: `ace${id}-${idx}`, label: `${name} · ${idx + 1}`, unit: name, material, color: material ? normColor(sl.color) : null, uid: null, vendor: null, remainPct: null });
        });
      });
      const cur = String(hub.current_filament || '').match(/^(\d+)-(\d+)$/);
      if (cur) activeSlot = `ace${cur[1]}-${cur[2]}`;
      return { filament: slots, activeSlot, filamentUnits: units };
    }

    // ACE-Klipper-Fork: ace_instance_N.slots[]
    const inst = Object.keys(s).filter((k) => /^ace_instance_\d+$/.test(k)).sort();
    if (inst.length) {
      for (const k of inst) {
        const id = Number(k.split('_').pop());
        const name = `ACE ${id + 1}`;
        units.push({ name, temp: null, humidityPct: null, humidity: null });
        (s[k].slots || []).forEach((sl, si) => {
          const idx = Number(sl.index ?? si) % 4;
          const material = String(sl.status) === 'empty' ? null : mat(sl.material ?? sl.type);
          slots.push({ key: `ace${id}-${idx}`, label: `${name} · ${idx + 1}`, unit: name, material, color: material ? normColor(sl.color) : null, uid: null, vendor: null, remainPct: null });
        });
      }
      const ci = Number(s.ace?.current_index);
      if (Number.isFinite(ci) && ci >= 0) activeSlot = `ace${Math.floor(ci / 4)}-${ci % 4}`;
      return { filament: slots, activeSlot, filamentUnits: units };
    }

    // Happy Hare (und Rinkhals-MMU-Ansicht): mmu.gate_material[], gate_color[], gate_status[]
    const mmu = s.mmu;
    if (mmu && Array.isArray(mmu.gate_material)) {
      const name = mmu.gate_material.length <= 4 ? 'ACE 1' : 'MMU';
      units.push({ name, temp: null, humidityPct: null, humidity: null });
      mmu.gate_material.forEach((m, i) => {
        const empty = Array.isArray(mmu.gate_status) && Number(mmu.gate_status[i]) === 0;
        const material = empty ? null : mat(m);
        slots.push({ key: `gate${i}`, label: `${name} · ${i + 1}`, unit: name, material, color: material ? normColor(mmu.gate_color?.[i]) : null, uid: null, vendor: null, remainPct: null });
      });
      if (Number(mmu.gate) >= 0) activeSlot = `gate${Number(mmu.gate)}`;
      return { filament: slots, activeSlot, filamentUnits: units };
    }

    return { activeSlot };
  }

  /** Alle für Filament, Lüfter und Licht interessanten Objekte – zum Nachsehen, was der Drucker meldet. */
  async diagnostics() {
    const list = await fetchJson(`${this.base}/printer/objects/list`, { headers: this.headers });
    const objs = list?.result?.objects || [];
    const pick = objs.filter((o) => /filament|ace|mmu|hub|fan|print_task|detect|rfid|spool|led|output_pin|toolhead|extruder|machine_state|exception/i.test(o)).slice(0, 80);
    const q = await fetchJson(`${this.base}/printer/objects/query?${pick.map(encodeURIComponent).join('&')}`, { headers: this.headers });
    let info = null;
    try { info = (await fetchJson(`${this.base}/printer/info`, { headers: this.headers }))?.result || null; } catch { /* optional */ }
    let power = null;
    try { power = (await fetchJson(`${this.base}/machine/device_power/devices`, { headers: this.headers }))?.result || null; } catch { /* optional */ }
    let macros = null;
    try {
      const cfg = await fetchJson(`${this.base}/printer/objects/query?configfile=settings`, { headers: this.headers });
      macros = Object.keys(cfg?.result?.status?.configfile?.settings || {}).filter((k) => /^gcode_macro /.test(k)).map((k) => k.slice(12));
    } catch { /* optional */ }
    return { objects: objs, query: q?.result?.status || {}, printerInfo: info, devicePower: power, macros, detected: { light: this.lightObj || this.powerLight?.device || (this.macroLight ? `${this.macroLight.on}/${this.macroLight.off}` : null), filament: this.filObjs || [], fans: this.fanObjs || [] } };
  }

  async cameraSource() {
    const url = this.config.cameraUrl || this.cameraUrl;
    return url ? { type: 'http-snapshot', url, intervalMs: 700 } : null;
  }

  canPrint(file) {
    if (file.kind !== 'gcode') return 'Klipper-Drucker brauchen eine .gcode-Datei';
    return null;
  }

  async startPrint(job) {
    const form = new FormData();
    form.append('root', 'gcodes');
    form.append('print', 'true');
    form.append('file', await fileBlob(job.path), job.name);
    await postForm(`${this.base}/server/files/upload`, form, { headers: this.headers });
  }

  async gcode(script) {
    await fetchJson(`${this.base}/printer/gcode/script?script=${encodeURIComponent(script)}`, { method: 'POST', headers: this.headers });
  }

  async command(cmd, args = {}) {
    if (cmd === 'speed') return this.gcode(`M220 S${SPEED_LEVELS[args.level]?.pct || Number(args.pct) || 100}`);
    if (cmd === 'light') {
      if (this.powerLight) {
        await fetchJson(`${this.base}/machine/device_power/device?device=${encodeURIComponent(this.powerLight.device)}&action=${args.on ? 'on' : 'off'}`, { method: 'POST', headers: this.headers });
        this.powerLight.on = Boolean(args.on);
        return;
      }
      if (this.macroLight) {
        await this.gcode(args.on ? this.macroLight.on : this.macroLight.off);
        this.macroLight.state = Boolean(args.on);
        return;
      }
      if (!this.lightObj) throw new Error('Kein Licht konfiguriert');
      const name = this.lightObj.split(' ').slice(1).join(' ');
      const v = args.on ? 1 : 0;
      return this.gcode(this.lightObj.startsWith('output_pin') ? `SET_PIN PIN=${name} VALUE=${v}` : `SET_LED LED=${name} RED=${v} GREEN=${v} BLUE=${v} WHITE=${v} SYNC=0 TRANSMIT=1`);
    }
    const path = { pause: 'pause', resume: 'resume', cancel: 'cancel' }[cmd];
    if (!path) return super.command(cmd);
    await fetchJson(`${this.base}/printer/print/${path}`, { method: 'POST', headers: this.headers });
  }
}

module.exports = MoonrakerDriver;
