// Fehldrucke: Grund erfassen, als Fehldruck markieren, mit einem Klick neu einreihen.
//   - Abgebrochene/fehlgeschlagene Drucke tragen „failOpen“, bis sie neu eingereiht oder erledigt sind
//     (erscheinen auf der Heute-Seite).
//   - Ein „fertiger“ Druck lässt sich nachträglich als Fehldruck markieren (Spaghetti, Haftung …):
//     er zählt dann nicht mehr als erledigtes Stück und sein Material als Ausschuss.

const files = require('./files');

const REASONS = ['Haftung / abgelöst', 'Spaghetti', 'Filament leer oder gerissen', 'Düse verstopft', 'Schichtversatz', 'Verzug (Warping)', 'Strom / Verbindung weg', 'Falsche Datei / Einstellung', 'Von Hand abgebrochen', 'Sonstiges'];

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

class Failures {
  /** ctx: { history(), saveHistory(), production, broadcast } */
  constructor(ctx) {
    this.ctx = ctx;
  }

  entry(id) {
    const h = this.ctx.history().find((x) => x.id === id);
    if (!h) throw httpError(404, 'Verlaufseintrag nicht gefunden');
    return h;
  }

  done() {
    this.ctx.saveHistory();
    this.ctx.broadcast('history', null);
    this.ctx.broadcast('production', null);
  }

  /** Beim Druckende aufgerufen: nicht erfolgreiche Drucke zur Nachfrage vormerken */
  onEnded(entry) {
    if (entry.result !== 'finished') entry.failOpen = true;
  }

  /** Grund eintragen; ein fertiger Druck wird dabei zum Fehldruck */
  mark(id, { reason = '', note = '' } = {}) {
    const h = this.entry(id);
    if (h.result === 'finished') {
      h.origResult = 'finished';
      h.result = 'error';
      h.markedFailed = true;
      delete h.labelPending;
      if (h.queueId) this.ctx.production.itemFailed(h.queueId);
    }
    h.failReason = String(reason || '').slice(0, 80) || null;
    h.failNote = String(note || '').slice(0, 300) || null;
    this.done();
    return h;
  }

  /** Markierung zurücknehmen (versehentlich als Fehldruck markiert) */
  unmark(id) {
    const h = this.entry(id);
    if (!h.markedFailed) throw httpError(409, 'Nur nachträglich markierte Drucke');
    if (h.requeuedAt) throw httpError(409, 'Wurde schon neu eingereiht');
    h.result = h.origResult || 'finished';
    delete h.markedFailed;
    delete h.origResult;
    h.failReason = null;
    h.failNote = null;
    h.failOpen = false;
    if (h.queueId) this.ctx.production.itemFailed(h.queueId, false);
    this.done();
    return h;
  }

  /** Gleiche Datei, gleiche Farbzuordnung, gleicher Auftrag – oben in die Warteschlange */
  requeue(id, { reason, note } = {}) {
    const h = this.entry(id);
    if (h.requeuedAt) throw httpError(409, 'Wurde schon neu eingereiht');
    if (reason || note || h.result === 'finished') this.mark(id, { reason: reason ?? h.failReason, note: note ?? h.failNote });
    const p = this.ctx.production;
    const q = h.queueId ? p.getItem(h.queueId) : null;
    let item;
    if (q && ['failed', 'cancelled'].includes(q.status)) item = p.requeue(q.id);
    else {
      // Drucker melden den Dateinamen teils ohne/mit anderer Endung („teil.gcode.3mf“ → „teil“)
      const base = (n) => String(n || '').toLowerCase().replace(/(\.gcode)?(\.3mf|\.gcode|\.bgcode)$/i, '');
      const cand = files.list().filter((x) => x.printable);
      const f = cand.find((x) => x.name === h.file) || cand.find((x) => base(x.name) === base(h.file));
      if (!f) throw httpError(404, `„${h.file}“ liegt nicht mehr in den Dateien – bitte neu hochladen`);
      item = p.addToQueue({ fileId: f.id, printerId: h.printerId, orderId: h.orderId || null, options: q?.options || {}, positionId: q?.positionId || null, top: true, urgent: true, mode: q?.mode || null })[0];
    }
    h.requeuedAt = new Date().toISOString();
    h.requeueId = item.id;
    h.failOpen = false;
    this.done();
    return item;
  }

  /** „Passt so“ – Nachfrage schließen, ohne neu einzureihen */
  dismiss(id) {
    const h = this.entry(id);
    h.failOpen = false;
    this.done();
    return h;
  }
}

module.exports = { Failures, REASONS };
