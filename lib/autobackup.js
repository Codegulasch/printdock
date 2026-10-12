// Automatische Sicherung: einmal am Tag eine ZIP-Datei in den Sicherungsordner, die letzten N bleiben.
// Als Add-on: /share/printdock/sicherungen (über die Samba-Freigabe erreichbar), sonst <Daten>/sicherungen.
// Druckdateien kommen auf Wunsch mit – ohne bleibt die Sicherung klein (Einstellungen, Spulen, Aufträge, Verlauf, Fotos).

const fs = require('fs');
const path = require('path');
const { store, DATA_DIR } = require('./store');
const backup = require('./backup');

const storage = require('./storage');

const ADDON = Boolean(process.env.SUPERVISOR_TOKEN);
// Sicherungsordner: Standard bzw. eingestellter Speicherort (NAS); ist der gerade weg, wird lokal gesichert
const dirs = () => [...new Set([storage.target('backups'), storage.DEFAULT.backups])];
const db = store('autobackup.json', { enabled: true, keep: 7, withFiles: false, hour: 3, last: null, error: null });

function list() {
  const out = new Map();
  for (const d of dirs()) {
    try {
      for (const name of fs.readdirSync(d).filter((n) => /^printdock-\d{4}-\d{2}-\d{2}.*\.zip$/.test(n))) {
        if (!out.has(name)) out.set(name, { name, size: fs.statSync(path.join(d, name)).size, dir: d });
      }
    } catch {
      /* Ordner fehlt oder NAS nicht erreichbar */
    }
  }
  return [...out.values()].sort((a, b) => b.name.localeCompare(a.name)).map(({ name, size, dir }) => ({ name, size, local: dir !== storage.target('backups') }));
}

function view() {
  const { enabled, keep, withFiles, hour, last, error } = db.data;
  const dir = storage.target('backups');
  return { enabled, keep, withFiles, hour, last, error, dir, share: ADDON && dir === '/share/printdock/sicherungen' ? '\\\\homeassistant\\share\\printdock\\sicherungen' : null, files: list() };
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
  const DIR = storage.writeDir('backups').dir;
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
  const name = `printdock-${stamp}.zip`;
  const tmp = path.join(DIR, `${name}.tmp`);
  try {
    const out = fs.createWriteStream(tmp);
    await backup.writeBackup(DATA_DIR, out, info, { skipDirs: db.data.withFiles ? [] : ['files'], extra: storage.backupExtras() });
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
    fs.renameSync(tmp, path.join(DIR, name));
    // Alte löschen
    for (const f of list().slice(db.data.keep)) for (const d of dirs()) fs.rmSync(path.join(d, f.name), { force: true });
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
  for (const d of dirs()) {
    const f = path.join(d, n);
    if (fs.existsSync(f)) return f;
  }
  return null;
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

module.exports = { view, save, run, filePath, schedule, get BACKUP_DIR() { return storage.target('backups'); } };
