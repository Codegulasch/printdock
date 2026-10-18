// Speicherort: Druckdateien, Fotos und Sicherungen auf ein NAS, einen Server oder eine zweite Platte legen,
// damit z. B. Home Assistant nicht vollläuft (und die HA-Sicherungen klein bleiben).
//
// Drei Arten:
//   local   Datenordner von PrintDock (Standard)
//   smb     SMB-Freigabe direkt (Server, Freigabe, Benutzer, Passwort) – ohne Einhängen, ohne Home Assistant.
//           PrintDock schreibt zuerst lokal und lädt im Hintergrund hoch (smbclient); die lokale Kopie wird erst
//           gelöscht, wenn die Datei vollständig auf dem NAS liegt. Gebraucht (Druckstart, Download, Foto) wird sie
//           in einen Zwischenspeicher geholt (tmp/, nicht in Sicherungen). Unter Windows geht das über den
//           Netzwerkpfad \\server\freigabe mit Anmeldung („net use“) – dort ist kein smbclient nötig.
//   folder  ein Ordner, der schon eingehängt ist (HA-Netzwerkspeicher /share/<Name>, Docker-Volume, fstab, /Volumes)
//
// Unterordner am Speicherort (PrintDock löscht dort nur, was es selbst angelegt hat):
//   dateien      Druckdateien (Vorschaubilder bleiben lokal – klein und oft gebraucht)
//   fotos        Fotos fertiger Teile und der ersten Schicht
//   sicherungen  automatische Sicherungen
//
// Ist der Ort gerade nicht erreichbar (NAS aus, WLAN weg), speichert PrintDock lokal weiter und zieht nach.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { store, DATA_DIR } = require('./store');
const smb = require('./smb');

const ADDON = Boolean(process.env.SUPERVISOR_TOKEN);
const WIN = process.platform === 'win32';
const KINDS = ['files', 'photos', 'backups'];
const SUB = { files: 'dateien', photos: 'fotos', backups: 'sicherungen' };
const LABEL = { files: 'Druckdateien', photos: 'Fotos', backups: 'Sicherungen' };
const DEFAULT = {
  files: path.join(DATA_DIR, 'files'),
  photos: path.join(DATA_DIR, 'photos'),
  backups: process.env.BACKUP_DIR || (ADDON ? '/share/printdock/sicherungen' : path.join(DATA_DIR, 'sicherungen')),
};
const CACHE = path.join(DATA_DIR, 'tmp', 'nas-cache'); // geholte Dateien (nicht in Sicherungen)

const db = store('storage.json', { mode: null, path: '', smb: null, files: true, photos: true, backups: true, moving: null, lastError: null, sync: null, remote: {} });
if (!db.data.mode) db.data.mode = db.data.path ? 'folder' : 'local';
// Ein beim Beenden unterbrochenes Verschieben gilt als nicht passiert (Quelle ist noch vollständig)
if (db.data.moving) db.data.moving = null;
db.data.remote ||= {};
db.save();

let onChange = () => {};
const health = new Map(); // Pfad → { ok, at }

// nur Dateien, die PrintDock selbst anlegt
const FILTER = {
  files: (n) => /^[0-9a-f-]{36}\.(gcode|3mf|gcode\.3mf|stl|step|stp|obj|thumb)$/i.test(n),
  photos: (n) => /\.jpg$/i.test(n) && !n.startsWith('.'),
  backups: (n) => /^printdock-.*\.zip$/.test(n),
};
// beim Hochladen: Vorschaubilder bleiben lokal
const UPLOAD = { files: (n) => FILTER.files(n) && !/\.thumb$/i.test(n), photos: FILTER.photos, backups: FILTER.backups };

// ================================================================ Art und Ziel

/** SMB unter Windows = Netzwerkpfad mit Anmeldung, also wie ein Ordner */
const uncOf = (c) => `\\\\${c.server}\\${c.share}${c.dir ? `\\${c.dir}` : ''}`;
function mode() {
  if (db.data.mode === 'smb' && WIN) return 'folder';
  return db.data.mode || 'local';
}
const basePath = () => (db.data.mode === 'smb' && WIN && db.data.smb ? uncOf(smb.normalize(db.data.smb)) : db.data.path);
const isSmb = () => mode() === 'smb';
const external = (kind) => mode() !== 'local' && db.data[kind] !== false;
const remoteDir = (kind) => smb.sub(smb.normalize(db.data.smb || {}).dir, SUB[kind]);

/** Wo liegen Dateien dieser Art „zu Hause“ (lokaler Pfad; bei SMB der lokale Zwischenstand) */
function target(kind) {
  return external(kind) && mode() === 'folder' ? path.join(basePath(), SUB[kind]) : DEFAULT[kind];
}

/** Anzeige des Orts (bei SMB der Netzwerkpfad) */
function shown(kind) {
  if (!external(kind)) return DEFAULT[kind];
  if (isSmb()) return `${uncOf(smb.normalize(db.data.smb))}\\${SUB[kind]}`;
  return target(kind);
}

// ================================================================ Ordner-Modus (eingehängt)

/** Pfad sinnvoll? absolut (oder UNC unter Windows), nicht der Datenordner selbst */
function validPath(p) {
  const s = String(p || '').trim();
  if (!s) return '';
  if (!(path.isAbsolute(s) || /^\\\\[^\\]+\\[^\\]+/.test(s))) throw Object.assign(new Error('Bitte einen vollständigen Pfad angeben, z. B. /share/nas/printdock oder \\\\nas\\freigabe\\printdock'), { status: 400 });
  const r = /^\\\\/.test(s) ? s : path.resolve(s);
  if (r === path.resolve(DATA_DIR)) throw Object.assign(new Error('Das ist schon der Datenordner von PrintDock'), { status: 400 });
  return r;
}

// Kennung im Speicherort: Fehlt sie, ist das NAS nicht eingehängt (leerer Einhängepunkt auf der lokalen Platte) –
// dann wird dort nichts geschrieben und nichts angelegt.
const MARKER = '.printdock-speicherort';

/** Schreibtest mit kleiner Datei – { ok, error, freeMb }. Legt höchstens den letzten Ordner an. */
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

/** Ordner-Modus: eingehängt (Kennung da) und Unterordner beschreibbar? */
function check(kind) {
  if (!fs.existsSync(path.join(basePath(), MARKER))) return { ok: false, error: 'Speicherort nicht eingehängt (Kennung fehlt) – ist das NAS erreichbar?' };
  return probe(target(kind));
}

/** Erreichbar? (Ergebnis 30 s zwischengespeichert, damit ein langsames NAS nicht jede Anfrage bremst) */
function reachable(kind) {
  if (isSmb()) return !db.data.sync?.error;
  const t = target(kind);
  const h = health.get(t);
  if (h && Date.now() - h.at < 30_000) return h.ok;
  const ok = check(kind).ok;
  health.set(t, { ok, at: Date.now() });
  return ok;
}

/** Windows: Anmeldung an der Freigabe („net use“), damit der Netzwerkpfad geht */
function netUse(c) {
  if (!WIN || !c?.server) return Promise.resolve();
  const n = smb.normalize(c);
  const args = ['use', `\\\\${n.server}\\${n.share}`];
  if (n.password) args.push(n.password);
  if (n.user) args.push(`/user:${n.domain && n.domain !== 'WORKGROUP' ? `${n.domain}\\` : ''}${n.user}`);
  args.push('/persistent:no');
  return new Promise((resolve) => execFile('net', args, { timeout: 30_000, windowsHide: true }, () => resolve()));
}
if (db.data.mode === 'smb' && WIN) netUse(db.data.smb);

// ================================================================ Schreiben und Lesen

/** Wohin jetzt schreiben? Ordner-Modus: externer Ort, wenn erreichbar – sonst (und bei SMB immer) lokal */
function writeDir(kind) {
  const t = target(kind);
  if (t === DEFAULT[kind]) {
    fs.mkdirSync(t, { recursive: true });
    if (isSmb() && external(kind)) scheduleSync();
    return { dir: t, local: false };
  }
  // live nachsehen (nicht nur den 30-s-Zwischenstand): Kennung da → eingehängt; nur den eigenen Unterordner anlegen
  try {
    if (reachable(kind) && fs.existsSync(path.join(basePath(), MARKER))) {
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

/** Datei suchen (synchron): Speicherort, lokal, Zwischenspeicher – sonst der erwartete Pfad */
function find(kind, name) {
  const a = path.join(target(kind), name);
  if (fs.existsSync(a)) return a;
  const b = path.join(DEFAULT[kind], name);
  if (fs.existsSync(b)) return b;
  const c = path.join(CACHE, kind, name);
  return fs.existsSync(c) ? c : a;
}

/** Datei lokal verfügbar machen (bei SMB vom NAS holen) – liefert Pfad oder null */
async function ensureLocal(kind, name) {
  const p = find(kind, name);
  if (fs.existsSync(p)) {
    if (p.startsWith(CACHE)) fs.utimesSync(p, new Date(), new Date()); // zuletzt gebraucht
    return p;
  }
  if (!isSmb() || !external(kind)) return null;
  const dest = path.join(CACHE, kind, name);
  await smb.get(db.data.smb, remoteDir(kind), name, dest);
  return dest;
}

/** Datei am Speicherort löschen (lokal löscht der Aufrufer) */
async function removeRemote(kind, names) {
  if (!isSmb() || !external(kind) || !names.length) return;
  for (const n of names) fs.rmSync(path.join(CACHE, kind, n), { force: true });
  try {
    await smb.remove(db.data.smb, remoteDir(kind), names);
    const r = db.data.remote[kind];
    if (r) r.files = r.files.filter((f) => !names.includes(f.name));
  } catch (err) {
    console.warn(`Speicherort: Löschen auf dem NAS fehlgeschlagen – ${err.message}`);
  }
}

/** Alle eigenen Dateien einer Art am Speicherort löschen (z. B. Verlauf leeren → Fotos) */
async function clearRemote(kind) {
  if (!isSmb() || !external(kind)) return;
  try {
    await smb.run(db.data.smb, [`cd "${remoteDir(kind)}"`, kind === 'photos' ? 'del *.jpg' : 'del *'], { allow: ['NT_STATUS_NO_SUCH_FILE', 'NT_STATUS_OBJECT_NAME_NOT_FOUND'] });
    db.data.remote[kind] = { at: Date.now(), files: [] };
  } catch (err) {
    console.warn(`Speicherort: Löschen auf dem NAS fehlgeschlagen – ${err.message}`);
  }
}

/** Dateien am Speicherort (bei SMB aus dem letzten Abgleich) */
function remoteFiles(kind) {
  return isSmb() && external(kind) ? db.data.remote[kind]?.files || [] : [];
}

// ================================================================ SMB: Abgleich

let syncTimer = null;
let syncing = null;
function scheduleSync(delay = 15_000) {
  if (!isSmb()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => smbSync().catch(() => {}), delay);
  syncTimer.unref?.();
}

/**
 * Lokales hochladen, auf dem NAS prüfen (Größe), dann lokal löschen. progress(name) je Datei.
 * Liefert Anzahl hochgeladener Dateien.
 */
async function smbSync(progress) {
  if (!isSmb()) return 0;
  if (syncing) return syncing;
  syncing = (async () => {
    let n = 0;
    try {
      const conn = db.data.smb;
      for (const k of KINDS) {
        if (!external(k)) continue;
        const dir = remoteDir(k);
        await smb.mkdirs(conn, dir);
        const locals = fs.existsSync(DEFAULT[k]) ? fs.readdirSync(DEFAULT[k]).filter(UPLOAD[k]) : [];
        let remote = await smb.list(conn, dir);
        const have = new Map(remote.map((f) => [f.name, f.size]));
        const todo = locals.filter((name) => have.get(name) !== fs.statSync(path.join(DEFAULT[k], name)).size);
        if (todo.length) {
          await smb.put(conn, dir, todo.map((name) => ({ local: path.join(DEFAULT[k], name), name })));
          remote = await smb.list(conn, dir);
        }
        const ok = new Map(remote.map((f) => [f.name, f.size]));
        for (const name of locals) {
          const p = path.join(DEFAULT[k], name);
          if (fs.existsSync(p) && ok.get(name) === fs.statSync(p).size) {
            fs.rmSync(p, { force: true }); // liegt sicher auf dem NAS
            if (todo.includes(name)) {
              n += 1;
              progress?.(name);
            }
          }
        }
        db.data.remote[k] = { at: Date.now(), files: remote.filter((f) => FILTER[k](f.name)) };
      }
      db.data.sync = { at: new Date().toISOString(), error: null, uploaded: n };
      if (n) console.log(`Speicherort: ${n} Datei(en) aufs NAS übertragen`);
    } catch (err) {
      const first = !db.data.sync?.error;
      db.data.sync = { at: new Date().toISOString(), error: err.message };
      if (first) console.warn(`Speicherort: NAS nicht erreichbar – ${err.message} (Dateien bleiben lokal und werden nachgeholt)`);
    } finally {
      db.save();
      syncing = null;
      onChange();
    }
    return n;
  })();
  return syncing;
}

/** Zwischenspeicher aufräumen: länger nicht gebraucht oder zu groß */
function cleanCache() {
  try {
    const all = [];
    for (const k of KINDS) {
      const d = path.join(CACHE, k);
      if (!fs.existsSync(d)) continue;
      for (const n of fs.readdirSync(d)) {
        const p = path.join(d, n);
        const st = fs.statSync(p);
        all.push({ p, size: st.size, at: st.mtimeMs });
      }
    }
    all.sort((a, b) => b.at - a.at);
    let sum = 0;
    for (const f of all) {
      sum += f.size;
      if (Date.now() - f.at > 2 * 864e5 || sum > 2 * 1024 ** 3) fs.rmSync(f.p, { force: true });
    }
  } catch {
    /* egal */
  }
}

// ================================================================ Anzeige

function dirSize(dir, filter = () => true) {
  let bytes = 0;
  let n = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile() || !filter(e.name)) continue;
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
  const roots = ADDON ? ['/share', '/media'] : process.platform === 'darwin' ? ['/Volumes'] : WIN ? [] : ['/mnt', '/media', '/srv', '/nas'];
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
  if (WIN) return 'windows';
  if (process.platform === 'darwin') return 'mac';
  if (fs.existsSync('/.dockerenv')) return 'docker';
  return 'linux';
}

function view() {
  const smbMode = isSmb();
  const kinds = KINDS.map((k) => {
    const ext = external(k);
    let p = { ok: true, freeMb: null };
    if (ext && mode() === 'folder') {
      p = check(k);
      health.set(target(k), { ok: p.ok, at: Date.now() });
    } else if (ext && smbMode) p = { ok: !db.data.sync?.error, error: db.data.sync?.error || null, freeMb: db.data.smbFree ?? null };
    let used;
    if (ext && smbMode) {
      const rf = db.data.remote[k]?.files || [];
      used = { n: rf.filter((f) => !/\.thumb$/.test(f.name)).length, mb: Math.round(rf.reduce((a, f) => a + f.size, 0) / 1024 / 1024) };
    } else used = dirSize(target(k), (n) => FILTER[k](n) && !/\.thumb$/.test(n));
    const pending = ext ? dirSize(DEFAULT[k], UPLOAD[k]).n : 0;
    return { kind: k, label: LABEL[k], dir: shown(k), external: ext, ok: p.ok, error: p.error || null, freeMb: p.freeMb, usedMb: used.mb, count: used.n, localPending: (smbMode || target(k) !== DEFAULT[k]) && k !== 'backups' ? pending : smbMode ? pending : 0 };
  });
  const s = db.data.smb ? smb.normalize(db.data.smb) : null;
  return {
    mode: db.data.mode, path: db.data.mode === 'folder' ? db.data.path : '',
    smb: s ? { server: s.server, share: s.share, dir: s.dir.replace(/\\/g, '/'), user: s.user, domain: s.domain === 'WORKGROUP' ? '' : s.domain, hasPassword: Boolean(s.password) } : null,
    smbclient: WIN ? true : Boolean(smb.binary()),
    files: db.data.files !== false, photos: db.data.photos !== false, backups: db.data.backups !== false,
    kinds, moving: db.data.moving, lastError: db.data.lastError, sync: db.data.sync, platform: platformHint(), suggestions: suggestions(), defaults: DEFAULT, sub: SUB,
  };
}

/** Kurzinfo für „Heute“ und den Plattform-Check */
function problems() {
  if (mode() === 'local') return [];
  if (isSmb()) return db.data.sync?.error ? KINDS.filter((k) => external(k)).map((k) => ({ kind: k, label: LABEL[k], dir: shown(k), error: db.data.sync.error })) : [];
  return KINDS.filter((k) => external(k) && !reachable(k)).map((k) => ({ kind: k, label: LABEL[k], dir: target(k) }));
}

// ================================================================ Umziehen

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

/** Alles vom NAS zurück in den Datenordner holen (beim Wechsel weg von SMB) */
async function pullAll(conn, kinds, progress) {
  for (const k of kinds) {
    const dir = smb.sub(smb.normalize(conn).dir, SUB[k]);
    let list = [];
    try {
      list = (await smb.list(conn, dir)).filter((f) => FILTER[k](f.name));
    } catch {
      continue; // Ordner gibt es nicht
    }
    fs.mkdirSync(DEFAULT[k], { recursive: true });
    for (const f of list) {
      const dest = path.join(DEFAULT[k], f.name);
      if (!(fs.existsSync(dest) && fs.statSync(dest).size === f.size)) await smb.get(conn, dir, f.name, dest);
      progress?.(f.name);
    }
  }
}

/** Neue Einstellungen prüfen und normalisieren */
function nextConfig(body) {
  const kinds = {
    files: body.files !== undefined ? Boolean(body.files) : db.data.files !== false,
    photos: body.photos !== undefined ? Boolean(body.photos) : db.data.photos !== false,
    backups: body.backups !== undefined ? Boolean(body.backups) : db.data.backups !== false,
  };
  const m = ['local', 'smb', 'folder'].includes(body.mode) ? body.mode : body.path ? 'folder' : body.path === '' ? 'local' : db.data.mode;
  if (m === 'folder') return { mode: 'folder', path: validPath(body.path ?? db.data.path), smb: db.data.smb, ...kinds };
  if (m === 'smb') {
    const old = db.data.smb ? smb.normalize(db.data.smb) : null;
    const s = smb.normalize(body.smb || {});
    if (!s.server || !s.share) throw Object.assign(new Error('Server und Freigabe angeben'), { status: 400 });
    // Passwort leer gelassen = altes behalten (Oberfläche zeigt es nie an)
    if (!s.password && old && old.server === s.server && old.user === s.user) s.password = old.password;
    return { mode: 'smb', path: '', smb: s, ...kinds };
  }
  return { mode: 'local', path: '', smb: db.data.smb, ...kinds };
}

/** „Prüfen“ in der Oberfläche */
async function test(body) {
  if (typeof body === 'string') body = { mode: 'folder', path: body };
  const n = nextConfig(body);
  if (n.mode === 'smb') {
    if (WIN) {
      await netUse(n.smb);
      const dir = uncOf(n.smb);
      const r = probe(dir);
      return { ...r, path: dir };
    }
    const r = await smb.test(n.smb);
    return { ...r, path: r.target || uncOf(n.smb) };
  }
  if (n.mode === 'folder') {
    const r = { path: n.path, ...probe(n.path) };
    // gleiche Platte wie der Datenordner? Dann ist das NAS vermutlich nicht eingehängt (leerer Einhängepunkt)
    try {
      if (r.ok && fs.statSync(n.path).dev === fs.statSync(DATA_DIR).dev) r.sameDisk = true;
    } catch {
      /* egal */
    }
    return r;
  }
  return { ok: true, path: DATA_DIR };
}

/**
 * Neuen Ort übernehmen: prüfen, Dateien umziehen, umschalten. Läuft im Hintergrund; Fortschritt in view().moving.
 * Weg von SMB: alles zurück in den Datenordner holen (die Kopien auf dem NAS bleiben liegen).
 */
async function change(body = {}) {
  if (db.data.moving) throw Object.assign(new Error('Verschieben läuft noch'), { status: 409 });
  const next = nextConfig(body);
  // neuen Ort vorher prüfen
  if (next.mode === 'smb') {
    const t = await test({ mode: 'smb', smb: next.smb });
    if (!t.ok) throw Object.assign(new Error(t.error || 'NAS nicht erreichbar'), { status: 400 });
    if (WIN) fs.writeFileSync(path.join(uncOf(next.smb), MARKER), `PrintDock-Speicherort – nicht löschen.\nAngelegt: ${new Date().toISOString()}\n`);
    if (t.freeMb != null) next.smbFree = t.freeMb;
  }
  if (next.mode === 'folder') {
    const pb = probe(next.path);
    if (!pb.ok) throw Object.assign(new Error(`${next.path} – ${pb.error}`), { status: 400 });
    fs.writeFileSync(path.join(next.path, MARKER), `PrintDock-Speicherort – nicht löschen.\nAngelegt: ${new Date().toISOString()}\n`);
  }
  const wasSmb = isSmb();
  const oldConn = db.data.smb;
  const oldKinds = KINDS.filter((k) => external(k));
  const folderOf = (cfg, k) => (cfg.mode === 'folder' && cfg[k] ? path.join(cfg.path, SUB[k]) : cfg.mode === 'smb' && WIN && cfg[k] ? path.join(uncOf(cfg.smb), SUB[k]) : DEFAULT[k]);
  const oldFolders = Object.fromEntries(KINDS.map((k) => [k, target(k)]));
  db.data.moving = { done: 0, total: 0, current: null, startedAt: new Date().toISOString() };
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
      // 1. Alles in den Datenordner holen (vom NAS bzw. aus dem bisherigen Ordner)
      if (wasSmb) {
        const keepOnNas = next.mode === 'smb' && JSON.stringify(smb.normalize(next.smb)) === JSON.stringify(smb.normalize(oldConn || {}));
        const pull = oldKinds.filter((k) => !(keepOnNas && next[k]));
        db.data.moving.total += pull.length ? (await Promise.all(pull.map((k) => smb.list(oldConn, remoteDir(k)).then((l) => l.filter((f) => FILTER[k](f.name)).length).catch(() => 0)))).reduce((a, b) => a + b, 0) : 0;
        await pullAll(oldConn, pull, tick);
      }
      for (const k of KINDS) {
        const from = oldFolders[k];
        const to = folderOf(next, k);
        if (from !== DEFAULT[k] && path.resolve(from) !== path.resolve(to)) {
          db.data.moving.total += fs.existsSync(from) ? fs.readdirSync(from).filter(FILTER[k]).length : 0;
          await copyAll(from, DEFAULT[k], FILTER[k], tick);
        }
      }
      // 2. Umschalten
      Object.assign(db.data, next);
      if (next.mode !== 'smb') db.data.sync = null;
      db.save();
      health.clear();
      // 3. An den neuen Ort bringen
      if (isSmb()) {
        db.data.moving.total += KINDS.filter((k) => external(k)).reduce((a, k) => a + (fs.existsSync(DEFAULT[k]) ? fs.readdirSync(DEFAULT[k]).filter(UPLOAD[k]).length : 0), 0);
        await smbSync(tick);
        if (db.data.sync?.error) throw new Error(db.data.sync.error);
      } else {
        for (const k of KINDS) {
          const to = target(k);
          if (to !== DEFAULT[k]) {
            db.data.moving.total += fs.existsSync(DEFAULT[k]) ? fs.readdirSync(DEFAULT[k]).filter(FILTER[k]).length : 0;
            await moveDir(DEFAULT[k], to, FILTER[k], tick);
          }
          // alten Ordner leeren (Kopien liegen jetzt am neuen Ort bzw. im Datenordner)
          const from = oldFolders[k];
          if (from !== DEFAULT[k] && path.resolve(from) !== path.resolve(to)) await moveDir(from, to, FILTER[k]);
        }
      }
      console.log(`Speicherort übernommen: ${next.mode === 'smb' ? uncOf(next.smb) : next.path || 'Datenordner'} (${db.data.moving.done} Dateien)`);
    } catch (err) {
      db.data.lastError = { at: new Date().toISOString(), msg: err.message };
      console.warn(`Speicherort: Umziehen fehlgeschlagen – ${err.message}`);
    } finally {
      db.data.moving = null;
      db.save();
      onChange();
    }
  })();
  return view();
}

/** Lokal Zwischengespeichertes an den Speicherort bringen (alle 10 Minuten, nach dem Start, „Jetzt nachziehen“) */
async function catchUp() {
  if (mode() === 'local' || db.data.moving) return 0;
  cleanCache();
  if (isSmb()) return smbSync();
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

/** Für Sicherungen: externe Ordner (eingehängt), die unter files/ bzw. photos/ mit hinein gehören. SMB: nicht – das NAS ist die Ablage. */
function backupExtras() {
  if (mode() !== 'folder') return [];
  return ['files', 'photos'].filter((k) => external(k)).map((k) => ({ prefix: k, dir: target(k), filter: FILTER[k] }));
}

module.exports = {
  backupExtras, test, ensureLocal, removeRemote, clearRemote, remoteFiles, isSmb, scheduleSync,
  KINDS, DEFAULT, CACHE, target, writeDir, find, view, change, problems, catchUp, probe, external,
  set onChange(fn) { onChange = fn; },
};
