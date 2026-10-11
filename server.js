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

const PORT = Number(process.env.PORT) || 3080;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PRINTERS_FILE = path.join(DATA_DIR, 'printers.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const CHANNELS_FILE = path.join(DATA_DIR, 'notifications.json');
const HISTORY_MAX = 1000;
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

/** Verfolgt den laufenden Druckjob und schreibt beim Ende einen Verlaufseintrag. */
function trackJob(cfg, rt, status) {
  if (ACTIVE.has(status.state)) {
    if (!rt.job || (status.file && rt.job.file !== status.file)) {
      rt.job = { file: status.file, startedAt: Date.now() - (status.elapsedSec || 0) * 1000 };
    }
    rt.job.lastProgress = status.progress;
    if (status.activeSlot) rt.job.activeSlot = status.activeSlot;
    if (status.filamentUsedMm != null) rt.job.filamentMm = status.filamentUsedMm;
    return null;
  }
  let entry = null;
  if (rt.job && ENDED[status.state]) {
    const endedAt = Date.now();
    entry = {
      id: crypto.randomUUID(),
      printerId: cfg.id,
      printerName: cfg.name,
      file: rt.job.file || status.file,
      result: status.state,
      progress: status.state === 'finished' ? 100 : rt.job.lastProgress ?? null,
      startedAt: new Date(rt.job.startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      durationSec: Math.round((endedAt - rt.job.startedAt) / 1000),
      message: status.message || null,
      activeSlot: rt.job.activeSlot || null,
      filamentMm: rt.job.filamentMm || null,
    };
    history.push(entry);
    saveHistory();
    broadcast('history', entry);
    console.log(`[${cfg.name}] Druck ${ENDED[status.state]}: ${entry.file}`);
  }
  // Bei 'offline' den Job behalten – der Drucker kann zurückkommen und weiterdrucken.
  if (status.state !== 'offline') rt.job = null;
  return entry;
}

async function startPrinter(cfg) {
  const Driver = byId[cfg.driver];
  if (!Driver) {
    console.warn(`Unbekannter Treiber "${cfg.driver}" für ${cfg.name}`);
    return;
  }
  const driver = new Driver(cfg.config || {});
  const rt = { driver, job: null, lastState: undefined, offlineTimer: null };
  runtime.set(cfg.id, rt);
  driver.on('status', (status) => {
    if (runtime.get(cfg.id) !== rt) return; // veraltete Instanz
    const entry = trackJob(cfg, rt, status);
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
    autoOff: st.autoOff === true || st.autoOff === 'true',
    autoOffDelay: Math.max(1, Math.min(240, Number(st.autoOffDelay) || 10)),
    autoOffMaxTemp: Math.max(30, Math.min(120, Number(st.autoOffMaxTemp) || 50)),
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
  if (resource === 'app' && !id && req.method === 'GET') return sendJson(res, 200, { ...app.publicSettings(req), directUrl: ha.directUrl, update: updateAvailable() });
  if (resource === 'login' && req.method === 'POST') {
    app.login(req, res, await readBody(req));
    return sendJson(res, 200, { ok: true });
  }
  if (resource === 'logout' && req.method === 'POST') {
    app.logout(req, res);
    return sendJson(res, 200, { ok: true });
  }
  // Ersteinrichtung ist ohne Login möglich, solange sie nicht abgeschlossen ist
  const setupOpen = !app.publicSettings(req).setupDone;
  if (!app.isAuthed(req) && !(setupOpen && resource === 'app')) throw httpError(401, 'Bitte anmelden');

  if (resource === 'app') {
    if (!id && req.method === 'PUT') {
      const before = app.moduleOn('homeassistant');
      app.save(await readBody(req));
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

  // ---- Verlauf
  if (resource === 'history') {
    if (req.method === 'GET') {
      const limit = Math.min(Number(url.searchParams.get('limit')) || 200, HISTORY_MAX);
      return sendJson(res, 200, history.slice(-limit).reverse());
    }
    if (req.method === 'DELETE' && !id) {
      history = [];
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
    if (id === 'mapping' && req.method === 'GET') {
      const cfg = printerConfigs.find((p) => p.id === url.searchParams.get('printerId'));
      const item = production.getItem(url.searchParams.get('queueId'));
      if (!cfg || !item) throw httpError(404, 'Drucker oder Eintrag nicht gefunden');
      return sendJson(res, 200, filament.mappingFor(cfg, files.get(item.fileId), item.options));
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
    if (!id && req.method === 'GET') return sendJson(res, 200, files.list());
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
    if (action === 'start' && req.method === 'POST') {
      const body = await readBody(req);
      if (app.plateCheck && body.plateConfirmed !== true) throw httpError(409, 'Bitte bestätigen, dass die Druckplatte geräumt ist');
      // Filament-Zuordnung aus dem Startdialog übernehmen (Bambu: als ams_mapping an den Drucker)
      if (Array.isArray(body.slotMap) && body.slotMap.length) {
        const item = production.getItem(id);
        const cfg = printerConfigs.find((p) => p.id === body.printerId);
        if (item && cfg) {
          const options = { ...(item.options || {}), slotMap: body.slotMap };
          const file = files.get(item.fileId);
          if (filament.canMap(cfg, file)) {
            if (['moonraker', 'octoprint', 'anycubic'].includes(cfg.driver)) options.toolMap = filament.toolMapFor(cfg, file, body.slotMap.map(String));
            else options.amsMapping = filament.amsMappingFor(file, body.slotMap.map(String));
          }
          production.updateItem(id, { options });
        }
      }
      if (body.printerId && body.plateConfirmed) production.setPlateClear(body.printerId, true);
      return sendJson(res, 200, await production.start(id, body.printerId, { manual: true }));
    }
    if (action === 'requeue' && req.method === 'POST') return sendJson(res, 200, production.requeue(id));
  }

  // ---- Aufträge
  if (resource === 'orders') {
    if (!id && req.method === 'GET') return sendJson(res, 200, production.orders());
    if (!id && req.method === 'POST') return sendJson(res, 201, production.saveOrder(await readBody(req)));
    if (!action && req.method === 'PUT') return sendJson(res, 200, production.saveOrder(await readBody(req), id));
    if (!action && req.method === 'DELETE') {
      production.deleteOrder(id);
      return sendJson(res, 200, { ok: true });
    }
    if (action === 'plan' && req.method === 'POST') return sendJson(res, 200, production.planOrder(id, await readBody(req)));
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
    ffmpegAvailable().then((ok) => console.log(ok ? `ffmpeg: ${ffmpegPath()}` : 'ffmpeg nicht gefunden – RTSP-Kameras (Bambu X1/H2D/X2D) zeigen kein Bild. Windows: winget install Gyan.FFmpeg'));
  });
})();

async function shutdown() {
  for (const id of [...runtime.keys()]) await stopPrinter(id);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
