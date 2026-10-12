// PrintDock – herstellerübergreifende 3D-Drucker-Verwaltung
// Start: node server.js   (Port über PORT, Datenordner über DATA_DIR)

require('./lib/env'); // zuerst: Umgebung (Add-on) vervollständigen
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { drivers, byId } = require('./drivers');
const { CameraManager, serveSnapshot, serveMjpeg, ffmpegPath, ffmpegAvailable } = require('./camera');
const { Notifier, CHANNELS, EVENTS, detectEvents } = require('./notify');
const files = require('./lib/files');
const slicer = require('./lib/slicer');
const { Production } = require('./lib/production');
const { Filament } = require('./lib/filament');
const demoData = require('./lib/demo-data');
const { HomeAssistant } = require('./lib/homeassistant');
const app = require('./lib/app');
const stats = require('./lib/stats');
const hms = require('./lib/hms');
let ha = null; // wird nach Produktion/Filament angelegt
let relay = null; // Status-Server für Kunden-Links
let archive = null; // Archiv aller Drucke (auch am Drucker/im Slicer gestartete)

const PORT = Number(process.env.PORT) || 3080;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PRINTERS_FILE = path.join(DATA_DIR, 'printers.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const CHANNELS_FILE = path.join(DATA_DIR, 'notifications.json');
const HISTORY_MAX = 20000; // Archiv: so viele Drucke bleiben gespeichert
const MASK = '••••••';

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------------------------------------------------------------- Speicher

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file); // atomar, damit bei Stromausfall nichts halb geschrieben ist
}

let printerConfigs = readJson(PRINTERS_FILE, []);
let history = readJson(HISTORY_FILE, []);
let channels = readJson(CHANNELS_FILE, []);
const channelResults = new Map(); // id -> letztes Versandergebnis (nur im Speicher)

const savePrinters = () => writeJson(PRINTERS_FILE, printerConfigs);
const saveHistory = () => writeJson(HISTORY_FILE, history.slice(-HISTORY_MAX));
const saveChannels = () => writeJson(CHANNELS_FILE, channels);

// ---------------------------------------------------------------- Felder (Formulare)

/**
 * Prüft Eingaben gegen eine Feldbeschreibung (aus Treiber- bzw. Kanal-Meta).
 * Unveränderte Geheimnisse (MASK) werden aus der bestehenden Konfiguration übernommen.
 */
function validateFields(fields, input = {}, existing = null) {
  const config = {};
  for (const f of fields) {
    let v = input[f.key];
    if (typeof v === 'string') v = v.trim();
    if (f.secret && (v === MASK || v === undefined) && existing) v = existing[f.key];
    if (v === '' || v == null) v = f.default;
    if (f.type === 'number' && v != null) v = Number(v);
    if (f.type === 'select' && !f.options.some((o) => o.value === v)) v = f.default;
    if (f.required && (v === undefined || v === '')) throw httpError(400, `Feld „${f.label}“ fehlt`);
    if (v !== undefined) config[f.key] = v;
  }
  return config;
}

function maskFields(fields, config = {}) {
  const secret = new Set(fields.filter((f) => f.secret).map((f) => f.key));
  const out = {};
  for (const [k, v] of Object.entries(config)) out[k] = secret.has(k) && v ? MASK : v;
  return out;
}

// ---------------------------------------------------------------- Laufzeit

/** id -> { driver, job, lastState, offlineTimer } */
const runtime = new Map();
const clients = new Set();
const cameras = new CameraManager();

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
  if (!ha) return;
  if (event === 'printers') setTimeout(() => ha.publishDiscovery(), 500);
  if (['production', 'history'].includes(event)) relay?.changed();
  if (['production', 'filament', 'history'].includes(event)) {
    clearTimeout(broadcast.sumTimer);
    broadcast.sumTimer = setTimeout(() => {
      ha.publishSummary();
      ha.publishAllStates();
    }, 1000);
  }
}

const notifier = new Notifier({
  getChannels: () => channels,
  getSnapshot: (printerId) => {
    const rt = runtime.get(printerId);
    return rt ? cameras.trySnapshot(printerId, rt.driver) : null;
  },
  onResult: (id, result) => {
    channelResults.set(id, result);
    broadcast('channels', null);
  },
});

const production = new Production({
  printers: () => printerConfigs,
  runtime,
  history: () => history,
  broadcast,
  notify: (event, cfg, status, extra) => {
    const st = status || runtime.get(cfg.id)?.driver.status || null;
    notifier.dispatch(event, cfg, st, extra).catch((err) => console.warn(err.message));
  },
});

// Eingangsordner: Dateien aus Slicern ohne Druck-Host (Bambu Studio) automatisch übernehmen
const { Inbox } = require('./lib/inbox');
const inbox = new Inbox({ production, broadcast });
inbox.start();


const filament = new Filament({
  printers: () => printerConfigs,
  runtime,
  broadcast,
  getQueueItem: (id) => production.getItem(id),
  notify: (event, cfg, status, extra) => {
    notifier.dispatch(event, cfg, status || runtime.get(cfg.id)?.driver.status || null, extra).catch((err) => console.warn(err.message));
  },
});

// Als Add-on: echte IP des Home-Assistant-Rechners für Slicer und Downloads ermitteln
require('./lib/hostinfo').refresh(PORT).then((i) => i.ip && console.log(`Erreichbar im Heimnetz unter http://${i.ip}:${i.port || PORT}`));

// Optionale Spoolman-Anbindung: Spulen kommen aus Spoolman, Verbrauch geht zurück
const { Spoolman } = require('./lib/spoolman');
const spoolman = new Spoolman({ db: require('./lib/filament').db, filament, printers: () => printerConfigs });
filament.ext = spoolman;

// PrintDock-Stationen (NFC-Leser + Waage + Display, eigene Firmware)
const { Stations } = require('./lib/stations');
const tags = require('./lib/tags');
const stations = new Stations({
  filament,
  spools: () => require('./lib/filament').db.data.spools,
  printers: () => printerConfigs,
  baseUrl: () => ha?.directUrl || '',
  broadcast,
});
filament.ctx.onPlaced = (spool, cfg, slot, source) => stations.onPlaced(spool, cfg, slot, source);
filament.ctx.onTagAssigned = (spool, pending) => stations.onTagAssigned(spool, pending);
stations.ctx.onEnv = (stationId, pct, temp) => filament.stationEnv(stationId, pct, temp);
stations.ctx.envTarget = (stationId) => {
  const src = require('./lib/filament').db.data.humSources.find((x) => x.kind === 'station' && x.stationId === stationId);
  if (!src) return null;
  if (src.target.type === 'storage') return src.target.name;
  const cfg = printerConfigs.find((p) => p.id === src.target.printerId);
  return [cfg?.name, src.target.unit].filter(Boolean).join(' · ');
};
filament.migrateHumidityEntities(savePrinters);

// Trocknen per Knopf (Bambu AMS 2 Pro/HT, Klipper-Makro, Home Assistant)
const { Drying } = require('./lib/drying');
const drying = new Drying({
  db: require('./lib/filament').db,
  filament,
  printers: () => printerConfigs,
  runtime,
  ha: () => ha,
  broadcast,
  notify: (event, who, entry) => notifier.dispatch(event, who, null, entry).catch((err) => console.warn(err.message)),
});
// Feuchte-Check vor dem Start (Grenzwerte je Material)
const { HumCheck } = require('./lib/humcheck');
const humcheck = new HumCheck({ filament, drying });
production.ctx.humBlock = (p, f, options) => (require('./lib/app').moduleOn('filament') ? humcheck.blockReason(p, f, options) : null);
production.ctx.dryActive = (key) => Boolean(drying.data.dryJobs[key]) || Boolean(drying.view().find((x) => x.key === key)?.active);
// Trocknen gilt als erledigt, wenn die Spulen an der Stelle seit dem Start als getrocknet vermerkt sind
production.ctx.dryDone = (a) => {
  const cfg = printerConfigs.find((p) => p.id === a.printerId);
  if (!cfg) return false;
  const unit = a.key.split('|')[1] || null;
  const spools = filament.slotsFor(cfg).filter((sl) => !unit || sl.unit === unit).map((sl) => filament.spoolAt(cfg.id, sl.key)).filter(Boolean);
  return !spools.length || spools.some((sp) => sp.driedAt && Date.parse(sp.driedAt) >= Date.parse(a.at) - 60_000);
};

// Belegung an den Drucker übertragen (Bambu-AMS: Material und Farbe des Fachs)
filament.ctx.pushSlot = async (cfg, key, spool) => {
  const rt = runtime.get(cfg.id);
  if (!rt || !(cfg.driver === 'bambu' || (cfg.driver === 'anycubic' && /^ace/.test(key)) || (cfg.driver === 'demo' && /^(ams|ext)/.test(key)))) return;
  const [tempMin, tempMax] = tags.tempsFor(spool.material);
  await rt.driver.command('filament_setting', { key, material: spool.material, color: spool.color, tempMin, tempMax });
  console.log(`[${cfg.name}] ${key}: ${spool.material} ${spool.color} gesetzt (${spool.nr})`);
};

ha = new HomeAssistant({
  printers: () => printerConfigs,
  runtime,
  broadcast,
  production,
  filament,
  summary: () => ({ ...production.summary(), ...filament.summary() }),
  port: PORT,
});
CHANNELS.homeassistant.ha = ha;

const ACTIVE = new Set(['preparing', 'printing', 'paused']);
const ENDED = { finished: 'erfolgreich', cancelled: 'abgebrochen', error: 'fehlgeschlagen' };

// Laufende Druckjobs überstehen einen Neustart von PrintDock (sonst wird das Druckende verpasst)
const jobsDb = require('./lib/store').store('jobs.json', {});
let jobsSaveTimer = null;
function saveJobs(now = false) {
  clearTimeout(jobsSaveTimer);
  if (now) return jobsDb.save();
  jobsSaveTimer = setTimeout(() => jobsDb.save(), 20_000);
}
function persistJob(cfg, rt, now = false) {
  if (rt.job) jobsDb.data[cfg.id] = rt.job;
  else delete jobsDb.data[cfg.id];
  saveJobs(now);
}

/** Verfolgt den laufenden Druckjob und schreibt beim Ende einen Verlaufseintrag. */
function trackJob(cfg, rt, status) {
  // Nach einem Neustart übernommener Job: erst eine Minute lang den echten Zustand abwarten
  // (manche Drucker melden beim Verbinden kurz „bereit“, bevor der volle Status da ist)
  if (rt.job?.restored && !ACTIVE.has(status.state) && Date.now() - rt.createdAt < 60_000) return null;
  if (ACTIVE.has(status.state)) {
    if (!rt.job || (status.file && rt.job.file !== status.file)) {
      rt.job = { id: crypto.randomUUID(), file: status.file, startedAt: Date.now() - (status.elapsedSec || 0) * 1000 };
      archive?.onJobStart(cfg, rt, status);
      energy.start(cfg, rt.job).catch(() => {});
      persistJob(cfg, rt, true);
    }
    if (rt.job.restored) {
      delete rt.job.restored;
      delete rt.job.recovered; // läuft noch – das Ende sehen wir live
    }
    rt.job.lastAt = Date.now();
    persistJob(cfg, rt);
    rt.job.lastProgress = status.progress;
    if (status.remainingSec != null) rt.job.lastRemaining = status.remainingSec;
    if (status.activeSlot) {
      rt.job.activeSlot = status.activeSlot;
      // benutzte Plätze merken – für die Filament-Zuordnung bei Mehrfarb-Drucken, die nicht aus PrintDock kamen
      rt.job.slotsUsed ||= [];
      if (!rt.job.slotsUsed.includes(status.activeSlot) && rt.job.slotsUsed.length < 16) rt.job.slotsUsed.push(status.activeSlot);
    }
    if (status.filamentUsedMm != null) rt.job.filamentMm = status.filamentUsedMm;
    return null;
  }
  let entry = null;
  // Manche Drucker (z. B. Anycubic im LAN-Modus, einige Klipper-Firmwares) springen nach dem Druck
  // direkt auf „bereit“ – ohne „fertig“ dazwischen. Dann am Fortschritt entscheiden.
  let endState = ENDED[status.state] ? status.state : null;
  if (!endState && rt.job && status.state === 'idle') {
    const nearlyDone = (rt.job.lastProgress ?? 0) >= 95 || (rt.job.lastRemaining != null && rt.job.lastRemaining <= 180 && (rt.job.lastProgress ?? 0) >= 80);
    endState = nearlyDone ? 'finished' : 'cancelled';
    console.log(`[${cfg.name}] Druckende ohne Abschlussmeldung erkannt (Fortschritt ${Math.round(rt.job.lastProgress ?? 0)} %) → ${endState === 'finished' ? 'fertig' : 'abgebrochen'}`);
  }
  if (rt.job && endState) {
    // übernommener Job: Ende = letztes Lebenszeichen, nicht jetzt
    const endedAt = rt.job.recovered && rt.job.lastAt ? rt.job.lastAt : Date.now();
    entry = {
      id: crypto.randomUUID(),
      printerId: cfg.id,
      printerName: cfg.name,
      file: rt.job.file || status.file,
      result: endState,
      progress: endState === 'finished' ? 100 : rt.job.lastProgress ?? null,
      startedAt: new Date(rt.job.startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      durationSec: Math.round((endedAt - rt.job.startedAt) / 1000),
      message: status.message || null,
      activeSlot: rt.job.activeSlot || null,
      filamentMm: rt.job.filamentMm || null,
      ...(rt.job.recovered ? { recovered: true } : {}),
      ...(rt.job.l1Photo ? { l1Photo: rt.job.l1Photo } : {}),
    };
    archive?.enrich(entry, rt.job);
    failures.onEnded(entry);
    history.push(entry);
    saveHistory();
    broadcast('history', entry);
    console.log(`[${cfg.name}] Druck ${ENDED[endState]}: ${entry.file}`);
    finishExtras(cfg, rt, rt.job, entry).catch((err) => console.warn(`[${cfg.name}] ${err.message}`));
  }
  // Bei 'offline' den Job behalten – der Drucker kann zurückkommen und weiterdrucken.
  if (status.state !== 'offline' && rt.job) {
    rt.job = null;
    persistJob(cfg, rt, true);
  }
  return entry;
}

// Notaus über Home Assistant (Rauch, Hitze → Steckdosen aus)
const { Emergency } = require('./lib/emergency');
const emergency = new Emergency({
  ha: () => ha,
  printers: () => printerConfigs,
  broadcast,
  notify: (cfg, entry) => notifier.dispatch('emergency', cfg, runtime.get(cfg.id)?.driver.status || null, entry).catch((err) => console.warn(err.message)),
});

// Startregeln je Drucker: Zeitfenster, günstiger Strom (nur automatische Starts)
const { StartRules } = require('./lib/startrules');
const startRules = new StartRules({ ha: () => ha, printers: () => printerConfigs });
production.ctx.startRule = (p, f) => startRules.check(p, f);

// Hängende Warteschlangen-Einträge („druckt“, Drucker aber längst bereit)
production.ctx.hasJob = (printerId) => Boolean(runtime.get(printerId)?.job);
production.ctx.onHistoryLinked = () => saveHistory();
production.ctx.externalJob = (printerId) => {
  const j = runtime.get(printerId)?.job;
  return j?.external ? j.file || '?' : null;
};
/** Druckende nachtragen, das PrintDock verpasst hat: Verlaufseintrag, Auftrag, Filament wie bei einem echten Ende */
production.ctx.resolveLost = (q, result, { auto = false } = {}) => {
  const cfg = printerConfigs.find((p) => p.id === q.printerId);
  const startedAt = Date.parse(q.startedAt) || Date.now();
  const endedAt = q.lastSeenAt && q.lastSeenAt > startedAt ? q.lastSeenAt : Date.now();
  const entry = {
    id: crypto.randomUUID(),
    printerId: q.printerId,
    printerName: cfg?.name || '?',
    file: files.get(q.fileId)?.name || '?',
    result,
    progress: result === 'finished' ? 100 : q.lastProgress ?? null,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    durationSec: Math.round((endedAt - startedAt) / 1000),
    message: auto ? 'Druckende nachträglich erkannt' : 'Von Hand abgeschlossen',
    recovered: true,
  };
  if (result !== 'finished' && !auto) entry.failOpen = false;
  history.push(entry);
  production.closeItem(q, entry);
  try {
    if (cfg && app.moduleOn('filament')) filament.onJobEnd(cfg, entry);
  } catch (err) {
    console.warn(`Filament-Abbuchung fehlgeschlagen: ${err.message}`);
  }
  if (app.partLabels && result === 'finished' && entry.orderId) entry.labelPending = true;
  saveHistory();
  broadcast('history', null);
  console.log(`[${entry.printerName}] Hängender Eintrag abgeschlossen: ${entry.file} → ${result}`);
  return entry;
};

// Automatische Druckerwahl: liegt das Filament der Datei im Drucker?
production.ctx.fit = (p, f) => (require('./lib/app').moduleOn('filament') ? filament.fitFor(p, f) : { ok: true, score: 0 });
// Automatische Sicherung (täglich)
const backupInfo = () => ({ version: require('./package.json').version, printers: printerConfigs.length, auto: true });
require('./lib/autobackup').schedule(backupInfo);
const { Costs } = require('./lib/costs');
const costs = new Costs({ filament, history: () => history, printers: () => printerConfigs });
const { Remote } = require('./lib/remote');
const remote = new Remote({ port: PORT, broadcast, authEnabled: () => require('./lib/app').authEnabled });
const { Shop } = require('./lib/shop');
const shop = new Shop({ db: require('./lib/filament').db, filament, broadcast });
const { Reserve } = require('./lib/reserve');
const reserve = new Reserve({ printers: () => printerConfigs, runtime, filament, production, shop });
const { Failures } = require('./lib/failures');
const failures = new Failures({ history: () => history, saveHistory: () => saveHistory(), production, broadcast });
const { EnergyTracker } = require('./lib/energy');
const energy = new EnergyTracker({ ha });
const PHOTO_DIR = path.join(require('./lib/store').DATA_DIR, 'photos');

// Archiv: Drucke, die nicht aus PrintDock kamen, erkennen, Datei vom Drucker holen, Auftrag zuordnen
const { Archive } = require('./lib/archive');
archive = new Archive({
  history: () => history, saveHistory: () => saveHistory(), broadcast, production, files, app,
  printers: () => printerConfigs, runtime, persistJob: (cfg, rt) => persistJob(cfg, rt),
});
// Status-Server für Kunden-Links (relay/): freigegebene Aufträge dorthin veröffentlichen
const { Relay } = require('./lib/relay');
relay = new Relay({ production, history: () => history, photoDir: PHOTO_DIR, lang: () => app.lang });
production.ctx.onShareRemoved = (token) => relay.remove(token);

/** Nach dem Druck: Stromverbrauch und Foto des fertigen Teils an den Verlaufseintrag hängen */
async function finishExtras(cfg, rt, job, entry) {
  let changed = false;
  const kwh = await energy.finish(cfg, job);
  if (kwh != null) {
    entry.energyKwh = kwh;
    changed = true;
  }
  if (require('./lib/app').photos && entry.result === 'finished' && rt.driver.status?.camera !== false) {
    const jpg = await notifier.getSnapshot(cfg.id);
    if (jpg?.length) {
      fs.mkdirSync(PHOTO_DIR, { recursive: true });
      fs.writeFileSync(path.join(PHOTO_DIR, `${entry.id}.jpg`), jpg);
      entry.photo = true;
      changed = true;
    }
  }
  // Etikett für das fertige Teil vormerken (nur Auftragsdrucke)
  if (require('./lib/app').partLabels && entry.result === 'finished' && entry.orderId) {
    entry.labelPending = true;
    changed = true;
  }
  if (changed) {
    saveHistory();
    broadcast('history', null);
  }
}

/** Etiketten für fertige Auftragsteile: Daten je Verlaufseintrag */
function partLabels(entries) {
  return entries.map((h) => {
    const o = production.orders().find((x) => x.id === h.orderId);
    if (!o) return null;
    const done = history.filter((x) => x.orderId === o.id && x.result === 'finished').sort((a, b) => Date.parse(a.endedAt) - Date.parse(b.endedAt));
    return {
      id: h.id, orderId: o.id, nr: o.nr, title: o.title, customer: o.customer || '', file: h.file, endedAt: h.endedAt,
      n: done.findIndex((x) => x.id === h.id) + 1, of: o.qty, shareToken: o.shareToken || null,
      color: filament.spoolRecords().find((sp) => sp.id === h.filament?.[0]?.spoolId)?.color || null,
    };
  }).filter(Boolean);
}

/** Foto nach der ersten Schicht (Option): ab Schicht 2 bzw. 3 % Fortschritt einmal je Druck */
function firstLayerPhoto(cfg, rt, status) {
  if (!app.firstLayer || !rt.job || rt.job.l1 || status.state !== 'printing') return;
  const second = status.layer != null ? status.layer >= 2 : (status.progress ?? 0) >= 3;
  if (!second || status.camera === false) return;
  rt.job.l1 = true;
  (async () => {
    const jpg = await notifier.getSnapshot(cfg.id);
    if (!jpg?.length) return;
    fs.mkdirSync(PHOTO_DIR, { recursive: true });
    const name = `l1-${cfg.id.slice(0, 8)}-${Date.now()}.jpg`;
    fs.writeFileSync(path.join(PHOTO_DIR, name), jpg);
    if (rt.job) {
      rt.job.l1Photo = name;
      persistJob(cfg, rt, true);
    }
    broadcast('firstLayer', { printerId: cfg.id, photo: name });
    notifier.dispatch('firstLayer', cfg, status, { file: status.file, photo: name }).catch((err) => console.warn(err.message));
    console.log(`[${cfg.name}] Foto der ersten Schicht gespeichert`);
  })().catch((err) => console.warn(`[${cfg.name}] Erste Schicht: ${err.message}`));
}

async function startPrinter(cfg) {
  const Driver = byId[cfg.driver];
  if (!Driver) {
    console.warn(`Unbekannter Treiber "${cfg.driver}" für ${cfg.name}`);
    return;
  }
  const driver = new Driver(cfg.config || {});
  const saved = jobsDb.data[cfg.id];
  const rt = { driver, job: saved ? { ...saved, restored: true, recovered: true } : null, lastState: undefined, offlineTimer: null, createdAt: Date.now() };
  runtime.set(cfg.id, rt);
  driver.on('status', (status) => {
    if (runtime.get(cfg.id) !== rt) return; // veraltete Instanz
    const entry = trackJob(cfg, rt, status);
    firstLayerPhoto(cfg, rt, status);
    detectEvents(rt, status, entry, (event, e) => {
      notifier.dispatch(event, cfg, rt.driver.status, e).catch((err) => console.warn(err.message));
    });
    const filOn = app.moduleOn('filament');
    if (filOn) filament.onStatus(cfg, status);
    production.onStatus(cfg, status, entry);
    if (entry) {
      try {
        if (filOn) filament.onJobEnd(cfg, entry);
      } catch (err) {
        console.warn(`Filament-Abbuchung fehlgeschlagen: ${err.message}`);
      }
      archive?.afterEnd(entry, cfg, rt); // Fremddruck: Datei holen, eindeutigen Auftrag zuordnen
      saveHistory(); // Auftrag, Warteschlange und Filament nachgetragen
      ha.onJobEnd(cfg);
    }
    if (ACTIVE.has(status.state)) ha.cancelAutoOff(cfg.id);
    ha.publishState(cfg);
    broadcast('status', { id: cfg.id, status });
  });
  try {
    await driver.start();
  } catch (err) {
    driver.setOffline(err.message);
  }
}

async function stopPrinter(id) {
  const rt = runtime.get(id);
  if (!rt) return;
  runtime.delete(id);
  clearTimeout(rt.offlineTimer);
  cameras.drop(id);
  try {
    await rt.driver.stop();
  } catch {
    /* egal */
  }
}

function publicPrinter(cfg) {
  const fields = byId[cfg.driver]?.meta.fields || [];
  return {
    id: cfg.id,
    name: cfg.name,
    driver: cfg.driver,
    settings: cfg.settings || {},
    demo: Boolean(cfg.demo),
    firstLayer: runtime.get(cfg.id)?.job?.l1Photo || null,
    power: ha?.power[cfg.id] ?? null,
    canStart: byId[cfg.driver]?.prototype.startPrint !== require('./drivers/base').BaseDriver.prototype.startPrint,
    config: maskFields(fields, cfg.config),
    status: runtime.get(cfg.id)?.driver.status || null,
  };
}

function validatePrinter(body, existing) {
  const name = String(body.name || '').trim();
  if (!name) throw httpError(400, 'Name fehlt');
  const Driver = byId[body.driver];
  if (!Driver) throw httpError(400, 'Unbekannte Anbindung');
  const prev = existing?.driver === body.driver ? existing.config : null;
  const st = body.settings || {};
  const settings = {
    model: String(st.model || '').trim().slice(0, 80),
    autoStart: st.autoStart === true || st.autoStart === 'true',
    hoursOffset: Math.max(0, Number(st.hoursOffset) || 0),
    slots: String(st.slots || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 16).join(', '),
    powerEntity: /^(switch|light|input_boolean)\.[\w]+$/.test(String(st.powerEntity || '').trim()) ? String(st.powerEntity).trim() : '',
    energyEntity: /^sensor\.[\w]+$/.test(String(st.energyEntity || '').trim()) ? String(st.energyEntity).trim() : '',
    autoOff: st.autoOff === true || st.autoOff === 'true',
    autoOffDelay: Math.max(1, Math.min(240, Number(st.autoOffDelay) || 10)),
    autoOffMaxTemp: Math.max(30, Math.min(120, Number(st.autoOffMaxTemp) || 50)),
    ...require('./lib/startrules').cleanRules(st),
  };
  return { name, driver: body.driver, settings, config: validateFields(Driver.meta.fields, body.config, prev) };
}

function publicChannel(c) {
  return { ...c, config: maskFields(CHANNELS[c.type]?.fields || [], c.config), lastResult: channelResults.get(c.id) || null };
}

function validateChannel(body, existing) {
  const name = String(body.name || '').trim();
  const type = CHANNELS[body.type];
  if (!type) throw httpError(400, 'Unbekannter Kanaltyp');
  const prev = existing?.type === body.type ? existing.config : null;
  const validEvents = new Set(EVENTS.map((e) => e.id));
  return {
    name: name || type.label,
    type: body.type,
    enabled: body.enabled !== false,
    attachImage: Boolean(body.attachImage) && type.image,
    events: (Array.isArray(body.events) ? body.events : []).filter((e) => validEvents.has(e)),
    config: validateFields(type.fields, body.config, prev),
  };
}

// ---------------------------------------------------------------- HTTP

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/**
 * PrintDock neu starten (z. B. nach dem Einspielen einer Sicherung).
 * Add-on: über den Supervisor. Docker/systemd (PRINTDOCK_RESTART=exit): Prozess beenden, der Dienst startet neu.
 * Sonst: 'manual' – von Hand neu starten.
 */
async function restartSelf() {
  if (process.env.SUPERVISOR_TOKEN) {
    setTimeout(() => {
      fetch('http://supervisor/addons/self/restart', { method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}` } })
        .catch((err) => console.warn(`Neustart über den Supervisor fehlgeschlagen: ${err.message}`));
    }, 800);
    return 'auto';
  }
  if (process.env.PRINTDOCK_RESTART === 'exit') {
    setTimeout(() => process.exit(75), 800);
    return 'auto';
  }
  return 'manual';
}

const updater = require('./lib/updater');
/** Neuere Version bekannt? (für den Hinweis in der Oberfläche) */
function updateAvailable() {
  const last = updater.settings().last;
  return last?.latest && updater.cmp(last.latest, require('./package.json').version) > 0 ? last.latest.replace(/^v/, '') : null;
}
// Alle 6 Stunden nach Updates sehen (Fehler still – z. B. privates Repository ohne Token).
// Eine neue Version wird einmal gemeldet (Oberfläche und – wenn eingeschaltet – Benachrichtigung „Update verfügbar“).
const updNote = require('./lib/store').store('update-notice.json', { notified: null });
setTimeout(function autoCheck() {
  updater.check().then((r) => {
    broadcast('app', null);
    if (r?.newer && r.latest && updNote.data.notified !== r.latest) {
      updNote.data.notified = r.latest;
      updNote.save();
      console.log(`Update verfügbar: ${r.latest}`);
      notifier.dispatch('update', { id: 'printdock', name: 'PrintDock' }, null, { version: String(r.latest).replace(/^v/, '') }).catch(() => {});
    }
  }).catch((err) => console.warn(`Update-Prüfung: ${err.message}`));
  setTimeout(autoCheck, 6 * 3600_000).unref();
}, 90_000).unref();

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) reject(httpError(413, 'Anfrage zu groß'));
      else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {});
      } catch {
        reject(httpError(400, 'Ungültiges JSON'));
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
};

const APP_VERSION = require('./package.json').version;
const audit = require('./lib/audit');
/** Was Bediener (Rolle „operator“) ändern dürfen: Druckbetrieb, Filament am Drucker, Nachbearbeitung */
const OPERATOR_WRITES = [
  /^queue$/, /^queue\/[^/]+$/, /^queue\/[^/]+\/(start|dry-start|dry-cancel|resolve|requeue)$/, /^queue\/reorder$/,
  /^printers\/[^/]+\/(plate-clear|command|power)$/,
  /^history\/[^/]+\/(fail|unfail|requeue|dismiss)$/, /^archive\/[^/]+\/(assign|reprint)$/,
  /^orders\/[^/]+\/(plan|post|mode)$/, /^labels\/printed$/,
  /^spools\/[^/]+\/(weigh|book|dried)$/, /^filament\/(assign|from-slot|ignore|disarm|dry)$/,
  /^rfid(\/.*)?$/, /^stations\/[^/]+\/(weigh|tare|identify|write)$/,
  /^filament\/shop\/order(\/[^/]+\/arrived)?$/,
];
function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'Verboten' });
  fs.readFile(file, (err, buf) => {
    if (err) return sendJson(res, 404, { error: 'Nicht gefunden' });
    // index.html: Skripte mit Versionsnummer laden, damit nach einem Update nie alte Dateien aus dem Cache kommen
    if (file.endsWith('index.html')) buf = Buffer.from(buf.toString('utf8').replace(/(src|href)="((?:[\w-]+\/)?[\w-]+\.(?:js|svg|webmanifest))"/g, `$1="$2?v=${APP_VERSION}"`));
    const etag = `"${crypto.createHash('sha1').update(buf).digest('base64').slice(0, 20)}"`;
    // Immer beim Server nachfragen (304, wenn unverändert) – Browser und Home-Assistant-App cachen sonst alte Stände
    const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ETag: etag };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    res.writeHead(200, headers);
    res.end(buf);
  });
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const [, resource, id, action] = parts;

  // ---- App-Einstellungen und Login (ohne Anmeldung erreichbar)
  if (resource === 'app' && !id && req.method === 'GET') return sendJson(res, 200, { ...app.publicSettings(req), directUrl: ha.directUrl, statusBase: relay?.linkBase() || null, update: updateAvailable() });
  if (resource === 'login' && req.method === 'POST') {
    const lb = await readBody(req);
    app.login(req, res, lb);
    audit.log({ user: String(lb.user || '').slice(0, 40), method: 'POST', path: 'login' });
    return sendJson(res, 200, { ok: true });
  }
  if (resource === 'logout' && req.method === 'POST') {
    app.logout(req, res);
    return sendJson(res, 200, { ok: true });
  }
  // Ersteinrichtung ist ohne Login möglich, solange sie nicht abgeschlossen ist
  const setupOpen = !app.publicSettings(req).setupDone;
  if (!app.isAuthed(req) && !(setupOpen && resource === 'app')) throw httpError(401, 'Bitte anmelden');

  // Rollen: Bediener dürfen schauen und den Druckbetrieb bedienen, aber nichts einstellen
  const me = app.who(req);
  const sub = parts.slice(1).join('/');
  if (me.role === 'operator') {
    const adminGet = /^(backup|autobackup|remote|relay|users|audit|printers\/[^/]+\/diagnostics|update)/.test(sub);
    if ((req.method === 'GET' && adminGet) || (req.method !== 'GET' && !OPERATOR_WRITES.some((re) => re.test(sub)))) throw httpError(403, 'Nur für Admins – als Bediener nicht erlaubt');
  }
  if (req.method !== 'GET') {
    audit.log({ user: me.name || (me.kind === 'local' ? 'Heimnetz' : me.kind === 'open' ? null : me.kind), role: me.role, method: req.method, path: sub });
  }

  // ---- Status-Server für Kunden-Links
  if (resource === 'relay') {
    if (!id && req.method === 'GET') return sendJson(res, 200, relay.view());
    if (!id && req.method === 'PUT') return sendJson(res, 200, await relay.save(await readBody(req)));
    if (id === 'test' && req.method === 'POST') return sendJson(res, 200, await relay.test());
    if (id === 'sync' && req.method === 'POST') {
      await relay.syncAll();
      return sendJson(res, 200, relay.view());
    }
  }

  // ---- Plattform-Check
  if (resource === 'platform' && req.method === 'GET') {
    return sendJson(res, 200, await require('./lib/platform').check({
      ffmpeg: ffmpegAvailable, ffmpegPath, ha, remote, port: PORT, directUrl: ha.directUrl,
      inboxDir: require('./lib/inbox').INBOX_DIR, backupDir: require('./lib/autobackup').BACKUP_DIR,
    }));
  }

  // ---- Benutzer und Protokoll (nur Admins, siehe oben)
  if (resource === 'users') {
    if (!id && req.method === 'GET') return sendJson(res, 200, app.usersView());
    if (!id && req.method === 'POST') return sendJson(res, 201, app.saveUser(await readBody(req)));
    if (id && req.method === 'PUT') return sendJson(res, 200, app.saveUser(await readBody(req), id));
    if (id && req.method === 'DELETE') return sendJson(res, 200, app.removeUser(id));
  }
  if (resource === 'audit' && req.method === 'GET') return sendJson(res, 200, audit.list({ limit: Math.min(1000, Number(url.searchParams.get('limit')) || 300), user: url.searchParams.get('user') || null }));

  // ---- Fernzugriff (Tailscale, Cloudflare Tunnel)
  if (resource === 'remote') {
    if (!id && req.method === 'GET') return sendJson(res, 200, remote.view());
    if (!id && req.method === 'PUT') return sendJson(res, 200, await remote.save(await readBody(req)));
    if (id === 'tailscale' && action === 'logout' && req.method === 'POST') return sendJson(res, 200, await remote.tailscaleLogout());
  }

  if (resource === 'app') {
    if (!id && req.method === 'PUT') {
      const before = app.moduleOn('homeassistant');
      app.save(await readBody(req));
      remote.authChanged();
      if (before !== app.moduleOn('homeassistant')) ha.init().catch(() => {});
      broadcast('app', null);
      return sendJson(res, 200, { ...app.publicSettings(req), directUrl: ha.directUrl, update: updateAvailable() });
    }
    if (id === 'key' && req.method === 'GET') return sendJson(res, 200, { apiKey: app.apiKey });
  }

  if (resource === 'stats' && req.method === 'GET') {
    const days = Math.max(0, Math.min(3650, Number(url.searchParams.get('days') ?? 30) || 0));
    return sendJson(res, 200, stats.compute({ history, usage: filament.usageRecords(), printers: printerConfigs, days }));
  }

  if (resource === 'events' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': verbunden\n\n');
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
    return;
  }

  if (resource === 'drivers' && req.method === 'GET') {
    return sendJson(res, 200, drivers.map((D) => D.meta));
  }

  // ---- Fotos (erste Schicht)
  if (resource === 'photos' && id && req.method === 'GET') {
    const file = path.join(PHOTO_DIR, String(id).replace(/[^\w.-]/g, ''));
    if (!/\.jpg$/.test(file) || !fs.existsSync(file)) throw httpError(404, 'Kein Foto');
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' });
    return fs.createReadStream(file).pipe(res);
  }

  // ---- Verlauf
  // ---- Archiv: Suche, Filter, Export, Auftrag zuordnen, nochmal drucken
  if (resource === 'archive') {
    const deco = (h) => ({ ...h, costs: costs.forEntry(h) });
    if (id === 'export.csv' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="printdock-archiv-${new Date().toISOString().slice(0, 10)}.csv"` });
      return res.end(archive.csv(url.searchParams, deco));
    }
    if (!id && req.method === 'GET') return sendJson(res, 200, archive.query(url.searchParams, deco));
    if (id && action === 'candidates' && req.method === 'GET') return sendJson(res, 200, archive.candidates(id));
    if (id && action === 'assign' && req.method === 'POST') return sendJson(res, 200, archive.assign(id, await readBody(req)));
    if (id && action === 'reprint' && req.method === 'POST') return sendJson(res, 201, archive.reprint(id, await readBody(req)));
  }
  if (resource === 'history') {
    if (id && action === 'photo' && req.method === 'GET') {
      const file = path.join(PHOTO_DIR, `${String(id).replace(/[^\w-]/g, '')}.jpg`);
      if (!fs.existsSync(file)) throw httpError(404, 'Kein Foto');
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' });
      return fs.createReadStream(file).pipe(res);
    }
    if (id && req.method === 'POST' && ['fail', 'unfail', 'requeue', 'dismiss'].includes(action)) {
      const body = action === 'fail' || action === 'requeue' ? await readBody(req) : {};
      if (action === 'fail') return sendJson(res, 200, failures.mark(id, body));
      if (action === 'unfail') return sendJson(res, 200, failures.unmark(id));
      if (action === 'requeue') return sendJson(res, 200, failures.requeue(id, body));
      return sendJson(res, 200, failures.dismiss(id));
    }
    if (req.method === 'GET') {
      const limit = Math.min(Number(url.searchParams.get('limit')) || 200, HISTORY_MAX);
      return sendJson(res, 200, history.slice(-limit).reverse().map((h) => ({ ...h, costs: costs.forEntry(h) })));
    }
    if (req.method === 'DELETE' && !id) {
      history = [];
      fs.rmSync(PHOTO_DIR, { recursive: true, force: true });
      saveHistory();
      return sendJson(res, 200, { ok: true });
    }
  }

  // ---- Benachrichtigungen
  if (resource === 'notification-types' && req.method === 'GET') {
    return sendJson(res, 200, {
      events: EVENTS,
      channels: Object.entries(CHANNELS).map(([key, c]) => ({ id: key, label: c.label, hint: c.hint, fields: c.fields, image: c.image })),
    });
  }

  if (resource === 'notifications') {
    if (!id && req.method === 'GET') return sendJson(res, 200, channels.map(publicChannel));
    if (!id && req.method === 'POST') {
      const c = { id: crypto.randomUUID(), ...validateChannel(await readBody(req)) };
      channels.push(c);
      saveChannels();
      broadcast('channels', null);
      return sendJson(res, 201, publicChannel(c));
    }
    const idx = channels.findIndex((c) => c.id === id);
    if (idx < 0) throw httpError(404, 'Kanal nicht gefunden');
    if (!action && req.method === 'PUT') {
      channels[idx] = { id, ...validateChannel(await readBody(req), channels[idx]) };
      saveChannels();
      broadcast('channels', null);
      return sendJson(res, 200, publicChannel(channels[idx]));
    }
    // Schnellschalter aus der Liste: Kamerabild an/aus, Kanal an/aus
    if (action === 'set' && req.method === 'POST') {
      const b = await readBody(req);
      if (typeof b.attachImage === 'boolean') channels[idx].attachImage = b.attachImage;
      if (typeof b.enabled === 'boolean') channels[idx].enabled = b.enabled;
      saveChannels();
      broadcast('channels', null);
      return sendJson(res, 200, publicChannel(channels[idx]));
    }
    if (!action && req.method === 'DELETE') {
      channels.splice(idx, 1);
      channelResults.delete(id);
      saveChannels();
      broadcast('channels', null);
      return sendJson(res, 200, { ok: true });
    }
    if (action === 'test' && req.method === 'POST') {
      // Mit Kamerabild des ersten Druckers, der eine Kamera hat
      const withCam = printerConfigs.find((p) => runtime.get(p.id)?.driver.status.camera);
      try {
        await notifier.test(channels[idx], withCam || null, withCam ? runtime.get(withCam.id).driver.status : null);
      } catch (err) {
        throw httpError(502, `Senden fehlgeschlagen: ${err.message}`);
      }
      return sendJson(res, 200, { ok: true });
    }
  }

  // ---- Übersicht
  if (resource === 'summary' && req.method === 'GET') return sendJson(res, 200, { ...production.summary(), ...filament.summary() });

  // ---- Home Assistant
  if (resource === 'ha') {
    if (!id && req.method === 'GET') return sendJson(res, 200, ha.publicSettings());
    if (!id && req.method === 'PUT') {
      const r = await ha.saveSettings(await readBody(req));
      broadcast('ha', null);
      return sendJson(res, 200, r);
    }
    if (id === 'test' && req.method === 'POST') return sendJson(res, 200, await ha.test());
    if (id === 'entities' && req.method === 'GET') {
      const kind = url.searchParams.get('kind');
      return sendJson(res, 200, await ha.entities(kind === 'dryer' ? ['switch', 'input_boolean', 'button', 'input_button', 'script', 'number', 'input_number', 'climate', 'fan'] : undefined));
    }
    if (id === 'humidity-sensors' && req.method === 'GET') return sendJson(res, 200, await ha.humiditySensors());
    if (id === 'energy-sensors' && req.method === 'GET') return sendJson(res, 200, await ha.energySensors());
    if (id === 'emergency' && !action && req.method === 'GET') return sendJson(res, 200, emergency.view());
    if (id === 'emergency' && !action && req.method === 'PUT') return sendJson(res, 200, emergency.save(await readBody(req)));
    if (id === 'emergency' && action === 'test' && req.method === 'POST') return sendJson(res, 200, await emergency.test((await readBody(req)).id));
    if (id === 'blueprints' && !action && req.method === 'GET') return sendJson(res, 200, ha.blueprints());
    if (id === 'blueprints' && action === 'install' && req.method === 'POST') return sendJson(res, 200, await ha.installBlueprints());
    if (id === 'blueprints' && action && req.method === 'GET') {
      const f = ha.blueprintPath(action);
      if (!f) throw httpError(404, 'Vorlage nicht gefunden');
      res.writeHead(200, { 'Content-Type': 'text/yaml; charset=utf-8', 'Content-Disposition': `attachment; filename="${path.basename(f)}"` });
      return fs.createReadStream(f).pipe(res);
    }
    if (id === 'notify-services' && req.method === 'GET') return sendJson(res, 200, await ha.notifyServices());
    if (id === 'restart' && req.method === 'POST') return sendJson(res, 200, await ha.restartCore());
    if (id === 'card' && req.method === 'POST') {
      if (ha.publicSettings().addon) {
        ha.cardInstalled = false;
        await ha.installCard();
        return sendJson(res, 200, ha.publicSettings().card);
      }
      return sendJson(res, 200, await ha.registerCardResource());
    }
  }

  // ---- Updates
  if (resource === 'update') {
    if (!id && req.method === 'GET') return sendJson(res, 200, updater.settings());
    if (!id && req.method === 'PUT') return sendJson(res, 200, updater.saveSettings(await readBody(req)));
    if (id === 'check' && req.method === 'POST') {
      const r = await updater.check();
      broadcast('app', null);
      return sendJson(res, 200, r);
    }
    if (id === 'install' && req.method === 'POST') return sendJson(res, 200, await updater.install(restartSelf));
  }

  // ---- Datensicherung
  if (resource === 'autobackup') {
    const ab = require('./lib/autobackup');
    if (!id && req.method === 'GET') return sendJson(res, 200, ab.view());
    if (!id && req.method === 'PUT') return sendJson(res, 200, ab.save(await readBody(req)));
    if (id === 'run' && req.method === 'POST') return sendJson(res, 200, await ab.run(backupInfo()));
    if (id === 'file' && req.method === 'GET') {
      const f = ab.filePath(url.searchParams.get('name'));
      if (!f) throw httpError(404, 'Sicherung nicht gefunden');
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${path.basename(f)}"` });
      return fs.createReadStream(f).pipe(res);
    }
  }
  if (resource === 'backup') {
    const backup = require('./lib/backup');
    const { DATA_DIR } = require('./lib/store');
    if (!id && req.method === 'GET') {
      const day = new Date().toISOString().slice(0, 10);
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="printdock-backup-${day}.zip"`, 'Cache-Control': 'no-store' });
      try {
        await backup.writeBackup(DATA_DIR, res, { version: require('./package.json').version, printers: printerConfigs.length });
        res.end();
      } catch (err) {
        console.warn(`Sicherung: ${err.message}`);
        res.destroy();
      }
      return;
    }
    if (id === 'restore' && req.method === 'POST') {
      const part = path.join(DATA_DIR, `${backup.PENDING}.part`);
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(part);
        req.pipe(out);
        out.on('finish', resolve);
        out.on('error', reject);
        req.on('error', reject);
      });
      let info;
      try {
        info = backup.inspect(part);
      } catch (err) {
        fs.rmSync(part, { force: true });
        return sendJson(res, 400, { error: err.status ? err.message : 'Das ist keine PrintDock-Sicherung' });
      }
      fs.renameSync(part, path.join(DATA_DIR, backup.PENDING));
      const restart = await restartSelf();
      return sendJson(res, 200, { ...info, restart });
    }
  }

  // ---- Demo-Daten
  if (resource === 'demo') {
    const ctx = { printerConfigs, startPrinter, stopPrinter, savePrinters, history, saveHistory, production, filament, broadcast };
    if (!id && req.method === 'GET') return sendJson(res, 200, { loaded: printerConfigs.some((p) => p.demo) });
    if (id === 'load' && req.method === 'POST') return sendJson(res, 200, await demoData.load(ctx));
    if (id === 'remove' && req.method === 'POST') return sendJson(res, 200, await demoData.remove(ctx));
  }

  // ---- Filament
  if (resource === 'spoolman') {
    if (!id && req.method === 'GET') return sendJson(res, 200, spoolman.publicSettings());
    if (!id && req.method === 'PUT') {
      const r = await spoolman.saveSettings(await readBody(req));
      broadcast('filament', null);
      return sendJson(res, 200, r);
    }
    if (id === 'test' && req.method === 'POST') {
      const b = await readBody(req);
      if (b.url !== undefined) await spoolman.saveSettings({ url: b.url });
      return sendJson(res, 200, await spoolman.test());
    }
    if (id === 'sync' && req.method === 'POST') {
      const r = await spoolman.sync();
      return sendJson(res, 200, { ...r, settings: spoolman.publicSettings() });
    }
  }
  if (resource === 'filament') {
    if (!id && req.method === 'GET') return sendJson(res, 200, { ...filament.view(), spoolman: spoolman.publicSettings(), stations: stations.view(), dryers: drying.view() });
    if (id === 'dryers') {
      const b = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
      if (!action && req.method === 'POST') return sendJson(res, 201, drying.saveDryer(b));
      if (action && req.method === 'PUT') return sendJson(res, 200, drying.saveDryer(b, action));
      if (action && req.method === 'DELETE') { drying.deleteDryer(action); return sendJson(res, 200, { ok: true }); }
    }
    if (id === 'dry' && req.method === 'POST') {
      const b = await readBody(req);
      return sendJson(res, 200, b.stop ? await drying.stop(b.key) : await drying.start(b.key, b));
    }
    if (id === 'disarm' && req.method === 'POST') { filament.disarm(); return sendJson(res, 200, { ok: true }); }
    // Feuchte-Messstellen (Sensor aus Home Assistant oder PrintDock Station → AMS/ACE-Einheit, Drucker oder Trockenbox)
    if (id === 'hum-sources') {
      const sid = action;
      if (!sid && req.method === 'POST') { const r = filament.saveHumSource(await readBody(req)); ha.pollHumidity().catch(() => {}); return sendJson(res, 201, r); }
      if (sid && req.method === 'PUT') { const r = filament.saveHumSource(await readBody(req), sid); ha.pollHumidity().catch(() => {}); return sendJson(res, 200, r); }
      if (sid && req.method === 'DELETE') { filament.deleteHumSource(sid); return sendJson(res, 200, { ok: true }); }
    }
    if (id === 'assign' && req.method === 'POST') {
      const b = await readBody(req);
      filament.assign(b.printerId, b.key, b.spoolId || null);
      return sendJson(res, 200, { ok: true });
    }
    if (id === 'from-slot' && req.method === 'POST') {
      const b = await readBody(req);
      return sendJson(res, 201, filament.fromSlot(b.printerId, b.key, b));
    }
    if (id === 'ignore' && req.method === 'POST') {
      const b = await readBody(req);
      filament.ignoreSlot(b.printerId, b.key);
      return sendJson(res, 200, { ok: true });
    }
    if (id === 'settings' && req.method === 'PUT') return sendJson(res, 200, filament.saveSettings(await readBody(req)));
    if (id === 'humcheck' && req.method === 'GET') return sendJson(res, 200, humcheck.view());
    if (id === 'humcheck' && req.method === 'PUT') {
      const r = humcheck.save(await readBody(req));
      production.dispatch();
      return sendJson(res, 200, r);
    }
    if (id === 'mapping' && req.method === 'GET') {
      const cfg = printerConfigs.find((p) => p.id === url.searchParams.get('printerId'));
      const item = production.getItem(url.searchParams.get('queueId'));
      if (!cfg || !item) throw httpError(404, 'Drucker oder Eintrag nicht gefunden');
      const map = filament.mappingFor(cfg, files.get(item.fileId), item.options);
      // Reservierungen anderer offener Drucke auf den Spulen dieses Druckers (Warnung im Startdialog)
      try {
        const r = reserve.compute();
        const recs = filament.spoolRecords();
        map.reservedOthers = {};
        for (const sl of map.slots) {
          const sp = sl.spool && recs.find((x) => x.nr === sl.spool.nr && !x.archived);
          if (!sp) continue;
          const others = Object.entries(r.items).filter(([qid]) => qid !== item.id).flatMap(([, it]) => it.uses.filter((u) => u.spoolId === sp.id));
          if (others.length) map.reservedOthers[sl.key] = { grams: others.reduce((a, u) => a + u.grams, 0), jobs: others.length };
        }
      } catch (err) {
        console.warn(`Reservierung: ${err.message}`);
      }
      return sendJson(res, 200, map);
    }
    if (id === 'reservations' && req.method === 'GET') return sendJson(res, 200, { ...reserve.compute(), shop: shop.view() });
    // Einkauf: Bezugsquellen und Bestellungen
    if (id === 'shop') {
      const b = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
      const oid = parts[4];
      if (!action && req.method === 'GET') return sendJson(res, 200, shop.view());
      if (action === 'source' && req.method === 'PUT') return sendJson(res, 200, shop.saveSource(b));
      if (action === 'order' && !oid && req.method === 'POST') return sendJson(res, 201, shop.order(b));
      if (action === 'order' && oid && parts[5] === 'arrived' && req.method === 'POST') return sendJson(res, 200, shop.arrived(oid));
      if (action === 'order' && oid && req.method === 'DELETE') { shop.remove(oid); return sendJson(res, 200, { ok: true }); }
    }
    if (id === 'check' && req.method === 'GET') {
      const cfg = printerConfigs.find((p) => p.id === url.searchParams.get('printerId'));
      const item = production.getItem(url.searchParams.get('queueId'));
      if (!cfg || !item) throw httpError(404, 'Drucker oder Eintrag nicht gefunden');
      return sendJson(res, 200, filament.check(cfg, files.get(item.fileId), item.options));
    }
  }
  if (resource === 'spools' && action === 'dried' && req.method === 'POST') return sendJson(res, 200, filament.dried(id));
  // RFID/NFC: Leser am Drucker (ESPHome) oder Handy melden einen Tag bzw. eine Spulennummer
  if (resource === 'rfid' && !id && req.method === 'POST') return sendJson(res, 200, filament.rfidScan(await readBody(req)));
  if (resource === 'rfid' && id === 'phone' && req.method === 'POST') return sendJson(res, 200, filament.phoneScan(await readBody(req)));
  if (resource === 'rfid' && id === 'assign' && req.method === 'POST') return sendJson(res, 200, filament.rfidAssign((await readBody(req)).spoolId));
  if (resource === 'rfid' && id === 'dismiss' && req.method === 'POST') { filament.pendingTag = null; filament.save(); return sendJson(res, 200, { ok: true }); }
  // Neue Spule aus einem gelesenen Tag (OpenSpool/Anycubic-Daten) anlegen
  if (resource === 'rfid' && id === 'create' && req.method === 'POST') {
    const p = filament.pendingTag;
    if (!p) throw httpError(404, 'Kein offener Tag');
    const b = await readBody(req);
    const d = p.data || {};
    const spool = filament.saveSpool({
      material: b.material || d.material || 'PLA', brand: b.brand ?? d.brand ?? '', color: b.color || d.color || '#888888',
      colorName: b.colorName || (d.color ? require('./lib/colors').nameOf(d.color) : ''), netWeight: b.netWeight || d.netWeight || 1000,
      diameter: d.diameter || 1.75, remaining: b.remaining, tare: b.tare, rfid: p.tag,
    })[0];
    return sendJson(res, 201, filament.rfidAssign(spool.id));
  }
  // Inhalt eines Tags (fürs Beschreiben mit dem Handy): Link und OpenSpool-Daten
  if (resource === 'spools' && action === 'tag' && req.method === 'GET') {
    const sp = require('./lib/filament').db.data.spools.find((s) => s.id === id);
    if (!sp) throw httpError(404, 'Spule nicht gefunden');
    return sendJson(res, 200, { url: tags.spoolUrl(ha?.directUrl || '', sp), openspool: tags.openSpoolJson(sp) });
  }
  // ---- Stationen
  if (resource === 'stations') {
    const b = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
    if (!id && req.method === 'GET') return sendJson(res, 200, stations.view());
    if (id === 'pair' && req.method === 'POST') return sendJson(res, 201, stations.accept(b.id, b));
    if (id === 'reject' && req.method === 'POST') { stations.reject(b.id); return sendJson(res, 200, { ok: true }); }
    if (id && !action && req.method === 'PUT') return sendJson(res, 200, stations.update(id, b));
    if (id && !action && req.method === 'DELETE') { stations.remove(id); return sendJson(res, 200, { ok: true }); }
    if (action === 'tare' && req.method === 'POST') return sendJson(res, 200, stations.tare(id));
    if (action === 'weigh' && req.method === 'POST') return sendJson(res, 200, stations.weighSpool(id, b.spoolId));
    if (action === 'calibrate' && req.method === 'POST') return sendJson(res, 200, stations.calibrate(id, b.grams));
    if (action === 'identify' && req.method === 'POST') return sendJson(res, 200, stations.identifyStation(id));
    if (action === 'write' && req.method === 'POST') return sendJson(res, 200, await stations.write(id, b.spoolId, b.format || 'universal'));
  }
  if (resource === 'spools') {
    if (!id && req.method === 'POST') return sendJson(res, 201, filament.saveSpool(await readBody(req)));
    if (id && !action && req.method === 'PUT') return sendJson(res, 200, filament.saveSpool(await readBody(req), id));
    if (id && !action && req.method === 'DELETE') {
      filament.deleteSpool(id);
      return sendJson(res, 200, { ok: true });
    }
    if (action === 'weigh' && req.method === 'POST') return sendJson(res, 200, filament.weigh(id, (await readBody(req)).gross));
    if (action === 'book' && req.method === 'POST') {
      const b = await readBody(req);
      return sendJson(res, 200, filament.book(id, b.grams, b.note));
    }
  }

  // ---- Dateien
  if (resource === 'files') {
    if (!id && req.method === 'GET') {
      // neu geslicte Version: Aufträge, die noch die ältere Datei nutzen
      return sendJson(res, 200, files.list().map((f) => (f.replaces ? { ...f, replacesOrders: production.ordersUsingFile(f.replaces), replacesName: files.get(f.replaces)?.name || null } : f)));
    }
    if (!id && req.method === 'POST') {
      const name = decodeURIComponent(req.headers['x-filename'] || '');
      if (!name) throw httpError(400, 'Dateiname fehlt');
      const f = await files.addFromStream(req, name, { source: 'upload' });
      broadcast('files', null);
      return sendJson(res, 201, f);
    }
    const f = files.get(id);
    if (!f) throw httpError(404, 'Datei nicht gefunden');
    if (!action && req.method === 'GET') return sendJson(res, 200, f);
    if (!action && req.method === 'PATCH') {
      const updated = files.update(id, await readBody(req));
      broadcast('files', null);
      return sendJson(res, 200, updated);
    }
    if (!action && req.method === 'DELETE') {
      if (production.queueView().some((q) => q.fileId === id && ['queued', 'sending', 'printing'].includes(q.status))) {
        throw httpError(409, 'Datei ist noch in der Warteschlange eingeplant');
      }
      files.remove(id);
      broadcast('files', null);
      return sendJson(res, 200, { ok: true });
    }
    if (action === 'thumb' && req.method === 'GET') {
      if (!f.thumb) throw httpError(404, 'Kein Vorschaubild');
      res.writeHead(200, { 'Content-Type': f.thumb, 'Cache-Control': 'max-age=86400' });
      return fs.createReadStream(files.thumbPath(f)).pipe(res);
    }
    if (action === 'dl' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': f.size,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        'Access-Control-Allow-Origin': '*',
      });
      return fs.createReadStream(files.filePath(f)).pipe(res);
    }
  }

  // ---- Warteschlange
  if (resource === 'queue') {
    if (!id && req.method === 'GET') return sendJson(res, 200, production.queueView());
    if (!id && req.method === 'POST') return sendJson(res, 201, production.addToQueue(await readBody(req)));
    if (id === 'reorder' && req.method === 'POST') {
      production.reorder((await readBody(req)).ids || []);
      return sendJson(res, 200, { ok: true });
    }
    if (id === 'clear-finished' && req.method === 'POST') {
      production.clearFinished();
      return sendJson(res, 200, { ok: true });
    }
    if (!action && req.method === 'PUT') return sendJson(res, 200, production.updateItem(id, await readBody(req)));
    if (!action && req.method === 'DELETE') {
      production.removeItem(id);
      return sendJson(res, 200, { ok: true });
    }
    // Filament-Zuordnung aus dem Startdialog übernehmen (Bambu: als ams_mapping an den Drucker)
    const applySlotMap = (body) => {
      if (!Array.isArray(body.slotMap) || !body.slotMap.length) return;
      const item = production.getItem(id);
      const cfg = printerConfigs.find((p) => p.id === body.printerId);
      if (!item || !cfg) return;
      const options = { ...(item.options || {}), slotMap: body.slotMap };
      const file = files.get(item.fileId);
      if (filament.canMap(cfg, file)) {
        if (['moonraker', 'octoprint', 'anycubic'].includes(cfg.driver)) options.toolMap = filament.toolMapFor(cfg, file, body.slotMap.map(String));
        else options.amsMapping = filament.amsMappingFor(file, body.slotMap.map(String));
      }
      production.updateItem(id, { options });
    };
    if (action === 'start' && req.method === 'POST') {
      const body = await readBody(req);
      if (app.plateCheck && body.plateConfirmed !== true) throw httpError(409, 'Bitte bestätigen, dass die Druckplatte geräumt ist');
      applySlotMap(body);
      if (body.printerId && body.plateConfirmed) production.setPlateClear(body.printerId, true);
      return sendJson(res, 200, await production.start(id, body.printerId, { manual: true }));
    }
    // Feuchte-Check für den Startdialog
    if (action === 'humcheck' && req.method === 'GET') {
      const item = production.getItem(id);
      const cfg = printerConfigs.find((p) => p.id === url.searchParams.get('printerId'));
      if (!item || !cfg) throw httpError(404, 'Drucker oder Eintrag nicht gefunden');
      const slotMap = url.searchParams.get('slotMap') ? url.searchParams.get('slotMap').split(',') : undefined;
      return sendJson(res, 200, app.moduleOn('filament') ? humcheck.check(cfg, files.get(item.fileId), { ...(item.options || {}), ...(slotMap ? { slotMap } : {}) }) : { ok: true, issues: [] });
    }
    // Erst trocknen, danach automatisch starten
    if (action === 'dry-start' && req.method === 'POST') {
      const body = await readBody(req);
      if (app.plateCheck && body.plateConfirmed !== true) throw httpError(409, 'Bitte bestätigen, dass die Druckplatte geräumt ist');
      if (!printerConfigs.some((p) => p.id === body.printerId)) throw httpError(404, 'Drucker nicht gefunden');
      const d = drying.find(String(body.key || ''));
      applySlotMap(body);
      if (!d.active) await drying.start(d.key, { unload: Boolean(d.loaded) });
      if (body.plateConfirmed) production.setPlateClear(body.printerId, true);
      return sendJson(res, 200, production.setAfterDry(id, { key: d.key, printerId: body.printerId, at: new Date().toISOString(), name: d.name }));
    }
    if (action === 'dry-cancel' && req.method === 'POST') return sendJson(res, 200, production.setAfterDry(id, null));
    if (action === 'requeue' && req.method === 'POST') return sendJson(res, 200, production.requeue(id));
    // Hängenden Eintrag von Hand abschließen: „war fertig“ bzw. „abgebrochen“
    if (action === 'resolve' && req.method === 'POST') {
      const q = production.getItem(id);
      if (!q) throw httpError(404, 'Eintrag nicht gefunden');
      if (!['printing', 'sending'].includes(q.status)) throw httpError(409, 'Eintrag läuft nicht');
      const st = runtime.get(q.printerId)?.driver.status;
      if (st && ACTIVE.has(st.state) && runtime.get(q.printerId)?.job) throw httpError(409, 'Der Drucker druckt gerade – erst am Drucker beenden');
      const result = (await readBody(req)).result === 'finished' ? 'finished' : 'cancelled';
      if (q.status === 'sending') q.status = 'printing';
      return sendJson(res, 200, production.ctx.resolveLost(q, result));
    }
  }

  // ---- Aufträge
  if (resource === 'orders') {
    if (!id && req.method === 'GET') return sendJson(res, 200, production.orders().map((o) => ({ ...o, costs: costs.forOrder(o), shareUrl: o.shareToken ? relay.linkFor(o.shareToken) : null })));
    if (!id && req.method === 'POST') return sendJson(res, 201, production.saveOrder(await readBody(req)));
    if (!action && req.method === 'PUT') return sendJson(res, 200, production.saveOrder(await readBody(req), id));
    if (!action && req.method === 'DELETE') {
      production.deleteOrder(id);
      return sendJson(res, 200, { ok: true });
    }
    if (action === 'plan' && req.method === 'POST') return sendJson(res, 200, production.planOrder(id, await readBody(req)));
    if (action === 'mode' && req.method === 'POST') return sendJson(res, 200, production.orderMode(id, (await readBody(req)).mode));
    if (action === 'use-file' && req.method === 'POST') {
      const b = await readBody(req);
      const r = production.useFile(id, b.from, b.to);
      if (!production.ordersUsingFile(b.from).length) files.update(b.to, { replacesDone: true });
      broadcast('files', null);
      return sendJson(res, 200, r);
    }
    if (action === 'share' && req.method === 'POST') return sendJson(res, 200, production.shareOrder(id, (await readBody(req)).enabled !== false));
    if (action === 'post' && req.method === 'POST') return sendJson(res, 200, production.setPost(id, await readBody(req)));
    if (action === 'archive' && req.method === 'POST') return sendJson(res, 200, production.archiveOrder(id, (await readBody(req)).archived !== false));
  }

  // ---- Wartung
  if (resource === 'maintenance') {
    if (!id && req.method === 'GET') return sendJson(res, 200, production.maintenanceView());
    if (id === 'tasks' && !action && req.method === 'POST') return sendJson(res, 201, production.saveTask(await readBody(req)));
    if (id === 'templates' && req.method === 'POST') return sendJson(res, 200, production.addTemplates((await readBody(req)).printerId));
    const taskId = action;
    if (id === 'tasks' && taskId) {
      const sub = parts[4];
      if (!sub && req.method === 'PUT') return sendJson(res, 200, production.saveTask(await readBody(req), taskId));
      if (!sub && req.method === 'DELETE') {
        production.deleteTask(taskId);
        return sendJson(res, 200, { ok: true });
      }
      if (sub === 'done' && req.method === 'POST') {
        production.taskDone(taskId, (await readBody(req)).note);
        return sendJson(res, 200, { ok: true });
      }
    }
  }

  // ---- Etiketten für fertige Teile
  if (resource === 'labels') {
    if (!id && req.method === 'GET') {
      const orderId = url.searchParams.get('order');
      const list = orderId ? history.filter((h) => h.orderId === orderId && h.result === 'finished') : history.filter((h) => h.labelPending);
      return sendJson(res, 200, partLabels(list));
    }
    if (id === 'printed' && req.method === 'POST') {
      const ids = new Set((await readBody(req)).ids || []);
      for (const h of history) if (ids.has(h.id)) delete h.labelPending;
      saveHistory();
      broadcast('history', null);
      return sendJson(res, 200, { ok: true });
    }
  }

  // ---- Eingangsordner (z. B. Export aus Bambu Studio)
  if (resource === 'inbox' && req.method === 'GET') return sendJson(res, 200, inbox.view());

  // ---- Einstellungen (Slicer)
  if (resource === 'settings') {
    if (req.method === 'GET') return sendJson(res, 200, { ...slicer.getSettings(), inbox: inbox.view() });
    if (req.method === 'PUT') {
      const s2 = slicer.saveSettings(await readBody(req));
      broadcast('settings', null);
      return sendJson(res, 200, s2);
    }
  }

  // ---- Drucker
  if (resource === 'printers') {
    if (!id && req.method === 'GET') return sendJson(res, 200, printerConfigs.map(publicPrinter));

    if (!id && req.method === 'POST') {
      const cfg = { id: crypto.randomUUID(), ...validatePrinter(await readBody(req)) };
      printerConfigs.push(cfg);
      savePrinters();
      await startPrinter(cfg);
      broadcast('printers', null);
      return sendJson(res, 201, publicPrinter(cfg));
    }

    const idx = printerConfigs.findIndex((p) => p.id === id);
    if (idx < 0) throw httpError(404, 'Drucker nicht gefunden');
    const existing = printerConfigs[idx];

    if (!action && req.method === 'PUT') {
      const cfg = { id, ...validatePrinter(await readBody(req), existing) };
      printerConfigs[idx] = cfg;
      savePrinters();
      await stopPrinter(id);
      await startPrinter(cfg);
      broadcast('printers', null);
      return sendJson(res, 200, publicPrinter(cfg));
    }

    if (!action && req.method === 'DELETE') {
      await stopPrinter(id);
      printerConfigs.splice(idx, 1);
      savePrinters();
      production.printerRemoved(id);
      filament.printerRemoved(id);
      broadcast('printers', null);
      return sendJson(res, 200, { ok: true });
    }

    if (action === 'power' && req.method === 'POST') {
      await ha.setPower(id, Boolean((await readBody(req)).on));
      return sendJson(res, 200, { ok: true });
    }

    if (action === 'hms' && req.method === 'GET') {
      const st = runtime.get(id)?.driver.status;
      return sendJson(res, 200, await hms.describe(st?.hms || [], existing.settings?.model || '', app.lang));
    }

    if (action === 'diagnostics' && req.method === 'GET') {
      const rt = runtime.get(id);
      if (!rt) throw httpError(409, 'Drucker nicht aktiv');
      const data = { printdock: require('./package.json').version, platform: `${process.platform} ${process.arch}, Node ${process.version}`, ffmpeg: (await ffmpegAvailable()) ? ffmpegPath() : null, driver: existing.driver, model: existing.settings?.model || null, at: new Date().toISOString(), status: rt.driver.status };
      try { Object.assign(data, await rt.driver.diagnostics()); } catch (err) { data.error = err.message; }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="printdock-${existing.driver}-${id.slice(0, 8)}.json"` });
      return res.end(JSON.stringify(data, null, 2));
    }

    if (action === 'plate-clear' && req.method === 'POST') {
      production.setPlateClear(id, true);
      return sendJson(res, 200, { ok: true });
    }

    if (action === 'command' && req.method === 'POST') {
      const { cmd, ...args } = await readBody(req);
      const demoOnly = cmd === 'demo_slot' && existing.driver === 'demo'; // für Tests und die Station-Simulation
      if (!['pause', 'resume', 'cancel', 'light', 'speed'].includes(cmd) && !demoOnly) throw httpError(400, 'Unbekannter Befehl');
      const rt = runtime.get(id);
      if (!rt) throw httpError(409, 'Drucker nicht aktiv');
      await rt.driver.command(cmd, args);
      console.log(`[${existing.name}] Befehl: ${cmd}`);
      return sendJson(res, 200, { ok: true });
    }

    if ((action === 'camera.jpg' || action === 'camera.mjpg') && req.method === 'GET') {
      const rt = runtime.get(id);
      if (!rt) throw httpError(409, 'Drucker nicht aktiv');
      let session;
      try {
        session = await cameras.get(id, rt.driver);
      } catch (err) {
        throw httpError(502, err.message);
      }
      if (!session) throw httpError(404, 'Dieser Drucker hat keine Kamera');
      return action === 'camera.jpg' ? serveSnapshot(res, session) : serveMjpeg(req, res, session);
    }
  }

  throw httpError(404, 'Unbekannter Endpunkt');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/slicer') && (await slicer.handleOctoPrint(req, res, url, production))) return;
    // „Gerät“-Ansicht im Slicer (OrcaSlicer zeigt die Host-Adresse als Webseite): zur Oberfläche weiterleiten
    if (/^\/slicer(\/[^/]+)?\/?$/.test(url.pathname) && req.method === 'GET') {
      res.writeHead(302, { Location: '/' });
      return res.end();
    }
    if (url.pathname === '/printdock-card.js') {
      // Home-Assistant-Karte – ohne Anmeldung, damit Home Assistant sie laden kann
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
      return fs.createReadStream(path.join(__dirname, 'dist', 'printdock-card.js')).pipe(res);
    }
    // Kunden-Statusseite: ohne Anmeldung, nur mit geheimem Link
    const sm = /^\/status\/([a-f0-9]{24})(?:\/photo\/([\w-]+))?\/?$/.exec(url.pathname);
    if (sm && req.method === 'GET') {
      const sp = require('./lib/statuspage');
      const sctx = { production, history: () => history, lang: app.lang, photoDir: PHOTO_DIR, brand: relay?.view().brand?.name ? relay.view().brand : null };
      if (sm[2]) {
        const f = sp.photo(sctx, sm[1], sm[2]);
        if (!f) throw httpError(404, 'Nicht gefunden');
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' });
        return fs.createReadStream(f).pipe(res);
      }
      const r = sp.render(sctx, sm[1]);
      res.writeHead(r.status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
      return res.end(r.html);
    }
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else serveStatic(req, res);
  } catch (err) {
    if (!res.headersSent) sendJson(res, err.status || 500, { error: err.message });
  }
});

// Stationen verbinden sich per WebSocket (eigener Schlüssel je Station, keine Anmeldung nötig)
server.on('upgrade', (req, socket) => {
  const p = new URL(req.url, 'http://localhost').pathname;
  if (p === '/api/station/ws' || p === '/station') return stations.upgrade(req, socket);
  socket.destroy();
});

// ---------------------------------------------------------------- Start

server.on('error', async (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} ist schon belegt – vermutlich läuft PrintDock bereits (z. B. in einem anderen Terminalfenster).`);
    console.error('  • Laufende Instanz dort mit Strg+C beenden, oder');
    console.error(`  • herausfinden, was den Port nutzt:  lsof -i :${PORT}   (Windows: netstat -ano | findstr :${PORT})`);
    console.error(`  • oder einen anderen Port nehmen:    PORT=3081 npm start   (Windows: set PORT=3081 && npm start)\n`);
  } else {
    console.error(`Server konnte nicht starten: ${err.message}`);
  }
  for (const id of [...runtime.keys()]) await stopPrinter(id);
  process.exit(1);
});

(async () => {
  for (const cfg of printerConfigs) await startPrinter(cfg);
  server.listen(PORT, () => {
    console.log(`PrintDock läuft auf http://localhost:${PORT}  (Daten: ${DATA_DIR})`);
    console.log(`${printerConfigs.length} Drucker, ${channels.length} Benachrichtigungskanal/-kanäle`);
    remote.init();
    ffmpegAvailable().then((ok) => console.log(ok ? `ffmpeg: ${ffmpegPath()}` : 'ffmpeg nicht gefunden – RTSP-Kameras (Bambu X1/H2D/X2D) zeigen kein Bild. Windows: winget install Gyan.FFmpeg'));
  });
})();

async function shutdown() {
  saveJobs(true);
  audit.flush();
  remote.kill('tailscale');
  remote.kill('cloudflare');
  for (const id of [...runtime.keys()]) await stopPrinter(id);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
