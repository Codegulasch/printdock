// Umslicen: fehlende Varianten eines Teils mit OrcaSlicer erzeugen.
//
// Ablauf
//   1. Profile lernen: Lädt man eine 3MF hoch, die zu einem Drucker gehört (feste Drucker oder Druckermodell),
//      merkt sich PrintDock deren Einstellungen (Metadata/project_settings.config) – Drucker, Druckprofil
//      und je Material das Filamentprofil. Die neueste Datei gewinnt, Materialien sammeln sich.
//   2. Auftrag: „Für U1 slicen“ legt einen Auftrag an. Quelle ist eine Datei des Teils mit Modell
//      (Projekt-3MF, geslicte 3MF mit Modell oder STL/STEP/OBJ).
//   3. Helfer: ein kleines Programm auf dem PC (helper/printdock-slicer.js) fragt Aufträge ab, startet
//      OrcaSlicer auf der Kommandozeile und lädt das Ergebnis hoch. Es wird zur Variante für genau diesen Drucker.
//
// Profile: gelerntes Profil des Zieldruckers + „Absicht“ aus der Quelle (Schichthöhe, Wände, Füllung,
// Stützen, Brim …). Klappt das nicht, versucht der Helfer Orcas eigenes Druckerprofil, zuletzt nur
// Orca-Standardprofile. Ohne gelerntes Profil gleich die Standardprofile.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { store, DATA_DIR } = require('./store');
const files = require('./files');
const parts = require('./parts');
const { openZip } = require('./zip');
const KEYS = require('./orca-keys.json');

const PROFILE_DIR = path.join(DATA_DIR, 'reslice');
fs.mkdirSync(PROFILE_DIR, { recursive: true });

const db = store('reslice.json', {});
const d = db.data;
d.token ??= crypto.randomBytes(16).toString('hex');
d.helpers ??= {};
d.profiles ??= {};
d.jobs ??= [];
db.save();

const ONLINE_MS = 20000;
const RUN_TIMEOUT_MS = 25 * 60 * 1000;
const httpError = (status, message) => Object.assign(new Error(message), { status });
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const KEYSET = { print: new Set(KEYS.print), filament: new Set(KEYS.filament), printer: new Set(KEYS.printer) };

// Was aus der Quelle übernommen wird (die Absicht), der Rest kommt vom Zieldrucker
const INTENT = ['layer_height', 'wall_loops', 'top_shell_layers', 'bottom_shell_layers', 'top_shell_thickness', 'bottom_shell_thickness', 'sparse_infill_density', 'sparse_infill_pattern', 'top_surface_pattern', 'bottom_surface_pattern', 'enable_support', 'support_type', 'support_style', 'support_threshold_angle', 'support_on_build_plate_only', 'support_critical_regions_only', 'brim_type', 'brim_width', 'brim_object_gap', 'seam_position', 'ironing_type', 'fuzzy_skin', 'spiral_mode', 'print_sequence', 'wall_generator', 'only_one_wall_top', 'detect_thin_wall', 'infill_direction', 'raft_layers', 'wall_sequence'];

const MATERIALS = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PA', 'PC', 'PLA-CF', 'PETG-CF', 'PA-CF', 'PVA', 'HIPS'];

/** Meldungen zu den Fehlercodes von OrcaSlicer (Kommandozeile) */
const ERRORS = {
  '-2': 'OrcaSlicer kennt eine Option nicht – bitte OrcaSlicer aktualisieren',
  '-3': 'Die Quelldatei wurde nicht gefunden',
  '-5': 'Ein Profil konnte nicht gelesen werden',
  '-6': 'Die Quelldatei konnte nicht gelesen werden (Modell defekt oder Format unbekannt)',
  '-14': 'Zu wenig Arbeitsspeicher beim Slicen',
  '-15': 'Dieser Drucker wird für diese Datei nicht unterstützt',
  '-16': 'Der Drucker passt nicht zur 3MF',
  '-17': 'Druckprofil und Drucker passen nicht zusammen',
  '-18': 'Ungültige Werte in der 3MF',
  '-21': 'Die Teile ließen sich nicht auf der Platte anordnen – zu groß für diesen Drucker?',
  '-24': 'Die 3MF stammt aus einer neueren Slicer-Version – bitte OrcaSlicer aktualisieren',
  '-50': 'Nichts zu slicen: Platte leer oder Teil liegt außerhalb des Druckraums – zu groß für diesen Drucker?',
  '-51': 'Ungültige Slice-Einstellungen in der 3MF',
  '-52': 'Teile ragen über das Druckbett hinaus – zu groß für diesen Drucker',
  '-58': 'Slicen dauert zu lange',
  '-59': 'Modell zu fein (zu viele Dreiecke)',
  '-61': 'Filament passt nicht zur Druckplatte',
  '-62': 'Die Filamente haben zu unterschiedliche Temperaturen',
  '-63': 'Teile kollidieren beim Drucken Objekt für Objekt',
  '-64': 'Teile kollidieren',
  '-65': 'Vasenmodus geht mit diesen Einstellungen nicht',
  '-66': 'Die Farben lassen sich den Düsen/Werkzeugen nicht zuordnen – zu viele Farben für diesen Drucker?',
  '-67': 'Nur ein TPU-Filament je Druck möglich',
  '-68': 'Ein Filament kann auf der zugeordneten Düse nicht gedruckt werden',
  '-100': 'Slicen fehlgeschlagen',
  '-101': 'Kollisionen im G-code erkannt (z. B. Reinigungsturm zu nah an den Teilen)',
  '-102': 'G-code im nicht druckbaren Bereich',
};

let ctx = null;
/** ctx: { printers(), modelOf(p), moduleOn(name), broadcast(ev), lang() } */
function init(c) {
  ctx = c;
}
const on = () => Boolean(ctx?.moduleOn('reslice'));
const printers = () => ctx?.printers() || [];
const printerById = (id) => printers().find((p) => p.id === id) || null;

// ------------------------------------------------------------------ 3MF lesen

function readProjectConfig(zip) {
  const e = zip.find(/^Metadata\/project_settings\.config$/i);
  if (!e) return null;
  try {
    const cfg = JSON.parse(zip.read(e, 32 * 1024 * 1024).toString('utf8'));
    return cfg && typeof cfg === 'object' ? cfg : null;
  } catch {
    return null;
  }
}

function readApplication(zip) {
  const e = zip.find(/^3D\/3dmodel\.model$/i);
  if (!e) return null;
  const head = zip.read(e, 64 * 1024).toString('utf8');
  const m = head.match(/<metadata name="Application">([^<]*)<\/metadata>/i);
  return m ? m[1].trim().slice(0, 60) : null;
}

/** Enthält die Datei ein Modell (nicht nur G-code)? */
const geoCache = new Map();
async function hasModel(f) {
  if (!f) return false;
  if (['stl', 'obj', 'step', 'stp'].includes(f.ext)) return true;
  if (f.kind !== '3mf') return false;
  const key = `${f.id}:${f.hash || f.size}`;
  if (geoCache.has(key)) return geoCache.get(key);
  let yes = false;
  try {
    const zip = openZip(await files.localPath(f));
    try {
      if (zip.entries.some((e) => /^3D\/Objects\/.+\.model$/i.test(e.name) && e.size > 200)) yes = true;
      else {
        const e = zip.find(/^3D\/3dmodel\.model$/i);
        if (e) yes = /<mesh\b|<vertices\b/.test(zip.read(e, 4 * 1024 * 1024).toString('utf8'));
      }
    } finally {
      zip.close();
    }
  } catch {
    yes = false;
  }
  geoCache.set(key, yes);
  return yes;
}

async function configOf(f) {
  if (!f || f.kind !== '3mf') return null;
  try {
    const zip = openZip(await files.localPath(f));
    try {
      return { cfg: readProjectConfig(zip), app: readApplication(zip) };
    } finally {
      zip.close();
    }
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ Profile lernen

const profileFile = (pid) => path.join(PROFILE_DIR, `${pid.replace(/[^\w-]/g, '')}.json`);
function loadProfile(pid) {
  try {
    return JSON.parse(fs.readFileSync(profileFile(pid), 'utf8'));
  } catch {
    return null;
  }
}

const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const matKey = (t) => String(t || '').trim().toUpperCase();

/** Werte eines Filaments (Index j) aus der Projektdatei – Listen je Filament werden aufgeteilt */
function filamentValues(cfg, j) {
  const n = arr(cfg.filament_type).length || 1;
  const out = {};
  for (const k of KEYS.filament) {
    if (!(k in cfg) || k === 'inherits' || k.startsWith('compatible_')) continue;
    const v = cfg[k];
    if (Array.isArray(v) && v.length && v.length % n === 0) {
      const per = v.length / n;
      out[k] = v.slice(j * per, (j + 1) * per);
    } else out[k] = v;
  }
  return out;
}

function pick(cfg, set) {
  const out = {};
  for (const [k, v] of Object.entries(cfg || {})) if (set.has(k) && k !== 'inherits' && !k.startsWith('compatible_')) out[k] = v;
  return out;
}

/** Datei als Profil für ihre Drucker übernehmen (nach dem Hochladen bzw. Zuordnen) */
async function learn(fileId) {
  if (!on()) return [];
  const f = files.get(fileId);
  if (!f || f.kind !== '3mf' || f.source === 'reslice' || f.source === 'printer' || f.demo) return [];
  const targets = printers().filter((p) => parts.variantFits(f, p, ctx.modelOf(p)) === true);
  if (!targets.length) return [];
  const got = await configOf(f);
  if (!got?.cfg || !(got.cfg.printer_model || got.cfg.printer_settings_id)) return [];
  const { cfg, app } = got;
  const learned = [];
  for (const p of targets) {
    const prev = loadProfile(p.id);
    const fil = { ...(prev?.fil || {}) };
    arr(cfg.filament_type).forEach((type, j) => {
      if (type) fil[matKey(type)] = { ...filamentValues(cfg, j), _name: arr(cfg.filament_settings_id)[j] || type, _at: new Date().toISOString() };
    });
    fs.writeFileSync(profileFile(p.id), JSON.stringify({ cfg, fil }));
    d.profiles[p.id] = {
      fileId: f.id,
      fileName: f.name,
      at: new Date().toISOString(),
      app,
      printerModel: cfg.printer_model || null,
      printerPreset: cfg.printer_settings_id || null,
      processPreset: cfg.print_settings_id || null,
      layerHeight: Number(cfg.layer_height) || null,
      nozzle: Number(arr(cfg.nozzle_diameter)[0]) || null,
      bedType: cfg.curr_bed_type || null,
      materials: Object.keys(fil).sort(),
    };
    learned.push(p.id);
  }
  db.save();
  ctx.broadcast('reslice', null);
  return learned;
}

function removeProfile(pid) {
  delete d.profiles[pid];
  fs.rmSync(profileFile(pid), { force: true });
  db.save();
  ctx.broadcast('reslice', null);
}

// ------------------------------------------------------------------ Quellen und Planung

/** Dateien eines Teils, aus denen sich slicen lässt (mit Modell); beste zuerst */
async function sources(partId) {
  const list = [];
  for (const f of parts.variants(partId)) {
    if (f.source === 'reslice') continue; // nicht aus eigenen Ergebnissen weiterslicen
    if (!(await hasModel(f))) continue;
    const rank = f.kind === '3mf' && !f.printable ? 0 : f.kind === '3mf' ? 1 : 2; // Projekt-3MF > geslicte 3MF > STL & Co.
    list.push({ f, rank });
  }
  return list.sort((a, b) => a.rank - b.rank || Date.parse(b.f.uploadedAt) - Date.parse(a.f.uploadedAt)).map((x) => x.f);
}

/** Filamente der Quelle: [{ type, color, used }] */
async function sourceFilaments(f) {
  const got = await configOf(f);
  const types = arr(got?.cfg?.filament_type);
  const colors = arr(got?.cfg?.filament_colour);
  const usedSlots = new Set((f.meta?.materials || []).map((m) => m.slot).filter((x) => x != null));
  if (types.length) {
    return types.map((type, i) => ({ type: type || 'PLA', color: (colors[i] || '').slice(0, 7) || null, used: usedSlots.size ? usedSlots.has(i + 1) : true }));
  }
  const m = f.meta?.materials?.[0];
  return [{ type: m?.type || null, color: m?.color || null, used: true }];
}

function outputKind(p) {
  return p?.driver === 'bambu' ? '3mf' : 'gcode';
}

/** Infos für den Dialog „Für <Drucker> slicen“ */
async function plan(partId, printerId) {
  const part = parts.get(partId);
  if (!part) throw httpError(404, 'Teil nicht gefunden');
  const p = printerById(printerId);
  if (!p) throw httpError(404, 'Drucker nicht gefunden');
  const srcs = await sources(partId);
  const prof = d.profiles[printerId] || null;
  const lib = prof ? loadProfile(printerId)?.fil || {} : {};
  const out = [];
  for (const f of srcs) out.push({ id: f.id, name: f.name, kind: f.kind, printable: f.printable, printerModel: f.meta?.printerModel || null, plates: f.meta?.plates?.length ? f.meta.plates : [1], filaments: await sourceFilaments(f) });
  return {
    part: { id: part.id, name: part.name },
    printer: { id: p.id, name: p.name, model: ctx.modelOf(p), output: outputKind(p) },
    profile: prof,
    materials: [...new Set([...Object.keys(lib), ...MATERIALS])],
    learnedMaterials: Object.keys(lib),
    sources: out,
    helper: helperState(),
    running: d.jobs.find((j) => j.partId === partId && j.printerId === printerId && ['queued', 'running'].includes(j.status)) || null,
  };
}

// ------------------------------------------------------------------ Aufträge

function jobView(j) {
  const p = printerById(j.printerId);
  return { ...j, printerName: p?.name || '?', partName: parts.get(j.partId)?.name || j.partName || '?', sourceName: files.get(j.sourceFileId)?.name || null };
}

function jobs() {
  checkTimeouts();
  return d.jobs.slice(-40).reverse().map(jobView);
}

async function createJob(body = {}) {
  if (!on()) throw httpError(409, 'Umslicen ist ausgeschaltet');
  const part = parts.get(body.partId);
  if (!part) throw httpError(404, 'Teil nicht gefunden');
  const p = printerById(body.printerId);
  if (!p) throw httpError(404, 'Drucker nicht gefunden');
  const srcs = await sources(part.id);
  const src = (body.sourceFileId && srcs.find((f) => f.id === body.sourceFileId)) || srcs[0];
  if (!src) throw httpError(409, 'Zu diesem Teil gibt es keine Datei mit Modell. Bitte die Projekt-3MF (oder STL) hochladen und dem Teil zuordnen.');
  const open = d.jobs.find((j) => j.partId === part.id && j.printerId === p.id && ['queued', 'running'].includes(j.status));
  if (open) return jobView(open);
  const fils = await sourceFilaments(src);
  const materials = fils.map((x, i) => matKey(arr(body.materials)[i] || x.type || 'PLA'));
  const job = {
    id: crypto.randomUUID(),
    partId: part.id,
    partName: part.name,
    printerId: p.id,
    sourceFileId: src.id,
    plate: Math.max(1, Math.min(50, Number(body.plate) || 1)),
    materials,
    colors: fils.map((x) => x.color),
    status: 'queued',
    createdAt: new Date().toISOString(),
    by: body.by || null,
  };
  d.jobs.push(job);
  if (d.jobs.length > 200) d.jobs.splice(0, d.jobs.length - 200);
  db.save();
  ctx.broadcast('reslice', null);
  return jobView(job);
}

function retryJob(id) {
  const j = d.jobs.find((x) => x.id === id);
  if (!j) throw httpError(404, 'Auftrag nicht gefunden');
  if (!['failed', 'done', 'cancelled'].includes(j.status)) throw httpError(409, 'Läuft noch');
  Object.assign(j, { status: 'queued', error: null, code: null, log: null, startedAt: null, doneAt: null, helperId: null, attempt: null, resultFileId: null });
  db.save();
  ctx.broadcast('reslice', null);
  return jobView(j);
}

function removeJob(id) {
  const i = d.jobs.findIndex((x) => x.id === id);
  if (i < 0) throw httpError(404, 'Auftrag nicht gefunden');
  const j = d.jobs[i];
  if (j.status === 'running') {
    j.status = 'cancelled'; // der Helfer erfährt es beim Hochladen
    j.doneAt = new Date().toISOString();
  } else d.jobs.splice(i, 1);
  db.save();
  ctx.broadcast('reslice', null);
}

function checkTimeouts() {
  let changed = false;
  for (const j of d.jobs) {
    if (j.status === 'running' && Date.now() - Date.parse(j.startedAt) > RUN_TIMEOUT_MS) {
      Object.assign(j, { status: 'failed', error: 'Keine Rückmeldung vom Helfer (Zeitüberschreitung)', doneAt: new Date().toISOString() });
      changed = true;
    }
  }
  if (changed) {
    db.save();
    ctx?.broadcast('reslice', null);
  }
}

// ------------------------------------------------------------------ Profile für einen Auftrag bauen

function clampLayer(process, machine) {
  const lh = Number(arr(process.layer_height)[0] ?? process.layer_height);
  const max = Number(arr(machine?.max_layer_height)[0]);
  const min = Number(arr(machine?.min_layer_height)[0]);
  if (lh && max && lh > max) process.layer_height = String(max);
  if (lh && min && lh < min) process.layer_height = String(min);
}

/** Versuche für den Helfer: gelernt → gelernt mit Orca-Drucker → nur Orca-Standard */
async function buildAttempts(job) {
  const p = printerById(job.printerId);
  const src = files.get(job.sourceFileId);
  const srcCfg = (await configOf(src))?.cfg || null;
  const intent = {};
  if (srcCfg) for (const k of INTENT) if (k in srcCfg && KEYSET.print.has(k)) intent[k] = srcCfg[k];
  const label = `PrintDock ${p?.name || ''}`.trim();
  const prof = loadProfile(job.printerId);
  const meta = d.profiles[job.printerId];
  const model = meta?.printerModel || ctx.modelOf(p) || '';
  const nozzle = meta?.nozzle || 0.4;
  const sysMachine = { system: { kind: 'machine', model, nozzle } };
  const sysProcess = () => ({ system: { kind: 'process', layerHeight: Number(intent.layer_height || meta?.layerHeight || 0.2) }, overlay: intent, name: `${label} Prozess` });
  const sysFil = (type) => ({ system: { kind: 'filament', type } });

  const attempts = [];
  if (prof?.cfg) {
    const machine = { ...pick(prof.cfg, KEYSET.printer), type: 'machine', from: 'User', name: label, inherits: '' };
    const process = { ...pick(prof.cfg, KEYSET.print), ...intent, type: 'process', from: 'User', name: `${label} Prozess`, inherits: '', compatible_printers: [], compatible_printers_condition: '' };
    clampLayer(process, machine);
    const fils = job.materials.map((m, i) => {
      const lib = prof.fil?.[m];
      if (!lib) return sysFil(m);
      const { _name, _at, ...vals } = lib;
      return { ...vals, type: 'filament', from: 'User', name: `${label} ${m} ${i + 1}`, inherits: '', compatible_printers: [], compatible_printers_condition: '' };
    });
    attempts.push({ label: 'learned', machine, process, filaments: fils });
    attempts.push({ label: 'orca-machine', machine: sysMachine, process: { ...process, name: `${label} Prozess` }, filaments: fils });
  }
  attempts.push({ label: 'orca', machine: sysMachine, process: sysProcess(), filaments: job.materials.map(sysFil) });
  return { attempts, bedType: meta?.bedType || null };
}

// ------------------------------------------------------------------ Helfer

function helperState() {
  const live = (h) => Date.now() - Date.parse(h.lastSeen) < ONLINE_MS;
  // verbundene zuerst, dann solche mit Angaben (Name, Orca), dann zuletzt gesehen
  const hs = Object.values(d.helpers).sort((a, b) => live(b) - live(a) || Boolean(b.orca) - Boolean(a.orca) || Date.parse(b.lastSeen) - Date.parse(a.lastSeen));
  const h = hs[0] || null;
  return h ? { ...h, online: Date.now() - Date.parse(h.lastSeen) < ONLINE_MS, presets: undefined } : null;
}

function view() {
  checkTimeouts();
  const prs = printers();
  return {
    on: on(),
    token: d.token,
    helper: helperState(),
    helpers: Object.values(d.helpers).map((h) => ({ ...h, online: Date.now() - Date.parse(h.lastSeen) < ONLINE_MS })),
    profiles: prs.map((p) => ({ printerId: p.id, printerName: p.name, model: ctx.modelOf(p), ...(d.profiles[p.id] || {}), learned: Boolean(d.profiles[p.id]) })),
    jobs: jobs(),
    dismissed: d.dismissed || [],
  };
}

function newToken() {
  d.token = crypto.randomBytes(16).toString('hex');
  d.helpers = {};
  db.save();
  ctx.broadcast('reslice', null);
  return d.token;
}

function sendRes(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readJsonBody(req, max = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        reject(httpError(413, 'Zu groß'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(httpError(400, 'Ungültiges JSON'));
      }
    });
    req.on('error', reject);
  });
}

function touchHelper(id, info = {}) {
  const hid = String(id || 'default').replace(/[^\w.-]/g, '').slice(0, 64) || 'default';
  const h = (d.helpers[hid] ||= { id: hid, firstSeen: new Date().toISOString() });
  Object.assign(h, info, { lastSeen: new Date().toISOString() });
  return h;
}

let lastSave = 0;
function saveSoon() {
  if (Date.now() - lastSave > 30000) {
    lastSave = Date.now();
    db.save();
  }
}

/**
 * Endpunkte für den Helfer unter /helper/… (eigener Schlüssel, keine Anmeldung)
 * @returns true wenn behandelt
 */
async function handleHelper(req, res, url) {
  const m = url.pathname.match(/^\/helper\/(hello|poll|jobs\/([\w-]+)\/(source|result|fail))$/);
  if (!m) return false;
  const send = (status, data) => sendRes(res, status, data);
  const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || url.searchParams.get('token');
  if (!auth || auth.length !== d.token.length || !crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(d.token))) {
    send(403, { error: 'Falscher Kopplungscode – in PrintDock unter Einstellungen → Umslicen nachsehen' });
    return true;
  }
  const helperId = url.searchParams.get('id') || 'default';
  try {
    if (m[1] === 'hello' && req.method === 'POST') {
      const b = await readJsonBody(req);
      const wasOnline = helperState()?.online;
      touchHelper(helperId, {
        name: String(b.name || '').slice(0, 60) || null,
        os: String(b.os || '').slice(0, 40) || null,
        version: String(b.version || '').slice(0, 20) || null,
        orca: b.orca ? { path: String(b.orca.path || '').slice(0, 300), version: String(b.orca.version || '').slice(0, 40) || null, ok: Boolean(b.orca.ok), profiles: Number(b.orca.profiles) || 0 } : null,
        models: Array.isArray(b.models) ? b.models.map(String).slice(0, 2000) : [],
      });
      db.save();
      if (!wasOnline) ctx.broadcast('reslice', null);
      send(200, { ok: true, enabled: on(), lang: ctx.lang?.() || 'de', printers: printers().map((p) => ({ id: p.id, name: p.name, model: ctx.modelOf(p) })) });
      return true;
    }
    if (m[1] === 'poll' && req.method === 'GET') {
      const wasOnline = helperState()?.online;
      touchHelper(helperId);
      saveSoon();
      if (!wasOnline) ctx.broadcast('reslice', null);
      checkTimeouts();
      if (!on()) return send(200, { job: null, enabled: false }), true;
      // Der Helfer fragt nur nach, wenn er nichts zu tun hat: Läuft bei ihm noch ein Auftrag, wurde er
      // dazwischen beendet (Fenster zu, PC neu gestartet) → Auftrag wieder einreihen
      for (const j of d.jobs) if (j.status === 'running' && j.helperId === helperId) Object.assign(j, { status: 'queued', startedAt: null, helperId: null });
      const job = d.jobs.find((j) => j.status === 'queued');
      if (!job) return send(200, { job: null }), true;
      const p = printerById(job.printerId);
      const src = files.get(job.sourceFileId);
      if (!p || !src) {
        Object.assign(job, { status: 'failed', error: !p ? 'Drucker gibt es nicht mehr' : 'Quelldatei gibt es nicht mehr', doneAt: new Date().toISOString() });
        db.save();
        ctx.broadcast('reslice', null);
        return send(200, { job: null }), true;
      }
      const { attempts, bedType } = await buildAttempts(job);
      Object.assign(job, { status: 'running', startedAt: new Date().toISOString(), helperId });
      db.save();
      ctx.broadcast('reslice', null);
      const base = `${part_safe(job.partName)}_${part_safe(p.name)}`;
      send(200, {
        job: {
          id: job.id,
          part: job.partName,
          printer: { name: p.name, model: ctx.modelOf(p) },
          source: { name: src.name, ext: src.ext, size: src.size },
          plate: job.plate,
          bedType,
          output: outputKind(p),
          outputName: outputKind(p) === '3mf' ? `${base}.gcode.3mf` : `${base}.gcode`,
          attempts,
        },
      });
      return true;
    }
    const job = d.jobs.find((j) => j.id === m[2]);
    if (!job) return send(404, { error: 'Auftrag nicht gefunden' }), true;
    if (m[3] === 'source' && req.method === 'GET') {
      const f = files.get(job.sourceFileId);
      if (!f) return send(404, { error: 'Quelldatei fehlt' }), true;
      const fp = await files.localPath(f);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': fs.statSync(fp).size, 'X-Filename': encodeURIComponent(f.name) });
      fs.createReadStream(fp).pipe(res);
      return true;
    }
    if (m[3] === 'fail' && req.method === 'POST') {
      const b = await readJsonBody(req);
      if (job.status !== 'running') return send(200, { ok: true }), true;
      const code = b.code != null ? String(b.code) : null;
      Object.assign(job, {
        status: 'failed',
        code,
        error: String(b.message || '').slice(0, 300) || ERRORS[code] || (code ? `OrcaSlicer meldet Fehler ${code}` : 'Slicen fehlgeschlagen'),
        hint: ERRORS[code] || null,
        log: String(b.log || '').slice(-6000) || null,
        attempt: b.attempt || null,
        doneAt: new Date().toISOString(),
      });
      db.save();
      ctx.broadcast('reslice', null);
      console.log(`Umslicen: ${job.partName} für ${printerById(job.printerId)?.name || '?'} fehlgeschlagen – ${job.error}`);
      send(200, { ok: true });
      return true;
    }
    if (m[3] === 'result' && req.method === 'POST') {
      if (job.status === 'cancelled') {
        req.resume();
        return send(409, { error: 'Abgebrochen' }), true;
      }
      const p = printerById(job.printerId);
      const name = decodeURIComponent(url.searchParams.get('name') || '') || `${job.partName}.gcode`;
      const entry = await files.addFromStream(req, name, { source: 'reslice', extra: { partId: job.partId, targets: [job.printerId], reslice: { jobId: job.id, from: job.sourceFileId, attempt: url.searchParams.get('attempt') || null } } });
      if (!entry.printable) {
        Object.assign(job, { status: 'failed', error: 'Das Ergebnis ist keine druckfertige Datei', doneAt: new Date().toISOString(), resultFileId: entry.id });
      } else {
        Object.assign(job, { status: 'done', resultFileId: entry.id, attempt: url.searchParams.get('attempt') || null, doneAt: new Date().toISOString(), error: null });
        console.log(`Umslicen: ${job.partName} für ${p?.name || '?'} fertig → ${entry.name}`);
      }
      db.save();
      ctx.broadcast('reslice', null);
      ctx.broadcast('files', null);
      ctx.broadcast('production', null);
      send(200, { ok: job.status === 'done', fileId: entry.id });
      return true;
    }
    send(405, { error: 'Nicht unterstützt' });
  } catch (err) {
    if (!res.headersSent) send(err.status || 500, { error: err.message });
  }
  return true;
}

function part_safe(s) {
  return String(s || '').replace(/[^\p{L}\p{N}._ -]+/gu, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'Teil';
}

function dismiss(partId, printerId) {
  d.dismissed = [...(d.dismissed || []), `${partId}:${printerId}`].slice(-200);
  db.save();
  ctx.broadcast('reslice', null);
}

module.exports = { init, learn, removeProfile, plan, createJob, retryJob, removeJob, view, newToken, handleHelper, dismiss, hasModel, ERRORS, _test: { filamentValues, buildAttempts, pick } };
