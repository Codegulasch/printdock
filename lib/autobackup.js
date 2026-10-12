// Automatische Sicherung: einmal am Tag eine ZIP-Datei in den Sicherungsordner, die letzten N bleiben.
// Als Add-on: /share/printdock/sicherungen (über die Samba-Freigabe erreichbar), sonst <Daten>/sicherungen.
// Druckdateien kommen auf Wunsch mit – ohne bleibt die Sicherung klein (Einstellungen, Spulen, Aufträge, Verlauf, Fotos).

const fs = require('fs');
const path = require('path');
const { store, DATA_DIR } = require('./store');
const backup = require('./backup');

const ADDON = Boolean(process.env.SUPERVISOR_TOKEN);
const DIR = process.env.BACKUP_DIR || (ADDON ? '/share/printdock/sicherungen' : path.join(DATA_DIR, 'sicherungen'));
const db = store('autobackup.json', { enabled: true, keep: 7, withFiles: false, hour: 3, last: null, error: null });

function list() {
  try {
    return fs.readdirSync(DIR).filter((n) => /^printdock-\d{4}-\d{2}-\d{2}.*\.zip$/.test(n)).sort().reverse()
      .map((name) => ({ name, size: fs.statSync(path.join(DIR, name)).size }));
  } catch {
    return [];
  }
}

function view() {
  const { enabled, keep, withFiles, hour, last, error } = db.data;
  return { enabled, keep, withFiles, hour, last, error, dir: DIR, share: ADDON ? '\\\\homeassistant\\share\\printdock\\sicherungen' : null, files: list() };
}

function save(body = {}) {
  if (typeof body.enabled === 'boolean') db.data.enabled = body.enabled;
  if (typeof body.withFiles === 'boolean') db.data.withFiles = body.withFiles;
  if (body.keep !== undefined) db.data.keep = Math.max(1, Math.min(60, Number(body.keep) || 7));
  if (body.hour !== undefined) db.data.hour = Math.max(0, Math.min(23, Number(body.hour) || 0));
  db.save();
  return view();
}

async function run(info = {}) {
  fs.mkdirSync(DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
  const name = `printdock-${stamp}.zip`;
  const tmp = path.join(DIR, `${name}.tmp`);
  try {
    const out = fs.createWriteStream(tmp);
    await backup.writeBackup(DATA_DIR, out, info, { skipDirs: db.data.withFiles ? [] : ['files'] });
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
    fs.renameSync(tmp, path.join(DIR, name));
    // Alte löschen
    for (const f of list().slice(db.data.keep)) fs.rmSync(path.join(DIR, f.name), { force: true });
    db.data.last = { at: new Date().toISOString(), name };
    db.data.error = null;
    db.save();
    console.log(`Sicherung: ${name}`);
    return view();
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    db.data.error = { at: new Date().toISOString(), msg: err.message };
    db.save();
    console.warn(`Sicherung fehlgeschlagen: ${err.message}`);
    throw err;
  }
}

function filePath(name) {
  const n = path.basename(String(name || ''));
  if (!/^printdock-.*\.zip$/.test(n)) return null;
  const f = path.join(DIR, n);
  return fs.existsSync(f) ? f : null;
}

/** Jede Viertelstunde prüfen: heute zur eingestellten Stunde schon gesichert? */
function schedule(info) {
  const tick = () => {
    if (!db.data.enabled) return;
    const now = new Date();
    const lastDay = db.data.last?.at ? new Date(db.data.last.at).toDateString() : null;
    if (now.getHours() >= db.data.hour && lastDay !== now.toDateString()) run(info()).catch(() => {});
  };
  setTimeout(tick, 2 * 60_000).unref?.();
  setInterval(tick, 15 * 60_000).unref?.();
}

module.exports = { view, save, run, filePath, schedule, BACKUP_DIR: DIR };
