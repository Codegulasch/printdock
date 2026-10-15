// Teile: ein Modell („Kabelclip“) mit geslicten Varianten je Drucker.
// Eine Variante ist eine Datei der Bibliothek mit partId. Für welche Drucker sie gilt:
//   targets = [printerId, …]  → genau diese Drucker (beim Hochladen gewählt)
//   targets leer              → nach dem Druckermodell aus der Datei (wie bisher)
// Warteschlange und Aufträge können auf ein Teil zeigen (partId); gestartet wird die Variante,
// die zum freien Drucker passt.

const crypto = require('crypto');
const { store } = require('./store');
const files = require('./files');

const db = store('parts.json', { parts: [], migrated: false });
db.data.parts ??= [];

const httpError = (status, message) => Object.assign(new Error(message), { status });
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const modelNorm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Lesbarer Name aus dem Dateinamen: Endung weg, Unterstriche zu Leerzeichen */
function nameFromFile(name) {
  return String(name || '').replace(/\.gcode\.3mf$|\.3mf$|\.gcode$|\.stl$|\.step$|\.stp$|\.obj$/i, '').replace(/[_]+/g, ' ').trim().slice(0, 120) || 'Teil';
}

function list() {
  return db.data.parts;
}

function get(id) {
  return db.data.parts.find((p) => p.id === id) || null;
}

function create(name) {
  const n = String(name || '').trim().slice(0, 120);
  if (!n) throw httpError(400, 'Bitte einen Namen für das Teil angeben');
  const p = { id: crypto.randomUUID(), name: n, createdAt: new Date().toISOString() };
  db.data.parts.push(p);
  db.save();
  return p;
}

/** Teil zum Namen finden (gleich geschrieben, Groß/Klein und Zeichen egal) oder anlegen */
function byName(name, { create: make = true } = {}) {
  const k = norm(name);
  return db.data.parts.find((p) => norm(p.name) === k) || (make ? create(name) : null);
}

function update(id, body = {}) {
  const p = get(id);
  if (!p) throw httpError(404, 'Teil nicht gefunden');
  if (body.name !== undefined) {
    const n = String(body.name).trim().slice(0, 120);
    if (!n) throw httpError(400, 'Bitte einen Namen angeben');
    p.name = n;
  }
  if (body.note !== undefined) p.note = String(body.note || '').slice(0, 500);
  db.save();
  return p;
}

/** Teil löschen – die Dateien bleiben, sie sind danach nur keinem Teil mehr zugeordnet */
function remove(id) {
  const idx = db.data.parts.findIndex((p) => p.id === id);
  if (idx < 0) throw httpError(404, 'Teil nicht gefunden');
  for (const f of files.list().filter((x) => x.partId === id)) files.update(f.id, { partId: null });
  db.data.parts.splice(idx, 1);
  db.save();
}

function variants(partId) {
  return files.list().filter((f) => f.partId === partId);
}

/** Datei einem Teil zuordnen: { partId } oder { partName } (wird angelegt), targets = Drucker-IDs */
function assignFile(fileId, { partId, partName, targets } = {}) {
  const f = files.get(fileId);
  if (!f) throw httpError(404, 'Datei nicht gefunden');
  let part = null;
  if (partId) {
    part = get(partId);
    if (!part) throw httpError(404, 'Teil nicht gefunden');
  } else if (partName !== undefined && String(partName).trim()) {
    part = byName(partName);
  }
  const patch = { partId: part ? part.id : null };
  if (Array.isArray(targets)) patch.targets = targets;
  files.update(fileId, patch);
  // leere Teile aufräumen (Datei wurde in ein anderes Teil verschoben)
  for (const p of db.data.parts.slice()) if (!variants(p.id).length && p.id !== part?.id && p.autoCreated) remove(p.id);
  return part;
}

/**
 * Neue Datei automatisch einordnen (Slicer, Eingangsordner, Hochladen): gibt es ein Teil mit einer
 * gleichnamigen Datei bzw. gleichem Namen, kommt sie dazu – sonst ein neues Teil.
 * Vom Drucker übernommene Dateien (Archiv) bekommen kein Teil.
 */
function autoAssign(f) {
  if (!f || f.partId || f.source === 'printer') return null;
  const stem = files.stem(f.name);
  const sibling = files.list().find((x) => x.id !== f.id && x.partId && files.stem(x.name) === stem && get(x.partId));
  const part = sibling ? get(sibling.partId) : byName(nameFromFile(f.name));
  if (!sibling) part.autoCreated = true;
  db.save();
  files.update(f.id, { partId: part.id });
  return part;
}

/** Einmalig beim Update: vorhandene Dateien (nicht vom Drucker) bekommen je ein Teil */
function migrate() {
  if (db.data.migrated) return;
  for (const f of files.list().slice().reverse()) {
    if (!f.partId && f.source !== 'printer') autoAssign(f);
  }
  db.data.migrated = true;
  db.save();
}

/** Passt eine Variante zu einem Drucker? (feste Drucker oder Druckermodell) – true/false/null (unbekannt) */
function variantFits(f, printer, printerModel) {
  if (Array.isArray(f.targets) && f.targets.length) return f.targets.includes(printer.id);
  const a = modelNorm(f.meta?.printerModel);
  const b = modelNorm(printerModel);
  if (!a || !b) return null;
  return a.includes(b) || b.includes(a);
}

/** Variante eines Teils für einen Drucker (druckfertig) */
function variantFor(partId, printer, printerModel, { loose = false } = {}) {
  const vs = variants(partId).filter((f) => f.printable);
  return vs.find((f) => variantFits(f, printer, printerModel) === true) || (loose ? vs.find((f) => variantFits(f, printer, printerModel) === null) : null) || null;
}

function view(printers = []) {
  return db.data.parts.map((p) => {
    const vs = variants(p.id);
    const cover = printers.map((pr) => {
      const v = vs.find((f) => f.printable && variantFits(f, pr, pr.model) === true);
      return { printerId: pr.id, name: pr.name, fileId: v?.id || null };
    });
    const main = vs.find((f) => f.thumb) || vs[0] || null;
    return {
      ...p,
      variants: vs.map((f) => ({ id: f.id, name: f.name, kind: f.kind, printable: f.printable, thumb: Boolean(f.thumb), targets: f.targets || [], meta: { printerModel: f.meta?.printerModel || null, estimatedSec: f.meta?.estimatedSec || null, filamentG: f.meta?.filamentG || null, materials: f.meta?.materials || null }, uploadedAt: f.uploadedAt, source: f.source })),
      thumbFile: main?.thumb ? main.id : null,
      printable: vs.some((f) => f.printable),
      cover,
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

function removeDemo() {
  db.data.parts = db.data.parts.filter((p) => variants(p.id).length);
  db.save();
}

module.exports = { list, get, create, byName, update, remove, variants, assignFile, autoAssign, migrate, variantFits, variantFor, view, nameFromFile, removeDemo, db };
