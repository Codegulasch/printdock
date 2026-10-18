// Farben: Abstand zweier Farbtöne und ein passender Name für die Spule.
// Namen sind deutsche Schlüssel; die Oberfläche übersetzt sie.

const NAMED = [
  ['Schwarz', '#1C1C1C'], ['Dunkelgrau', '#4A4A4A'], ['Grau', '#8A8F98'], ['Hellgrau', '#C0C4C8'], ['Silber', '#A8A9AD'],
  ['Weiß', '#F4F4F4'], ['Natur', '#E8DFC8'], ['Beige', '#D8C3A5'], ['Braun', '#7A4E2D'], ['Gold', '#D4AF37'],
  ['Gelb', '#F5D33B'], ['Orange', '#F07D1A'], ['Rot', '#C8102E'], ['Dunkelrot', '#7F1D1D'], ['Pink', '#F06FA8'],
  ['Magenta', '#C2187A'], ['Violett', '#7C3AED'], ['Dunkelblau', '#1E3A8A'], ['Blau', '#2F6FDE'], ['Hellblau', '#7CC3F0'],
  ['Türkis', '#22B8B0'], ['Dunkelgrün', '#1F5F3A'], ['Grün', '#2E9E4F'], ['Hellgrün', '#8BD45A'], ['Oliv', '#7A7A32'],
];

function rgb(hex) {
  const m = String(hex || '').replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

/** Wahrnehmungsnaher Abstand (gewichtetes RGB), 0 = gleich, ~765 = maximal. */
function distance(a, b) {
  const x = rgb(a);
  const y = rgb(b);
  if (!x || !y) return Infinity;
  const r = (x[0] + y[0]) / 2;
  const dr = x[0] - y[0];
  const dg = x[1] - y[1];
  const db = x[2] - y[2];
  return Math.sqrt((2 + r / 256) * dr * dr + 4 * dg * dg + (2 + (255 - r) / 256) * db * db);
}

function nameOf(hex) {
  if (!rgb(hex)) return '';
  let best = null;
  for (const [name, h] of NAMED) {
    const d = distance(hex, h);
    if (!best || d < best.d) best = { name, d };
  }
  return best.name;
}

/** Farbe aus verschiedenen Formaten: [r,g,b], "RRGGBB", "#RRGGBBAA", ARGB-Zahl. */
function normalize(v) {
  if (Array.isArray(v) && v.length >= 3 && v.every((n) => Number.isFinite(Number(n)))) {
    return `#${v.slice(0, 3).map((n) => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return `#${((v >>> 0) & 0xffffff).toString(16).padStart(6, '0').toUpperCase()}`;
  const s = String(v ?? '').trim().replace(/^#|^0x/i, '');
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(s)) return `#${s.slice(0, 6).toUpperCase()}`;
  return null;
}

module.exports = { distance, nameOf, normalize, NAMED };
