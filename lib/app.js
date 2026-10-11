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
d.modules = Object.fromEntries(MODULES.map((m) => [m, d.modules?.[m] !== false]));
d.auth ??= { enabled: false, user: 'admin', hash: '', salt: '' };
d.apiKey ??= crypto.randomBytes(16).toString('hex');
d.sessions ??= {};
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
    modules: d.modules,
    auth: { enabled: d.auth.enabled, user: d.auth.user },
    loggedIn: isAuthed(req),
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

/** Zugriff erlaubt? Ohne Login-Schutz immer; sonst Sitzung oder API-Key. */
function isAuthed(req) {
  if (!d.auth.enabled) return true;
  if (sessionOf(req)) return true;
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
  const ok = d.auth.hash && String(user || '').trim() === d.auth.user && safeEqual(hashPassword(password || '', d.auth.salt), d.auth.hash);
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
  d.sessions[sid] = { exp: now + SESSION_DAYS * 864e5 };
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
  get authEnabled() { return d.auth.enabled; },
  moduleOn, publicSettings, save, isAuthed, login, logout,
};
