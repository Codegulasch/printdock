// Treiber für OctoPrint (deckt fast alle Marlin-Drucker mit Raspberry Pi ab,
// z. B. ältere Anycubic-, Creality- oder Prusa-Modelle).
//
// Konfiguration: { host, port = 80, apiKey }

const { BaseDriver, temp, fetchJson, fileBlob, postForm, netError, downloadTo } = require('./base');

class OctoPrintDriver extends BaseDriver {
  static meta = {
    id: 'octoprint',
    label: 'OctoPrint',
    hint: 'Marlin-Drucker mit OctoPrint (z. B. per Raspberry Pi)',
    fields: [
      { key: 'host', label: 'IP-Adresse oder Hostname', required: true },
      { key: 'port', label: 'Port', default: 80, type: 'number' },
      { key: 'apiKey', label: 'API-Key (OctoPrint → Einstellungen → API)', required: true, secret: true },
      { key: 'cameraUrl', label: 'Kamera-Snapshot-URL (leer = Standard von OctoPi)' },
    ],
  };

  get base() {
    return `http://${this.config.host}:${this.config.port || 80}`;
  }

  get headers() {
    return { 'X-Api-Key': this.config.apiKey || '' };
  }

  async start() {
    this.loop();
  }

  async stop() {
    await super.stop();
    clearTimeout(this.timer);
  }

  async loop() {
    if (this.stopped) return;
    try {
      await this.poll();
    } catch (err) {
      this.setOffline(netError(err));
    }
    const interval = this.config.pollMs || 3000;
    this.timer = setTimeout(() => this.loop(), this.status.online ? interval : interval * 5);
  }

  async poll() {
    const [job, printer] = await Promise.all([
      fetchJson(`${this.base}/api/job`, { headers: this.headers }),
      fetchJson(`${this.base}/api/printer`, { headers: this.headers }).catch(() => null), // 409 wenn nicht verbunden
    ]);

    const flags = printer?.state?.flags || {};
    let state = 'idle';
    if (!printer) state = 'error';
    else if (flags.error || flags.closedOrError) state = 'error';
    else if (flags.paused || flags.pausing) state = 'paused';
    else if (flags.printing) state = 'printing';
    else if (flags.cancelling) state = 'cancelled';

    const t = printer?.temperature || {};
    const nozzles = Object.keys(t)
      .filter((k) => /^tool\d+$/.test(k))
      .sort()
      .map((k, i, arr) => ({ name: arr.length > 1 ? `T${i}` : 'Düse', ...temp(t[k].actual, t[k].target) }));

    const active = state === 'printing' || state === 'paused';
    this.jobFile = job?.job?.file || null; // { name, path, origin }
    this.update({
      online: true,
      state,
      file: job?.job?.file?.name || null,
      progress: active && job?.progress?.completion != null ? Math.round(job.progress.completion * 10) / 10 : null,
      remainingSec: active ? job?.progress?.printTimeLeft ?? null : null,
      elapsedSec: active ? job?.progress?.printTime ?? null : null,
      layer: null,
      totalLayers: null,
      nozzles,
      bed: t.bed ? temp(t.bed.actual, t.bed.target) : null,
      chamber: t.chamber ? temp(t.chamber.actual, t.chamber.target) : null,
      message: !printer ? 'OctoPrint läuft, aber der Drucker ist nicht verbunden' : printer?.state?.error || null,
      camera: true,
    });
  }

  async cameraSource() {
    return { type: 'http-snapshot', url: this.config.cameraUrl || `${this.base}/webcam/?action=snapshot`, intervalMs: 700 };
  }

  canPrint(file) {
    if (file.kind !== 'gcode') return 'OctoPrint braucht eine .gcode-Datei';
    return null;
  }

  /** Laufende Datei über die OctoPrint-Download-Adresse holen (nur Dateien im lokalen Speicher, nicht SD) */
  async fetchCurrentFile(dest, { maxBytes } = {}) {
    const f = this.jobFile;
    if (!f?.path || (f.origin && f.origin !== 'local')) return null;
    const rel = String(f.path).split('/').map(encodeURIComponent).join('/');
    await downloadTo(`${this.base}/downloads/files/local/${rel}`, dest, { headers: this.headers, maxBytes });
    return { name: f.name || String(f.path).split('/').pop() };
  }

  async startPrint(job) {
    const form = new FormData();
    form.append('select', 'true');
    form.append('print', 'true');
    form.append('file', await fileBlob(job.path), job.name);
    await postForm(`${this.base}/api/files/local`, form, { headers: this.headers });
  }

  async command(cmd) {
    const body = {
      pause: { command: 'pause', action: 'pause' },
      resume: { command: 'pause', action: 'resume' },
      cancel: { command: 'cancel' },
    }[cmd];
    if (!body) return super.command(cmd);
    await fetchJson(`${this.base}/api/job`, { method: 'POST', headers: this.headers, body });
  }
}

module.exports = OctoPrintDriver;
