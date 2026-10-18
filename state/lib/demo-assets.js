// Erzeugt Demo-Dateien ohne externe Werkzeuge: PNG-Vorschaubilder,
// G-code mit Slicer-Kopfzeilen und geslicte 3MF-Projekte (ZIP).

const zlib = require('zlib');

// ------------------------------------------------------------------ CRC32 (PNG + ZIP)
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// ------------------------------------------------------------------ PNG
function png(width, height, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bit-Tiefe
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const shade = ([r, g, b], f) => [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v * f))));

/**
 * Vorschaubild eines Bauteils in Isometrie auf einer Druckplatte.
 * shape: 'box' | 'cylinder' | 'bracket' | 'tower'
 */
function thumbnail({ colors = ['#2F6FDE'], shape = 'box', size = 300 }) {
  const W = size;
  const H = size;
  const img = Buffer.alloc(W * H * 4);
  const put = (x, y, [r, g, b], a = 255) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    const na = a / 255;
    img[i] = img[i] * (1 - na) + r * na;
    img[i + 1] = img[i + 1] * (1 - na) + g * na;
    img[i + 2] = img[i + 2] * (1 - na) + b * na;
    img[i + 3] = Math.max(img[i + 3], a);
  };
  const s = W / 300;
  const iso = (x, y, z) => [W / 2 + (x - y) * 0.866 * s, H * 0.62 + ((x + y) * 0.5 - z) * s];
  // Polygon füllen (Scanline)
  const poly = (pts, col, a = 255) => {
    const ys = pts.map((p) => p[1]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[(i + 1) % pts.length];
        if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.ceil(xs[k]); x <= xs[k + 1]; x++) put(x, y, col, a);
    }
  };
  // Druckplatte
  const plate = [-120, 120].flatMap((x) => [x]);
  void plate;
  poly([iso(-125, -125, 0), iso(125, -125, 0), iso(125, 125, 0), iso(-125, 125, 0)], [52, 58, 66], 255);
  for (let g = -100; g <= 100; g += 25) {
    for (let t = 0; t <= 1; t += 0.004) {
      const [x1, y1] = iso(g, -125 + 250 * t, 0);
      put(x1, y1, [70, 78, 88]);
      const [x2, y2] = iso(-125 + 250 * t, g, 0);
      put(x2, y2, [70, 78, 88]);
    }
  }
  const box = (x0, y0, z0, dx, dy, dz, color) => {
    const c = hex(color);
    // Schicht-Linien für Druckoptik
    const top = [iso(x0, y0, z0 + dz), iso(x0 + dx, y0, z0 + dz), iso(x0 + dx, y0 + dy, z0 + dz), iso(x0, y0 + dy, z0 + dz)];
    const left = [iso(x0, y0 + dy, z0), iso(x0 + dx, y0 + dy, z0), iso(x0 + dx, y0 + dy, z0 + dz), iso(x0, y0 + dy, z0 + dz)];
    const right = [iso(x0 + dx, y0, z0), iso(x0 + dx, y0 + dy, z0), iso(x0 + dx, y0 + dy, z0 + dz), iso(x0 + dx, y0, z0 + dz)];
    poly(left, shade(c, 0.72));
    poly(right, shade(c, 0.55));
    poly(top, shade(c, 1.08));
    for (let z = z0 + 4; z < z0 + dz; z += 4) {
      for (let t = 0; t <= 1; t += 0.006) {
        const [a1, b1] = iso(x0 + dx * t, y0 + dy, z);
        put(a1, b1, shade(c, 0.6), 70);
        const [a2, b2] = iso(x0 + dx, y0 + dy * t, z);
        put(a2, b2, shade(c, 0.45), 70);
      }
    }
  };
  const cyl = (cx, cy, z0, r, h, color, teeth = 0) => {
    const c = hex(color);
    for (let z = z0; z <= z0 + h; z += 0.7) {
      for (let a = 0; a < Math.PI * 2; a += 0.01) {
        const rr = teeth ? r + (Math.sin(a * teeth) > 0.3 ? 6 : 0) : r;
        const [x, y] = iso(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, z);
        const f = 0.55 + 0.45 * Math.max(0, Math.cos(a - 0.8));
        put(x, y, shade(c, z >= z0 + h - 0.7 ? 1.08 : f));
      }
    }
    for (let rr = 0; rr <= r; rr += 0.7) {
      for (let a = 0; a < Math.PI * 2; a += 0.01) {
        const [x, y] = iso(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, z0 + h);
        put(x, y, shade(c, rr < r * 0.3 && teeth ? 0.35 : 1.06));
      }
    }
  };
  const [c1, c2 = colors[0], c3 = c2, c4 = c3] = colors;
  if (shape === 'box') {
    box(-70, -55, 0, 140, 110, 38, c1);
    if (colors.length > 1) box(-60, -45, 38, 120, 90, 6, c2);
  } else if (shape === 'cylinder') {
    cyl(-30, 0, 0, 48, 22, c1, 14);
    cyl(55, -40, 0, 30, 18, c2, 10);
    if (colors.length > 2) cyl(40, 60, 0, 24, 14, c3, 9);
  } else if (shape === 'bracket') {
    box(-80, -30, 0, 160, 60, 14, c1);
    box(-80, -30, 14, 30, 60, 70, c1);
    box(50, -30, 14, 30, 60, 70, c2);
  } else if (shape === 'tower') {
    box(-40, -40, 0, 80, 80, 30, c1);
    box(-32, -32, 30, 64, 64, 30, c2);
    box(-24, -24, 60, 48, 48, 30, c3);
    box(-16, -16, 90, 32, 32, 22, c4);
  } else if (shape === 'lamp') {
    cyl(0, 0, 0, 70, 90, c1);
    cyl(0, 0, 90, 30, 10, c2);
  }
  return png(W, H, img);
}

// ------------------------------------------------------------------ G-code
function fmtTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h ? `${h}h ` : ''}${m}m ${s}s`;
}

function thumbBlock(pngBuf) {
  const b64 = pngBuf.toString('base64');
  const lines = b64.match(/.{1,78}/g).map((l) => `; ${l}`);
  return `; thumbnail begin 300x300 ${b64.length}\n${lines.join('\n')}\n; thumbnail end\n`;
}

/** G-code, wie OrcaSlicer ihn schreibt (Kopf + Einstellungen am Ende). */
function gcode({ printerModel, seconds, materials, layers = 200, layerHeight = 0.2, thumb }) {
  const grams = materials.map((m) => m.grams.toFixed(2)).join(', ');
  const total = materials.reduce((a, m) => a + m.grams, 0);
  const body = [];
  for (let l = 1; l <= Math.min(layers, 60); l++) body.push(`;LAYER_CHANGE\n;Z:${(l * layerHeight).toFixed(2)}\nG1 Z${(l * layerHeight).toFixed(2)} F600\nG1 X${100 + (l % 7)} Y${100 + (l % 5)} E0.4 F3000`);
  return `; HEADER_BLOCK_START
; generated by OrcaSlicer 2.3.1 on ${new Date().toISOString().slice(0, 10)} at 10:00:00
; total layer number: ${layers}
; estimated printing time (normal mode) = ${fmtTime(seconds)}
; HEADER_BLOCK_END
${thumb ? thumbBlock(thumb) : ''}
; Demo-Datei von PrintDock – nicht zum echten Drucken gedacht
G28
${body.join('\n')}
M104 S0
M140 S0
; filament used [g] = ${grams}
; total filament weight [g] : ${total.toFixed(2)}
; filament_type = ${materials.map((m) => m.type).join(';')}
; filament_colour = ${materials.map((m) => m.color).join(';')}
; layer_height = ${layerHeight}
; nozzle_diameter = 0.4
; printer_model = ${printerModel}
`;
}

// ------------------------------------------------------------------ ZIP (für 3MF)
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name);
    const comp = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** Geslicte 3MF wie aus Bambu Studio („Plate-Datei exportieren“). */
function project3mf({ printerModel, seconds, materials, layers = 200, thumb }) {
  const total = materials.reduce((a, m) => a + m.grams, 0);
  const sliceInfo = `<?xml version="1.0" encoding="UTF-8"?>
<config><header><header_item key="X-BBL-Client-Type" value="slicer"/></header>
<plate><metadata key="index" value="1"/><metadata key="nozzle_diameters" value="0.4"/>
<metadata key="prediction" value="${seconds}"/><metadata key="weight" value="${total.toFixed(2)}"/>
${materials.map((m, i) => `<filament id="${i + 1}" type="${m.type}" color="${m.color}FF" used_m="${(m.grams / 3).toFixed(2)}" used_g="${m.grams.toFixed(2)}"/>`).join('\n')}
</plate></config>`;
  const settings = JSON.stringify({ printer_model: printerModel, layer_height: '0.2', filament_type: materials.map((m) => m.type), filament_colour: materials.map((m) => m.color) });
  const plateGcode = `; HEADER_BLOCK_START\n; generated by BambuStudio 02.03.00\n; total layer number: ${layers}\n; HEADER_BLOCK_END\n; Demo-Datei von PrintDock\nG28\n`;
  return zip([
    { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>') },
    { name: '3D/3dmodel.model', data: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources/><build/></model>') },
    { name: 'Metadata/plate_1.gcode', data: Buffer.from(plateGcode) },
    { name: 'Metadata/slice_info.config', data: Buffer.from(sliceInfo) },
    { name: 'Metadata/project_settings.config', data: Buffer.from(settings) },
    ...(thumb ? [{ name: 'Metadata/plate_1.png', data: thumb }] : []),
  ]);
}

/** Einfaches STL (Würfel) als unbearbeitetes Modell. */
function stl(name = 'demo') {
  return Buffer.from(`solid ${name}\nendsolid ${name}\n`);
}

module.exports = { thumbnail, gcode, project3mf, stl, png };
