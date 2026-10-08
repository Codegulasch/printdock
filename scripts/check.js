// Schnelltest für CI und vor einem Release:  npm run check
//  1. Syntax aller JavaScript-Dateien
//  2. Jeder Text in t('…') / tr('…') hat eine englische Übersetzung
//  3. Server startet, Demo-Daten laden, wichtige Endpunkte antworten
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
let failed = 0;
const fail = (msg) => { failed += 1; console.error(`✗ ${msg}`); };
const ok = (msg) => console.log(`✓ ${msg}`);

// ---------------------------------------------------------------- 1. Syntax
const jsFiles = ['.', 'lib', 'drivers', 'public', 'scripts']
  .flatMap((d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith('.js')).map((f) => path.join(root, d, f)));
for (const f of jsFiles) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (err) { fail(`Syntax: ${path.relative(root, f)}\n${err.stderr}`); }
}
ok(`Syntax: ${jsFiles.length} Dateien`);

// ---------------------------------------------------------------- 2. Übersetzungen
const { translate, DICTS } = require('../public/i18n.js');
const sources = [...fs.readdirSync(path.join(root, 'public')).filter((f) => f.endsWith('.js') && !f.startsWith('i18n')).map((f) => path.join(root, 'public', f)),
  path.join(root, 'notify.js'), path.join(root, 'lib', 'homeassistant.js'), path.join(root, 'lib', 'demo-data.js')];
const missing = new Set();
for (const f of sources) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/\btr?\(\s*'((?:[^'\\]|\\.)*)'/g)) {
    const key = m[1].replace(/\\'/g, "'");
    if (!/[A-Za-zÄÖÜäöüß]/.test(key)) continue;
    if (!(key in DICTS.en) && !(key.replace(/#\w+$/, '') in DICTS.en) && translate('en', key) === key) missing.add(key);
  }
}
if (missing.size) fail(`Englische Übersetzung fehlt für ${missing.size} Text(e):\n  ${[...missing].join('\n  ')}`);
else ok(`Übersetzungen vollständig (${Object.keys(DICTS.en).length} Einträge)`);

// ---------------------------------------------------------------- 3. Server
(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printdock-check-'));
  const port = 30000 + Math.floor(Math.random() * 20000);
  const srv = spawn(process.execPath, [path.join(root, 'server.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  srv.stdout.on('data', (d) => (log += d));
  srv.stderr.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  const req = async (p, opts = {}) => {
    const r = await fetch(base + p, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  try {
    for (let i = 0; i < 50; i++) {
      try { await fetch(`${base}/api/app`); break; } catch { await new Promise((r) => setTimeout(r, 200)); }
    }
    const app = await req('/api/app');
    if (app.status !== 200 || app.body.setupDone !== false) fail(`/api/app: ${app.status}`); else ok('Server läuft, Ersteinrichtung offen');
    const setup = await req('/api/app', { method: 'PUT', body: JSON.stringify({ lang: 'en', setupDone: true }) });
    if (setup.status !== 200 || setup.body.lang !== 'en') fail(`Einrichtung speichern: ${setup.status}`); else ok('Einrichtung gespeichert');
    const demo = await req('/api/demo/load', { method: 'POST' });
    if (demo.status !== 200 || demo.body.printers !== 5) fail(`Demo laden: ${demo.status}`); else ok('Demo-Daten geladen');
    for (const p of ['/api/printers', '/api/queue', '/api/orders', '/api/files', '/api/filament', '/api/maintenance', '/api/summary', '/api/stats?days=30', '/api/history']) {
      const r = await req(p);
      if (r.status !== 200) fail(`${p}: HTTP ${r.status}`);
    }
    ok('Endpunkte antworten');
    const q = (await req('/api/queue')).body.find((x) => x.status === 'queued');
    const noPlate = await req(`/api/queue/${q.id}/start`, { method: 'POST', body: JSON.stringify({ printerId: 'x' }) });
    if (noPlate.status !== 409) fail(`Start ohne Plattenbestätigung sollte abgelehnt werden (HTTP ${noPlate.status})`); else ok('Start ohne „Platte geräumt“ wird abgelehnt');
    const auth = await req('/api/app', { method: 'PUT', body: JSON.stringify({ auth: { enabled: true, user: 'admin', password: 'test1234' } }) });
    const locked = await req('/api/printers');
    if (auth.status !== 200 || locked.status !== 401) fail(`Login-Schutz greift nicht (HTTP ${locked.status})`); else ok('Login-Schutz greift');
    const stats = await fetch(`${base}/api/stats?days=0`, { headers: { 'X-Api-Key': JSON.parse(fs.readFileSync(path.join(dataDir, 'app.json'))).apiKey } });
    if (stats.status !== 200) fail(`API-Key wird nicht akzeptiert (HTTP ${stats.status})`); else ok('API-Key funktioniert');
  } catch (err) {
    fail(`Servertest: ${err.message}\n${log}`);
  } finally {
    srv.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  if (failed) {
    console.error(`\n${failed} Prüfung(en) fehlgeschlagen`);
    process.exit(1);
  }
  console.log('\nAlles in Ordnung.');
})();
