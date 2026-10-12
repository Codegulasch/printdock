// App-Einstellungen: Sprache, Akzentfarbe, Module an/aus, Einrichtung und
// optionaler Login-Schutz (für den Zugriff von außen, z. B. per Cloudflare Tunnel).

const crypto = require('crypto');
const { store } = require('./store');

/** Alle abschaltbaren Bereiche. Drucker-Übersicht und Einstellungen sind immer da. */
const MODULES = ['queue', 'orders', 'files', 'filament', 'maintenance', 'history', 'stats', 'camera', 'notifications', 'homeassistant', 'slicer', 'demo'];
const ACCENTS = ['cobalt', 'violet', 'petrol', 'green', 'orange', 'magenta', 'graphite'];
const LANGS = ['de', 'en'];

const db = store('app.json', {});
const d = db.data;
// Bestehende Installationen (vor dem Assistenten) gelten als eingerichtet.
const existing = require('fs').existsSync(require('path').join(require('./store').DATA_DIR, 'printers.json'));
d.setupDone ??= existing;
d.lang ??= LANGS.includes(process.env.PRINTDOCK_LANG) ? process.env.PRINTDOCK_LANG : 'de';
d.accent ??= 'cobalt';
d.density ??= 'standard';
d.plateCheck ??= true;
// Kosten: Strompreis, Maschinenstunde, Aufschlag, Filamentpreis ohne Spulenpreis, Leistung ohne Messung
d.costs = { kwhPrice: 0.3, machineRate: 0, markup: 0, kgPrice: 20, watts: 120, currency: '€', ...(d.costs || {}) };
d.photos ??= true;
d.nav ??= { order: [], hidden: [], home: '' }; // Menü: Reihenfolge, ausgeblendete Punkte, Startseite
d.partLabels ??= false;
d.post ??= { enabled: false, steps: ['Stützen entfernen', 'Prüfen', 'Verpackt', 'Versendet'] }; // Nachbearbeitung je Auftrag
d.firstLayer ??= false;
// Archiv: Drucke, die nicht aus PrintDock kamen (Slicer direkt, Touchscreen)
d.archive = { fetch: true, maxMb: 200, keepDays: 90, autoAssign: true, ...(d.archive || {}) };
// Standard-Druckart für neue Einträge/Aufträge – bisher entschied „Auto-Start“ am Drucker
if (!['auto', 'manual', 'single'].includes(d.printMode)) {
  let auto = true;
  try {
    const pr = JSON.parse(require('fs').readFileSync(require('path').join(require('./store').DATA_DIR, 'printers.json'), 'utf8'));
    if (Array.isArray(pr) && pr.length) auto = pr.some((p) => p.settings?.autoStart || ['same', 'prio'].includes(p.settings?.orderNext));
  } catch {
    /* neue Installation */
  }
  d.printMode = auto ? 'auto' : 'manual';
} // Foto nach der ersten Schicht // Etikett für jedes fertige Teil eines Auftrags vormerken
d.modules = Object.fromEntries(MODULES.map((m) => [m, d.modules?.[m] !== false]));
d.auth ??= { enabled: false, user: 'admin', hash: '', salt: '' };
d.auth.scope ??= 'all'; // 'all' = jede Anfrage, 'remote' = nur Zugriffe von außen (Tunnel, Tailscale, Internet)
d.apiKey ??= crypto.randomBytes(16).toString('hex');
d.sessions ??= {};
// Weitere Benutzer (der Zugang aus d.auth ist der Haupt-Admin): { id, name, role: 'admin' | 'operator', hash, salt }
d.users ??= [];
db.save();

const SESSION_DAYS = 30;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function hashPassword(pw, salt) {
  return crypto.scryptSync(String(pw), salt, 32).toString('hex');
}

function moduleOn(name) {
  return d.modules[name] !== false;
}

function publicSettings(req) {
  return {
    setupDone: d.setupDone,
    lang: d.lang,
    accent: d.accent,
    density: d.density,
    plateCheck: d.plateCheck,
    costs: d.costs,
    photos: d.photos,
    partLabels: d.partLabels,
    post: d.post,
    firstLayer: d.firstLayer,
    printMode: d.printMode,
    archive: d.archive,
    nav: d.nav,
    modules: d.modules,
    auth: { enabled: d.auth.enabled, user: d.auth.user, scope: d.auth.scope },
    loggedIn: isAuthed(req),
    me: who(req),
    addon: Boolean(process.env.SUPERVISOR_TOKEN),
    dataDir: isAuthed(req) ? require('./store').DATA_DIR : undefined,
    version: require('../package.json').version,
  };
}

/** Speichert Einstellungen; Passwort nur, wenn eines mitkommt. */
function save(body = {}) {
  if (LANGS.includes(body.lang)) d.lang = body.lang;
  if (ACCENTS.includes(body.accent)) d.accent = body.accent;
  if (['compact', 'standard', 'large'].includes(body.density)) d.density = body.density;
  if (typeof body.plateCheck === 'boolean') d.plateCheck = body.plateCheck;
  if (typeof body.photos === 'boolean') d.photos = body.photos;
  if (typeof body.partLabels === 'boolean') d.partLabels = body.partLabels;
  if (typeof body.firstLayer === 'boolean') d.firstLayer = body.firstLayer;
  if (['auto', 'manual', 'single'].includes(body.printMode)) d.printMode = body.printMode;
  if (body.archive && typeof body.archive === 'object') {
    const a = body.archive;
    const n = (v, min, max, def) => (v === undefined || v === '' ? def : Math.min(max, Math.max(min, Math.round(Number(v)) || 0)));
    d.archive = {
      fetch: a.fetch === undefined ? d.archive.fetch : Boolean(a.fetch),
      maxMb: n(a.maxMb, 1, 2000, d.archive.maxMb),
      keepDays: n(a.keepDays, 0, 3650, d.archive.keepDays),
      autoAssign: a.autoAssign === undefined ? d.archive.autoAssign : Boolean(a.autoAssign),
    };
  }
  if (body.post && typeof body.post === 'object') {
    const steps = Array.isArray(body.post.steps) ? body.post.steps.map((x) => String(x).trim().slice(0, 40)).filter(Boolean).slice(0, 8) : d.post.steps;
    d.post = { enabled: Boolean(body.post.enabled), steps: steps.length ? steps : d.post.steps };
  }
  if (body.nav && typeof body.nav === 'object') {
    const ids = (a) => (Array.isArray(a) ? a.map((x) => String(x).replace(/[^\w-]/g, '').slice(0, 24)).filter(Boolean).slice(0, 40) : []);
    d.nav = { order: ids(body.nav.order), hidden: ids(body.nav.hidden), home: String(body.nav.home || '').replace(/[^\w-]/g, '').slice(0, 24) };
  }
  if (body.costs && typeof body.costs === 'object') {
    const c = body.costs;
    const num = (v, min, max, def) => (v === undefined || v === '' ? def : Math.min(max, Math.max(min, Number(String(v).replace(',', '.')) || 0)));
    d.costs = {
      kwhPrice: num(c.kwhPrice, 0, 5, d.costs.kwhPrice),
      machineRate: num(c.machineRate, 0, 1000, d.costs.machineRate),
      markup: num(c.markup, 0, 1000, d.costs.markup),
      kgPrice: num(c.kgPrice, 0, 1000, d.costs.kgPrice),
      watts: num(c.watts, 0, 5000, d.costs.watts),
      currency: c.currency !== undefined ? String(c.currency).trim().slice(0, 4) || '€' : d.costs.currency,
    };
  }
  if (body.modules && typeof body.modules === 'object') {
    for (const m of MODULES) if (typeof body.modules[m] === 'boolean') d.modules[m] = body.modules[m];
  }
  if (body.auth) {
    const a = body.auth;
    if (a.user !== undefined) d.auth.user = String(a.user).trim().slice(0, 40) || 'admin';
    if (a.password) {
      if (String(a.password).length < 6) throw httpError(400, 'Das Passwort braucht mindestens 6 Zeichen');
      d.auth.salt = crypto.randomBytes(16).toString('hex');
      d.auth.hash = hashPassword(a.password, d.auth.salt);
      d.sessions = {}; // alle abmelden
    }
    if (a.scope === 'all' || a.scope === 'remote') d.auth.scope = a.scope;
    if (typeof a.enabled === 'boolean') {
      if (a.enabled && !d.auth.hash) throw httpError(400, 'Für den Login-Schutz bitte ein Passwort festlegen');
      d.auth.enabled = a.enabled;
    }
  }
  if (body.setupDone === true) d.setupDone = true;
  if (body.newApiKey) d.apiKey = crypto.randomBytes(16).toString('hex');
  db.save();
}

// ---------------------------------------------------------------- Login

function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((x) => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

function sessionOf(req) {
  const sid = cookies(req).pd_session;
  const s = sid && d.sessions[sid];
  if (!s || s.exp < Date.now()) return null;
  return sid;
}

/**
 * Wer stellt die Anfrage? { name, role, kind }
 * Ohne Login-Schutz, aus der Home-Assistant-Seitenleiste, im Heimnetz (bei „nur von außen“) und mit API-Key: Admin.
 */
function who(req) {
  if (!d.auth.enabled) return { name: null, role: 'admin', kind: 'open' };
  if (fromIngress(req)) return { name: 'Home Assistant', role: 'admin', kind: 'ingress' };
  const sid = sessionOf(req);
  if (sid) {
    const s = d.sessions[sid];
    const u = s.userId ? d.users.find((x) => x.id === s.userId) : null;
    if (s.userId && !u) return { name: null, role: 'none', kind: 'gone' };
    return u ? { name: u.name, role: u.role, kind: 'user', id: u.id } : { name: d.auth.user, role: 'admin', kind: 'user', id: 'main' };
  }
  if (d.auth.scope === 'remote' && isLocal(req)) return { name: null, role: 'admin', kind: 'local' };
  return { name: 'API-Key', role: 'admin', kind: 'key' };
}

function usersView() {
  return [{ id: 'main', name: d.auth.user, role: 'admin', main: true }, ...d.users.map((u) => ({ id: u.id, name: u.name, role: u.role }))];
}

function saveUser(body = {}, id = null) {
  const name = String(body.name || '').trim().slice(0, 40);
  if (!name) throw httpError(400, 'Bitte einen Namen angeben');
  const role = body.role === 'admin' ? 'admin' : 'operator';
  const taken = [d.auth.user, ...d.users.filter((u) => u.id !== id).map((u) => u.name)].some((n) => n.toLowerCase() === name.toLowerCase());
  if (id === 'main') {
    if (taken && name.toLowerCase() !== d.auth.user.toLowerCase()) throw httpError(409, 'Den Namen gibt es schon');
    d.auth.user = name;
    if (body.password) setMainPassword(body.password);
    db.save();
    return usersView();
  }
  if (taken) throw httpError(409, 'Den Namen gibt es schon');
  let u = id ? d.users.find((x) => x.id === id) : null;
  if (id && !u) throw httpError(404, 'Benutzer nicht gefunden');
  if (!u) {
    if (!body.password) throw httpError(400, 'Bitte ein Passwort festlegen');
    u = { id: crypto.randomUUID(), name, role, salt: '', hash: '' };
    d.users.push(u);
  }
  Object.assign(u, { name, role });
  if (body.password) {
    if (String(body.password).length < 6) throw httpError(400, 'Das Passwort braucht mindestens 6 Zeichen');
    u.salt = crypto.randomBytes(16).toString('hex');
    u.hash = hashPassword(body.password, u.salt);
    for (const [k, s] of Object.entries(d.sessions)) if (s.userId === u.id) delete d.sessions[k];
  }
  db.save();
  return usersView();
}

function removeUser(id) {
  if (id === 'main') throw httpError(409, 'Der Haupt-Zugang lässt sich nicht löschen');
  d.users = d.users.filter((u) => u.id !== id);
  for (const [k, s] of Object.entries(d.sessions)) if (s.userId === id) delete d.sessions[k];
  db.save();
  return usersView();
}

function setMainPassword(pw) {
  if (String(pw).length < 6) throw httpError(400, 'Das Passwort braucht mindestens 6 Zeichen');
  d.auth.salt = crypto.randomBytes(16).toString('hex');
  d.auth.hash = hashPassword(pw, d.auth.salt);
  for (const [k, s] of Object.entries(d.sessions)) if (!s.userId) delete d.sessions[k];
}

const ADDON = Boolean(process.env.SUPERVISOR_TOKEN);
const addrOf = (req) => String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
/** Home-Assistant-Ingress (Seitenleiste): Home Assistant hat schon angemeldet */
const fromIngress = (req) => ADDON && addrOf(req) === '172.30.32.2';
/**
 * Kommt die Anfrage aus dem Heimnetz? Private Adresse und keine Weiterleitung.
 * Tunnel (cloudflared) und Tailscale liefern über 127.0.0.1 ein – das zählt als „von außen“.
 */
function isLocal(req) {
  const ip = addrOf(req);
  if (req.headers['cf-connecting-ip'] || req.headers['tailscale-user-login'] || req.headers['x-forwarded-for'] || req.headers['forwarded']) return false;
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|fe80:|f[cd][0-9a-f]{2}:)/i.test(ip);
}

/** Zugriff erlaubt? Ohne Login-Schutz immer; sonst Sitzung oder API-Key. */
function isAuthed(req) {
  if (!d.auth.enabled) return true;
  if (fromIngress(req)) return true;
  if (d.auth.scope === 'remote' && isLocal(req)) return true;
  if (sessionOf(req) && who(req).role !== 'none') return true;
  const key = req.headers['x-api-key'] || new URL(req.url, 'http://x').searchParams.get('k');
  return Boolean(key) && safeEqual(key, d.apiKey);
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const attempts = new Map(); // ip -> { n, until }

function login(req, res, { user, password }) {
  // Hinter Cloudflare Tunnel / Reverse-Proxy auf demselben Rechner die echte Adresse nehmen
  let ip = req.socket.remoteAddress || '';
  if (/^(::1|127\.|::ffff:127\.)/.test(ip)) ip = String(req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || ip).trim();
  const a = attempts.get(ip) || { n: 0, until: 0 };
  if (a.until > Date.now()) throw httpError(429, 'Zu viele Versuche – bitte eine Minute warten');
  const name = String(user || '').trim().toLowerCase();
  let userId = null;
  let ok = d.auth.hash && name === d.auth.user.toLowerCase() && safeEqual(hashPassword(password || '', d.auth.salt), d.auth.hash);
  if (!ok) {
    const u = d.users.find((x) => x.name.toLowerCase() === name);
    if (u?.hash && safeEqual(hashPassword(password || '', u.salt), u.hash)) {
      ok = true;
      userId = u.id;
    }
  }
  if (!ok) {
    a.n += 1;
    if (a.n >= 5) Object.assign(a, { n: 0, until: Date.now() + 60_000 });
    attempts.set(ip, a);
    throw httpError(401, 'Benutzer oder Passwort falsch');
  }
  attempts.delete(ip);
  const sid = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  for (const [k, s] of Object.entries(d.sessions)) if (s.exp < now) delete d.sessions[k];
  d.sessions[sid] = { exp: now + SESSION_DAYS * 864e5, ...(userId ? { userId } : {}) };
  db.save();
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
  res.setHeader('Set-Cookie', `pd_session=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}

function logout(req, res) {
  const sid = sessionOf(req);
  if (sid) {
    delete d.sessions[sid];
    db.save();
  }
  res.setHeader('Set-Cookie', 'pd_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

module.exports = {
  MODULES, ACCENTS, LANGS,
  get lang() { return d.lang; },
  get apiKey() { return d.apiKey; },
  get plateCheck() { return d.plateCheck; },
  get costs() { return d.costs; },
  get photos() { return d.photos; },
  get partLabels() { return d.partLabels; },
  get post() { return d.post; },
  get printMode() { return d.printMode; },
  get archive() { return d.archive; },
  get firstLayer() { return d.firstLayer; },
  get authEnabled() { return d.auth.enabled; },
  moduleOn, publicSettings, save, isAuthed, isLocal, login, logout, who, usersView, saveUser, removeUser,
};
