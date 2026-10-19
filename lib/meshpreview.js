// Vorschau-Netz für Modelldateien (STL, 3MF): liest die Dreiecke und liefert sie kompakt für die 3D-Ansicht im Browser.
// Ausgabe: Float32-Werte, je Dreieck 9 Zahlen (x,y,z der drei Ecken), bei sehr großen Modellen ausgedünnt.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { openZip } = require('./zip');

const MAX_TRIS = 120_000;

function fromStl(buf) {
  if (buf.length >= 84) {
    const n = buf.readUInt32LE(80);
    if (84 + n * 50 === buf.length) {
      const out = new Float32Array(n * 9);
      for (let i = 0; i < n; i += 1) {
        const o = 84 + i * 50 + 12;
        for (let k = 0; k < 9; k += 1) out[i * 9 + k] = buf.readFloatLE(o + k * 4);
      }
      return out;
    }
  }
  // ASCII-STL
  const txt = buf.toString('latin1');
  const nums = [];
  const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
  let m;
  while ((m = re.exec(txt))) nums.push(Number(m[1]), Number(m[2]), Number(m[3]));
  if (!nums.length) throw new Error('Keine Dreiecke in der STL-Datei gefunden');
  return Float32Array.from(nums.slice(0, nums.length - (nums.length % 9)));
}

const IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
function parseTransform(s) {
  const v = String(s || '').trim().split(/\s+/).map(Number);
  return v.length === 12 && v.every(Number.isFinite) ? v : IDENT;
}
// 3MF-Matrix: Zeilen m00 m01 m02 / m10 m11 m12 / m20 m21 m22 / m30 m31 m32 (Punkt als Zeilenvektor)
function mul(a, b) {
  const r = new Array(12);
  for (let i = 0; i < 4; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j] + (i === 3 ? b[9 + j] : 0);
    }
  }
  return r;
}

function from3mf(file) {
  const z = openZip(file);
  try {
    const objects = new Map(); // "pfad#id" → { verts, tris, comps }
    let items = [];
    for (const e of z.entries.filter((x) => /\.model$/i.test(x.name))) {
      const xml = z.read(e, 512 * 1024 * 1024).toString('utf8');
      const base = `/${e.name.replace(/^\//, '')}`;
      const objRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
      let om;
      while ((om = objRe.exec(xml))) {
        const id = /\bid="([^"]+)"/.exec(om[1])?.[1];
        const body = om[2];
        const verts = [];
        const tris = [];
        const comps = [];
        const vRe = /<vertex\b[^>]*?\bx="([^"]+)"[^>]*?\by="([^"]+)"[^>]*?\bz="([^"]+)"/g;
        let vm;
        while ((vm = vRe.exec(body))) verts.push(Number(vm[1]), Number(vm[2]), Number(vm[3]));
        const tRe = /<triangle\b[^>]*?\bv1="(\d+)"[^>]*?\bv2="(\d+)"[^>]*?\bv3="(\d+)"/g;
        let tm;
        while ((tm = tRe.exec(body))) tris.push(Number(tm[1]), Number(tm[2]), Number(tm[3]));
        const cRe = /<component\b([^>]*)\/?>/g;
        let cm;
        while ((cm = cRe.exec(body))) {
          const a = cm[1];
          comps.push({ id: /\bobjectid="([^"]+)"/.exec(a)?.[1], path: /\bp:path="([^"]+)"/.exec(a)?.[1] || null, tf: parseTransform(/\btransform="([^"]+)"/.exec(a)?.[1]) });
        }
        objects.set(`${base}#${id}`, { verts, tris, comps, base });
      }
      if (/3D\/3dmodel\.model$/i.test(e.name) || !items.length) {
        const found = [];
        const iRe = /<item\b([^>]*)\/?>/g;
        let im;
        while ((im = iRe.exec(xml))) found.push({ id: /\bobjectid="([^"]+)"/.exec(im[1])?.[1], path: /\bp:path="([^"]+)"/.exec(im[1])?.[1] || null, tf: parseTransform(/\btransform="([^"]+)"/.exec(im[1])?.[1]), base });
        if (found.length && /3D\/3dmodel\.model$/i.test(e.name)) items = found;
        else if (!items.length) items = found;
      }
    }
    const out = [];
    const emit = (key, tf, depth) => {
      const o = objects.get(key);
      if (!o || depth > 8) return;
      for (let i = 0; i < o.tris.length; i += 1) {
        const v = o.tris[i] * 3;
        const x = o.verts[v], y = o.verts[v + 1], zz = o.verts[v + 2];
        out.push(x * tf[0] + y * tf[3] + zz * tf[6] + tf[9], x * tf[1] + y * tf[4] + zz * tf[7] + tf[10], x * tf[2] + y * tf[5] + zz * tf[8] + tf[11]);
      }
      for (const c of o.comps) emit(`${c.path || o.base}#${c.id}`, mul(c.tf, tf), depth + 1);
    };
    if (items.length) for (const it of items) emit(`${it.path || it.base}#${it.id}`, it.tf, 0);
    else for (const key of objects.keys()) emit(key, IDENT, 0);
    if (!out.length) throw new Error('Keine Dreiecke in der 3MF-Datei gefunden');
    return Float32Array.from(out);
  } finally {
    z.close();
  }
}

/** Dreiecke ausdünnen, damit die Vorschau flüssig bleibt */
function thin(tris) {
  const n = tris.length / 9;
  if (n <= MAX_TRIS) return tris;
  const step = n / MAX_TRIS;
  const out = new Float32Array(MAX_TRIS * 9);
  for (let i = 0; i < MAX_TRIS; i += 1) out.set(tris.subarray(Math.floor(i * step) * 9, Math.floor(i * step) * 9 + 9), i * 9);
  return out;
}

/** Puffer + Dateiname → Buffer mit Float32-Dreiecken (bereits ausgedünnt) */
function meshFromBuffer(buf, name) {
  const ext = path.extname(String(name)).toLowerCase();
  let tris;
  if (ext === '.3mf') {
    const tmp = path.join(os.tmpdir(), `pd-3mf-${process.pid}-${Date.now()}.3mf`);
    fs.writeFileSync(tmp, buf);
    try { tris = from3mf(tmp); } finally { fs.rmSync(tmp, { force: true }); }
  } else if (ext === '.stl') {
    tris = fromStl(buf);
  } else {
    throw Object.assign(new Error('Vorschau nur für STL und 3MF'), { status: 415 });
  }
  const t = thin(tris);
  return Buffer.from(t.buffer, t.byteOffset, t.byteLength);
}

module.exports = { meshFromBuffer };
