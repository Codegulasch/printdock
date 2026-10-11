// Updates aus PrintDock heraus.
//
// Prüfen: neueste Versions-Markierung (Tag „v1.2.3“) im GitHub-Repository.
// Installieren:
//   - Home-Assistant-Add-on (lokal): neue Version in den Add-on-Ordner unter /addons schreiben,
//     dann baut der Supervisor das Add-on neu (store/reload + update).
//   - Node.js (PC, Raspberry Pi, systemd): Programmdateien ersetzen, bei Bedarf npm ci, neu starten.
//   - Docker: nur Hinweis – Dateien im Container wären beim Neuanlegen wieder weg.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFile } = require('child_process');
const { DATA_DIR, store } = require('./store');

const ROOT = path.join(__dirname, '..');
const API = () => (process.env.PRINTDOCK_GITHUB_API || 'https://api.github.com').replace(/\/+$/, '');
const APP_FILES = ['server.js', 'camera.js', 'notify.js', 'package.json', 'package-lock.json', 'drivers', 'lib', 'public', 'dist'];
const db = store('update.json', { repo: 'Codegulasch/printdock', token: '', last: null });
const MASK = '••••••';

const current = () => require('../package.json').version;
const httpError = (status, message) => Object.assign(new Error(message), { status });

/** Versionen vergleichen: 1 wenn a > b. */
function cmp(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  }
  return 0;
}

/** Wie läuft PrintDock? addon | docker | node */
function mode() {
  if (process.env.SUPERVISOR_TOKEN) return 'addon';
  if (fs.existsSync('/.dockerenv') || process.env.PRINTDOCK_DOCKER) return 'docker';
  return 'node';
}

async function gh(p, { raw = false, binary = false } = {}) {
  const headers = { 'User-Agent': 'PrintDock', Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json' };
  if (db.data.token) headers.Authorization = `Bearer ${db.data.token}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), binary ? 120_000 : 15_000);
  try {
    const r = await fetch(`${API()}${p}`, { headers, signal: ctrl.signal, redirect: 'follow' });
    if (r.status === 404) throw httpError(404, db.data.token ? 'Repository oder Version nicht gefunden – stimmt der Name, hat der Token Lesezugriff?' : 'Repository nicht gefunden – bei einem privaten Repository einen Token eintragen');
    if (r.status === 401 || r.status === 403) throw httpError(400, 'GitHub lehnt den Zugriff ab – Token prüfen');
    if (!r.ok) throw httpError(502, `GitHub antwortet mit HTTP ${r.status}`);
    if (binary) return Buffer.from(await r.arrayBuffer());
    return raw ? r.text() : r.json();
  } catch (err) {
    if (err.name === 'AbortError') throw httpError(504, 'GitHub antwortet nicht');
    if (err.status) throw err;
    throw httpError(502, `GitHub nicht erreichbar (${err.message})`);
  } finally {
    clearTimeout(t);
  }
}

function settings() {
  return { repo: db.data.repo, token: db.data.token ? MASK : '', mode: mode(), current: current(), last: db.data.last, installing: db.data.installing || null };
}

function saveSettings(body = {}) {
  if (body.repo !== undefined) {
    const repo = String(body.repo).trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$|\/+$/g, '');
    if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw httpError(400, 'Repository bitte als „Besitzer/Name“ angeben');
    db.data.repo = repo || 'Codegulasch/printdock';
  }
  if (body.token !== undefined && body.token !== MASK) db.data.token = String(body.token).trim();
  db.save();
  return settings();
}

/** Neueste Version auf GitHub suchen. */
async function check() {
  const tags = await gh(`/repos/${db.data.repo}/tags?per_page=50`);
  const versions = (tags || []).map((t) => t.name).filter((n) => /^v?\d+\.\d+\.\d+$/.test(n)).sort((a, b) => cmp(b, a));
  const latest = versions[0] || null;
  let notes = '';
  if (latest && cmp(latest, current()) > 0) {
    try {
      const log = await gh(`/repos/${db.data.repo}/contents/ha-addon/CHANGELOG.md?ref=${encodeURIComponent(latest)}`, { raw: true });
      // Abschnitte aller neueren Versionen
      const parts = String(log).split(/^## /m).slice(1).filter((sec) => cmp(sec.split('\n')[0].trim(), current()) > 0);
      notes = parts.map((sec) => `## ${sec.trim()}`).join('\n\n').slice(0, 6000);
    } catch {}
  }
  db.data.last = { at: new Date().toISOString(), latest, tag: latest, newer: Boolean(latest && cmp(latest, current()) > 0), notes };
  db.save();
  return { ...settings(), ...db.data.last };
}

// ---------------------------------------------------------------- ZIP lesen (GitHub-Archiv)
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw httpError(502, 'Download ist kein gültiges Archiv');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    const method = buf.readUInt16LE(p + 10);
    const comp = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extra + comment;
    if (name.endsWith('/')) continue;
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const data = buf.subarray(start, start + comp);
    files.set(name.replace(/^[^/]+\//, ''), method === 8 ? zlib.inflateRawSync(data) : data); // oberster Ordner (repo-tag/) weg
  }
  return files;
}

function writeTree(files, prefixes, target) {
  for (const [name, data] of files) {
    if (!prefixes.some((pre) => name === pre || name.startsWith(`${pre}/`))) continue;
    if (name.split('/').includes('..')) continue;
    const dest = path.join(target, ...name.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
  }
}

/** Ordner des lokalen Add-ons unter /addons finden (enthält config.yaml mit slug: printdock). */
function addonFolder() {
  const base = '/addons';
  if (!fs.existsSync(base)) return null;
  for (const d of fs.readdirSync(base)) {
    const cfg = path.join(base, d, 'config.yaml');
    if (fs.existsSync(cfg) && /^slug:\s*["']?printdock["']?\s*$/m.test(fs.readFileSync(cfg, 'utf8'))) return path.join(base, d);
  }
  return null;
}

async function supervisor(p, method = 'GET') {
  let r;
  try {
    r = await fetch(`http://supervisor${p}`, { method, headers: { Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}` } });
  } catch (err) {
    throw httpError(502, `Supervisor nicht erreichbar (${err.message})`);
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body.result === 'error') throw httpError(502, `Supervisor: ${body.message || `HTTP ${r.status}`}`);
  return body.data;
}

/**
 * Home Assistant das Update ausführen lassen. Nach /store/reload kennt der Supervisor die neue
 * Version nicht sofort – darum warten, bis er sie meldet, dann aktualisieren (mit Wiederholung).
 * Stand für die Oberfläche: db.data.installing = { version, state, error, at }.
 */
async function supervisorUpdate(slug, version) {
  const setState = (state, error = null) => {
    db.data.installing = { version, state, error, at: new Date().toISOString() };
    db.save();
    console.log(`Update: ${state}${error ? ` – ${error}` : ''}`);
  };
  setState('waiting');
  const deadline = Date.now() + 120_000;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const info = await supervisor('/addons/self/info');
      const latest = info.version_latest || info.version;
      if (latest === version || info.update_available) break;
      // Supervisor liest lokale Add-ons beim Neuladen des Stores ein
      await supervisor('/store/reload', 'POST').catch(() => {});
    } catch (err) {
      lastErr = err.message;
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  setState('updating');
  for (let i = 0; i < 3; i++) {
    try {
      // neue API, ältere Supervisor kennen nur /addons/<slug>/update
      await supervisor(`/store/addons/${slug}/update`, 'POST').catch(async (err) => {
        if (/404|not found|Unknown/i.test(err.message)) return supervisor(`/addons/${slug}/update`, 'POST');
        throw err;
      });
      return; // der Supervisor baut neu und startet das Add-on – dabei endet dieser Prozess
    } catch (err) {
      lastErr = err.message;
      // Verbindung bricht beim Neustart ab – das ist Erfolg
      if (/nicht erreichbar|ECONNRESET|socket|fetch failed/i.test(lastErr)) return;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  setState('failed', `${lastErr || 'unbekannter Fehler'} – bitte in Home Assistant unter Einstellungen → Add-ons → PrintDock auf „Aktualisieren“ tippen`);
}

const sh = (cmd, args, cwd) => new Promise((resolve, reject) => execFile(cmd, args, { cwd, timeout: 600_000, windowsHide: true, shell: process.platform === 'win32' }, (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).slice(-400))) : resolve(stdout))));

/**
 * Version installieren. Liefert { restart: 'auto' | 'manual' | 'supervisor', version }.
 * @param restartSelf  Funktion aus server.js (beendet bzw. startet PrintDock neu)
 */
async function install(restartSelf) {
  const m = mode();
  if (m === 'docker') throw httpError(400, 'Im Docker-Container bitte das Image aktualisieren: docker compose pull && docker compose up -d');
  const info = db.data.last?.newer ? db.data.last : await check();
  if (!info.newer) throw httpError(400, 'PrintDock ist bereits aktuell');
  const tag = info.tag;
  console.log(`Update: lade ${db.data.repo}@${tag} …`);
  const files = unzip(await gh(`/repos/${db.data.repo}/zipball/${encodeURIComponent(tag)}`, { binary: true }));
  if (!files.has('server.js') || !files.has('package.json')) throw httpError(502, 'Archiv enthält kein PrintDock');
  const newVersion = JSON.parse(files.get('package.json').toString('utf8')).version;

  if (m === 'addon') {
    const self = await supervisor('/addons/self/info');
    if (self.repository && self.repository !== 'local') {
      // Aus einem Add-on-Repository installiert: Home Assistant aktualisiert selbst
      await supervisor('/store/reload', 'POST').catch(() => {});
      supervisorUpdate(self.slug, newVersion).catch((err) => console.warn(`Update: ${err.message}`));
      return { restart: 'supervisor', version: newVersion };
    }
    const folder = addonFolder();
    if (!folder) throw httpError(500, 'Add-on-Ordner nicht gefunden (/addons nicht eingebunden?)');
    // Neuen Add-on-Ordner zusammenstellen: ha-addon/* + app/ (Programm), Image-Zeile raus, build.yaml dazu
    const tmp = `${folder}.new`;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    for (const [name, data] of files) {
      if (!name.startsWith('ha-addon/') || name.startsWith('ha-addon/app/')) continue;
      const dest = path.join(tmp, ...name.slice(9).split('/'));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, data);
    }
    const cfgFile = path.join(tmp, 'config.yaml');
    fs.writeFileSync(cfgFile, fs.readFileSync(cfgFile, 'utf8').replace(/^# Fertiges Image[^\n]*\n(?:#[^\n]*\n)*image:[^\n]*\n/m, '').replace(/^image:[^\n]*\n/m, '').replace(/^version: .*$/m, `version: "${newVersion}"`));
    fs.writeFileSync(path.join(tmp, 'build.yaml'), 'build_from:\n  aarch64: ghcr.io/home-assistant/aarch64-base:latest\n  amd64: ghcr.io/home-assistant/amd64-base:latest\n  armv7: ghcr.io/home-assistant/armv7-base:latest\n');
    writeTree(files, APP_FILES, path.join(tmp, 'app'));
    const old = `${folder}.old`;
    fs.rmSync(old, { recursive: true, force: true });
    fs.renameSync(folder, old);
    fs.renameSync(tmp, folder);
    fs.rmSync(old, { recursive: true, force: true });
    await supervisor('/store/reload', 'POST').catch(() => {});
    // Der Supervisor baut das neue Image und startet das Add-on neu – dabei endet dieser Prozess
    supervisorUpdate(self.slug, newVersion).catch((err) => console.warn(`Update: ${err.message}`));
    console.log(`Update: Add-on-Ordner auf ${newVersion} gebracht, Home Assistant baut neu`);
    return { restart: 'supervisor', version: newVersion };
  }

  // Node.js: alten Stand sichern, Dateien ersetzen, Abhängigkeiten bei Bedarf neu installieren
  const prev = path.join(DATA_DIR, 'update', `vorher-${current()}`);
  fs.rmSync(prev, { recursive: true, force: true });
  fs.mkdirSync(prev, { recursive: true });
  for (const f of APP_FILES) if (fs.existsSync(path.join(ROOT, f))) fs.cpSync(path.join(ROOT, f), path.join(prev, f), { recursive: true });
  const oldLock = fs.existsSync(path.join(ROOT, 'package-lock.json')) ? fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8') : '';
  for (const dir of ['drivers', 'lib', 'public', 'dist']) fs.rmSync(path.join(ROOT, dir), { recursive: true, force: true });
  writeTree(files, APP_FILES, ROOT);
  const newLock = fs.existsSync(path.join(ROOT, 'package-lock.json')) ? fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8') : '';
  if (oldLock !== newLock) {
    console.log('Update: installiere Abhängigkeiten (npm ci) …');
    await sh(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev'], ROOT);
  }
  console.log(`Update: Dateien auf ${newVersion} gebracht`);
  const restart = await restartSelf();
  return { restart, version: newVersion };
}

module.exports = { settings, saveSettings, check, install, mode, cmp };
