// Gemeinsame Basis für alle Druckertreiber.
//
// Jeder Treiber liefert den Status im selben, herstellerneutralen Format,
// damit Oberfläche und Historie nichts über einzelne Hersteller wissen müssen.
//
// Normalisierter Status:
// {
//   online:       boolean
//   state:        'offline' | 'idle' | 'preparing' | 'printing' | 'paused' | 'finished' | 'cancelled' | 'error'
//   file:         string | null       Name des aktuellen Druckjobs
//   progress:     number | null       0..100
//   remainingSec: number | null       geschätzte Restzeit in Sekunden
//   elapsedSec:   number | null
//   layer:        number | null
//   totalLayers:  number | null
//   nozzles:      [{ name, current, target }]
//   bed:          { current, target } | null
//   chamber:      { current, target } | null
//   message:      string | null       Fehler- oder Hinweistext
//   camera:       boolean             Drucker hat eine Kamera (Bild über /api/printers/:id/camera.*)
//   filament:     [{ key, label, unit, material, color, remainPct, uid, brand, weight }]
//                 Filament-Plätze, die der Drucker selbst meldet (z. B. Bambu AMS). Leer = unbekannt.
//   activeSlot:   string | null       key des gerade genutzten Platzes
//   filamentUsedMm: number | null     bisheriger Verbrauch des laufenden Drucks in mm (falls gemeldet)
//   filamentUnits: [{ name, humidity, humidityPct, temp }]   AMS/ACE-Einheiten (Feuchte, Temperatur)
//   wifi:         number | null       WLAN-Signal in dBm
//   hms:          [{ code, text, url }]  Gerätemeldungen (Bambu HMS)
//   fans:         [{ name, pct }]     Lüfter in Prozent
//   light:        boolean | null      Bauraumlicht (null = nicht steuerbar)
//   speed:        { level, pct } | null  Druckgeschwindigkeit (level 1–4: leise, standard, sport, turbo)
//   nozzleDiameter: number | null
//   capabilities: ['light', 'speed']  welche Zusatzbefehle der Treiber kann
// }

const EventEmitter = require('events');

const EMPTY_STATUS = Object.freeze({
  online: false,
  state: 'offline',
  file: null,
  progress: null,
  remainingSec: null,
  elapsedSec: null,
  layer: null,
  totalLayers: null,
  nozzles: [],
  bed: null,
  chamber: null,
  message: null,
  camera: false,
  filament: [],
  activeSlot: null,
  filamentUsedMm: null,
  filamentUnits: [],
  wifi: null,
  hms: [],
  fans: [],
  light: null,
  speed: null,
  nozzleDiameter: null,
  capabilities: [],
});

/** Geschwindigkeitsstufen (wie bei Bambu) und Prozentwerte für Klipper/OctoPrint. */
const SPEED_LEVELS = { 1: { label: 'Leise', pct: 50 }, 2: { label: 'Standard', pct: 100 }, 3: { label: 'Sport', pct: 124 }, 4: { label: 'Turbo', pct: 166 } };

class BaseDriver extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.status = { ...EMPTY_STATUS };
    this.stopped = false;
  }

  /** Verbindung aufbauen / Polling starten. */
  async start() {}

  /** Verbindung schließen. */
  async stop() {
    this.stopped = true;
  }

  /**
   * Kameraquelle für den Kamera-Proxy (siehe camera.js) oder null.
   * Darf async sein (z. B. um das Protokoll zu erkennen).
   */
  async cameraSource() {
    return null;
  }

  /**
   * Prüft, ob dieser Drucker die Datei drucken kann.
   * @returns null wenn ja, sonst ein Hinweistext
   */
  canPrint(file) {
    return 'Dieser Drucker kann keine Drucke aus PrintDock starten';
  }

  /**
   * Datei übertragen und Druck starten.
   * @param job { path, name, kind, meta, options }
   */
  async startPrint(job) {
    throw new Error(this.canPrint(job) || 'Druckstart nicht unterstützt');
  }

  /** Steuerbefehl: 'pause' | 'resume' | 'cancel' | 'light' ({ on }) | 'speed' ({ level }). */
  async command(cmd, args = {}) {
    throw new Error(`Befehl "${cmd}" wird von diesem Treiber nicht unterstützt`);
  }

  /** Teilaktualisierung übernehmen und Änderung melden. */
  update(partial) {
    this.status = { ...this.status, ...partial };
    this.emit('status', this.status);
  }

  /** Rohdaten für die Fehlersuche (Einstellungen → Drucker → Diagnose). */
  async diagnostics() {
    return {};
  }

  setOffline(message) {
    this.status = { ...EMPTY_STATUS, message: message || null };
    this.emit('status', this.status);
  }
}

/** Netzwerkfehler in verständliches Deutsch übersetzen. */
function netError(err) {
  if (err?.name === 'AbortError') return 'Keine Antwort (Zeitüberschreitung)';
  const code = err?.code || err?.cause?.code || err?.cause?.errors?.[0]?.code;
  const map = {
    ECONNREFUSED: 'Verbindung abgelehnt – läuft der Drucker, stimmt der Port?',
    EHOSTUNREACH: 'Drucker nicht erreichbar – eingeschaltet und im Netz?',
    ENETUNREACH: 'Netzwerk nicht erreichbar',
    ETIMEDOUT: 'Keine Antwort (Zeitüberschreitung)',
    ENOTFOUND: 'Adresse nicht gefunden – IP/Hostname prüfen',
    EAI_AGAIN: 'Adresse nicht auflösbar',
    ECONNRESET: 'Verbindung abgebrochen',
  };
  return map[code] || err?.message || 'Unbekannter Fehler';
}

/** Kleine Hilfe für Temperaturwerte. */
function temp(current, target) {
  if (current == null && target == null) return null;
  return {
    current: current == null ? null : Math.round(Number(current) * 10) / 10,
    target: target == null ? null : Math.round(Number(target) * 10) / 10,
  };
}

/** fetch mit Timeout (Node 18+). */
async function fetchJson(url, { method = 'GET', headers = {}, body, timeoutMs = 5000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body == null ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} bei ${url}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(t);
  }
}

/** Datei als Blob (streamend, ohne die ganze Datei in den Speicher zu laden). */
async function fileBlob(filePath) {
  const fs = require('fs');
  if (fs.openAsBlob) return fs.openAsBlob(filePath);
  return new Blob([await fs.promises.readFile(filePath)]);
}

/** Multipart-Upload mit langem Timeout. */
async function postForm(url, form, { headers = {}, timeoutMs = 15 * 60 * 1000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', headers, body: form, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`Upload abgelehnt: HTTP ${res.status} ${text.slice(0, 160)}`);
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(t);
  }
}

module.exports = { BaseDriver, EMPTY_STATUS, SPEED_LEVELS, temp, fetchJson, fileBlob, postForm, netError };
