// Demo-Daten: ein vollständiger, lebendiger Druckerpark zum Ausprobieren
// und Vorführen – simulierte Drucker, Dateien mit Vorschaubildern, Spulen,
// Aufträge, Warteschlange, 30 Tage Verlauf und Wartung.
// Alles trägt "demo: true" und lässt sich mit einem Klick wieder entfernen.

const crypto = require('crypto');
const assets = require('./demo-assets');
const files = require('./files');
const { tr } = require('./i18n');

const uid = () => crypto.randomUUID();
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const H = 3600e3;
const D = 24 * H;
const day = (offset) => {
  const d = new Date(Date.now() + offset * D);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Pseudo-Zufall mit festem Startwert: Demo sieht jedes Mal gleich aus
function rng(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

const FILES = [
  { key: 'deckel', name: 'Gehaeuse_Deckel.gcode.3mf', model: 'Bambu Lab X2D', sec: 11520, shape: 'box', mats: [['PLA', '#F2F2F2', 74], ['PLA', '#1C1C1C', 12]] },
  { key: 'spulenhalter', name: 'Spulenhalter_4farbig.gcode', model: 'Snapmaker U1', sec: 9000, shape: 'tower', mats: [['PLA', '#C8102E', 22], ['PLA', '#F2F2F2', 18], ['PLA', '#2F6FDE', 14], ['PLA', '#F5D33B', 10]] },
  { key: 'schrauber', name: 'Schraubendreher_Halter.gcode', model: 'Anycubic Kobra S1', sec: 3120, shape: 'bracket', mats: [['PLA', '#2F6FDE', 21]] },
  { key: 'zahnrad', name: 'Zahnrad_Set.gcode.3mf', model: 'Bambu Lab X2D', sec: 3900, shape: 'cylinder', mats: [['PLA', '#2E7D4F', 32], ['PETG', '#E2561F', 9]] },
  { key: 'wandhalter', name: 'Wandhalter.gcode.3mf', model: 'Bambu Lab A1', sec: 2460, shape: 'bracket', mats: [['PLA', '#C8102E', 18]] },
  { key: 'lampe', name: 'Lampenschirm_ASA.gcode', model: 'Voron 2.4', sec: 18300, shape: 'lamp', mats: [['ASA', '#8A8F98', 142]] },
  { key: 'clip', name: 'Kabelclip_PETG.gcode', model: 'Snapmaker U1', sec: 1440, shape: 'bracket', mats: [['PETG', '#FF6A00', 6]] },
  { key: 'logo', name: 'Messemuster_Logo.gcode.3mf', model: 'Bambu Lab X2D', sec: 7200, shape: 'box', mats: [['PLA', '#F2F2F2', 41], ['PLA', '#C8102E', 8]] },
  { key: 'proto', name: 'Prototyp_Halterung_v3.stl', model: null },
];

const PRINTERS = [
  { key: 'x2d', name: 'Werkstatt X2D', variant: 'x2d', scenario: 'printing', file: 'deckel', progress: 46, step: 0.012, model: 'Bambu Lab X2D', hours: 412 },
  { key: 'u1', name: 'Snapmaker U1', variant: 'u1', scenario: 'printing', file: 'spulenhalter', progress: 71, step: 0.02, model: 'Snapmaker U1', hours: 186, autoStart: true },
  { key: 's1', name: 'Kobra S1', variant: 's1', scenario: 'finished', file: 'schrauber', model: 'Anycubic Kobra S1', hours: 640 },
  { key: 'voron', name: 'Voron 2.4', variant: 'voron', scenario: 'idle', model: 'Voron 2.4', hours: 1290 },
  { key: 'a1', name: 'Bambu A1', variant: 'a1', scenario: 'paused', file: 'wandhalter', progress: 63, step: 0.03, model: 'Bambu Lab A1', hours: 233 },
];

// Spulen: [Drucker, Platz, Material, Farbe, Farbname, Hersteller, Rest g, Preis, RFID]
const SPOOLS = [
  ['x2d', 'ams0-0', 'PLA', '#F2F2F2', 'Weiß', 'Bambu Lab', 820, 19.99, 'DEMO-RFID-0001'],
  ['x2d', 'ams0-1', 'PLA', '#1C1C1C', 'Schwarz', 'Bambu Lab', 640, 19.99, 'DEMO-RFID-0002'],
  ['x2d', 'ams0-2', 'PETG', '#E2561F', 'Orange', 'Prusament', 370, 29.9, null],
  ['x2d', 'ams0-3', 'PLA Matt', '#2E7D4F', 'Grasgrün', 'Bambu Lab', 85, 22.99, 'DEMO-RFID-0004'],
  ['x2d', 'ext', 'TPU', '#2F6FDE', 'Blau', 'Recreus', 600, 34.5, null],
  ['u1', 'T0', 'PLA', '#C8102E', 'Rot', 'Polymaker', 540, 21.9, null],
  ['u1', 'T1', 'PLA', '#F2F2F2', 'Weiß', 'Polymaker', 760, 21.9, null],
  ['u1', 'T2', 'PLA', '#2F6FDE', 'Blau', 'Polymaker', 310, 21.9, null],
  ['u1', 'T3', 'PLA', '#F5D33B', 'Gelb', 'Polymaker', 95, 21.9, null],
  ['s1', 'ace0', 'PLA', '#2F6FDE', 'Blau', 'Anycubic', 450, 17.99, null],
  ['s1', 'ace1', 'PETG', '#FF6A00', 'Orange', 'Anycubic', 880, 18.99, null],
  ['s1', 'ace2', 'PLA', '#F5D33B', 'Gelb', 'Anycubic', 700, 17.99, null],
  ['voron', 'main', 'ASA', '#8A8F98', 'Grau', 'Formfutura', 910, 32.5, null],
  ['a1', 'ams0-0', 'PLA', '#C8102E', 'Rot', 'Bambu Lab', 900, 19.99, null],
  ['a1', 'ams0-1', 'PLA', '#FFFFFF', 'Weiß', 'Bambu Lab', 450, 19.99, null],
  [null, null, 'PETG', '#1C1C1C', 'Schwarz', 'Prusament', 1000, 29.9, null, 'Regal A'],
  [null, null, 'PLA Silk', '#D4AF37', 'Gold', 'eSun', 1000, 24.9, null, 'Regal A'],
  [null, null, 'ASA', '#1C1C1C', 'Schwarz', 'Formfutura', 1000, 32.5, null, 'Trockenbox'],
  [null, null, 'TPU', '#C8102E', 'Rot', 'Recreus', 500, 34.5, null, 'Trockenbox'],
];

/**
 * @param ctx { printerConfigs, startPrinter, savePrinters, history, saveHistory, production, filament, broadcast }
 */
async function load(ctx) {
  if (ctx.printerConfigs.some((p) => p.demo)) throw Object.assign(new Error('Demo-Daten sind bereits geladen'), { status: 409 });
  const rand = rng(7);

  // ---- Dateien
  const fileIds = {};
  const fileMeta = {};
  for (const f of FILES) {
    let buf;
    if (!f.model) buf = assets.stl(f.key);
    else {
      const materials = f.mats.map(([type, color, grams]) => ({ type, color, grams }));
      const thumb = assets.thumbnail({ shape: f.shape, colors: materials.map((m) => m.color) });
      const opts = { printerModel: f.model, seconds: f.sec, materials, thumb, layers: Math.round(f.sec / 40) };
      buf = f.name.endsWith('.3mf') ? assets.project3mf(opts) : Buffer.from(assets.gcode(opts));
    }
    const entry = await files.addFromBuffer(buf, f.name, { source: f.key === 'clip' ? 'slicer' : 'upload', demo: true });
    fileIds[f.key] = entry.id;
    fileMeta[f.key] = f;
  }

  // ---- Drucker
  const pid = {};
  for (const p of PRINTERS) {
    const id = uid();
    pid[p.key] = id;
    ctx.printerConfigs.push({
      id, name: tr(p.name), driver: 'demo', demo: true,
      settings: { model: p.model, autoStart: Boolean(p.autoStart), hoursOffset: p.hours, slots: '' },
      config: {
        variant: p.variant, scenario: p.scenario, ...(p.file ? { jobName: FILES.find((f) => f.key === p.file).name } : {}),
        progress: p.progress, step: p.step,
      },
    });
  }
  ctx.savePrinters();

  // ---- Aufträge
  const pos = () => uid();
  const orders = [
    { key: 'O1', nr: 'A-DEMO-001', title: tr('Gehäuse für Steuerung'), customer: tr('Meier Elektrotechnik'), due: day(2), prio: 1, closed: false,
      notes: tr('Deckel in Weiß, Logo-Einleger schwarz. Lieferung Freitag.'), positions: [{ id: pos(), fileId: fileIds.deckel, qty: 3 }, { id: pos(), fileId: fileIds.logo, qty: 1 }] },
    { key: 'O2', nr: 'A-DEMO-002', title: tr('Werkstatt-Organizer'), customer: tr('Eigenbedarf'), due: day(6), prio: 2, closed: false,
      notes: '', positions: [{ id: pos(), fileId: fileIds.spulenhalter, qty: 3 }, { id: pos(), fileId: fileIds.zahnrad, qty: 2 }] },
    { key: 'O3', nr: 'A-DEMO-003', title: tr('Ersatzteile Ladenbau'), customer: tr('Laden am Markt'), due: day(-1), prio: 2, closed: false,
      notes: tr('Kabelclips in Orange.'), positions: [{ id: pos(), fileId: fileIds.clip, qty: 3 }, { id: pos(), fileId: fileIds.schrauber, qty: 2 }] },
    { key: 'O4', nr: 'A-DEMO-004', title: tr('Messemuster'), customer: tr('Messe Nürnberg'), due: day(-10), prio: 3, closed: true,
      notes: '', positions: [{ id: pos(), fileId: fileIds.logo, qty: 2 }] },
  ].map((o) => ({ ...o, id: uid(), demo: true, createdAt: iso(14 * D) }));
  const O = Object.fromEntries(orders.map((o) => [o.key, o]));

  // ---- Verlauf (30 Tage) + Warteschlange
  const history = [];
  const usage = [];
  const queue = [];
  let sort = 1;
  const addItem = (fileKey, printerKey, status, order, posIdx, extra = {}) => {
    const item = {
      id: uid(), fileId: fileIds[fileKey], printerId: printerKey ? pid[printerKey] : null, orderId: order?.id || null,
      positionId: order ? order.positions[posIdx].id : null, status, sort: sort++, options: {}, createdAt: iso(3 * D), demo: true, ...extra,
    };
    queue.push(item);
    return item;
  };
  const addHistory = (fileKey, printerKey, endedAgo, result, item = null) => {
    const f = fileMeta[fileKey];
    const dur = Math.round(f.sec * (0.94 + rand() * 0.14) * (result === 'finished' ? 1 : 0.2 + rand() * 0.6));
    const progress = result === 'finished' ? 100 : Math.round((dur / f.sec) * 100);
    const printer = PRINTERS.find((p) => p.key === printerKey);
    const entry = {
      id: uid(), printerId: pid[printerKey], printerName: tr(printer.name), file: f.name, result, progress,
      startedAt: iso(endedAgo + dur * 1000), endedAt: iso(endedAgo), durationSec: dur,
      message: result === 'error' ? tr('Düse verstopft (simuliert)') : null, demo: true,
      queueId: item?.id || null, orderId: item?.orderId || null, filament: [],
    };
    const factor = progress / 100;
    f.mats.forEach(([type, color, grams], i) => {
      const g = Math.round(grams * factor * 10) / 10;
      const slot = SPOOLS.find((s) => s[0] === printerKey && s[3] === color) || SPOOLS.find((s) => s[0] === printerKey);
      usage.push({
        id: uid(), at: entry.endedAt, kind: 'print', spoolId: null, spoolNr: null, material: type, color,
        printerId: pid[printerKey], printerName: tr(printer.name), slot: slot ? slot[1] : null, historyId: entry.id, file: f.name,
        grams: g, cost: Math.round(g * 0.022 * 100) / 100, estimated: false, demo: true, _spoolKey: slot ? `${slot[0]}|${slot[1]}` : null, _i: i,
      });
      entry.filament.push({ spoolId: null, spoolNr: null, slot: slot ? slot[1] : null, grams: g, estimated: false, _spoolKey: slot ? `${slot[0]}|${slot[1]}` : null });
    });
    history.push(entry);
    return entry;
  };

  // Auftragsbezogene, bereits fertige Drucke
  const done = (fileKey, printerKey, order, posIdx, ago) => {
    const item = addItem(fileKey, printerKey, 'done', order, posIdx, { confirmed: true, startedAt: iso(ago + fileMeta[fileKey].sec * 1000), endedAt: iso(ago) });
    const h = addHistory(fileKey, printerKey, ago, 'finished', item);
    item.historyId = h.id;
  };
  done('deckel', 'x2d', O.O1, 0, 9 * H);
  done('spulenhalter', 'u1', O.O2, 0, 30 * H);
  done('spulenhalter', 'u1', O.O2, 0, 5 * H);
  done('schrauber', 's1', O.O3, 1, 2 * H);
  done('logo', 'x2d', O.O4, 0, 12 * D);
  done('logo', 'x2d', O.O4, 0, 11 * D);

  // Laufende Drucke (passen zu den simulierten Druckern)
  addItem('deckel', 'x2d', 'printing', O.O1, 0, { confirmed: true, startedAt: iso(1.5 * H) });
  addItem('spulenhalter', 'u1', 'printing', O.O2, 0, { confirmed: true, startedAt: iso(1.8 * H) });
  addItem('wandhalter', 'a1', 'printing', null, 0, { confirmed: true, startedAt: iso(0.5 * H), orderId: null, positionId: null });

  // Wartend
  addItem('deckel', 'x2d', 'queued', O.O1, 0);
  addItem('clip', 'u1', 'queued', O.O3, 0);
  addItem('clip', 'u1', 'queued', O.O3, 0);
  addItem('clip', 'u1', 'queued', O.O3, 0);
  addItem('schrauber', 's1', 'queued', O.O3, 1);
  addItem('zahnrad', null, 'queued', O.O2, 1);
  addItem('zahnrad', null, 'queued', O.O2, 1);
  addItem('lampe', 'voron', 'queued', null, 0, { orderId: null, positionId: null, error: 'Übertragung fehlgeschlagen: Drucker hat nicht geantwortet (simuliert) – erneut versuchen' });

  // Sonstiger Verlauf der letzten 30 Tage
  const pool = [['x2d', ['deckel', 'zahnrad', 'logo']], ['u1', ['spulenhalter', 'clip']], ['s1', ['schrauber']], ['voron', ['lampe']], ['a1', ['wandhalter']]];
  for (let i = 0; i < 46; i++) {
    const [pk, fks] = pool[Math.floor(rand() * pool.length)];
    const fk = fks[Math.floor(rand() * fks.length)];
    const r = rand();
    addHistory(fk, pk, (1 + rand() * 29) * D, r < 0.86 ? 'finished' : r < 0.95 ? 'cancelled' : 'error');
  }
  history.sort((a, b) => Date.parse(a.endedAt) - Date.parse(b.endedAt));

  // ---- Spulen
  const spools = SPOOLS.map(([pk, key, material, color, colorName, brand, remaining, price, rfid, location], i) => ({
    id: uid(), nr: `D-${String(i + 1).padStart(3, '0')}`, material, brand, colorName: tr(colorName), color, diameter: 1.75, netWeight: material === 'TPU' && !pk ? 500 : 1000,
    tare: 250, price, location: tr(location || ''), rfid, note: '', remaining, slot: pk ? { printerId: pid[pk], key } : null,
    archived: false, createdAt: iso(40 * D), lastUsedAt: pk ? iso(rand() * 3 * D) : null, demo: true, _key: pk ? `${pk}|${key}` : null,
  }));
  spools.push({
    id: uid(), nr: `D-${String(spools.length + 1).padStart(3, '0')}`, material: 'PLA', brand: 'Anycubic', colorName: tr('Blau'), color: '#2F6FDE', diameter: 1.75,
    netWeight: 1000, tare: 250, price: 17.99, location: '', rfid: null, note: tr('aufgebraucht'), remaining: 0, slot: null, archived: true,
    createdAt: iso(60 * D), lastUsedAt: iso(9 * D), demo: true,
  });
  // Verbrauch den Spulen zuordnen
  const byKey = Object.fromEntries(spools.filter((s) => s._key).map((s) => [s._key, s]));
  for (const u of usage) {
    const s = byKey[u._spoolKey];
    if (s) Object.assign(u, { spoolId: s.id, spoolNr: s.nr, cost: s.price ? Math.round((s.price / 1000) * u.grams * 100) / 100 : u.cost });
    delete u._spoolKey;
    delete u._i;
  }
  for (const h of history) {
    for (const f of h.filament) {
      const s = byKey[f._spoolKey];
      if (s) Object.assign(f, { spoolId: s.id, spoolNr: s.nr });
      delete f._spoolKey;
    }
  }
  spools.forEach((s) => delete s._key);

  ctx.history.push(...history);
  ctx.history.sort((a, b) => Date.parse(a.endedAt) - Date.parse(b.endedAt));
  ctx.saveHistory();
  ctx.filament.importDemo({ spools, usage });

  // ---- Produktion: Aufträge, Warteschlange, Platte, Wartung
  ctx.production.importDemo({
    orders: orders.map(({ key, ...o }) => o),
    queue,
    plate: { [pid.x2d]: { plateClear: false }, [pid.u1]: { plateClear: false }, [pid.s1]: { plateClear: false }, [pid.voron]: { plateClear: true }, [pid.a1]: { plateClear: false } },
    tasks: [
      { printerId: pid.x2d, title: tr('Druckplatte reinigen'), every: 10, unit: 'prints', used: 11, note: tr('Mit Spülmittel, PEI-Platte.') },
      { printerId: pid.x2d, title: tr('Düse prüfen und reinigen'), every: 100, unit: 'h', used: 88 },
      { printerId: pid.x2d, title: tr('Führungen reinigen und schmieren'), every: 200, unit: 'h', used: 40 },
      { printerId: pid.x2d, title: tr('Aktivkohlefilter tauschen'), every: 90, unit: 'days', used: 31 },
      { printerId: pid.u1, title: tr('Werkzeugwechsler prüfen'), every: 150, unit: 'h', used: 60 },
      { printerId: pid.u1, title: tr('Druckplatte reinigen'), every: 10, unit: 'prints', used: 4 },
      { printerId: pid.s1, title: tr('Lüfter und Filter prüfen'), every: 90, unit: 'days', used: 95 },
      { printerId: pid.s1, title: tr('Riemenspannung prüfen'), every: 300, unit: 'h', used: 120 },
      { printerId: pid.voron, title: tr('Riemenspannung prüfen'), every: 300, unit: 'h', used: 280 },
      { printerId: pid.voron, title: tr('Führungen reinigen und schmieren'), every: 200, unit: 'h', used: 35 },
      { printerId: pid.a1, title: tr('Druckplatte reinigen'), every: 10, unit: 'prints', used: 6 },
    ],
    log: [
      { id: uid(), taskId: null, printerId: pid.voron, printerName: 'Voron 2.4', title: tr('Führungen reinigen und schmieren'), at: iso(9 * D), hours: 1255, note: tr('Super Lube'), demo: true },
      { id: uid(), taskId: null, printerId: pid.x2d, printerName: tr('Werkstatt X2D'), title: tr('Führungen reinigen und schmieren'), at: iso(16 * D), hours: 372, note: '', demo: true },
    ],
  });

  for (const cfg of ctx.printerConfigs.filter((p) => p.demo)) await ctx.startPrinter(cfg);
  ctx.broadcast('printers', null);
  ctx.broadcast('files', null);
  ctx.broadcast('history', null);
  return { printers: PRINTERS.length, files: FILES.length, spools: spools.length, orders: orders.length, history: history.length };
}

async function remove(ctx) {
  const demoPrinters = ctx.printerConfigs.filter((p) => p.demo);
  for (const p of demoPrinters) await ctx.stopPrinter(p.id);
  const ids = demoPrinters.map((p) => p.id);
  ctx.printerConfigs.splice(0, ctx.printerConfigs.length, ...ctx.printerConfigs.filter((p) => !p.demo));
  ctx.savePrinters();
  ctx.history.splice(0, ctx.history.length, ...ctx.history.filter((h) => !h.demo));
  ctx.saveHistory();
  ctx.production.removeDemo(ids);
  ctx.filament.removeDemo(ids);
  files.removeDemo();
  require('./parts').removeDemo();
  ctx.broadcast('printers', null);
  ctx.broadcast('files', null);
  ctx.broadcast('history', null);
  return { removed: ids.length };
}

module.exports = { load, remove };
