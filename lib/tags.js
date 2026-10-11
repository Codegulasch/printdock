// Spulen-Tags (NFC/RFID, NTAG21x bzw. MIFARE Ultralight) lesen und beschreiben.
//
// Die PrintDock-Station liefert nur rohe Seiten (je 4 Byte) und schreibt rohe Seiten –
// welches Format auf dem Tag steht, entscheidet allein PrintDock. Unterstützt:
//
//   universal  NDEF: Link zur Spule in PrintDock (Handy öffnet die Spule) + OpenSpool-Datensatz
//   openspool  NDEF: nur OpenSpool (application/json) – z. B. Snapmaker U1 mit Community-Firmware
//   link       NDEF: nur der Link zur Spule
//   ace        Anycubic-ACE-Format (rohe Seiten 4–31) – das ACE Pro / Kobra S1 erkennt Material und Farbe
//
// Bambu-Tags (verschlüsselt) und Snapmaker-Original-Tags (MIFARE Classic, signiert) werden nur
// an der Kennung (UID) erkannt.
const colors = require('./colors');

const PAGE = 4;
const FIRST_USER_PAGE = 4;

// Temperaturen je Material: [Düse min, Düse max, Bett min, Bett max]
const TEMPS = {
  PLA: [190, 230, 50, 60],
  'PLA+': [210, 230, 45, 60],
  'PLA SILK': [200, 230, 55, 65],
  'PLA MATT': [190, 230, 55, 65],
  'PLA MATTE': [190, 230, 55, 65],
  'PLA HIGH SPEED': [190, 230, 50, 60],
  'PLA-CF': [210, 240, 50, 60],
  PETG: [230, 250, 70, 90],
  PCTG: [240, 260, 70, 90],
  ABS: [220, 250, 90, 100],
  ASA: [240, 280, 90, 100],
  TPU: [210, 230, 25, 60],
  PA: [260, 290, 80, 100],
  'PA-CF': [270, 300, 80, 100],
  PC: [260, 290, 100, 110],
  PVA: [190, 220, 45, 60],
  HIPS: [220, 250, 90, 100],
};

function tempsFor(material) {
  const m = String(material || 'PLA').toUpperCase().trim();
  if (TEMPS[m]) return TEMPS[m];
  const key = Object.keys(TEMPS).sort((a, b) => b.length - a.length).find((k) => m.startsWith(k));
  return TEMPS[key || 'PLA'];
}

// ---------------------------------------------------------------- Hilfen

const hex = (buf) => Buffer.from(buf).toString('hex').toUpperCase();
const fromHex = (s) => Buffer.from(String(s || '').replace(/[^0-9a-f]/gi, ''), 'hex');

/** Bytes ab Seite 4 → [{ page, hex }] (auf ganze Seiten aufgefüllt). */
function toPages(bytes, start = FIRST_USER_PAGE) {
  const len = Math.ceil(bytes.length / PAGE) * PAGE;
  const buf = Buffer.alloc(len);
  Buffer.from(bytes).copy(buf);
  const out = [];
  for (let i = 0; i < len; i += PAGE) out.push({ page: start + i / PAGE, hex: hex(buf.subarray(i, i + PAGE)) });
  return out;
}

/** Nutzbare Bytes laut Capability Container (Seite 3) – NTAG213: 144, 215: 496, 216: 872. */
function capacityOf(dump) {
  const cc = dump.subarray(12, 16);
  return cc[0] === 0xe1 && cc[2] ? cc[2] * 8 : null;
}

// ---------------------------------------------------------------- NDEF

const URI_PREFIX = ['', 'http://www.', 'https://www.', 'http://', 'https://'];

function ndefRecord({ tnf, type, payload }, first, last) {
  const t = Buffer.from(type, 'ascii');
  const p = Buffer.from(payload);
  const short = p.length < 256;
  const head = (first ? 0x80 : 0) | (last ? 0x40 : 0) | (short ? 0x10 : 0) | tnf;
  const len = short ? Buffer.from([p.length]) : Buffer.from([p.length >>> 24, (p.length >>> 16) & 255, (p.length >>> 8) & 255, p.length & 255]);
  return Buffer.concat([Buffer.from([head, t.length]), len, t, p]);
}

function uriRecord(uri) {
  let code = 0;
  for (let i = URI_PREFIX.length - 1; i > 0; i--) if (uri.startsWith(URI_PREFIX[i])) { code = i; break; }
  return { tnf: 1, type: 'U', payload: Buffer.concat([Buffer.from([code]), Buffer.from(uri.slice(URI_PREFIX[code].length), 'utf8')]) };
}

function mimeRecord(type, data) {
  return { tnf: 2, type, payload: Buffer.from(data, 'utf8') };
}

/** NDEF-Nachricht in einen Type-2-TLV-Block packen (03 len … FE). */
function ndefTlv(records) {
  const msg = Buffer.concat(records.map((r, i) => ndefRecord(r, i === 0, i === records.length - 1)));
  const len = msg.length < 255 ? Buffer.from([msg.length]) : Buffer.from([0xff, msg.length >> 8, msg.length & 255]);
  return Buffer.concat([Buffer.from([0x03]), len, msg, Buffer.from([0xfe])]);
}

function parseNdef(user) {
  // TLV-Blöcke durchgehen bis zur NDEF-Nachricht (03)
  let i = 0;
  while (i < user.length) {
    const t = user[i];
    if (t === 0x00) { i += 1; continue; }
    if (t === 0xfe) return null;
    let len = user[i + 1];
    let off = i + 2;
    if (len === 0xff) { len = user.readUInt16BE(i + 2); off = i + 4; }
    if (t === 0x03) return parseMessage(user.subarray(off, off + len));
    i = off + len;
  }
  return null;
}

function parseMessage(msg) {
  const records = [];
  let p = 0;
  while (p < msg.length) {
    const head = msg[p];
    const tnf = head & 7;
    const short = head & 0x10;
    const hasId = head & 0x08;
    const typeLen = msg[p + 1];
    let q = p + 2;
    const payLen = short ? msg[q] : msg.readUInt32BE(q);
    q += short ? 1 : 4;
    const idLen = hasId ? msg[q++] : 0;
    const type = msg.subarray(q, q + typeLen).toString('ascii');
    q += typeLen + idLen;
    const payload = msg.subarray(q, q + payLen);
    records.push({ tnf, type, payload });
    p = q + payLen;
    if (head & 0x40) break;
  }
  return records;
}

// ---------------------------------------------------------------- OpenSpool

function openSpoolJson(spool) {
  const [tMin, tMax] = tempsFor(spool.material);
  return JSON.stringify({
    protocol: 'openspool',
    version: '1.0',
    type: String(spool.material || 'PLA').toUpperCase(),
    color_hex: String(spool.color || '#FFFFFF').replace('#', '').toUpperCase(),
    brand: spool.brand || 'Generic',
    min_temp: String(tMin),
    max_temp: String(tMax),
    ...(spool.netWeight ? { weight: String(Math.round(spool.netWeight)) } : {}),
    ...(spool.diameter && spool.diameter !== 1.75 ? { diameter: String(spool.diameter) } : {}),
  });
}

function readOpenSpool(text) {
  try {
    const j = JSON.parse(text);
    if (String(j.protocol).toLowerCase() !== 'openspool') return null;
    return {
      material: String(j.type || '').trim() || null,
      color: colors.normalize(`#${String(j.color_hex || '').replace('#', '').slice(0, 6)}`),
      brand: j.brand && j.brand !== 'Generic' ? String(j.brand) : '',
      tempMin: Number(j.min_temp) || null,
      tempMax: Number(j.max_temp) || null,
      netWeight: Number(j.weight) || null,
      diameter: Number(j.diameter) === 2.85 ? 2.85 : Number(j.diameter) ? 1.75 : null,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- Anycubic ACE
// Seitenlayout nach DnG-Crafts/ACE-RFID und Original-Tags von Anycubic:
//  4  7B 00 65 00   5–9 Artikelnummer   10–14 Hersteller   15–19 Material   20 Farbe A B G R
//  23 ? (50/100)   24 Düse min/max   29 Bett min/max   30 Durchmesser ×100 / Länge m   31 Gewicht g

const ACE_SKU = { ABS: 'SHABBK-102', 'PLA HIGH SPEED': 'AHHSBK-103', 'PLA MATTE': 'HYGBK-102', 'PLA MATT': 'HYGBK-102', 'PLA SILK': 'AHSCWH-102', TPU: 'STPBK-101', PLA: 'AHPLBK-101', 'PLA+': 'AHPLPBK-102' };
const ACE_NAME = { 'PLA MATT': 'PLA Matte', 'PLA SILK': 'PLA Silk' };

function aceMaterial(material) {
  const m = String(material || 'PLA').trim();
  return ACE_NAME[m.toUpperCase()] || m;
}

const DENSITY = { PLA: 1.24, PETG: 1.27, PCTG: 1.23, ABS: 1.04, ASA: 1.07, TPU: 1.21, PA: 1.14, PC: 1.2, PVA: 1.19, HIPS: 1.04 };

/** Filamentlänge in Metern für ein Gewicht. */
function aceLength(grams, material, diameter = 1.75) {
  const m = String(material || '').toUpperCase();
  const d = DENSITY[Object.keys(DENSITY).find((k) => m.startsWith(k))] || 1.24;
  const r = diameter / 20; // cm
  return Math.round(grams / (100 * Math.PI * r * r * d));
}

function encodeAce(spool) {
  const b = Buffer.alloc(28 * PAGE); // Seiten 4..31
  const at = (page) => (page - 4) * PAGE;
  const str = (page, s, max = 20) => Buffer.from(String(s).slice(0, max), 'ascii').copy(b, at(page));
  b.set([0x7b, 0x00, 0x65, 0x00], at(4));
  const name = aceMaterial(spool.material);
  str(5, ACE_SKU[name.toUpperCase()] || ACE_SKU.PLA);
  str(10, spool.brand && !/anycubic/i.test(spool.brand) ? spool.brand : 'AC');
  str(15, name);
  let [r, g, bl] = colors.normalize(spool.color || '#FFFFFF').slice(1).match(/../g).map((x) => parseInt(x, 16));
  if (!r && !g && !bl) r = g = bl = 1; // 000000 wird vom ACE als „keine Farbe“ gelesen
  b.set([0xff, bl, g, r], at(20));
  b.writeUInt16LE(50, at(23));
  b.writeUInt16LE(100, at(23) + 2);
  const [tMin, tMax, bMin, bMax] = tempsFor(spool.material);
  b.writeUInt16LE(tMin, at(24));
  b.writeUInt16LE(tMax, at(24) + 2);
  b.writeUInt16LE(bMin, at(29));
  b.writeUInt16LE(bMax, at(29) + 2);
  b.writeUInt16LE(Math.round((spool.diameter || 1.75) * 100), at(30));
  const net = Math.round(spool.netWeight || 1000);
  b.writeUInt16LE(Math.min(65535, aceLength(net, spool.material, spool.diameter || 1.75)), at(30) + 2);
  b.writeUInt16LE(Math.min(65535, net), at(31));
  return b;
}

function readAce(user) {
  if (user.length < 28 * PAGE || user[0] !== 0x7b || user[2] !== 0x65) return null;
  const at = (page) => (page - 4) * PAGE;
  const str = (page, n = 20) => user.subarray(at(page), at(page) + n).toString('ascii').replace(/\0.*$/s, '').trim();
  const [a, bl, g, r] = user.subarray(at(20), at(20) + 4);
  let color = `#${[r, g, bl].map((x) => x.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  if (color === '#010101') color = '#000000';
  const brand = str(10);
  return {
    material: str(15) || null,
    sku: str(5) || null,
    brand: brand === 'AC' ? 'Anycubic' : brand,
    color: a ? color : null,
    tempMin: user.readUInt16LE(at(24)) || null,
    tempMax: user.readUInt16LE(at(24) + 2) || null,
    diameter: user.readUInt16LE(at(30)) === 285 ? 2.85 : 1.75,
    netWeight: user.readUInt16LE(at(31)) || null,
  };
}

// ---------------------------------------------------------------- öffentlich

const FORMATS = ['universal', 'openspool', 'link', 'ace'];

/** Link, unter dem PrintDock eine Spule öffnet. */
function spoolUrl(base, spool) {
  return `${String(base || '').replace(/\/+$/, '')}/#spool=${encodeURIComponent(spool.nr)}`;
}

/**
 * Seiten zum Beschreiben eines Tags.
 * @returns {{ format, bytes, pages: [{page, hex}] }}
 */
function encode(format, spool, { baseUrl = '', capacity = null } = {}) {
  if (!FORMATS.includes(format)) throw Object.assign(new Error(`Unbekanntes Tag-Format „${format}“`), { status: 400 });
  let bytes;
  if (format === 'ace') bytes = encodeAce(spool);
  else {
    const recs = [];
    if (format !== 'openspool') {
      if (!baseUrl) throw Object.assign(new Error('Für den Link fehlt die Adresse von PrintDock im Heimnetz (Einstellungen → System)'), { status: 400 });
      recs.push(uriRecord(spoolUrl(baseUrl, spool)));
    }
    if (format !== 'link') recs.push(mimeRecord('application/json', openSpoolJson(spool)));
    bytes = ndefTlv(recs);
  }
  if (capacity && bytes.length > capacity) {
    const NAMES = { universal: 'PrintDock + OpenSpool', openspool: 'OpenSpool', link: 'Nur Link', ace: 'Anycubic ACE' };
    const fit = FORMATS.filter((f) => f !== format).filter((f) => {
      try { return encode(f, spool, { baseUrl: baseUrl || 'http://x', capacity }); } catch { return false; }
    });
    const hint = fit.length ? ` – passt: ${fit.map((f) => `„${NAMES[f]}“`).join(', ')}, oder NTAG215/216 nehmen` : ' – NTAG215/216 nehmen';
    throw Object.assign(new Error(`Der Tag ist zu klein (${capacity} Byte, nötig ${bytes.length})${hint}`), { status: 400 });
  }
  return { format, bytes: bytes.length, pages: toPages(bytes) };
}

/**
 * Inhalt eines gelesenen Tags deuten.
 * @param pagesHex  Seiten ab 0 als Hex-Text (wie von der Station gemeldet)
 * @returns {{ format, spoolRef, data, capacity, blank }}
 */
function decode(pagesHex) {
  const dump = fromHex(pagesHex);
  const capacity = dump.length >= 16 ? capacityOf(dump) : null;
  const user = dump.subarray(FIRST_USER_PAGE * PAGE);
  const out = { format: 'unknown', spoolRef: null, url: null, data: null, capacity, blank: false };
  if (!user.length) return out;
  const ace = readAce(user);
  if (ace) return { ...out, format: 'ace', data: ace };
  const recs = parseNdef(user);
  if (recs?.length) {
    for (const r of recs) {
      if (r.tnf === 1 && r.type === 'U' && r.payload.length) {
        const uri = (URI_PREFIX[r.payload[0]] || '') + r.payload.subarray(1).toString('utf8');
        out.url = uri;
        const m = uri.match(/#spool=([^&]+)/);
        if (m) out.spoolRef = decodeURIComponent(m[1]);
      }
      if (r.tnf === 2 && /json/i.test(r.type)) out.data = readOpenSpool(r.payload.toString('utf8')) || out.data;
    }
    out.format = out.spoolRef ? (out.data ? 'universal' : 'link') : out.data ? 'openspool' : 'ndef';
    return out;
  }
  out.blank = Boolean(recs) || user.subarray(0, 16).every((x) => x === 0 || x === 0xff);
  if (out.blank) out.format = 'blank';
  return out;
}

module.exports = { encode, decode, FORMATS, tempsFor, spoolUrl, toPages, openSpoolJson, _internal: { encodeAce, readAce, parseNdef, ndefTlv, uriRecord, mimeRecord } };
