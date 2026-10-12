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

/** Kleiner WebSocket-Client (Node 18 hat noch kein globales WebSocket) – gleiche Schnittstelle wie im Browser */
function wsClient(url) {
  if (typeof WebSocket === 'function') return new WebSocket(url);
  const http = require('http');
  const crypto = require('crypto');
  const c = { send: null, close: null };
  const u = new URL(url.replace(/^ws/, 'http'));
  const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64') } });
  req.on('error', (e) => c.onerror?.(e));
  req.on('upgrade', (res, sock) => {
    let buf = Buffer.alloc(0);
    c.send = (text) => {
      const p = Buffer.from(text);
      const mask = crypto.randomBytes(4);
      const head = p.length < 126 ? Buffer.from([0x81, 0x80 | p.length]) : Buffer.from([0x81, 0xfe, p.length >> 8, p.length & 255]);
      sock.write(Buffer.concat([head, mask, p.map((b, i) => b ^ mask[i & 3])]));
    };
    c.close = () => sock.destroy();
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 2) {
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        if (buf.length < off + len) return;
        const op = buf[0] & 0x0f;
        const data = buf.subarray(off, off + len).toString();
        buf = buf.subarray(off + len);
        if (op === 1) c.onmessage?.({ data });
      }
    });
    c.onopen?.();
  });
  req.end();
  return c;
}

// ---------------------------------------------------------------- 1. Syntax
const jsFiles = ['.', 'lib', 'drivers', 'public', 'scripts', 'dist']
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

// ---------------------------------------------------------------- 3. Tag-Formate
try {
  const tags = require('../lib/tags');
  // Original-Tag von Anycubic (PLA+ „Bright Red“, Seiten 4–31, aus DnG-Crafts/ACE-RFID)
  const real = '7B006500' + '4148504C' + '50424B2D' + '31303200' + '00'.repeat(8) + '41430000' + '00'.repeat(16) + '504C412B' + '00'.repeat(16)
    + 'FF0006E1' + '00'.repeat(8) + '32006400' + 'CD00D700' + '00'.repeat(16) + '32003C00' + 'AF004A01' + 'E8030000';
  const head = '04A1B2C3D4E5F680' + '00000000' + 'E1101200';
  const ace = tags.decode(head + real);
  if (ace.format !== 'ace' || ace.data.material !== 'PLA+' || ace.data.color !== '#E10600' || ace.data.netWeight !== 1000) fail(`ACE lesen: ${JSON.stringify(ace)}`);
  const sp = { nr: 'S-007', material: 'PETG', color: '#3366FF', brand: 'Sunlu', netWeight: 1000, diameter: 1.75 };
  const back = tags.decode(head + tags.encode('ace', sp).pages.map((x) => x.hex).join(''));
  const uni = tags.decode(head.replace('E1101200', 'E1103E00') + tags.encode('universal', sp, { baseUrl: 'http://192.168.1.5:3080' }).pages.map((x) => x.hex).join(''));
  let small = false;
  try { tags.encode('universal', sp, { baseUrl: 'http://192.168.1.5:3080', capacity: 144 }); } catch { small = true; }
  if (back.data?.color !== '#3366FF' || uni.spoolRef !== 'S-007' || uni.data?.material !== 'PETG' || !small) fail('Tag-Formate: Hin- und Rückweg stimmt nicht');
  else ok('Tag-Formate: Anycubic ACE, OpenSpool, Link');
} catch (err) { fail(`Tag-Formate: ${err.message}`); }

// ---------------------------------------------------------------- 4. Server
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
    const bk = await fetch(`${base}/api/backup`);
    const bkFile = path.join(os.tmpdir(), `printdock-check-${port}.zip`);
    fs.writeFileSync(bkFile, Buffer.from(await bk.arrayBuffer()));
    try {
      const info = require('../lib/backup').inspect(bkFile);
      if (bk.status !== 200 || info.printers !== 5 || info.files < 8) fail(`Sicherung unvollständig (${JSON.stringify(info)})`); else ok(`Sicherung: ${info.files} Dateien`);
    } catch (err) { fail(`Sicherung: ${err.message}`); } finally { fs.rmSync(bkFile, { force: true }); }
    // Station: WebSocket, Kopplung, Tag melden
    await new Promise((resolve, reject) => {
      const ws = wsClient(`ws://127.0.0.1:${port}/api/station/ws`);
      const timer = setTimeout(() => reject(new Error('Station: keine Antwort')), 5000);
      ws.onerror = () => reject(new Error('Station: WebSocket-Fehler'));
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', id: 'CHECK-1', fw: 'check', caps: { nfc: true, scale: true } }));
      ws.onmessage = async (e) => {
        const m = JSON.parse(e.data);
        if (m.t === 'pair') {
          const r = await req('/api/stations/pair', { method: 'POST', body: JSON.stringify({ id: 'CHECK-1', code: m.code }) });
          if (r.status !== 201) reject(new Error(`Station koppeln: HTTP ${r.status}`));
        }
        if (m.t === 'welcome') ws.send(JSON.stringify({ t: 'tag', uid: '04AA11BB22CC33', kind: 'ntag', pages: '04AA11BB22CC3300E1103E00' + '0300FE00' + '00'.repeat(60) }));
        if (m.t === 'show' && /Leerer Tag/.test(m.lines[0])) {
          const f = await req('/api/filament');
          clearTimeout(timer);
          ws.close();
          if (f.body.pendingTag?.tag === '04AA11BB22CC33' && f.body.stations.list[0]?.online) resolve(); else reject(new Error('Station: Tag nicht gemeldet'));
        }
      };
    });
    ok('Station: koppeln und Tag melden');
    const auth = await req('/api/app', { method: 'PUT', body: JSON.stringify({ auth: { enabled: true, user: 'admin', password: 'test1234' } }) });
    const locked = await req('/api/printers');
    if (auth.status !== 200 || locked.status !== 401) fail(`Login-Schutz greift nicht (HTTP ${locked.status})`); else ok('Login-Schutz greift');
    const stats = await fetch(`${base}/api/stats?days=0`, { headers: { 'X-Api-Key': JSON.parse(fs.readFileSync(path.join(dataDir, 'app.json'))).apiKey } });
    if (stats.status !== 200) fail(`API-Key wird nicht akzeptiert (HTTP ${stats.status})`); else ok('API-Key funktioniert');
  } catch (err) {
    fail(`Servertest: ${err.message}\n${log}`);
  } finally {
    // erst sauber beenden lassen (schreibt beim Beenden noch Dateien), dann aufräumen
    await new Promise((r) => { srv.once('exit', r); srv.kill(); setTimeout(r, 5000); });
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
  if (failed) {
    console.error(`\n${failed} Prüfung(en) fehlgeschlagen`);
    process.exit(1);
  }
  console.log('\nAlles in Ordnung.');
})();
