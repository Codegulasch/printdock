// Simulierter Drucker – zum Ausprobieren ohne Hardware, für Demo-Daten
// und als Vorlage für neue Treiber.
//
// variant:  x2d | u1 | s1 | voron | a1 | basic   (bestimmt Düsen, Filament-System, Kammer …)
// scenario: idle | printing | paused | finished | error   (Startzustand)

const { BaseDriver, SPEED_LEVELS, temp } = require('./base');

const VARIANTS = {
  x2d: {
    nozzles: ['Links', 'Rechts'], chamber: 55, bed: 70, nozzleTemp: 250, nozzleDiameter: 0.4, wifi: -44,
    fans: ['Bauteil', 'Hilfslüfter', 'Bauraum'],
    units: [{ name: 'AMS 1', humidity: 2, humidityPct: 18, temp: 31 }],
    slots: [
      { key: 'ams0-0', label: 'AMS 1 · 1', unit: 'AMS 1', material: 'PLA', color: '#F2F2F2', remainPct: 82, uid: 'DEMO-RFID-0001', brand: 'PLA Basic' },
      { key: 'ams0-1', label: 'AMS 1 · 2', unit: 'AMS 1', material: 'PLA', color: '#1C1C1C', remainPct: 64, uid: 'DEMO-RFID-0002', brand: 'PLA Basic' },
      { key: 'ams0-2', label: 'AMS 1 · 3', unit: 'AMS 1', material: 'PETG', color: '#E2561F', remainPct: 37, uid: null },
      { key: 'ams0-3', label: 'AMS 1 · 4', unit: 'AMS 1', material: 'PLA', color: '#2E7D4F', remainPct: 12, uid: 'DEMO-RFID-0004', brand: 'PLA Matte' },
      { key: 'ext', label: 'Außen', unit: 'Extern', material: 'TPU', color: '#2F6FDE', remainPct: null, uid: null },
    ],
    light: true, speed: true,
  },
  u1: {
    nozzles: ['T0', 'T1', 'T2', 'T3'], chamber: null, bed: 65, nozzleTemp: 220, nozzleDiameter: 0.4, wifi: -58,
    fans: ['Bauteil'], units: [], slots: [], light: true, speed: true,
  },
  s1: {
    nozzles: ['Düse'], chamber: 38, bed: 60, nozzleTemp: 215, nozzleDiameter: 0.4, wifi: -61,
    fans: ['Bauteil', 'Bauraum'],
    units: [{ name: 'ACE 1', humidity: null, humidityPct: 24, temp: 29 }],
    slots: [
      { key: 'ace0', label: 'ACE 1 · 1', unit: 'ACE 1', material: 'PLA', color: '#2F6FDE', remainPct: null, uid: null },
      { key: 'ace1', label: 'ACE 1 · 2', unit: 'ACE 1', material: 'PETG', color: '#FF6A00', remainPct: null, uid: null },
      { key: 'ace2', label: 'ACE 1 · 3', unit: 'ACE 1', material: 'PLA', color: '#F5D33B', remainPct: null, uid: null },
      { key: 'ace3', label: 'ACE 1 · 4', unit: 'ACE 1', material: null, color: null, remainPct: null, uid: null },
    ],
    light: true, speed: true,
  },
  voron: {
    nozzles: ['Düse'], chamber: 52, bed: 100, nozzleTemp: 255, nozzleDiameter: 0.4, wifi: null,
    fans: ['Bauteil', 'Nevermore'], units: [], slots: [], light: true, speed: true,
  },
  a1: {
    nozzles: ['Düse'], chamber: null, bed: 55, nozzleTemp: 220, nozzleDiameter: 0.4, wifi: -52,
    fans: ['Bauteil'],
    units: [{ name: 'AMS lite', humidity: null, humidityPct: null, temp: null }],
    slots: [
      { key: 'ams0-0', label: 'AMS lite · 1', unit: 'AMS lite', material: 'PLA', color: '#C8102E', remainPct: 90, uid: null },
      { key: 'ams0-1', label: 'AMS lite · 2', unit: 'AMS lite', material: 'PLA', color: '#FFFFFF', remainPct: 45, uid: null },
      { key: 'ams0-2', label: 'AMS lite · 3', unit: 'AMS lite', material: null, color: null, remainPct: null, uid: null },
      { key: 'ams0-3', label: 'AMS lite · 4', unit: 'AMS lite', material: null, color: null, remainPct: null, uid: null },
    ],
    light: false, speed: true,
  },
  basic: { nozzles: ['Düse'], chamber: null, bed: 60, nozzleTemp: 215, nozzleDiameter: 0.4, wifi: null, fans: ['Bauteil'], units: [], slots: [], light: false, speed: false },
};

class DemoDriver extends BaseDriver {
  static meta = {
    id: 'demo',
    label: 'Demo (simuliert)',
    hint: 'Simulierter Drucker zum Ausprobieren ohne Hardware',
    fields: [
      {
        key: 'variant', label: 'Druckertyp', type: 'select', default: 'basic',
        options: [
          { value: 'basic', label: 'Einfacher Drucker' },
          { value: 'x2d', label: 'Wie Bambu X2D (2 Düsen, AMS, Kammer)' },
          { value: 'u1', label: 'Wie Snapmaker U1 (4 Werkzeuge)' },
          { value: 's1', label: 'Wie Anycubic S1 mit ACE' },
          { value: 'a1', label: 'Wie Bambu A1 mit AMS lite' },
          { value: 'voron', label: 'Wie Voron (Klipper)' },
        ],
      },
      {
        key: 'scenario', label: 'Startzustand', type: 'select', default: 'idle',
        options: [
          { value: 'idle', label: 'Bereit' },
          { value: 'printing', label: 'Druckt' },
          { value: 'paused', label: 'Pausiert (Filament leer)' },
          { value: 'finished', label: 'Fertig' },
          { value: 'error', label: 'Störung' },
        ],
      },
    ],
  };

  get v() {
    // eigene Kopie je Drucker, damit simulierte Spulenwechsel nur diesen Drucker betreffen
    if (!this._v || this._vKey !== this.config.variant) {
      const base = VARIANTS[this.config.variant] || VARIANTS.basic;
      this._v = { ...base, slots: base.slots.map((s) => ({ ...s, present: s.present ?? Boolean(s.material) })) };
      this._vKey = this.config.variant;
    }
    return this._v;
  }

  async start() {
    this.t = 0;
    this.phase = 'idle';
    this.progress = 0;
    this.paused = false;
    this.lightOn = this.v.light ? true : null;
    this.speedLevel = 2;
    this.temps = { nozzle: this.v.nozzles.map(() => 26), bed: 25, chamber: 24 };
    const sc = this.config.scenario || 'idle';
    if (sc !== 'idle') {
      this.jobName = this.config.jobName || 'Demo_Teil.gcode';
      this.step = Number(this.config.step) || 0.05;
      this.progress = Number(this.config.progress) || 34;
      this.phase = sc === 'finished' ? 'finished' : sc === 'error' ? 'error' : 'printing';
      this.paused = sc === 'paused';
      if (sc === 'printing' || sc === 'paused') {
        this.temps = { nozzle: this.v.nozzles.map((_, i) => (i === 0 ? this.v.nozzleTemp : 150)), bed: this.v.bed, chamber: this.v.chamber || 24 };
      }
      if (sc === 'finished') this.progress = 100;
    }
    this.tick();
    this.timer = setInterval(() => this.tick(), 2000);
  }

  async stop() {
    await super.stop();
    clearInterval(this.timer);
  }

  /** Temperatur nähert sich dem Ziel – sieht im Verlauf echt aus. */
  approach(cur, target, ambient = 26) {
    const goal = target || ambient;
    const next = cur + (goal - cur) * 0.18 + (Math.random() - 0.5) * (target ? 0.8 : 0.2);
    return Math.round(next * 10) / 10;
  }

  tick() {
    this.t++;
    const v = this.v;
    const speedMul = (SPEED_LEVELS[this.speedLevel]?.pct || 100) / 100;
    if (this.phase === 'printing' && !this.paused) {
      this.progress += (this.step || 0.8) * speedMul;
      if (this.progress >= 100) {
        if (this.config.loop) this.progress = 3;
        else {
          this.progress = 100;
          this.phase = 'finished';
        }
      }
    }
    const heating = this.phase === 'printing';
    const multiTool = v.nozzles.length > 2;
    const activeTool = multiTool ? Math.floor(this.progress / 25) % v.nozzles.length : 0;
    const nTarget = (i) => {
      if (!heating) return 0;
      if (multiTool) return i === activeTool ? v.nozzleTemp : 150;
      return i === 0 ? v.nozzleTemp : 0;
    };
    this.temps.nozzle = this.temps.nozzle.map((c, i) => this.approach(c, nTarget(i)));
    const bedTarget = heating ? v.bed : 0;
    this.temps.bed = this.approach(this.temps.bed, bedTarget, 25);
    if (v.chamber) this.temps.chamber = this.approach(this.temps.chamber, heating ? v.chamber : 0, 24);

    const state = this.phase === 'printing' ? (this.paused ? 'paused' : 'printing') : this.phase;
    const idle = state === 'idle';
    const totalLayers = 320;
    const step = (this.step || 0.8) * speedMul;
    const slots = v.slots.map((s) => ({ ...s }));
    let activeSlot = null;
    if (heating && slots.length) activeSlot = slots[Math.floor(this.progress / 30) % Math.min(2, slots.length)].key;
    if (heating && multiTool) activeSlot = `T${activeTool}`;
    this.update({
      online: true,
      state,
      file: idle ? null : this.jobName || 'Demo_Teil.gcode',
      progress: idle ? null : Math.round(this.progress * 10) / 10,
      remainingSec: state === 'printing' || state === 'paused' ? Math.round(((100 - this.progress) / step) * 2) : null,
      elapsedSec: idle ? null : Math.round((this.progress / step) * 2),
      layer: idle ? null : Math.max(1, Math.round((this.progress / 100) * totalLayers)),
      totalLayers: idle ? null : totalLayers,
      nozzles: v.nozzles.map((name, i) => ({ name, ...temp(this.temps.nozzle[i], nTarget(i)) })),
      bed: temp(this.temps.bed, bedTarget),
      chamber: v.chamber ? temp(this.temps.chamber, heating ? v.chamber : null) : null,
      message: this.paused ? 'Filament aufgebraucht – bitte nachladen (simuliert)' : state === 'error' ? 'Düse verstopft erkannt (simuliert)' : null,
      camera: true,
      filament: slots,
      filamentUnits: v.units,
      activeSlot,
      filamentUsedMm: idle ? null : Math.round(this.progress * 60),
      wifi: v.wifi != null ? v.wifi + Math.round((Math.random() - 0.5) * 4) : null,
      hms: state === 'error' ? [{ code: '0300_0100_0001_0007', text: 'Simulierte Störung: Düse verstopft', url: null }] : [],
      fans: v.fans.map((name, i) => ({ name, pct: heating ? [100, 40, 60][i] ?? 30 : 0 })),
      light: this.lightOn,
      speed: v.speed ? { level: this.speedLevel, pct: SPEED_LEVELS[this.speedLevel].pct } : null,
      nozzleDiameter: v.nozzleDiameter,
      capabilities: [...(v.light ? ['light'] : []), ...(v.speed ? ['speed'] : [])],
    });
  }

  /** Testbild über ffmpeg – zeigt, wie die Kamera-Ansicht funktioniert. */
  async cameraSource() {
    return { type: 'ffmpeg', inputArgs: ['-re', '-f', 'lavfi'], input: 'testsrc2=size=960x540:rate=4' };
  }

  canPrint(file) {
    return file.printable ? null : 'Datei ist nicht gesliced';
  }

  async startPrint(job) {
    await new Promise((r) => setTimeout(r, 800)); // Übertragung simulieren
    this.phase = 'printing';
    this.paused = false;
    this.progress = 0;
    this.jobName = job.name;
    // Zeitraffer: geschätzte Zeit / 60, mindestens 40 s
    this.step = 100 / Math.max(20, (job.meta?.estimatedSec || 2400) / 60 / 2);
    this.tick();
  }

  async command(cmd, args = {}) {
    if (cmd === 'pause') this.paused = true;
    else if (cmd === 'resume') this.paused = false;
    else if (cmd === 'cancel') this.phase = 'cancelled';
    else if (cmd === 'light' && this.v.light) this.lightOn = Boolean(args.on);
    else if (cmd === 'speed' && this.v.speed) this.speedLevel = Math.max(1, Math.min(4, Number(args.level) || 2));
    else if (cmd === 'filament_setting' || cmd === 'demo_slot') {
      // filament_setting: wie Bambu „Fach einstellen“; demo_slot: Spule einlegen/entnehmen simulieren
      const s = this.v.slots.find((x) => x.key === args.key);
      if (!s) throw new Error(`Unbekannter Platz ${args.key}`);
      if (cmd === 'demo_slot' && args.present === false) Object.assign(s, { material: null, color: null, uid: null, present: false, remainPct: null });
      else Object.assign(s, { material: args.material ?? s.material, color: args.color ?? s.color, uid: cmd === 'demo_slot' ? args.uid || null : s.uid, present: true, ...(cmd === 'demo_slot' ? { remainPct: null } : {}) });
    }
    else return super.command(cmd);
    this.tick();
  }
}

module.exports = DemoDriver;
