// Treiber für Klipper-Drucker mit Moonraker-API.
//
// Abgedeckt u. a.:
//  - Snapmaker U1 (Moonraker ab Werk, Port 7125)
//  - Anycubic Kobra 3 / S1 / S1 Max mit Community-Firmware "Rinkhals"
//  - Voron, Creality K1/K2 (gerootet), Sovol, Elegoo mit Klipper, ...
//
// Konfiguration: { host, port = 7125, apiKey? }

const { BaseDriver, SPEED_LEVELS, temp, fetchJson, fileBlob, postForm, netError } = require('./base');

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
      { key: 'lightPin', label: 'Licht: Klipper output_pin bzw. LED-Name (optional, z. B. caselight)' },
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
    this.fanObjs = objs.filter((o) => o === 'fan' || /^fan_generic /.test(o)).slice(0, 4);
    this.lightObj = this.config.lightPin
      ? objs.find((o) => o === `output_pin ${this.config.lightPin}` || o === `led ${this.config.lightPin}` || o === `neopixel ${this.config.lightPin}`) || null
      : null;
    try {
      const cfg = await fetchJson(`${this.base}/printer/objects/query?configfile=settings`, { headers: this.headers });
      this.nozzleDiameter = Number(cfg?.result?.status?.configfile?.settings?.extruder?.nozzle_diameter) || null;
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
    const query = ['print_stats', 'virtual_sdcard', 'display_status', 'webhooks', 'toolhead', 'gcode_move', ...this.extruders, ...(this.fanObjs || [])];
    if (this.lightObj) query.push(this.lightObj);
    if (this.hasBed) query.push('heater_bed');
    if (this.chamberObj) query.push(this.chamberObj);
    const qs = query.map(encodeURIComponent).join('&');
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
      fans: (this.fanObjs || []).filter((o) => s[o]).map((o) => ({ name: o === 'fan' ? 'Bauteil' : o.replace('fan_generic ', ''), pct: Math.round((s[o].speed || 0) * 100) })),
      speed: s.gcode_move?.speed_factor != null ? { level: null, pct: Math.round(s.gcode_move.speed_factor * 100) } : null,
      light: this.lightObj ? Boolean(s[this.lightObj]?.value ?? (s[this.lightObj]?.color_data?.[0]?.some((v) => v > 0))) : null,
      nozzleDiameter: this.nozzleDiameter,
      capabilities: ['speed', ...(this.lightObj ? ['light'] : [])],
      activeSlot: this.extruders.length > 1 && s.toolhead?.extruder ? `T${Math.max(0, this.extruders.indexOf(s.toolhead.extruder))}` : null,
    });
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
      if (!this.lightObj) throw new Error('Kein Licht konfiguriert');
      const name = this.config.lightPin;
      return this.gcode(this.lightObj.startsWith('output_pin') ? `SET_PIN PIN=${name} VALUE=${args.on ? 1 : 0}` : `SET_LED LED=${name} WHITE=${args.on ? 1 : 0}`);
    }
    const path = { pause: 'pause', resume: 'resume', cancel: 'cancel' }[cmd];
    if (!path) return super.command(cmd);
    await fetchJson(`${this.base}/printer/print/${path}`, { method: 'POST', headers: this.headers });
  }
}

module.exports = MoonrakerDriver;
