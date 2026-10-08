// Minimaler ZIP-Leser für 3MF-Dateien (Bambu Studio, OrcaSlicer, PrusaSlicer).
// Liest nur das Inhaltsverzeichnis und gezielt einzelne Einträge – auch bei
// großen Dateien wird nie die ganze Datei in den Speicher geladen.

const fs = require('fs');
const zlib = require('zlib');

function readAt(fd, pos, len) {
  const buf = Buffer.alloc(len);
  const n = fs.readSync(fd, buf, 0, len, pos);
  return buf.subarray(0, n);
}

/** Inhaltsverzeichnis: [{ name, method, compSize, size, offset }] */
function listEntries(fd, fileSize) {
  const tailLen = Math.min(fileSize, 65557);
  const tail = readAt(fd, fileSize - tailLen, tailLen);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Keine gültige ZIP/3MF-Datei');
  const count = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  const cd = readAt(fd, cdOffset, cdSize);
  const entries = [];
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.length; i++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) break;
    const method = cd.readUInt16LE(p + 10);
    const compSize = cd.readUInt32LE(p + 20);
    const size = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const offset = cd.readUInt32LE(p + 42);
    const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({ name, method, compSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Eintrag entpacken. maxBytes begrenzt große Einträge (z. B. G-code). */
function readEntry(fd, entry, maxBytes = 8 * 1024 * 1024) {
  const local = readAt(fd, entry.offset, 30);
  if (local.readUInt32LE(0) !== 0x04034b50) throw new Error('Defekter ZIP-Eintrag');
  const start = entry.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
  if (entry.method === 0) return readAt(fd, start, Math.min(entry.compSize, maxBytes));
  if (entry.method !== 8) throw new Error(`Komprimierung ${entry.method} nicht unterstützt`);
  if (entry.size <= maxBytes) return zlib.inflateRawSync(readAt(fd, start, entry.compSize));
  // Große Einträge: nur den Anfang lesen und entpacken (reicht für den G-code-Kopf)
  const raw = readAt(fd, start, Math.min(entry.compSize, Math.ceil(maxBytes / 4)));
  return zlib.inflateRawSync(raw, { finishFlush: zlib.constants.Z_SYNC_FLUSH }).subarray(0, maxBytes);
}

function openZip(file) {
  const fd = fs.openSync(file, 'r');
  const size = fs.fstatSync(fd).size;
  let entries;
  try {
    entries = listEntries(fd, size);
  } catch (err) {
    fs.closeSync(fd);
    throw err;
  }
  return {
    entries,
    find: (re) => entries.find((e) => re.test(e.name)),
    read: (entry, max) => readEntry(fd, entry, max),
    close: () => fs.closeSync(fd),
  };
}

module.exports = { openZip };
