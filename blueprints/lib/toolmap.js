// Werkzeuge in einer G-code-Datei umnummerieren – für Drucker ohne eigene Filament-Zuordnung
// (Klipper/Moonraker, OctoPrint). Beispiel: Im Slice ist Rot T0, im Drucker liegt Rot aber in T2
// → toolMap [2, …]: aus T0 wird T2. Die Zuordnung gilt gleichzeitig (Tauschen T0↔T1 geht).
//
// Ersetzt werden:
//   T<n> als eigener Befehl (Werkzeugwechsel)
//   T<n>-Parameter in M104/M109/M106/M107/M108/M217/M218/M221/M568 (Temperatur, Lüfter, Fluss je Werkzeug)
//   EXTRUDER=extruder / extruder<n> in Klipper-Befehlen (z. B. ACTIVATE_EXTRUDER)
//   TOOL=<n> / T=<n> in Makro-Aufrufen (z. B. Snapmaker, ACE-Treiber)
// Kommentare (; …) bleiben unverändert.

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const PARAM_CMDS = /^(M10[4-9]|M217|M218|M221|M568)\b/i;

/** Ist die Zuordnung überhaupt eine Änderung? */
function isIdentity(map) {
  return !map.some((v, i) => v != null && v !== i);
}

function remapLine(line, map) {
  const semi = line.indexOf(';');
  const code = semi >= 0 ? line.slice(0, semi) : line;
  const rest = semi >= 0 ? line.slice(semi) : '';
  if (!code.trim()) return line;
  const to = (n) => {
    const v = map[Number(n)];
    return v == null ? Number(n) : v;
  };
  let out = code;
  const trimmed = code.trimStart();
  // Werkzeugwechsel „T1“ (auch „T1 ; Kommentar“ oder „T1 S1“)
  const tc = /^(\s*)T(\d+)(\b.*)$/i.exec(code);
  if (tc) out = `${tc[1]}T${to(tc[2])}${tc[3]}`;
  else if (PARAM_CMDS.test(trimmed)) out = code.replace(/(\s)T(\d+)\b/gi, (_, sp, n) => `${sp}T${to(n)}`);
  // Klipper: EXTRUDER=extruder, extruder1, …
  out = out.replace(/\bEXTRUDER=extruder(\d*)\b/gi, (_, n) => {
    const v = to(n === '' ? 0 : n);
    return `EXTRUDER=extruder${v === 0 ? '' : v}`;
  });
  // Makros: TOOL=1 / T=1
  out = out.replace(/\b(TOOL|T)=(\d+)\b/g, (_, k, n) => `${k}=${to(n)}`);
  return out + rest;
}

/** Datei Zeile für Zeile umschreiben, Ergebnis als temporäre Datei. Gibt den Pfad zurück. */
async function remapFile(src, map, tmpDir) {
  fs.mkdirSync(tmpDir, { recursive: true });
  const dst = path.join(tmpDir, `remap-${Date.now()}-${path.basename(src)}`);
  const out = fs.createWriteStream(dst);
  const rl = readline.createInterface({ input: fs.createReadStream(src), crlfDelay: Infinity });
  let count = 0;
  for await (const line of rl) {
    const nl = remapLine(line, map);
    if (nl !== line) count++;
    if (!out.write(`${nl}\n`)) await new Promise((r) => out.once('drain', r));
  }
  await new Promise((r, j) => out.end((err) => (err ? j(err) : r())));
  return { path: dst, changed: count };
}

module.exports = { remapLine, remapFile, isIdentity };
