// Datensicherung: alles aus dem Datenordner als ZIP herunterladen und wiederherstellen.
//
// Die Sicherung enthält Einstellungen, Drucker, Warteschlange, Aufträge, Spulen, Wartung,
// Verlauf und die Druckdateien. Wiederhergestellt wird beim nächsten Start (vor dem Laden
// der Daten); der vorherige Stand wird in before-restore-<Zeit>/ aufgehoben.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MANIFEST = 'printdock-backup.json';
const PENDING = 'restore-pending.zip';
// Nicht sichern: Zwischenspeicher, halbe Schreibvorgänge, ältere Wiederherstellungen
const SKIP = /^(hms-[a-z]+\.json|.*\.tmp|restore-pending\.zip(\.part)?|before-restore-.*|sicherungen|tmp|eingang|bin)$/;

// ---------------------------------------------------------------- CRC32
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf, crc = 0) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf, crc);
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Alle zu sichernden Dateien (relativ zum Datenordner, mit / getrennt). */
function listFiles(dataDir, skipDirs = []) {
  const out = [];
  const walk = (rel) => {
    for (const ent of fs.readdirSync(path.join(dataDir, rel), { withFileTypes: true })) {
      if (!rel && SKIP.test(ent.name)) continue;
      if (!rel && ent.isDirectory() && skipDirs.includes(ent.name)) continue;
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(r);
      else if (ent.isFile() && !/\.tmp$/.test(ent.name)) out.push(r);
    }
  };
  walk('');
  return out;
}

function fileCrc(file) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(1 << 20);
  let crc = 0;
  let n;
  try {
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) crc = crc32(buf.subarray(0, n), crc);
  } finally {
    fs.closeSync(fd);
  }
  return crc >>> 0;
}

/**
 * Schreibt eine ZIP-Sicherung (unkomprimiert, damit auch große Druckdateien nur
 * gestreamt werden) in den Stream `out`.
 */
async function writeBackup(dataDir, out, info, { skipDirs = [] } = {}) {
  const manifest = Buffer.from(JSON.stringify({ app: 'PrintDock', ...info, withoutFiles: skipDirs.includes('files') || undefined, createdAt: new Date().toISOString() }, null, 2));
  const entries = [{ name: MANIFEST, buf: manifest }, ...listFiles(dataDir, skipDirs).map((name) => ({ name, file: path.join(dataDir, name) }))];
  const central = [];
  let offset = 0;
  let closed = false;
  out.once('close', () => (closed = true));
  const write = async (buf) => {
    if (closed || out.destroyed) throw new Error('Download abgebrochen');
    offset += buf.length;
    if (!out.write(buf)) await new Promise((resolve) => { out.once('drain', resolve); out.once('close', resolve); });
  };
  for (const e of entries) {
    const size = e.buf ? e.buf.length : fs.statSync(e.file).size;
    if (size >= 0xffffffff) continue; // > 4 GB: ZIP64 wäre nötig – solche Dateien gibt es hier praktisch nicht
    const crc = e.buf ? crc32(e.buf) >>> 0 : fileCrc(e.file);
    const name = Buffer.from(e.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8-Dateinamen
    local.writeUInt16LE(0, 8); // gespeichert
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    const at = offset;
    await write(Buffer.concat([local, name]));
    if (e.buf) await write(e.buf);
    else {
      for await (const chunk of fs.createReadStream(e.file, { highWaterMark: 1 << 20 })) await write(chunk);
    }
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(size, 20);
    cd.writeUInt32LE(size, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(at, 42);
    central.push(Buffer.concat([cd, name]));
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  await write(Buffer.concat([cdBuf, end]));
}

// ---------------------------------------------------------------- Lesen
function readAt(fd, pos, len) {
  const buf = Buffer.alloc(len);
  const n = fs.readSync(fd, buf, 0, len, pos);
  return buf.subarray(0, n);
}

/** Inhaltsverzeichnis einer ZIP-Datei: [{ name, method, compSize, size, dataStart }] */
function readZip(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(size, 65557);
    const tail = readAt(fd, size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Keine gültige Sicherungsdatei (ZIP)');
    const count = tail.readUInt16LE(eocd + 10);
    const cd = readAt(fd, tail.readUInt32LE(eocd + 16), tail.readUInt32LE(eocd + 12));
    const entries = [];
    let p = 0;
    for (let i = 0; i < count && cd.readUInt32LE(p) === 0x02014b50; i++) {
      const nameLen = cd.readUInt16LE(p + 28);
      const extra = cd.readUInt16LE(p + 30);
      const comment = cd.readUInt16LE(p + 32);
      const offset = cd.readUInt32LE(p + 42);
      const local = readAt(fd, offset, 30);
      entries.push({
        name: cd.subarray(p + 46, p + 46 + nameLen).toString('utf8'),
        method: cd.readUInt16LE(p + 10),
        compSize: cd.readUInt32LE(p + 20),
        size: cd.readUInt32LE(p + 24),
        dataStart: offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28),
      });
      p += 46 + nameLen + extra + comment;
    }
    return entries;
  } finally {
    fs.closeSync(fd);
  }
}

/** Prüft eine hochgeladene Sicherung und liefert ihre Angaben. */
function inspect(file) {
  const entries = readZip(file);
  const m = entries.find((e) => e.name === MANIFEST);
  if (!m) throw Object.assign(new Error('Das ist keine PrintDock-Sicherung'), { status: 400 });
  const fd = fs.openSync(file, 'r');
  try {
    const raw = readAt(fd, m.dataStart, m.compSize);
    const info = JSON.parse((m.method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8'));
    return { ...info, files: entries.length - 1 };
  } finally {
    fs.closeSync(fd);
  }
}

/** Sicherere Pfade: keine absoluten Pfade, kein „..“. */
function safeName(name) {
  const n = String(name).replace(/\\/g, '/');
  if (!n || n.startsWith('/') || n.split('/').some((s) => s === '..' || s === '')) return null;
  return n;
}

/**
 * Beim Start: liegt eine Sicherung zum Wiederherstellen bereit, den aktuellen Stand
 * beiseitelegen und die Sicherung auspacken.
 */
function applyPending(dataDir) {
  const zip = path.join(dataDir, PENDING);
  if (!fs.existsSync(zip)) return null;
  let info;
  try {
    info = inspect(zip);
  } catch (err) {
    console.warn(`Wiederherstellung übersprungen: ${err.message}`);
    fs.renameSync(zip, path.join(dataDir, `restore-failed-${Date.now()}.zip`));
    return null;
  }
  // Vorherigen Stand aufheben (nur den letzten, um Platz zu sparen)
  for (const d of fs.readdirSync(dataDir)) if (/^before-restore-/.test(d)) fs.rmSync(path.join(dataDir, d), { recursive: true, force: true });
  const keep = path.join(dataDir, `before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(keep);
  for (const d of fs.readdirSync(dataDir)) {
    if (d === PENDING || d === path.basename(keep)) continue;
    fs.renameSync(path.join(dataDir, d), path.join(keep, d));
  }
  const fd = fs.openSync(zip, 'r');
  try {
    for (const e of readZip(zip)) {
      const name = safeName(e.name);
      if (!name || name === MANIFEST || name.endsWith('/')) continue;
      const target = path.join(dataDir, ...name.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (e.method === 8) {
        fs.writeFileSync(target, zlib.inflateRawSync(readAt(fd, e.dataStart, e.compSize)));
      } else if (e.method === 0) {
        const out = fs.openSync(target, 'w');
        const buf = Buffer.alloc(1 << 20);
        let pos = e.dataStart;
        let left = e.compSize;
        while (left > 0) {
          const n = fs.readSync(fd, buf, 0, Math.min(buf.length, left), pos);
          if (n <= 0) break;
          fs.writeSync(out, buf, 0, n);
          pos += n;
          left -= n;
        }
        fs.closeSync(out);
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  // Sicherung ohne Druckdateien (automatische Sicherung): vorhandene Druckdateien und Sicherungen behalten
  for (const d of [...(info.withoutFiles ? ['files'] : []), 'sicherungen', 'eingang', 'bin']) {
    const from = path.join(keep, d);
    if (fs.existsSync(from) && !fs.existsSync(path.join(dataDir, d))) fs.renameSync(from, path.join(dataDir, d));
  }
  fs.rmSync(zip, { force: true });
  console.log(`Sicherung vom ${info.createdAt} (PrintDock ${info.version}) wiederhergestellt – vorheriger Stand liegt in ${path.basename(keep)}`);
  return info;
}

module.exports = { writeBackup, inspect, applyPending, PENDING };
