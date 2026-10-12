// Speicherort: Druckdateien, Fotos und Sicherungen auf ein NAS, einen Server oder eine zweite Platte legen,
// damit z. B. Home Assistant nicht vollläuft (und die HA-Sicherungen klein bleiben).
//
// Ein Basispfad, darunter eigene Unterordner (PrintDock löscht dort nur, was es selbst angelegt hat):
//   <Pfad>/dateien      Druckdateien und Vorschaubilder
//   <Pfad>/fotos        Fotos fertiger Teile und der ersten Schicht
//   <Pfad>/sicherungen  automatische Sicherungen
//
// Der Pfad muss auf dem Rechner, auf dem PrintDock läuft, als Ordner erreichbar sein:
//   Home Assistant  Einstellungen → System → Speicher → Netzwerkspeicher (Verwendung „Freigabe“ → /share/<Name>,
//                   „Medien“ → /media/<Name>)
//   Docker          NAS-Ordner auf dem Host einhängen und als Volume durchreichen (z. B. /mnt/nas:/nas)
//   Pi / Linux      per /etc/fstab einhängen (cifs oder nfs), z. B. /mnt/nas/printdock
//   Windows         UNC-Pfad direkt, z. B. \\nas\drucken\printdock
//   macOS           Freigabe im Finder verbinden → /Volumes/<Freigabe>
//
// Ist der Ort gerade nicht erreichbar (NAS aus, WLAN weg), speichert PrintDock lokal weiter und zieht die Dateien
// nach, sobald er wieder da ist.

const fs = require('fs');
const path = require('path');
const { store, DATA_DIR } = require('./store');

const ADDON = Boolean(process.env.SUPERVISOR_TOKEN);
const KINDS = ['files', 'photos', 'backups'];
const SUB = { files: 'dateien', photos: 'fotos', backups: 'sicherungen' };
const LABEL = { files: 'Druckdateien', photos: 'Fotos', backups: 'Sicherungen' };
const DEFAULT = {
  files: path.join(DATA_DIR, 'files'),
  photos: path.join(DATA_DIR, 'photos'),
  backups: process.env.BACKUP_DIR || (ADDON ? '/share/printdock/sicherungen' : path.join(DATA_DIR, 'sicherungen')),
};

const db = store('storage.json', { path: '', files: true, photos: true, backups: true, moving: null, lastError: null });
// Ein beim Beenden unterbrochenes Verschieben gilt als nicht passiert (Quelle ist noch vollständig)
if (db.data.moving) {
  db.data.moving = null;
  db.save();
}

let onChange = () => {};
const health = new Map(); // Pfad → { ok, at }

/** Pfad sinnvoll? absolut (oder UNC unter Windows), nicht der Datenordner selbst */
function validPath(p) {
  const s = String(p || '').trim();
  if (!s) return '';
  if (!(path.isAbsolute(s) || /^\\\\[^\\]+\\[^\\]+/.test(s))) throw Object.assign(new Error('Bitte einen vollständigen Pfad angeben, z. B. /share/nas/printdock oder \\\\nas\\freigabe\\printdock'), { status: 400 });
  const r = path.resolve(s);
  if (r === path.resolve(DATA_DIR)) throw Object.assign(new Error('Das ist schon der Datenordner von PrintDock'), { status: 400 });
  return r;
}

// Kennung im Speicherort: Fehlt sie, ist das NAS nicht eingehängt (leerer Einhängepunkt auf der lokalen Platte) –
// dann wird dort nichts geschrieben und nichts angelegt.
const MARKER = '.printdock-speicherort';

/**
 * Schreibtest mit kleiner Datei – liefert { ok, error, freeMb }.
 * create: Ordner anlegen (nur beim Einrichten und nur, wenn der übergeordnete Ordner existiert)
 */
function probe(dir, { create = true } = {}) {
  try {
    if (!fs.existsSync(dir)) {
      if (!create) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      if (!fs.existsSync(path.dirname(dir))) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      fs.mkdirSync(dir);
    }
    const f = path.join(dir, `.printdock-test-${process.pid}`);
    fs.writeFileSync(f, 'ok');
    fs.unlinkSync(f);
    let freeMb = null;
    try {
      const s = fs.statfsSync(dir);
      freeMb = Math.round((s.bavail * s.bsize) / 1024 / 1024);
    } catch {
      /* nicht überall verfügbar */
    }
    return { ok: true, freeMb };
  } catch (err) {
    return { ok: false, error: err.code === 'ENOENT' ? 'Ordner nicht gefunden – ist das NAS eingehängt?' : err.code === 'EACCES' || err.code === 'EPERM' ? 'Kein Schreibrecht' : err.message };
  }
}

/** Ist der Speicherort eingehängt und beschreibbar? (Kennung vorhanden, Unterordner beschreibbar) */
function check(kind) {
  const base = db.data.path;
  if (!fs.existsSync(path.join(base, MARKER))) return { ok: false, error: 'Speicherort nicht eingehängt (Kennung fehlt) – ist das NAS erreichbar?' };
  return probe(target(kind));
}

/** Erreichbar? (Ergebnis 30 s zwischengespeichert, damit ein langsames NAS nicht jede Anfrage bremst) */
function reachable(kind) {
  const t = target(kind);
  const h = health.get(t);
  if (h && Date.now() - h.at < 30_000) return h.ok;
  const ok = check(kind).ok;
  health.set(t, { ok, at: Date.now() });
  return ok;
}

const external = (kind) => Boolean(db.data.path && db.data[kind] !== false);

/** Wo sollen Dateien dieser Art liegen (unabhängig davon, ob der Ort gerade erreichbar ist) */
function target(kind) {
  return external(kind) ? path.join(db.data.path, SUB[kind]) : DEFAULT[kind];
}

/** Wohin jetzt schreiben? Externer Ort, wenn erreichbar – sonst lokal (und später nachziehen) */
function writeDir(kind) {
  const t = target(kind);
  if (t === DEFAULT[kind]) {
    fs.mkdirSync(t, { recursive: true });
    return { dir: t, local: false };
  }
  // live nachsehen (nicht nur den 30-s-Zwischenstand): Kennung da → eingehängt; nur den eigenen Unterordner anlegen
  try {
    if (reachable(kind) && fs.existsSync(path.join(db.data.path, MARKER))) {
      if (!fs.existsSync(t)) fs.mkdirSync(t);
      return { dir: t, local: false };
    }
  } catch {
    /* gerade weg */
  }
  health.set(t, { ok: false, at: Date.now() });
  fs.mkdirSync(DEFAULT[kind], { recursive: true });
  return { dir: DEFAULT[kind], local: true };
}

/** Datei suchen: zuerst am eingestellten Ort, dann lokal */
function find(kind, name) {
  const a = path.join(target(kind), name);
  if (fs.existsSync(a)) return a;
  const b = path.join(DEFAULT[kind], name);
  return fs.existsSync(b) ? b : a;
}

function dirSize(dir) {
  let bytes = 0;
  let n = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile()) continue;
      bytes += fs.statSync(path.join(dir, e.name)).size;
      n += 1;
    }
  } catch {
    /* fehlt */
  }
  return { mb: Math.round(bytes / 1024 / 1024), n };
}

/** Häufige Orte für eingehängte Netzlaufwerke – als Vorschläge in der Oberfläche */
function suggestions() {
  const roots = ADDON ? ['/share', '/media'] : process.platform === 'darwin' ? ['/Volumes'] : process.platform === 'win32' ? [] : ['/mnt', '/media', '/srv', '/nas'];
  const out = [];
  for (const r of roots) {
    try {
      for (const e of fs.readdirSync(r, { withFileTypes: true })) {
        if (!e.isDirectory() || e.name.startsWith('.') || (ADDON && r === '/share' && e.name === 'printdock')) continue;
        if (process.platform === 'darwin' && e.name === 'Macintosh HD') continue;
        out.push(path.join(r, e.name, 'printdock'));
      }
    } catch {
      /* gibt es hier nicht */
    }
  }
  return out.slice(0, 12);
}

function platformHint() {
  if (ADDON) return 'addon';
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'mac';
  if (fs.existsSync('/.dockerenv')) return 'docker';
  return 'linux';
}

function view() {
  const kinds = KINDS.map((k) => {
    const t = target(k);
    const ext = external(k);
    const p = ext ? check(k) : { ok: true, freeMb: null };
    if (ext) health.set(t, { ok: p.ok, at: Date.now() });
    const here = dirSize(t);
    const local = ext ? dirSize(DEFAULT[k]) : { mb: 0, n: 0 };
    return { kind: k, label: LABEL[k], dir: t, external: ext, ok: p.ok, error: p.error || null, freeMb: p.freeMb, usedMb: here.mb, count: here.n, localPending: k === 'backups' ? 0 : local.n };
  });
  return {
    path: db.data.path, files: db.data.files !== false, photos: db.data.photos !== false, backups: db.data.backups !== false,
    kinds, moving: db.data.moving, lastError: db.data.lastError, platform: platformHint(), suggestions: suggestions(), defaults: DEFAULT, sub: SUB,
  };
}

/** Kurzinfo für „Heute“ und den Plattform-Check */
function problems() {
  if (!db.data.path) return [];
  return KINDS.filter((k) => external(k) && !reachable(k)).map((k) => ({ kind: k, label: LABEL[k], dir: target(k) }));
}

// ================================================================ Verschieben

/** Dateien eines Ordners (nur oberste Ebene) von a nach b kopieren und danach in a löschen */
async function moveDir(a, b, filter, progress) {
  if (path.resolve(a) === path.resolve(b) || !fs.existsSync(a)) return 0;
  fs.mkdirSync(b, { recursive: true });
  const names = fs.readdirSync(a, { withFileTypes: true }).filter((e) => e.isFile() && filter(e.name)).map((e) => e.name);
  let n = 0;
  for (const name of names) {
    const src = path.join(a, name);
    const dst = path.join(b, name);
    const size = fs.statSync(src).size;
    if (!(fs.existsSync(dst) && fs.statSync(dst).size === size)) {
      await fs.promises.copyFile(src, `${dst}.tmp`);
      if (fs.statSync(`${dst}.tmp`).size !== size) throw new Error(`Kopie von ${name} unvollständig`);
      fs.renameSync(`${dst}.tmp`, dst);
    }
    fs.rmSync(src, { force: true });
    n += 1;
    progress?.(name);
  }
  return n;
}

// nur Dateien, die PrintDock selbst anlegt
const FILTER = {
  files: (n) => /^[0-9a-f-]{36}\.(gcode|3mf|gcode\.3mf|stl|step|stp|obj|thumb)$/i.test(n),
  photos: (n) => /\.jpg$/i.test(n) && !n.startsWith('.'),
  backups: (n) => /^printdock-.*\.zip$/.test(n),
};

/**
 * Neuen Ort übernehmen: prüfen, alles kopieren, umschalten, Reste nachziehen, alte Kopien löschen.
 * Läuft im Hintergrund; Fortschritt steht in view().moving.
 */
async function change(body = {}) {
  if (db.data.moving) throw Object.assign(new Error('Verschieben läuft noch'), { status: 409 });
  const next = {
    path: body.path !== undefined ? validPath(body.path) : db.data.path,
    files: body.files !== undefined ? Boolean(body.files) : db.data.files !== false,
    photos: body.photos !== undefined ? Boolean(body.photos) : db.data.photos !== false,
    backups: body.backups !== undefined ? Boolean(body.backups) : db.data.backups !== false,
  };
  const dirOf = (cfg, k) => (cfg.path && cfg[k] ? path.join(cfg.path, SUB[k]) : DEFAULT[k]);
  // neuen Ort vorher prüfen: Basisordner (bzw. dessen übergeordneter Ordner) muss existieren, dann Kennung schreiben
  if (next.path) {
    const pb = probe(next.path);
    if (!pb.ok) throw Object.assign(new Error(`${next.path} – ${pb.error}`), { status: 400 });
    fs.writeFileSync(path.join(next.path, MARKER), `PrintDock-Speicherort – nicht löschen.\nAngelegt: ${new Date().toISOString()}\n`);
  }
  for (const k of KINDS) {
    const d = dirOf(next, k);
    if (d === DEFAULT[k]) continue;
    const p = probe(d);
    if (!p.ok) throw Object.assign(new Error(`${LABEL[k]}: ${d} – ${p.error}`), { status: 400 });
  }
  const old = { path: db.data.path, files: db.data.files !== false, photos: db.data.photos !== false, backups: db.data.backups !== false };
  const plan = KINDS.map((k) => ({ k, from: dirOf(old, k), to: dirOf(next, k) })).filter((x) => path.resolve(x.from) !== path.resolve(x.to));
  if (!plan.length) {
    Object.assign(db.data, next);
    db.save();
    onChange();
    return view();
  }
  const total = plan.reduce((a, x) => a + (fs.existsSync(x.from) ? fs.readdirSync(x.from).filter(FILTER[x.k]).length : 0) + (fs.existsSync(DEFAULT[x.k]) && x.from !== DEFAULT[x.k] && x.to !== DEFAULT[x.k] ? fs.readdirSync(DEFAULT[x.k]).filter(FILTER[x.k]).length : 0), 0);
  db.data.moving = { done: 0, total, current: null, startedAt: new Date().toISOString() };
  db.data.lastError = null;
  db.save();
  onChange();
  (async () => {
    const tick = (name) => {
      db.data.moving.done += 1;
      db.data.moving.current = name;
      if (db.data.moving.done % 10 === 0) onChange();
    };
    try {
      // 1. kopieren (Quelle bleibt, bis umgeschaltet ist) – hier noch ohne Löschen
      for (const x of plan) await copyAll(x.from, x.to, FILTER[x.k], tick);
      // 2. umschalten
      Object.assign(db.data, next);
      db.save();
      health.clear();
      // 3. Reste nachziehen (in der Zwischenzeit Neues) und alte Kopien löschen; lokale Notfall-Kopien ebenfalls
      for (const x of plan) {
        await moveDir(x.from, x.to, FILTER[x.k]);
        if (x.to !== DEFAULT[x.k]) await moveDir(DEFAULT[x.k], x.to, FILTER[x.k]);
      }
      console.log(`Speicherort übernommen: ${next.path || 'Datenordner'} (${db.data.moving.done} Dateien)`);
    } catch (err) {
      db.data.lastError = { at: new Date().toISOString(), msg: err.message };
      console.warn(`Speicherort: Verschieben fehlgeschlagen – ${err.message}`);
    } finally {
      db.data.moving = null;
      db.save();
      onChange();
    }
  })();
  return view();
}

async function copyAll(a, b, filter, progress) {
  if (!fs.existsSync(a)) return;
  fs.mkdirSync(b, { recursive: true });
  for (const name of fs.readdirSync(a).filter(filter)) {
    const src = path.join(a, name);
    const dst = path.join(b, name);
    const size = fs.statSync(src).size;
    if (!(fs.existsSync(dst) && fs.statSync(dst).size === size)) {
      await fs.promises.copyFile(src, `${dst}.tmp`);
      if (fs.statSync(`${dst}.tmp`).size !== size) throw new Error(`Kopie von ${name} unvollständig`);
      fs.renameSync(`${dst}.tmp`, dst);
    }
    progress?.(name);
  }
}

/** Lokal Zwischengespeichertes auf den externen Ort nachziehen (alle 10 Minuten und nach dem Start) */
async function catchUp() {
  if (!db.data.path || db.data.moving) return 0;
  let n = 0;
  for (const k of ['files', 'photos']) {
    if (!external(k)) continue;
    const t = target(k);
    if (!reachable(k)) continue;
    try {
      n += await moveDir(DEFAULT[k], t, FILTER[k]);
    } catch (err) {
      console.warn(`Speicherort: Nachziehen fehlgeschlagen – ${err.message}`);
    }
  }
  if (n) {
    console.log(`Speicherort: ${n} lokal zwischengespeicherte Datei(en) nachgezogen`);
    onChange();
  }
  return n;
}
setTimeout(() => catchUp().catch(() => {}), 30_000).unref?.();
setInterval(() => catchUp().catch(() => {}), 10 * 60_000).unref?.();

/** Für Sicherungen: externe Ordner, die unter files/ bzw. photos/ mit hinein gehören */
function backupExtras() {
  return ['files', 'photos'].filter((k) => external(k)).map((k) => ({ prefix: k, dir: target(k), filter: FILTER[k] }));
}

/** „Prüfen“ in der Oberfläche: legt nichts an, wenn schon der übergeordnete Ordner fehlt */
function test(p) {
  const dir = validPath(p);
  const r = { path: dir, ...probe(dir) };
  // gleiche Platte wie der Datenordner? Dann ist das NAS vermutlich nicht eingehängt (leerer Einhängepunkt)
  try {
    if (r.ok && fs.statSync(dir).dev === fs.statSync(DATA_DIR).dev) r.sameDisk = true;
  } catch {
    /* egal */
  }
  return r;
}

module.exports = {
  backupExtras, test,
  KINDS, DEFAULT, target, writeDir, find, view, change, problems, catchUp, probe, external,
  set onChange(fn) { onChange = fn; },
};
