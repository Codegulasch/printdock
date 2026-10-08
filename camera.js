// Kamera-Proxy: Der Server holt die Bilder vom Drucker und reicht sie als
// JPEG (Einzelbild) bzw. MJPEG (Livebild) an den Browser weiter.
// Vorteil: Zugangsdaten bleiben auf dem Server, Bambu-Kameras (die kein
// Browser direkt anzeigen kann) funktionieren, und Benachrichtigungen können
// ein Foto anhängen.
//
// Quellen (vom Treiber über cameraSource() geliefert):
//   { type: 'http-snapshot', url, headers?, intervalMs? }  Moonraker, OctoPrint
//   { type: 'ffmpeg', input, inputArgs? }                   RTSP(S), z. B. Bambu X1/H2
//   { type: 'bambu-tcp', host, accessCode }                Bambu P1/A1 (Port 6000)

const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const tls = require('tls');

const IDLE_STOP_MS = 30_000; // Quelle stoppen, wenn so lange niemand zuschaut
const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);

// ------------------------------------------------------------------ Quellen

class HttpSnapshotSource extends EventEmitter {
  constructor({ url, headers = {}, intervalMs = 1000 }) {
    super();
    Object.assign(this, { url, headers, intervalMs });
  }
  start() {
    this.running = true;
    this.loop();
  }
  stop() {
    this.running = false;
    clearTimeout(this.timer);
  }
  async loop() {
    if (!this.running) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(this.url, { headers: this.headers, signal: ctrl.signal });
      if (!res.ok) throw new Error(`Kamera antwortet mit HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.subarray(0, 2).equals(SOI)) this.emit('frame', buf);
      else throw new Error('Kamera liefert kein JPEG');
    } catch (err) {
      this.emit('error', err.name === 'AbortError' ? new Error('Kamera antwortet nicht') : err);
    } finally {
      clearTimeout(t);
    }
    this.timer = setTimeout(() => this.loop(), this.intervalMs);
  }
}

class FfmpegSource extends EventEmitter {
  constructor({ input, inputArgs = [], fps = 2, width = 1280 }) {
    super();
    Object.assign(this, { input, inputArgs, fps, width });
  }
  start() {
    this.running = true;
    this.spawn();
  }
  stop() {
    this.running = false;
    clearTimeout(this.restartTimer);
    if (this.proc) this.proc.kill('SIGKILL');
  }
  spawn() {
    if (!this.running) return;
    const args = [
      '-hide_banner', '-loglevel', 'error',
      ...this.inputArgs,
      '-i', this.input,
      '-an',
      '-vf', `fps=${this.fps},scale='min(${this.width},iw)':-2`,
      '-q:v', '6',
      '-f', 'mjpeg', 'pipe:1',
    ];
    let proc;
    try {
      proc = spawn(process.env.FFMPEG_PATH || 'ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      this.emit('error', err);
      return;
    }
    this.proc = proc;
    let buf = Buffer.alloc(0);
    let stderr = '';
    proc.stdout.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      buf = extractJpegs(buf, (jpg) => this.emit('frame', jpg));
    });
    proc.stderr.on('data', (d) => (stderr = (stderr + d).slice(-500)));
    proc.on('error', (err) => {
      this.emit('error', err.code === 'ENOENT' ? new Error('ffmpeg ist nicht installiert (nötig für diese Kamera)') : err);
    });
    proc.on('exit', () => {
      if (this.proc === proc) this.proc = null;
      if (!this.running) return;
      const msg = stderr.trim().split('\n').pop();
      this.emit('error', new Error(msg ? `Kamerastream: ${msg}` : 'Kamerastream beendet'));
      this.restartTimer = setTimeout(() => this.spawn(), 5000);
    });
  }
}

/** Bambu P1/A1: proprietärer JPEG-Stream über TLS auf Port 6000. */
class BambuTcpSource extends EventEmitter {
  constructor({ host, accessCode }) {
    super();
    Object.assign(this, { host, accessCode });
  }
  start() {
    this.running = true;
    this.connect();
  }
  stop() {
    this.running = false;
    clearTimeout(this.restartTimer);
    if (this.sock) this.sock.destroy();
  }
  connect() {
    if (!this.running) return;
    const sock = tls.connect({ host: this.host, port: 6000, rejectUnauthorized: false, timeout: 10000 });
    this.sock = sock;
    let buf = Buffer.alloc(0);
    sock.on('secureConnect', () => {
      // 80-Byte-Anmeldung: 0x40, 0x3000, 0, 0, Benutzer (32 Byte), Access Code (32 Byte)
      const auth = Buffer.alloc(80);
      auth.writeUInt32LE(0x40, 0);
      auth.writeUInt32LE(0x3000, 4);
      auth.write('bblp', 16, 'ascii');
      auth.write(String(this.accessCode || ''), 48, 'ascii');
      sock.write(auth);
    });
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      // Jeder Frame: 16 Byte Kopf (Länge in den ersten 3 Byte, little endian) + JPEG
      while (buf.length >= 16) {
        const size = buf[0] | (buf[1] << 8) | (buf[2] << 16);
        if (size === 0 || size > 5_000_000) {
          buf = Buffer.alloc(0); // Synchronisation verloren
          break;
        }
        if (buf.length < 16 + size) break;
        const jpg = buf.subarray(16, 16 + size);
        if (jpg.subarray(0, 2).equals(SOI)) this.emit('frame', Buffer.from(jpg));
        buf = buf.subarray(16 + size);
      }
    });
    sock.on('timeout', () => sock.destroy(new Error('Kamera antwortet nicht')));
    sock.on('error', (err) => this.emit('error', err));
    sock.on('close', () => {
      if (!this.running) return;
      this.restartTimer = setTimeout(() => this.connect(), 5000);
    });
  }
}

/** Schneidet vollständige JPEGs aus einem Bytestrom; gibt den Rest zurück. */
function extractJpegs(buf, onFrame) {
  for (;;) {
    const start = buf.indexOf(SOI);
    if (start < 0) return Buffer.alloc(0);
    const end = buf.indexOf(EOI, start + 2);
    if (end < 0) return start > 0 ? buf.subarray(start) : buf;
    onFrame(Buffer.from(buf.subarray(start, end + 2)));
    buf = buf.subarray(end + 2);
  }
}

const SOURCES = { 'http-snapshot': HttpSnapshotSource, ffmpeg: FfmpegSource, 'bambu-tcp': BambuTcpSource };

// ------------------------------------------------------------------ Sitzung

class CameraSession extends EventEmitter {
  constructor(sourceConfig) {
    super();
    this.setMaxListeners(100);
    this.sourceConfig = sourceConfig;
    this.frame = null;
    this.frameAt = 0;
    this.error = null;
    this.viewers = 0;
  }

  ensureRunning() {
    clearTimeout(this.idleTimer);
    if (!this.source) {
      const Source = SOURCES[this.sourceConfig.type];
      this.source = new Source(this.sourceConfig);
      this.source.on('frame', (f) => {
        this.frame = f;
        this.frameAt = Date.now();
        this.error = null;
        this.emit('frame', f);
      });
      this.source.on('error', (err) => {
        this.error = err.message;
      });
      this.source.start();
    }
    if (this.viewers === 0) this.idleTimer = setTimeout(() => this.halt(), IDLE_STOP_MS);
  }

  halt() {
    if (this.source) this.source.stop();
    this.source = null;
  }

  addViewer() {
    this.viewers++;
    this.ensureRunning();
  }

  removeViewer() {
    this.viewers = Math.max(0, this.viewers - 1);
    if (this.viewers === 0) this.ensureRunning(); // startet den Leerlauf-Timer
  }

  /** Aktuelles Bild (max. maxAgeMs alt) oder auf das nächste warten. */
  snapshot({ maxAgeMs = 3000, timeoutMs = 12000 } = {}) {
    this.ensureRunning();
    if (this.frame && Date.now() - this.frameAt < maxAgeMs) return Promise.resolve(this.frame);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.off('frame', onFrame);
        reject(new Error(this.error || 'Kein Kamerabild erhalten'));
      }, timeoutMs);
      const onFrame = (f) => {
        clearTimeout(t);
        resolve(f);
      };
      this.once('frame', onFrame);
    });
  }
}

// ------------------------------------------------------------------ Verwaltung

class CameraManager {
  constructor() {
    this.sessions = new Map(); // printerId -> { key, session }
  }

  /** Sitzung für einen Drucker holen (oder null, falls er keine Kamera hat). */
  async get(printerId, driver) {
    const cfg = await driver.cameraSource();
    if (!cfg || !SOURCES[cfg.type]) return null;
    const key = JSON.stringify(cfg);
    const existing = this.sessions.get(printerId);
    if (existing && existing.key === key) return existing.session;
    if (existing) existing.session.halt();
    const session = new CameraSession(cfg);
    this.sessions.set(printerId, { key, session });
    return session;
  }

  drop(printerId) {
    const s = this.sessions.get(printerId);
    if (s) s.session.halt();
    this.sessions.delete(printerId);
  }

  /** Einzelbild für Benachrichtigungen – Fehler werden still geschluckt. */
  async trySnapshot(printerId, driver) {
    try {
      const s = await this.get(printerId, driver);
      return s ? await s.snapshot({ maxAgeMs: 5000, timeoutMs: 10000 }) : null;
    } catch {
      return null;
    }
  }
}

/** Express-freie HTTP-Handler. */
async function serveSnapshot(res, session) {
  try {
    const jpg = await session.snapshot();
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'Content-Length': jpg.length });
    res.end(jpg);
  } catch (err) {
    res.writeHead(504, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

function serveMjpeg(req, res, session) {
  const boundary = 'printdockframe';
  res.writeHead(200, {
    'Content-Type': `multipart/x-mixed-replace; boundary=${boundary}`,
    'Cache-Control': 'no-store',
    Connection: 'close',
  });
  const send = (jpg) => {
    res.write(`--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpg.length}\r\n\r\n`);
    res.write(jpg);
    res.write('\r\n');
  };
  session.addViewer();
  if (session.frame && Date.now() - session.frameAt < 10000) send(session.frame);
  session.on('frame', send);
  req.on('close', () => {
    session.off('frame', send);
    session.removeViewer();
  });
}

module.exports = { CameraManager, serveSnapshot, serveMjpeg, extractJpegs };
