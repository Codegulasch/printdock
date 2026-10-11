#!/usr/bin/env node
// Simulierte PrintDock-Station – zum Ausprobieren ohne Hardware.
//
//   node scripts/station-sim.js [ws://localhost:3080/api/station/ws] [--token=…] [--id=…]
//
// Befehle (eintippen, Enter):
//   tag [ntag213|ntag215|ace]   leeren Tag auflegen (Standard ntag215)
//   tag <UID>                    bekannten Tag (nur UID) auflegen
//   ace PLA+ #E10600             Anycubic-Tag mit Material/Farbe auflegen
//   gone                         Tag abnehmen
//   w <Gramm>                    Gewicht auf der Waage (ruhig)
//   btn | btn long               Taste kurz/lang
//   show                         aktuellen Tag-Inhalt anzeigen
//   quit
const readline = require('readline');
const path = require('path');
const tags = require(path.join(__dirname, '..', 'lib', 'tags'));

const args = process.argv.slice(2);
const url = args.find((a) => /^wss?:/.test(a)) || 'ws://localhost:3080/api/station/ws';
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
let token = opt('token', process.env.STATION_TOKEN || '');
const id = opt('id', 'SIM-' + Math.random().toString(16).slice(2, 8).toUpperCase());
const quiet = args.includes('--quiet');

let tag = null; // { uid, kind, mem: Buffer }
let scaleOffset = 0;
let raw = 0;

const CC = { ntag213: 0x12, ntag215: 0x3e, ntag216: 0x6d };
function newTag(kind = 'ntag215', uid) {
  const pages = kind === 'ntag213' ? 45 : kind === 'ntag216' ? 231 : 135;
  const mem = Buffer.alloc(pages * 4);
  const u = Buffer.from(uid || '04' + Math.random().toString(16).slice(2, 14).padEnd(12, '0'), 'hex');
  u.copy(mem, 0, 0, 3);
  u.copy(mem, 4, 3, 7);
  mem.set([0xe1, 0x10, CC[kind] || 0x3e, 0x00], 12);
  mem.set([0x03, 0x00, 0xfe], 16);
  return { uid: u.toString('hex').toUpperCase(), kind: 'ntag', mem };
}

const ws = new WebSocket(url);
const send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
const log = (...a) => !quiet && console.log(...a);

ws.addEventListener('open', () => {
  log(`verbunden mit ${url} als ${id}`);
  send({ t: 'hello', id, name: 'Sim-Station', fw: 'sim-1.0', hw: 'simulator', caps: { nfc: true, scale: true, display: true, led: true }, token });
});
ws.addEventListener('close', (e) => { log(`getrennt (${e.code})`); process.exit(0); });
ws.addEventListener('error', (e) => { console.error('Fehler:', e.message || e); });
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.t === 'show') return log(`┌ DISPLAY ${m.color || ''} ${m.beep ? `♪${m.beep}` : ''}\n│ ${m.lines.join('\n│ ')}\n└`);
  if (m.t === 'pair') return log(`Kopplungscode: ${m.code}`);
  if (m.t === 'welcome') { token = m.token; return log(`gekoppelt als „${m.name}“ – Token: ${m.token}`); }
  if (m.t === 'tare') { scaleOffset = raw; log('Tara'); return sendWeight(); }
  if (m.t === 'calibrate') { log(`kalibriert auf ${m.grams} g`); return send({ t: 'calibrated', ok: true, grams: m.grams }); }
  if (m.t === 'write') {
    if (!tag || tag.uid !== m.uid) return send({ t: 'written', job: m.job, ok: false, error: 'tag removed' });
    Buffer.from(m.data, 'hex').copy(tag.mem, m.start * 4);
    log(`Tag beschrieben: ${m.data.length / 8} Seiten ab ${m.start}`);
    return send({ t: 'written', job: m.job, ok: true, uid: tag.uid, pages: tag.mem.toString('hex').toUpperCase() });
  }
  log('←', m);
});

function sendTag() {
  send({ t: 'tag', uid: tag.uid, kind: tag.kind, pages: tag.mem ? tag.mem.toString('hex').toUpperCase() : undefined });
}
function sendWeight() {
  send({ t: 'weight', g: Math.round((raw - scaleOffset) * 10) / 10, stable: true });
}

function cmd(line) {
  const [c, ...rest] = line.trim().split(/\s+/);
  if (!c) return;
  if (c === 'tag') {
    const a = rest[0];
    if (a && /^[0-9a-f]{8,20}$/i.test(a)) tag = { uid: a.toUpperCase(), kind: 'mifare_classic', mem: null };
    else tag = newTag(a || 'ntag215');
    log(`Tag ${tag.uid} aufgelegt`);
    return sendTag();
  }
  if (c === 'ace') {
    tag = newTag('ntag213');
    const enc = tags.encode('ace', { material: rest[0] || 'PLA', color: rest[1] || '#E10600', netWeight: 1000 });
    for (const p of enc.pages) Buffer.from(p.hex, 'hex').copy(tag.mem, p.page * 4);
    log(`Anycubic-Tag ${tag.uid} aufgelegt`);
    return sendTag();
  }
  if (c === 'gone') { tag = null; return send({ t: 'tag_gone' }); }
  if (c === 'w') { raw = Number(rest[0]) + scaleOffset; return sendWeight(); }
  if (c === 'btn') return send({ t: 'button', press: rest[0] === 'long' ? 'long' : 'short' });
  if (c === 'show') return log(tag?.mem ? tags.decode(tag.mem.toString('hex')) : tag);
  if (c === 'quit') return ws.close();
  log('unbekannt:', c);
}

// Befehle aus --run="tag;w 1200;…" (für Tests) oder von der Tastatur
const run = opt('run', '');
if (run) {
  const steps = run.split(';');
  ws.addEventListener('open', async () => {
    for (const s of steps) {
      await new Promise((r) => setTimeout(r, s.startsWith('sleep') ? Number(s.split(' ')[1]) : 400));
      if (!s.startsWith('sleep')) cmd(s);
    }
  });
} else {
  readline.createInterface({ input: process.stdin }).on('line', cmd);
}
