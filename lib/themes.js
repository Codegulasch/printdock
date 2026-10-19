// Eigenes Erscheinungsbild: Theme-Pakete (Zip) mit Farben, Logo, Schriften und etwas CSS.
// Die Pakete liegen im Datenordner (data/themes/<id>/) – sie überstehen Updates und landen in der Sicherung.
// Aufbau und Beispiel: docs/themes.md

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DATA_DIR } = require('./store');
const { openZip } = require('./zip');

const DIR = path.join(DATA_DIR, 'themes');
const httpError = (status, message) => Object.assign(new Error(message), { status });

const MAX_ZIP = 8 * 1024 * 1024;
const MAX_FILE = 3 * 1024 * 1024;
const ALLOWED = /^(theme\.json|theme\.css|[\w.-]+\.(svg|png|webp|woff2|woff|txt|md))$/i;
const COLOR = /^#[0-9a-fA-F]{6}$/;

// Farbnamen in theme.json → CSS-Variablen von PrintDock
const TOKENS = {
  bg: '--bg', panel: '--panel', panel2: '--panel2', ink: '--ink', muted: '--muted', line: '--line',
  run: '--run', runBg: '--run-bg', fault: '--fault', faultBg: '--fault-bg', warn: '--warn', warnBg: '--warn-bg', warnInk: '--warn-ink',
  pause: '--pause', pauseBg: '--pause-bg', btn: '--btn', btnInk: '--btn-ink', stripe: '--stripe',
  stFree: '--st-free', stRun: '--st-run', stRun2: '--st-run2', stWait: '--st-wait', stFault: '--st-fault', stOff: '--st-off',
};

const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const cssStr = (s) => `"${String(s).replace(/["\\\n\r]/g, '')}"`;
const fontStack = (fam, fallback) => (fam ? `${cssStr(fam)},${fallback}` : null);

function readMeta(id) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(DIR, id, 'theme.json'), 'utf8'));
    return m && typeof m === 'object' ? m : null;
  } catch {
    return null;
  }
}

/** Installierte Themes: [{ id, name, version, logo, favicon, brand }] */
function list() {
  let ids = [];
  try { ids = fs.readdirSync(DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { /* noch keine */ }
  return ids.map((id) => {
    const m = readMeta(id);
    if (!m) return null;
    const b = m.brand || {};
    const stamp = Math.round(fs.statSync(path.join(DIR, id, 'theme.json')).mtimeMs);
    const file = (f) => (f && fs.existsSync(path.join(DIR, id, f)) ? `themes/${id}/${f}?v=${stamp}` : null);
    return {
      id, name: String(m.name || id).slice(0, 60), version: String(m.version || '').slice(0, 20), stamp,
      brand: { text: String(b.text || m.name || '').slice(0, 40), accentText: String(b.accentText || '').slice(0, 40), sub: String(b.sub || '').slice(0, 40), title: String(b.title || m.name || '').slice(0, 60) },
      logo: file(b.logo), favicon: file(b.favicon || b.logo), themeColor: { light: m.light?.bg || null, dark: m.dark?.bg || null },
      css: `themes/${id}/theme.css?v=${stamp}`,
    };
  }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}

const exists = (id) => list().some((x) => x.id === id);

/** Zip prüfen und installieren (ersetzt ein Theme gleichen Namens) */
function install(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw httpError(400, 'Keine Datei erhalten');
  if (buf.length > MAX_ZIP) throw httpError(413, 'Theme-Paket ist zu groß (höchstens 8 MB)');
  const tmp = path.join(os.tmpdir(), `pd-theme-${process.pid}-${Date.now()}.zip`);
  fs.writeFileSync(tmp, buf);
  let z;
  try {
    try { z = openZip(tmp); } catch { throw httpError(400, 'Keine gültige Zip-Datei'); }
    // Dateien dürfen direkt im Zip oder in genau einem Ordner liegen
    const entries = z.entries.filter((e) => !e.name.endsWith('/') && !/(^|\/)(__MACOSX|\.)/.test(e.name));
    const jsonEntry = entries.find((e) => /(^|\/)theme\.json$/i.test(e.name));
    if (!jsonEntry) throw httpError(400, 'Im Paket fehlt die Datei theme.json');
    const prefix = jsonEntry.name.slice(0, jsonEntry.name.length - 'theme.json'.length);
    let meta;
    try { meta = JSON.parse(z.read(jsonEntry, MAX_FILE).toString('utf8')); } catch { throw httpError(400, 'theme.json ist kein gültiges JSON'); }
    const id = slug(meta.id || meta.name);
    if (!id || id === 'printdock') throw httpError(400, 'theme.json braucht einen Namen ("name")');
    const files = [];
    for (const e of entries) {
      if (!e.name.startsWith(prefix)) continue;
      const rel = e.name.slice(prefix.length);
      if (rel.includes('/') || !ALLOWED.test(rel)) continue; // nur erlaubte Dateien, keine Unterordner
      if (e.size > MAX_FILE) throw httpError(413, `${rel} ist zu groß (höchstens 3 MB)`);
      files.push([rel, z.read(e, MAX_FILE)]);
    }
    const target = path.join(DIR, id);
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    for (const [rel, data] of files) fs.writeFileSync(path.join(target, rel), data);
    return list().find((x) => x.id === id);
  } finally {
    z?.close();
    fs.rmSync(tmp, { force: true });
  }
}

function remove(id) {
  const target = path.join(DIR, slug(id));
  if (!slug(id) || !fs.existsSync(target)) throw httpError(404, 'Theme nicht gefunden');
  fs.rmSync(target, { recursive: true, force: true });
}

function tokenBlock(colors = {}, dark = false) {
  const out = [];
  for (const [k, v] of Object.entries(TOKENS)) if (COLOR.test(colors[k] || '')) out.push(`${v}:${colors[k]}`);
  const a = colors.accent, ab = colors.accentBg, ai = colors.accentInk;
  if (dark) {
    if (COLOR.test(a || '')) out.push(`--a2:${a}`);
    if (COLOR.test(ab || '')) out.push(`--a2bg:${ab}`);
    if (COLOR.test(ai || '')) out.push(`--a2ink:${ai}`);
  } else {
    if (COLOR.test(a || '')) out.push(`--a1:${a}`);
    if (COLOR.test(ab || '')) out.push(`--a1bg:${ab}`);
    if (COLOR.test(ai || '')) out.push(`--accent-ink:${ai}`);
  }
  return out.join(';');
}

/** Stylesheet des Themes: Schriften, Farben (hell/dunkel), Formen – dazu theme.css aus dem Paket */
function css(id) {
  const m = readMeta(slug(id));
  if (!m) throw httpError(404, 'Theme nicht gefunden');
  const dir = path.join(DIR, slug(id));
  const parts = [`/* Theme „${String(m.name || id).replace(/\*\//g, '')}“ – erzeugt von PrintDock aus theme.json */`];
  for (const f of Array.isArray(m.fonts) ? m.fonts.slice(0, 12) : []) {
    if (!f?.family || !/^[\w.-]+\.(woff2|woff)$/i.test(f.file || '') || !fs.existsSync(path.join(dir, f.file))) continue;
    parts.push(`@font-face{font-family:${cssStr(f.family)};font-style:${f.style === 'italic' ? 'italic' : 'normal'};font-display:swap;font-weight:${/^[\d ]+$/.test(String(f.weight || '')) ? f.weight : 400};${/^[\d% ]+$/.test(String(f.stretch || '')) ? `font-stretch:${f.stretch};` : ''}src:url(${encodeURI(f.file)}) format("${/woff2$/i.test(f.file) ? 'woff2' : 'woff'}")}`);
  }
  const fonts = m.fontFamilies || {};
  const vars = [tokenBlock(m.light)];
  const body = fontStack(fonts.body, 'system-ui,-apple-system,"Segoe UI",sans-serif');
  const head = fontStack(fonts.heading, 'system-ui,sans-serif');
  const mono = fontStack(fonts.mono, 'ui-monospace,Menlo,Consolas,monospace');
  if (body) vars.push(`--body:${body}`);
  if (head) vars.push(`--cond:${head}`);
  if (mono) vars.push(`--mono:${mono}`);
  const h = m.headings || {};
  if (/^\d{2,3}%$/.test(String(h.stretch || ''))) vars.push(`--th-head-stretch:${h.stretch}`);
  if (/^\d{3}$/.test(String(h.weight || ''))) vars.push(`--th-head-weight:${h.weight}`);
  if (/^-?[\d.]+em$/.test(String(h.letterSpacing || ''))) vars.push(`--th-head-ls:${h.letterSpacing}`);
  if (/^[\d.]+(rem|px)$/.test(String(m.radius || ''))) vars.push(`--th-radius:${m.radius}`);
  parts.push(`:root[data-skin="custom"]{${vars.filter(Boolean).join(';')}}`);
  if (m.dark) {
    const d = tokenBlock(m.dark, true);
    parts.push(`@media (prefers-color-scheme:dark){:root[data-skin="custom"]:not([data-theme="light"]){${d}}}`);
    parts.push(`:root[data-skin="custom"][data-theme="dark"]{${d}}`);
  }
  try {
    const own = fs.readFileSync(path.join(dir, 'theme.css'), 'utf8');
    parts.push('/* theme.css aus dem Paket */', own.slice(0, 200_000));
  } catch { /* optional */ }
  return parts.join('\n');
}

/** Datei aus einem Theme-Ordner (Logo, Schrift) – nur erlaubte Namen */
function file(id, name) {
  const s = slug(id);
  if (!s || !ALLOWED.test(name || '') || name === 'theme.json') return null;
  const f = path.join(DIR, s, name);
  return fs.existsSync(f) ? f : null;
}

module.exports = { list, exists, install, remove, css, file, DIR };
