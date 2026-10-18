#!/usr/bin/env node
'use strict';
/*
  PrintDock Slicer-Helfer
  ───────────────────────
  Läuft auf dem PC, auf dem OrcaSlicer installiert ist. Holt Umslice-Aufträge von PrintDock,
  slict sie mit OrcaSlicer auf der Kommandozeile und lädt das Ergebnis als Variante hoch.

  Start:   printdock-slicer            (fragt beim ersten Mal nach Adresse und Kopplungscode)
           node printdock-slicer.js --url http://homeassistant.local:3080 --code <Kopplungscode>
  Optionen:
    --url <Adresse>      PrintDock-Adresse (wie im Browser, ohne /ingress)
    --code <Code>        Kopplungscode aus PrintDock → Einstellungen → Umslicen
    --orca <Pfad>        OrcaSlicer-Programm, falls es nicht gefunden wird
    --profiles <Ordner>  Ordner mit Orca-Systemprofilen (…/resources/profiles), falls nicht gefunden
    --reset              gespeicherte Einstellungen vergessen
    --once               nur einen Auftrag abarbeiten (zum Testen)
  Braucht nur Node.js ≥ 18 – oder die fertige Programmdatei aus den GitHub-Releases.
*/

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');

const VERSION = '0.21.2';
const POLL_MS = 3000;
const SLICE_TIMEOUT_MS = 20 * 60 * 1000;

// ------------------------------------------------------------------ Texte

let LANG = /^de/i.test(Intl.DateTimeFormat().resolvedOptions().locale || process.env.LANG || '') ? 'de' : 'en';
const T = {
  title: ['PrintDock Slicer-Helfer', 'PrintDock slicer helper'],
  askUrl: ['PrintDock-Adresse (z. B. http://homeassistant.local:3080): ', 'PrintDock address (e.g. http://homeassistant.local:3080): '],
  askCode: ['Kopplungscode (PrintDock → Einstellungen → Umslicen): ', 'Pairing code (PrintDock → Settings → Reslicing): '],
  noOrca: ['OrcaSlicer nicht gefunden. Bitte installieren (https://github.com/SoftFever/OrcaSlicer/releases) oder den Pfad mit --orca angeben.', 'OrcaSlicer not found. Please install it (https://github.com/SoftFever/OrcaSlicer/releases) or pass the path with --orca.'],
  orca: ['OrcaSlicer: {p}', 'OrcaSlicer: {p}'],
  profiles: ['Orca-Profile: {n} gefunden', 'Orca profiles: {n} found'],
  noProfiles: ['Orca-Systemprofile nicht gefunden – es gehen nur gelernte Profile (OrcaSlicer einmal starten oder --profiles angeben).', 'Orca system profiles not found – only learned profiles will work (start OrcaSlicer once or pass --profiles).'],
  connected: ['Verbunden mit PrintDock ({u}) – warte auf Aufträge …', 'Connected to PrintDock ({u}) – waiting for jobs …'],
  lost: ['Keine Verbindung zu PrintDock ({e}) – versuche es weiter …', 'No connection to PrintDock ({e}) – retrying …'],
  badCode: ['Der Kopplungscode passt nicht. Neu eingeben mit --reset.', 'The pairing code does not match. Re-enter with --reset.'],
  disabled: ['Umslicen ist in PrintDock ausgeschaltet – warte …', 'Reslicing is switched off in PrintDock – waiting …'],
  job: ['▶ {part} für {printer}', '▶ {part} for {printer}'],
  attempt: ['  Versuch {n}: {l}', '  Attempt {n}: {l}'],
  ok: ['  ✓ fertig: {f}', '  ✓ done: {f}'],
  fail: ['  ✗ {e}', '  ✗ {e}'],
  saved: ['Einstellungen gespeichert: {p}', 'Settings saved: {p}'],
};
const t = (k, v = {}) => String(T[k][LANG === 'de' ? 0 : 1]).replace(/\{(\w+)\}/g, (_, x) => (v[x] ?? ''));
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

// ------------------------------------------------------------------ Einstellungen

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const k = a.slice(2);
  const next = process.argv[i + 1];
  if (next && !next.startsWith('--')) {
    args[k] = next;
    i++;
  } else args[k] = true;
}

function configDir() {
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'PrintDock');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'PrintDock');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'printdock');
}
const CONFIG_FILE = path.join(configDir(), 'slicer-helper.json');
let cfg = {};
try {
  cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
} catch {
  cfg = {};
}
if (args.reset) cfg = {};
cfg.id ??= `${os.hostname().replace(/[^\w.-]/g, '').slice(0, 30) || 'pc'}-${crypto.randomBytes(3).toString('hex')}`;
function saveConfig() {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(q, (a) => (rl.close(), resolve(a.trim()))));
}

// ------------------------------------------------------------------ OrcaSlicer finden

function exists(p) {
  try {
    return Boolean(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
function isDir(p) {
  try {
    return Boolean(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
function which(cmd) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
}

function findOrca() {
  const home = os.homedir();
  const c = [];
  if (args.orca) c.push(String(args.orca));
  if (cfg.orca) c.push(cfg.orca);
  if (process.platform === 'win32') {
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]) {
      if (base) c.push(path.join(base, 'OrcaSlicer', 'orca-slicer.exe'));
    }
  } else if (process.platform === 'darwin') {
    c.push('/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer', path.join(home, 'Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer'));
  } else {
    c.push(which('orca-slicer'), which('OrcaSlicer'), '/usr/bin/orca-slicer', '/opt/OrcaSlicer/bin/orca-slicer');
    for (const dir of [home, path.join(home, 'Applications'), path.join(home, 'Downloads'), path.join(home, 'bin')]) {
      try {
        for (const f of fs.readdirSync(dir)) if (/^OrcaSlicer.*\.AppImage$/i.test(f)) c.push(path.join(dir, f));
      } catch {
        /* Ordner fehlt */
      }
    }
  }
  return c.find(exists) || null;
}

function profileDirs(orca) {
  const home = os.homedir();
  const dirs = [];
  if (args.profiles) dirs.push(String(args.profiles));
  // Orca kopiert die Systemprofile in den eigenen Datenordner (aktuellster Stand nach Profil-Updates)
  if (process.platform === 'win32') dirs.push(path.join(process.env.APPDATA || '', 'OrcaSlicer', 'system'));
  else if (process.platform === 'darwin') dirs.push(path.join(home, 'Library/Application Support/OrcaSlicer/system'));
  else dirs.push(path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'OrcaSlicer', 'system'), path.join(home, '.var/app/io.github.softfever.OrcaSlicer/config/OrcaSlicer/system'));
  if (orca) {
    const ex = path.dirname(orca);
    dirs.push(path.join(ex, 'resources', 'profiles'), path.join(ex, '..', 'Resources', 'profiles'), path.join(ex, '..', 'share', 'OrcaSlicer', 'profiles'), path.join(ex, '..', 'resources', 'profiles'));
  }
  return dirs.filter(isDir);
}

function orcaVersion(orca) {
  if (process.platform === 'darwin') {
    try {
      const plist = fs.readFileSync(path.join(path.dirname(orca), '..', 'Info.plist'), 'utf8');
      const m = plist.match(/CFBundleShortVersionString<\/key>\s*<string>([^<]+)/);
      if (m) return m[1];
    } catch {
      /* egal */
    }
  }
  try {
    const r = spawnSync(orca, ['--help'], { encoding: 'utf8', timeout: 30000, windowsHide: true });
    const m = `${r.stdout || ''}${r.stderr || ''}`.match(/OrcaSlicer[- ]v?(\d+\.\d+\.\d+[\w.-]*)/i);
    if (m) return m[1];
  } catch {
    /* egal */
  }
  return null;
}

// ------------------------------------------------------------------ Orca-Systemprofile

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const first = (v) => (Array.isArray(v) ? v[0] : v);
let INDEX = null; // name → [{ file, vendor, type, data }]

function walk(dir, out) {
  let ents = [];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.json')) out.push(p);
  }
}

function buildIndex(dirs) {
  const byName = new Map();
  let n = 0;
  // spätere Ordner zuerst, damit der Orca-Datenordner (vorne) gewinnt
  for (const root of dirs.slice().reverse()) {
    let vendors = [];
    try {
      vendors = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      continue;
    }
    for (const vendor of vendors) {
      const list = [];
      walk(path.join(root, vendor), list);
      for (const file of list) {
        let data;
        try {
          data = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch {
          continue;
        }
        if (!data || !data.name || !['machine', 'process', 'filament'].includes(data.type)) continue;
        const arr = byName.get(data.name) || [];
        const i = arr.findIndex((x) => x.vendor === vendor);
        const ent = { file, vendor, type: data.type, data };
        if (i >= 0) arr[i] = ent;
        else arr.push(ent);
        byName.set(data.name, arr);
        n++;
      }
    }
  }
  return { byName, count: n };
}

function lookup(name, vendor) {
  const arr = INDEX?.byName.get(name) || [];
  return arr.find((x) => x.vendor === vendor) || arr.find((x) => x.vendor === 'OrcaFilamentLibrary') || arr[0] || null;
}

function flatten(ent, seen = new Set()) {
  if (!ent || seen.has(ent.file)) return {};
  seen.add(ent.file);
  const own = { ...ent.data };
  const parent = own.inherits ? lookup(own.inherits, ent.vendor) : null;
  const base = parent ? flatten(parent, seen) : {};
  return { ...base, ...own };
}

const instantiable = (e) => String(e.data.instantiation ?? 'true') !== 'false';
function all(type) {
  const out = [];
  for (const arr of INDEX?.byName.values() || []) for (const e of arr) if (e.type === type && instantiable(e)) out.push(e);
  return out;
}

function toUserPreset(flat, type, name, overlay = {}) {
  const p = { ...flat, ...overlay, type, from: 'User', name, inherits: '' };
  delete p.instantiation;
  delete p.setting_id;
  if (type !== 'machine') {
    p.compatible_printers = [];
    p.compatible_printers_condition = '';
  }
  return p;
}

function systemMachine({ model, nozzle }) {
  const want = norm(model);
  const cands = all('machine').map((e) => ({ e, f: flatten(e) })).filter(({ f }) => {
    const pm = norm(f.printer_model);
    return pm && want && (pm === want || pm.includes(want) || want.includes(pm));
  });
  if (!cands.length) throw new Error(`Orca kennt den Drucker „${model}“ nicht`);
  const score = ({ f }) => (norm(f.printer_model) === want ? 0 : norm(f.printer_model).length) * 10 + (Math.abs(Number(first(f.nozzle_diameter)) - Number(nozzle || 0.4)) < 0.001 ? 0 : 5);
  cands.sort((a, b) => score(a) - score(b));
  return { name: cands[0].e.data.name, flat: cands[0].f };
}

function systemProcess(machineName, machineFlat, { layerHeight }) {
  let cands = all('process').filter((e) => {
    const f = flatten(e);
    return Array.isArray(f.compatible_printers) && f.compatible_printers.includes(machineName);
  });
  if (!cands.length) {
    const pm = norm(machineFlat.printer_model);
    cands = all('process').filter((e) => norm(flatten(e).compatible_printers_condition).includes(pm));
  }
  if (!cands.length) throw new Error(`Kein Orca-Druckprofil für „${machineName}“`);
  const lh = Number(layerHeight) || 0.2;
  const score = (e) => {
    const f = flatten(e);
    return Math.abs(Number(f.layer_height) - lh) * 100 + (/standard/i.test(e.data.name) ? 0 : 1);
  };
  cands.sort((a, b) => score(a) - score(b));
  return flatten(cands[0]);
}

function systemFilament(machineName, { type }) {
  const want = String(type || 'PLA').toUpperCase();
  const typed = all('filament').map((e) => ({ e, f: flatten(e) })).filter(({ f }) => String(first(f.filament_type) || '').toUpperCase() === want);
  const forMachine = typed.filter(({ f }) => Array.isArray(f.compatible_printers) && f.compatible_printers.includes(machineName));
  const universal = typed.filter(({ f }) => !f.compatible_printers?.length && !f.compatible_printers_condition);
  const isGeneric = (x) => /generic/i.test(x.e.data.name);
  const byLen = (a, b) => a.e.data.name.length - b.e.data.name.length;
  // Reihenfolge: Generic für diesen Drucker → Generic für alle → Markenprofil für diesen Drucker → irgendeins
  const pick = [forMachine.filter(isGeneric), universal.filter(isGeneric), forMachine, universal].find((x) => x.length);
  if (!pick) throw new Error(`Kein Orca-Filamentprofil für ${want}`);
  return pick.sort(byLen)[0].f;
}

/** Profile eines Versuchs in Dateien schreiben → { machine, process, filaments[] } (Pfade) */
function preparePresets(attempt, dir) {
  const write = (name, obj) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, JSON.stringify(obj, null, 1));
    return p;
  };
  let machine;
  let machineName;
  let machineFlat;
  if (attempt.machine.system) {
    const m = systemMachine(attempt.machine.system);
    machineName = m.name;
    machineFlat = m.flat;
    machine = toUserPreset(m.flat, 'machine', `PrintDock ${m.name}`);
  } else {
    machine = attempt.machine;
    machineName = machine.name;
    machineFlat = machine;
  }
  let process_;
  if (attempt.process.system) {
    const flat = systemProcess(machineName, machineFlat, attempt.process.system);
    process_ = toUserPreset(flat, 'process', attempt.process.name || 'PrintDock Prozess', attempt.process.overlay || {});
  } else process_ = attempt.process;
  const fils = attempt.filaments.map((f, i) => (f.system ? toUserPreset(systemFilament(machineName, f.system), 'filament', `PrintDock ${f.system.type} ${i + 1}`) : f));
  return {
    machine: write('machine.json', machine),
    process: write('process.json', process_),
    filaments: fils.map((f, i) => write(`filament_${i + 1}.json`, f)),
  };
}

// ------------------------------------------------------------------ ZIP (Platte aus der 3MF holen)

function zipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return [];
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    out.push({
      name,
      read() {
        const start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
        const raw = buf.subarray(start, start + compSize);
        return method === 0 ? raw : zlib.inflateRawSync(raw);
      },
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ------------------------------------------------------------------ PrintDock-Verbindung

let BASE = '';
async function call(pathname, { method = 'GET', body = null, raw = false, headers = {} } = {}) {
  const url = `${BASE}${pathname}${pathname.includes('?') ? '&' : '?'}id=${encodeURIComponent(cfg.id)}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${cfg.code}`, ...(body && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? (Buffer.isBuffer(body) ? body : JSON.stringify(body)) : undefined,
  });
  if (res.status === 403) {
    const e = new Error(t('badCode'));
    e.fatal = true;
    throw e;
  }
  if (raw) {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ------------------------------------------------------------------ Slicen

function normCode(code) {
  if (code == null) return null;
  if (code > 0x7fffffff) return code - 0x100000000; // Windows
  if (process.platform !== 'win32' && code > 127) return code - 256; // Linux/macOS
  return code;
}

function runOrca(orca, argv, cwd) {
  return new Promise((resolve) => {
    const child = spawn(orca, argv, { cwd, windowsHide: true, env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: process.env.APPIMAGE_EXTRACT_AND_RUN || '1' } });
    let out = '';
    const keep = (c) => {
      out += c.toString();
      if (out.length > 200000) out = out.slice(-100000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => child.kill(), SLICE_TIMEOUT_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: null, out: `${out}\n${err.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: normCode(code), out });
    });
  });
}

let optionalFlags = true;
async function sliceJob(orca, job) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printdock-slice-'));
  try {
    const src = await call(`/helper/jobs/${job.id}/source`, { raw: true });
    const ext = String(job.source.name).toLowerCase().endsWith('.gcode.3mf') ? '3mf' : job.source.ext;
    const input = path.join(dir, `source.${ext}`);
    fs.writeFileSync(input, src);
    let last = null;
    for (let i = 0; i < job.attempts.length; i++) {
      const a = job.attempts[i];
      log(t('attempt', { n: i + 1, l: a.label }));
      const adir = path.join(dir, `a${i + 1}`);
      const outDir = path.join(adir, 'out');
      fs.mkdirSync(outDir, { recursive: true });
      let presets;
      try {
        presets = preparePresets(a, adir);
      } catch (err) {
        last = { code: null, message: err.message, log: '', attempt: a.label };
        log(t('fail', { e: err.message }));
        continue;
      }
      const base = ['--slice', String(job.plate || 1), '--arrange', '1', '--load-settings', `${presets.machine};${presets.process}`, '--load-filaments', presets.filaments.join(';'), '--outputdir', outDir, '--export-3mf', 'result.3mf'];
      const opt = ['--allow-newer-file', '--debug', '2', ...(job.bedType ? ['--curr-bed-type', job.bedType] : [])];
      let r = await runOrca(orca, [...base, ...(optionalFlags ? opt : []), input], adir);
      if (r.code === -2 && optionalFlags) {
        optionalFlags = false; // ältere Orca-Version: ohne Zusatzoptionen
        r = await runOrca(orca, [...base, input], adir);
      }
      const gcodeFile = path.join(outDir, `plate_${job.plate || 1}.gcode`);
      const threemf = path.join(outDir, 'result.3mf');
      let result = null;
      if (job.output === '3mf') {
        if (exists(threemf) && zipEntries(fs.readFileSync(threemf)).some((e) => /^Metadata\/plate_\d+\.gcode$/i.test(e.name))) result = fs.readFileSync(threemf);
      } else if (exists(gcodeFile)) {
        result = fs.readFileSync(gcodeFile);
      } else if (exists(threemf)) {
        const e = zipEntries(fs.readFileSync(threemf)).find((x) => /^Metadata\/plate_\d+\.gcode$/i.test(x.name));
        if (e) result = e.read();
      }
      if (r.code === 0 && result?.length) {
        await call(`/helper/jobs/${job.id}/result?name=${encodeURIComponent(job.outputName)}&attempt=${encodeURIComponent(a.label)}`, { method: 'POST', body: result, headers: { 'Content-Type': 'application/octet-stream' } });
        log(t('ok', { f: job.outputName }));
        return;
      }
      const tail = r.out.split(/\r?\n/).filter((l) => /error|fail|exception|invalid|not /i.test(l)).slice(-15).join('\n') || r.out.slice(-3000);
      last = { code: r.code, message: null, log: tail, attempt: a.label };
      log(t('fail', { e: `Orca ${r.code}` }));
      // Modell/Platte grundsätzlich nicht slicebar → weitere Profile helfen nicht
      if ([-3, -6, -50, -52, -59, -21].includes(r.code)) break;
    }
    await call(`/helper/jobs/${job.id}/fail`, { method: 'POST', body: last || { message: 'Slicen fehlgeschlagen' } });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ Start

async function main() {
  console.log(`\n${t('title')} ${VERSION}\n`);
  let changed = false;
  if (args.url) (cfg.url = String(args.url)), (changed = true);
  if (args.code) (cfg.code = String(args.code)), (changed = true);
  if (!cfg.url) (cfg.url = await ask(t('askUrl'))), (changed = true);
  if (!cfg.code) (cfg.code = await ask(t('askCode'))), (changed = true);
  cfg.url = cfg.url.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(cfg.url)) cfg.url = `http://${cfg.url}`;
  BASE = cfg.url;

  const orca = findOrca();
  if (!orca) {
    console.error(t('noOrca'));
    await ask('');
    process.exit(1);
  }
  if (args.orca) (cfg.orca = orca), (changed = true);
  if (changed || args.reset) {
    saveConfig();
    log(t('saved', { p: CONFIG_FILE }));
  }
  const version = orcaVersion(orca);
  log(t('orca', { p: `${orca}${version ? ` (${version})` : ''}` }));
  const dirs = profileDirs(orca);
  INDEX = buildIndex(dirs);
  if (INDEX.count) log(t('profiles', { n: INDEX.count }));
  else log(t('noProfiles'));
  const models = [...new Set(all('machine').map((e) => flatten(e).printer_model).filter(Boolean))];

  let online = false;
  let disabledShown = false;
  let lastHello = 0;
  for (;;) {
    try {
      if (!online || Date.now() - lastHello > 10 * 60 * 1000) {
        const h = await call('/helper/hello', { method: 'POST', body: { name: os.hostname(), os: `${process.platform} ${os.release()}`, version: VERSION, orca: { path: orca, version, ok: true, profiles: INDEX.count }, models } });
        if (h.lang) LANG = h.lang;
        lastHello = Date.now();
        if (!online) log(t('connected', { u: BASE }));
        online = true;
      }
      const r = await call('/helper/poll');
      if (r.enabled === false) {
        if (!disabledShown) log(t('disabled'));
        disabledShown = true;
      } else disabledShown = false;
      if (r.job) {
        log(t('job', { part: r.job.part, printer: r.job.printer.name }));
        await sliceJob(orca, r.job).catch((err) => {
          log(t('fail', { e: err.message }));
          return call(`/helper/jobs/${r.job.id}/fail`, { method: 'POST', body: { message: err.message } }).catch(() => {});
        });
        if (args.once) process.exit(0);
        continue;
      }
    } catch (err) {
      if (err.fatal) {
        console.error(err.message);
        await ask('');
        process.exit(2);
      }
      if (online || !lastHello) log(t('lost', { e: err.cause?.code || err.message }));
      online = false;
      lastHello = lastHello || 1;
      await new Promise((r) => setTimeout(r, 10000));
      continue;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

if (require.main === module || !module.parent) main();
module.exports = { buildIndex, flatten, systemMachine, systemProcess, systemFilament, preparePresets, zipEntries, normCode, _setIndex: (i) => (INDEX = i) };
