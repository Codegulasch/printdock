#!/usr/bin/env node
// PrintDock Status-Server – öffentliche Statusseiten für Kunden, ohne das Heimnetz zu öffnen.
//
// PrintDock schickt bei jeder Änderung eines freigegebenen Auftrags die Statusdaten (ohne Kosten)
// und die Fotos der fertigen Teile hierher. Der Kunde ruft https://<dieser Server>/s/<code> auf.
// Keine Datenbank, keine Abhängigkeiten – Node.js 18+, Daten als Dateien.
//
// Umgebung:
//   PORT=8080
//   DATA_DIR=./data
//   RELAY_KEYS=werkstatt:geheimer-schluessel[,zweite:anderer-schluessel]   (je PrintDock ein Schlüssel)
//   TRUST_PROXY=1     hinter nginx/Caddy/Traefik: Client-IP aus X-Forwarded-For
//
// API (Authorization: Bearer <Schlüssel>):
//   GET    /api/v1/ping                       → { ok, name, version }
//   PUT    /api/v1/orders/<code>              JSON { lang, data, brand, expiresAt } → { missing: [Foto-IDs] }
//   PUT    /api/v1/orders/<code>/photos/<id>  JPEG (max. 3 MB)
//   DELETE /api/v1/orders/<code>
// Öffentlich:
//   GET /s/<code>   GET /s/<code>/p/<id>.jpg   GET /health

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let render;
try {
  render = require('./render'); // im Docker-Image hierher kopiert
} catch {
  render = require('../lib/statusrender'); // direkt aus dem PrintDock-Ordner gestartet
}

const VERSION = '1.0.0';
const PORT = Number(process.env.PORT) || 8080;
const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const KEYS = Object.fromEntries(String(process.env.RELAY_KEYS || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
  const i = x.indexOf(':');
  return i > 0 ? [x.slice(i + 1), x.slice(0, i)] : [x, 'printdock'];
}));
const CODE = /^[a-f0-9]{24}$/;
const PHOTO = /^[\w-]{8,64}$/;

fs.mkdirSync(DATA, { recursive: true });
if (!Object.keys(KEYS).length) console.warn('Achtung: RELAY_KEYS ist leer – PrintDock kann nichts hochladen.');

const dirOf = (code) => path.join(DATA, code);
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const safeEq = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

function who(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  const given = m ? m[1].trim() : String(req.headers['x-relay-key'] || '').trim();
  if (!given) return null;
  for (const [key, name] of Object.entries(KEYS)) if (safeEq(given, key)) return name;
  return null;
}

function body(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('Zu groß'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, status, data, type = 'application/json; charset=utf-8', extra = {}) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': buf.length, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex', ...extra });
  res.end(buf);
}

function expired(meta) {
  return meta?.expiresAt && Date.parse(meta.expiresAt) < Date.now();
}

/** Abgelaufene Seiten löschen (stündlich) */
function cleanup() {
  for (const code of fs.readdirSync(DATA)) {
    const meta = readJson(path.join(dirOf(code), 'order.json'));
    if (!meta || expired(meta)) fs.rmSync(dirOf(code), { recursive: true, force: true });
  }
}
setInterval(cleanup, 3600_000).unref();

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  // PUT/DELETE auch als POST mit X-HTTP-Method-Override (wie die PHP-Version)
  const ov = String(req.headers['x-http-method-override'] || '').toUpperCase();
  if (req.method === 'POST' && (ov === 'PUT' || ov === 'DELETE')) req.method = ov;
  const p = url.pathname.replace(/\/+$/, '') || '/';
  if (p === '/health') return send(res, 200, { ok: true, version: VERSION });
  if (p === '/' && req.method === 'GET') return send(res, 200, render.gone('de').replace('Dieser Link ist nicht mehr gültig.', 'PrintDock Status-Server – bitte den vollständigen Link aus Ihrer Auftragsbestätigung verwenden.'), 'text/html; charset=utf-8');

  // ---- öffentliche Seiten
  let m = /^\/s\/([a-f0-9]{24})$/.exec(p);
  if (m && req.method === 'GET') {
    const meta = readJson(path.join(dirOf(m[1]), 'order.json'));
    if (!meta || expired(meta)) return send(res, 404, render.gone(meta?.lang), 'text/html; charset=utf-8');
    const html = render.renderOrder(meta.lang, { ...meta.data, brand: meta.brand }, { photoUrl: (id) => `/s/${m[1]}/p/${id}.jpg` });
    return send(res, 200, html, 'text/html; charset=utf-8', { 'Cache-Control': 'no-cache' });
  }
  m = /^\/s\/([a-f0-9]{24})\/p\/([\w-]{8,64})\.jpg$/.exec(p);
  if (m && req.method === 'GET') {
    const meta = readJson(path.join(dirOf(m[1]), 'order.json'));
    const f = path.join(dirOf(m[1]), 'photos', `${m[2]}.jpg`);
    if (!meta || expired(meta) || !meta.data?.photos?.includes(m[2]) || !fs.existsSync(f)) return send(res, 404, 'Nicht gefunden', 'text/plain');
    return send(res, 200, fs.readFileSync(f), 'image/jpeg', { 'Cache-Control': 'public, max-age=86400' });
  }

  // ---- API für PrintDock
  if (!p.startsWith('/api/v1/')) return send(res, 404, { error: 'Nicht gefunden' });
  const owner = who(req);
  if (!owner) return send(res, 401, { error: 'Schlüssel fehlt oder ist falsch' });
  if (p === '/api/v1/ping') return send(res, 200, { ok: true, name: owner, version: VERSION });

  m = /^\/api\/v1\/orders\/([^/]+)(?:\/photos\/([^/]+))?$/.exec(p);
  if (!m || !CODE.test(m[1]) || (m[2] && !PHOTO.test(m[2]))) return send(res, 404, { error: 'Nicht gefunden' });
  const dir = dirOf(m[1]);
  const metaFile = path.join(dir, 'order.json');
  const meta = readJson(metaFile);
  if (meta && meta.owner !== owner) return send(res, 403, { error: 'Gehört zu einem anderen PrintDock' });

  if (!m[2] && req.method === 'PUT') {
    const b = JSON.parse((await body(req, 1_000_000)).toString('utf8') || '{}');
    if (!b.data?.nr) return send(res, 400, { error: 'Daten fehlen' });
    const photos = (b.data.photos || []).filter((id) => PHOTO.test(id)).slice(0, 24);
    const next = { owner, lang: b.lang === 'en' ? 'en' : 'de', brand: b.brand || null, expiresAt: b.expiresAt || null, data: { ...b.data, photos }, at: new Date().toISOString() };
    fs.mkdirSync(path.join(dir, 'photos'), { recursive: true });
    fs.writeFileSync(`${metaFile}.tmp`, JSON.stringify(next));
    fs.renameSync(`${metaFile}.tmp`, metaFile);
    // nicht mehr gezeigte Fotos löschen
    for (const f of fs.readdirSync(path.join(dir, 'photos'))) if (!photos.includes(f.replace(/\.jpg$/, ''))) fs.rmSync(path.join(dir, 'photos', f), { force: true });
    const missing = photos.filter((id) => !fs.existsSync(path.join(dir, 'photos', `${id}.jpg`)));
    return send(res, 200, { ok: true, missing });
  }
  if (m[2] && req.method === 'PUT') {
    if (!meta) return send(res, 404, { error: 'Erst die Auftragsdaten senden' });
    const jpg = await body(req, 3_000_000);
    if (jpg[0] !== 0xff || jpg[1] !== 0xd8) return send(res, 400, { error: 'Kein JPEG' });
    fs.writeFileSync(path.join(dir, 'photos', `${m[2]}.jpg`), jpg);
    return send(res, 200, { ok: true });
  }
  if (!m[2] && req.method === 'DELETE') {
    fs.rmSync(dir, { recursive: true, force: true });
    return send(res, 200, { ok: true });
  }
  return send(res, 405, { error: 'Methode nicht erlaubt' });
}

http.createServer((req, res) => {
  handle(req, res).catch((err) => send(res, err.status || 500, { error: err.status ? err.message : 'Fehler' }));
}).listen(PORT, () => {
  cleanup();
  console.log(`PrintDock Status-Server ${VERSION} auf Port ${PORT} · Daten: ${DATA} · ${Object.keys(KEYS).length} Schlüssel`);
});
