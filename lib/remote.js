// Fernzugriff direkt aus PrintDock: Tailscale (privates VPN) und Cloudflare Tunnel.
// Läuft überall gleich – Home-Assistant-Add-on, Docker, Raspberry Pi: PrintDock lädt das Programm
// beim ersten Einschalten selbst herunter (in den Datenordner, bleibt bei Updates erhalten)
// und startet/überwacht es. Nichts muss am Router freigegeben werden.
//
//   Tailscale        tailscaled im Userspace-Modus (keine Root-Rechte, kein /dev/net/tun nötig).
//                    Anmeldung mit Auth-Key oder per Link. Optional HTTPS über „tailscale serve“
//                    (https://printdock.<tailnet>.ts.net) – Voraussetzung für NFC am Handy.
//   Cloudflare       „Schnelltest“: zufällige Adresse https://…trycloudflare.com ohne Konto
//                    oder „Eigene Adresse“: Tunnel-Token aus dem Cloudflare-Dashboard.
//                    Nur mit eingeschaltetem Login-Schutz.

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn, execFile } = require('child_process');
const { store, DATA_DIR } = require('./store');

const BIN = path.join(DATA_DIR, 'bin');
const TS_DIR = path.join(DATA_DIR, 'tailscale');
const TS_SOCK = path.join(TS_DIR, 'tailscaled.sock');
const ARCH = { x64: 'amd64', arm64: 'arm64', arm: 'arm' }[process.arch] || null;
const OS = process.platform; // linux | win32 | darwin
const IN_CONTAINER = Boolean(process.env.SUPERVISOR_TOKEN) || fs.existsSync('/.dockerenv');

/** Bereits installiertes Tailscale (App auf Windows/Mac, Dienst auf dem Pi/Server) – dann nutzen wir dieses */
function hostTailscaleCandidates() {
  if (IN_CONTAINER) return [];
  if (OS === 'win32') return [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe')];
  if (OS === 'darwin') return ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale'];
  return ['/usr/bin/tailscale', '/usr/local/bin/tailscale', '/usr/sbin/tailscale'];
}

const db = store('remote.json', {
  tailscale: { enabled: false, authKey: '', hostname: 'printdock', https: true },
  cloudflare: { enabled: false, mode: 'quick', token: '', hostname: '' },
});

const httpError = (status, message) => Object.assign(new Error(message), { status });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Datei herunterladen (folgt Weiterleitungen) */
function download(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'PrintDock' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).href, dest, redirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Download fehlgeschlagen (HTTP ${res.statusCode})`));
      }
      const tmp = `${dest}.part`;
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', () => out.close(() => { fs.renameSync(tmp, dest); resolve(dest); }));
      out.on('error', reject);
    }).on('error', reject);
  });
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'PrintDock' } }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

const run = (bin, args, { timeout = 20_000, env } = {}) => new Promise((resolve, reject) => {
  execFile(bin, args, { timeout, env: { ...process.env, ...env } }, (err, stdout, stderr) => {
    if (err) return reject(Object.assign(new Error((stderr || err.message).trim().split('\n').pop()), { stdout, stderr }));
    resolve(stdout);
  });
});

/** Übrig gebliebenen Prozess eines früheren Laufs beenden (nach Absturz/hartem Neustart) */
function killStale(name) {
  const file = path.join(BIN, `${name}.pid`);
  try {
    const pid = Number(fs.readFileSync(file, 'utf8'));
    if (pid && fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(name)) process.kill(pid, 'SIGTERM');
  } catch { /* nichts zu tun */ }
}
const writePid = (name, pid) => { try { fs.writeFileSync(path.join(BIN, `${name}.pid`), String(pid)); } catch {} };

class Remote {
  /** ctx: { port, broadcast(event), authEnabled() } */
  constructor(ctx) {
    this.ctx = ctx;
    this.st = {
      tailscale: { status: 'off', msg: null, loginUrl: null, url: null, httpsUrl: null, ips: [], version: null },
      cloudflare: { status: 'off', msg: null, url: null, connections: 0, version: null },
    };
    this.proc = { tailscale: null, cloudflare: null };
    this.want = { tailscale: false, cloudflare: false };
    this.backoff = { tailscale: 5000, cloudflare: 5000 };
  }

  set(service, patch) {
    Object.assign(this.st[service], patch);
    this.ctx.broadcast('remote', null);
  }

  view() {
    const c = db.data;
    return {
      arch: ARCH,
      os: OS,
      port: this.ctx.port,
      addon: Boolean(process.env.SUPERVISOR_TOKEN),
      tailscale: { enabled: c.tailscale.enabled, hostname: c.tailscale.hostname, https: c.tailscale.https, hasKey: Boolean(c.tailscale.authKey), ...this.st.tailscale, external: Boolean(this.external) },
      cloudflare: { enabled: c.cloudflare.enabled, mode: c.cloudflare.mode, hostname: c.cloudflare.hostname, hasToken: Boolean(c.cloudflare.token), ...this.st.cloudflare },
    };
  }

  /** Beim Start: eingeschaltete Dienste hochfahren */
  init() {
    if (db.data.tailscale.enabled) this.startTailscale().catch(() => {});
    if (db.data.cloudflare.enabled) this.startCloudflare().catch(() => {});
    const stop = () => { this.kill('tailscale'); this.kill('cloudflare'); };
    process.once('exit', stop);
  }

  async save(body = {}) {
    const c = db.data;
    if (body.tailscale) {
      const b = body.tailscale;
      if (b.authKey !== undefined && b.authKey !== '••••') c.tailscale.authKey = String(b.authKey || '').trim();
      if (b.hostname !== undefined) c.tailscale.hostname = String(b.hostname || 'printdock').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'printdock';
      if (b.https !== undefined) c.tailscale.https = Boolean(b.https);
      if (b.enabled !== undefined) c.tailscale.enabled = Boolean(b.enabled);
      db.save();
      this.kill('tailscale');
      if (c.tailscale.enabled) this.startTailscale().catch(() => {});
      else this.set('tailscale', { status: 'off', msg: null, loginUrl: null });
    }
    if (body.cloudflare) {
      const b = body.cloudflare;
      if (b.mode === 'quick' || b.mode === 'token') c.cloudflare.mode = b.mode;
      if (b.token !== undefined && b.token !== '••••') c.cloudflare.token = String(b.token || '').trim().replace(/^.*--token\s+/, '').replace(/^.*service install\s+/, '');
      if (b.hostname !== undefined) c.cloudflare.hostname = String(b.hostname || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').slice(0, 120);
      if (b.enabled !== undefined) {
        if (b.enabled && !this.ctx.authEnabled()) throw httpError(409, 'Zuerst den Login-Schutz einschalten – über den Tunnel ist PrintDock aus dem Internet erreichbar');
        if (b.enabled && c.cloudflare.mode === 'token' && !c.cloudflare.token) throw httpError(400, 'Bitte den Tunnel-Token eintragen');
        c.cloudflare.enabled = Boolean(b.enabled);
      }
      db.save();
      this.kill('cloudflare');
      if (c.cloudflare.enabled) this.startCloudflare().catch(() => {});
      else this.set('cloudflare', { status: 'off', msg: null, url: null, connections: 0 });
    }
    return this.view();
  }

  /** Login-Schutz wurde ausgeschaltet → öffentlichen Tunnel sicherheitshalber stoppen */
  authChanged() {
    if (!this.ctx.authEnabled() && db.data.cloudflare.enabled) {
      db.data.cloudflare.enabled = false;
      db.save();
      this.kill('cloudflare');
      this.set('cloudflare', { status: 'off', msg: 'Gestoppt, weil der Login-Schutz ausgeschaltet wurde', url: null });
    }
  }

  kill(service) {
    this.want[service] = false;
    clearTimeout(this.restartTimer?.[service]);
    const p = this.proc[service];
    if (p && p.exitCode === null) p.kill('SIGTERM');
    this.proc[service] = null;
    if (service === 'tailscale') clearInterval(this.tsPoll);
  }

  respawnLater(service, fn) {
    if (!this.want[service]) return;
    this.restartTimer ||= {};
    const ms = this.backoff[service];
    this.backoff[service] = Math.min(120_000, ms * 2);
    this.restartTimer[service] = setTimeout(() => fn.call(this).catch(() => {}), ms);
  }

  // ================================================================ Programme besorgen

  async ensureCloudflared() {
    const bin = process.env.CLOUDFLARED_BIN || path.join(BIN, OS === 'win32' ? 'cloudflared.exe' : 'cloudflared');
    if (fs.existsSync(bin)) return bin;
    if (!ARCH) throw new Error(`Prozessor-Typ ${process.arch} wird nicht unterstützt`);
    fs.mkdirSync(BIN, { recursive: true });
    this.set('cloudflare', { status: 'downloading', msg: null });
    console.log('Fernzugriff: lade cloudflared …');
    const base = 'https://github.com/cloudflare/cloudflared/releases/latest/download';
    if (OS === 'win32') {
      await download(`${base}/cloudflared-windows-${ARCH === 'arm' ? '386' : 'amd64'}.exe`, bin);
    } else if (OS === 'darwin') {
      const tgz = path.join(BIN, 'cloudflared.tgz');
      await download(`${base}/cloudflared-darwin-${ARCH === 'arm64' ? 'arm64' : 'amd64'}.tgz`, tgz);
      await run('tar', ['-xzf', tgz, '-C', BIN], { timeout: 60_000 });
      fs.rmSync(tgz, { force: true });
    } else {
      await download(`${base}/cloudflared-linux-${ARCH}`, bin);
    }
    if (OS !== 'win32') fs.chmodSync(bin, 0o755);
    return bin;
  }

  async ensureTailscale() {
    const dir = process.env.TAILSCALE_DIR || BIN;
    const ts = path.join(dir, 'tailscale');
    const tsd = path.join(dir, 'tailscaled');
    if (fs.existsSync(ts) && fs.existsSync(tsd)) return { ts, tsd };
    if (!ARCH) throw new Error(`Prozessor-Typ ${process.arch} wird nicht unterstützt`);
    fs.mkdirSync(BIN, { recursive: true });
    this.set('tailscale', { status: 'downloading', msg: null });
    console.log('Fernzugriff: lade Tailscale …');
    const info = await getJson('https://pkgs.tailscale.com/stable/?mode=json');
    const ver = info.TarballsVersion;
    const name = info.Tarballs?.[ARCH] || (ver ? `tailscale_${ver}_${ARCH}.tgz` : null);
    if (!name) throw new Error('Tailscale-Version nicht ermittelbar');
    const tgz = path.join(BIN, name);
    await download(`https://pkgs.tailscale.com/stable/${name}`, tgz);
    const tmp = path.join(BIN, 'ts-extract');
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    await run('tar', ['-xzf', tgz, '-C', tmp], { timeout: 120_000 });
    const sub = path.join(tmp, fs.readdirSync(tmp)[0]);
    for (const f of ['tailscale', 'tailscaled']) {
      fs.copyFileSync(path.join(sub, f), path.join(BIN, f));
      fs.chmodSync(path.join(BIN, f), 0o755);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(tgz, { force: true });
    return { ts: path.join(BIN, 'tailscale'), tsd: path.join(BIN, 'tailscaled') };
  }

  // ================================================================ Cloudflare Tunnel

  async startCloudflare() {
    this.want.cloudflare = true;
    const c = db.data.cloudflare;
    let bin;
    try {
      bin = await this.ensureCloudflared();
    } catch (err) {
      this.set('cloudflare', { status: 'error', msg: `cloudflared: ${err.message}` });
      return this.respawnLater('cloudflare', this.startCloudflare);
    }
    if (!this.want.cloudflare) return;
    const target = `http://127.0.0.1:${this.ctx.port}`;
    const args = c.mode === 'quick'
      ? ['tunnel', '--no-autoupdate', '--url', target]
      : ['tunnel', '--no-autoupdate', 'run'];
    const env = { ...process.env, ...(c.mode === 'token' ? { TUNNEL_TOKEN: c.token } : {}), HOME: path.join(DATA_DIR, 'bin') };
    this.set('cloudflare', { status: 'starting', msg: null, url: c.mode === 'token' && c.hostname ? `https://${c.hostname}` : null, connections: 0 });
    killStale('cloudflared');
    const p = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc.cloudflare = p;
    writePid('cloudflared', p.pid);
    let tail = '';
    const onLine = (line) => {
      tail = line;
      const m = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/.exec(line);
      if (m && c.mode === 'quick') this.set('cloudflare', { url: m[0] });
      if (/Registered tunnel connection/i.test(line)) {
        this.backoff.cloudflare = 5000;
        this.set('cloudflare', { status: 'running', msg: null, connections: this.st.cloudflare.connections + 1 });
      }
      if (/Unregistered tunnel connection|Connection terminated/i.test(line)) this.set('cloudflare', { connections: Math.max(0, this.st.cloudflare.connections - 1) });
      if (/Unauthorized|invalid.*token|Provided Tunnel token is not valid/i.test(line)) this.set('cloudflare', { status: 'error', msg: 'Tunnel-Token ungültig – im Cloudflare-Dashboard neu kopieren' });
      const v = /cloudflared version (\S+)/i.exec(line) || /Version (\d{4}\.\d+\.\d+)/.exec(line);
      if (v) this.st.cloudflare.version = v[1];
    };
    let buf = '';
    const feed = (d) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      lines.forEach(onLine);
    };
    p.stdout.on('data', feed);
    p.stderr.on('data', feed);
    p.on('error', (err) => this.set('cloudflare', { status: 'error', msg: err.message }));
    p.on('exit', (code) => {
      if (this.proc.cloudflare === p) this.proc.cloudflare = null;
      if (!this.want.cloudflare) return;
      if (this.st.cloudflare.status !== 'error') this.set('cloudflare', { status: 'error', msg: `cloudflared beendet (${code ?? '–'}): ${tail.replace(/^\S+\s+\S+\s+/, '').slice(0, 160)}`, connections: 0 });
      console.warn(`Fernzugriff: cloudflared beendet (${code}) – starte neu`);
      this.respawnLater('cloudflare', this.startCloudflare);
    });
  }

  // ================================================================ Tailscale

  tsArgs(...args) {
    return this.external ? args : [`--socket=${TS_SOCK}`, ...args];
  }

  /** Läuft auf diesem Rechner schon Tailscale (App/Dienst)? → { ts } oder null */
  async findHostTailscale() {
    if (process.env.TAILSCALE_DIR) return null;
    for (const bin of hostTailscaleCandidates()) {
      if (!fs.existsSync(bin)) continue;
      try {
        const st = JSON.parse(await run(bin, ['status', '--json'], { timeout: 8000 }).catch((err) => err.stdout || '{}'));
        if (st.BackendState) return { ts: bin };
      } catch { /* weiter */ }
    }
    return null;
  }

  async startTailscale() {
    this.want.tailscale = true;
    const c = db.data.tailscale;
    // Vorhandenes Tailscale des Rechners nutzen (Windows/Mac-App, Dienst auf dem Pi) – nichts zusätzlich starten
    const host = await this.findHostTailscale();
    if (host) {
      this.external = true;
      this.bins = host;
      this.proc.tailscale = { external: true, exitCode: null, kill() {} };
      this.httpsTriedAt = 0;
      this.set('tailscale', { status: 'starting', msg: null, loginUrl: null, external: true });
      await this.pollTailscale();
      clearInterval(this.tsPoll);
      this.tsPoll = setInterval(() => this.pollTailscale().catch(() => {}), 15_000);
      this.tsPoll.unref?.();
      return;
    }
    this.external = false;
    if (OS !== 'linux') {
      this.set('tailscale', { status: 'error', msg: 'Auf Windows und Mac bitte die Tailscale-App installieren (tailscale.com/download) und anmelden – PrintDock nutzt sie dann automatisch.' });
      return this.respawnLater('tailscale', this.startTailscale);
    }
    let bins;
    try {
      bins = await this.ensureTailscale();
    } catch (err) {
      this.set('tailscale', { status: 'error', msg: `Tailscale: ${err.message}` });
      return this.respawnLater('tailscale', this.startTailscale);
    }
    if (!this.want.tailscale) return;
    this.bins = bins;
    this.httpsTriedAt = 0;
    fs.mkdirSync(TS_DIR, { recursive: true });
    this.set('tailscale', { status: 'starting', msg: null, loginUrl: null });
    killStale('tailscaled');
    await sleep(300);
    const p = spawn(bins.tsd, ['--tun=userspace-networking', `--statedir=${TS_DIR}`, `--socket=${TS_SOCK}`, '--port=0'], { stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc.tailscale = p;
    writePid('tailscaled', p.pid);
    let tail = '';
    const keep = (d) => { tail = d.toString().trim().split('\n').pop() || tail; };
    p.stdout.on('data', keep);
    p.stderr.on('data', keep);
    p.on('error', (err) => this.set('tailscale', { status: 'error', msg: err.message }));
    p.on('exit', (code) => {
      if (this.proc.tailscale === p) this.proc.tailscale = null;
      clearInterval(this.tsPoll);
      if (!this.want.tailscale) return;
      this.set('tailscale', { status: 'error', msg: `tailscaled beendet (${code ?? '–'}): ${tail.slice(0, 160)}` });
      this.respawnLater('tailscale', this.startTailscale);
    });
    // warten, bis der Dienst antwortet
    for (let i = 0; i < 30 && !fs.existsSync(TS_SOCK); i++) await sleep(500);
    await sleep(800);
    try {
      const args = ['up', `--hostname=${c.hostname}`, '--accept-dns=false', `--timeout=${c.authKey ? 25 : 8}s`, '--reset'];
      if (c.authKey) args.push(`--authkey=${c.authKey}`);
      await run(bins.ts, this.tsArgs(...args), { timeout: 30_000 }).catch((err) => {
        // ohne Auth-Key: „up“ wartet auf die Anmeldung im Browser – das ist kein Fehler
        if (!/timeout|context deadline|To authenticate/i.test(`${err.message} ${err.stdout || ''} ${err.stderr || ''}`)) throw err;
      });
    } catch (err) {
      this.set('tailscale', { status: 'error', msg: err.message.slice(0, 200) });
    }
    this.backoff.tailscale = 5000;
    await this.pollTailscale();
    clearInterval(this.tsPoll);
    this.tsPoll = setInterval(() => this.pollTailscale().catch(() => {}), 15_000);
    this.tsPoll.unref?.();
  }

  async pollTailscale() {
    if (!this.bins || !this.proc.tailscale) return;
    let s;
    try {
      s = JSON.parse(await run(this.bins.ts, this.tsArgs('status', '--json'), { timeout: 10_000 }));
    } catch (err) {
      return this.set('tailscale', { status: 'error', msg: err.message.slice(0, 200) });
    }
    const self = s.Self || {};
    const dns = String(self.DNSName || '').replace(/\.$/, '');
    const ver = s.Version ? String(s.Version).split('-')[0] : null;
    if ((s.BackendState === 'NeedsLogin' || s.BackendState === 'NoState') && this.external) {
      return this.set('tailscale', { status: 'login', loginUrl: s.AuthURL || null, msg: 'In der Tailscale-App dieses Rechners anmelden.', version: ver });
    }
    if (s.BackendState === 'NeedsLogin' || s.BackendState === 'NoState') {
      // ohne Auth-Key: Anmelde-Link holen
      let url = s.AuthURL || null;
      if (!url) {
        try {
          await run(this.bins.ts, this.tsArgs('up', `--hostname=${db.data.tailscale.hostname}`, '--accept-dns=false', '--timeout=3s'), { timeout: 8000 });
        } catch (err) {
          url = (/https:\/\/login\.tailscale\.com\/a\/\S+/.exec(`${err.stdout || ''}${err.stderr || ''}`) || [])[0] || null;
        }
      }
      return this.set('tailscale', { status: 'login', loginUrl: url, msg: null, version: ver });
    }
    if (s.BackendState !== 'Running') return this.set('tailscale', { status: 'starting', msg: s.BackendState || null, version: ver });
    const ips = self.TailscaleIPs || [];
    const patch = { status: 'running', loginUrl: null, msg: this.httpsMsg || null, ips, version: ver, url: `http://${dns.split('.')[0] || db.data.tailscale.hostname}:${this.ctx.port}`, dnsName: dns };
    // HTTPS im Tailnet (Zertifikat von Tailscale) – einmal einrichten
    // (klappt das nicht, alle 5 Minuten erneut – z. B. nachdem HTTPS im Tailnet eingeschaltet wurde)
    if (db.data.tailscale.https && dns && !this.st.tailscale.httpsUrl && Date.now() - (this.httpsTriedAt || 0) > 5 * 60_000) {
      this.httpsTriedAt = Date.now();
      try {
        await run(this.bins.ts, this.tsArgs('serve', '--bg', `http://127.0.0.1:${this.ctx.port}`), { timeout: 25_000 });
        patch.httpsUrl = `https://${dns}`;
        patch.httpsEnableUrl = null;
        patch.msg = this.httpsMsg = null;
      } catch (err) {
        const out = `${err.message} ${err.stdout || ''} ${err.stderr || ''}`;
        patch.httpsEnableUrl = (/https:\/\/login\.tailscale\.com\/f\/\S+/.exec(out) || [])[0] || null;
        patch.msg = this.httpsMsg = patch.httpsEnableUrl || /HTTPS|cert|not enabled|Serve/i.test(out) ? 'HTTPS ist im Tailnet noch nicht eingeschaltet (Tailscale-Admin → DNS → HTTPS Certificates)' : `HTTPS: ${err.message.slice(0, 160)}`;
      }
    } else if (!db.data.tailscale.https && this.st.tailscale.httpsUrl) {
      await run(this.bins.ts, this.tsArgs('serve', 'reset'), { timeout: 15_000 }).catch(() => {});
      patch.httpsUrl = null;
    }
    this.set('tailscale', patch);
  }

  async tailscaleLogout() {
    if (this.bins && this.proc.tailscale && !this.external) await run(this.bins.ts, this.tsArgs('logout'), { timeout: 15_000 }).catch(() => {});
    db.data.tailscale.enabled = false;
    db.data.tailscale.authKey = '';
    db.save();
    this.kill('tailscale');
    fs.rmSync(TS_DIR, { recursive: true, force: true });
    this.httpsTriedAt = 0;
    this.set('tailscale', { status: 'off', msg: null, loginUrl: null, url: null, httpsUrl: null, ips: [] });
    return this.view();
  }
}

module.exports = { Remote };
