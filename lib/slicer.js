// Slicer-Anbindung
//
// 1) "An Drucker senden" aus dem Slicer: PrintDock tut so, als wäre es ein
//    OctoPrint-Server. In OrcaSlicer, PrusaSlicer, SuperSlicer, Snapmaker Orca,
//    Anycubic Slicer Next (Orca-basiert) einen "physischen Drucker" vom Typ
//    OctoPrint anlegen und als Adresse eintragen:
//       http://<printdock>:3080/slicer            → nur in die Dateibibliothek
//       http://<printdock>:3080/slicer/queue      → in die Warteschlange (passender Drucker)
//       http://<printdock>:3080/slicer/<Drucker-ID> → in die Warteschlange dieses Druckers
//    "Hochladen und drucken" stellt den Druck nach vorne in die Warteschlange.
//
// 2) "In Slicer öffnen": Links mit URL-Schema (orcaslicer://, bambustudio://,
//    prusaslicer://) öffnen eine Datei aus der Bibliothek direkt im Slicer.

const Busboy = require('busboy');
const crypto = require('crypto');
const { store } = require('./store');
const files = require('./files');

const DEFAULT_SLICERS = [
  { id: 'orca', name: 'OrcaSlicer', url: 'orcaslicer://open?file={url}' },
  { id: 'bambu', name: 'Bambu Studio', url: 'bambustudio://open?file={url}' },
  { id: 'prusa', name: 'PrusaSlicer', url: 'prusaslicer://open?file={url}' },
];

const settingsDb = store('settings.json', {});
settingsDb.data.slicers ??= DEFAULT_SLICERS;
settingsDb.data.slicerKey ??= crypto.randomBytes(12).toString('hex');

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function getSettings() {
  return settingsDb.data;
}

function saveSettings(body) {
  if (Array.isArray(body.slicers)) {
    settingsDb.data.slicers = body.slicers
      .filter((s) => s && String(s.name || '').trim() && /\{url\}/.test(String(s.url || '')))
      .slice(0, 20)
      .map((s) => ({ id: s.id || crypto.randomUUID(), name: String(s.name).trim().slice(0, 60), url: String(s.url).trim().slice(0, 300) }));
  }
  if (body.newSlicerKey) settingsDb.data.slicerKey = crypto.randomBytes(12).toString('hex');
  settingsDb.save();
  return settingsDb.data;
}

/**
 * OctoPrint-kompatible Endpunkte unter /slicer[/<ziel>]/api/...
 * @returns true wenn behandelt
 */
async function handleOctoPrint(req, res, url, production) {
  const m = url.pathname.match(/^\/slicer(?:\/([^/]+))?\/api\/(version|files\/local|files|login|settings|connection|printer)$/);
  if (!m) return false;
  const [, target = null, endpoint] = m;

  const send = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };

  const key = req.headers['x-api-key'] || url.searchParams.get('apikey');
  if (key !== settingsDb.data.slicerKey) {
    send(403, { error: 'Falscher API-Key – den Schlüssel aus PrintDock (Einstellungen → Slicer) eintragen' });
    return true;
  }

  let printerId = null;
  if (target && target !== 'queue') {
    if (!production.ctx.printers().some((p) => p.id === target)) {
      send(404, { error: 'Unbekannter Drucker in der Adresse' });
      return true;
    }
    printerId = target;
  }

  if (endpoint === 'version') {
    send(200, { api: '0.1', server: '1.10.0', text: 'OctoPrint 1.10.0 (PrintDock)' });
    return true;
  }
  if (endpoint === 'login') {
    send(200, { name: 'printdock', active: true, admin: true });
    return true;
  }
  if (endpoint === 'settings') {
    send(200, { api: { enabled: true }, webcam: { webcamEnabled: false } });
    return true;
  }
  if (endpoint === 'connection') {
    send(200, { current: { state: 'Operational' }, options: {} });
    return true;
  }
  if (endpoint === 'printer') {
    send(200, { state: { text: 'Operational', flags: { operational: true, ready: true, printing: false } }, temperature: {} });
    return true;
  }
  if (endpoint === 'files' && req.method === 'GET') {
    send(200, { files: [], free: 1e12 });
    return true;
  }
  if (endpoint !== 'files/local' || req.method !== 'POST') {
    send(405, { error: 'Nicht unterstützt' });
    return true;
  }

  // Upload (multipart): Felder file, path, select, print
  const fields = {};
  let saved = null;
  let uploadErr = null;
  const pending = [];
  await new Promise((resolve, reject) => {
    let bb;
    try {
      bb = Busboy({ headers: req.headers, limits: { files: 1 } });
    } catch (err) {
      reject(httpError(400, 'Kein Multipart-Upload'));
      return;
    }
    bb.on('field', (name, val) => (fields[name] = val));
    bb.on('file', (name, stream, info) => {
      pending.push(
        files
          .addFromStream(stream, info.filename, { source: 'slicer' })
          .then((f) => (saved = f))
          .catch((err) => (uploadErr = err))
      );
    });
    bb.on('close', resolve);
    bb.on('error', reject);
    req.pipe(bb);
  }).catch((err) => (uploadErr = err));
  await Promise.all(pending);

  if (uploadErr || !saved) {
    send(uploadErr?.status || 400, { error: uploadErr?.message || 'Keine Datei empfangen' });
    return true;
  }

  const toQueue = target !== null; // /slicer/queue oder /slicer/<id>
  let queued = null;
  if (toQueue && saved.printable) {
    try {
      queued = production.addToQueue({ fileId: saved.id, printerId, top: fields.print === 'true' })[0];
    } catch (err) {
      console.warn(`Slicer-Upload: ${err.message}`);
    }
  }
  console.log(`Slicer-Upload: ${saved.name}${queued ? ' → Warteschlange' : ' → Bibliothek'}`);
  send(201, {
    done: true,
    files: { local: { name: saved.name, origin: 'local', refs: { resource: `/api/files/${saved.id}`, download: `/api/files/${saved.id}/dl/${encodeURIComponent(saved.name)}` } } },
  });
  return true;
}

module.exports = { getSettings, saveSettings, handleOctoPrint, DEFAULT_SLICERS };
