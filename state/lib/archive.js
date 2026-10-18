// Archiv aller Drucke – auch derer, die nicht aus PrintDock kamen (Slicer direkt an den Drucker,
// Touchscreen, Handy-App). PrintDock sieht sie am Druckerstatus, holt die Datei vom Drucker in die
// Bibliothek (Vorschaubild, Gramm, Kosten, „nochmal drucken“) und schlägt einen passenden Auftrag vor.
//
//   onJobStart  → nach ein paar Sekunden: kam der Druck aus PrintDock? Wenn nicht: Fremddruck, Datei holen
//   resumeOf    → gleicher Druck nach Stromausfall fortgesetzt? Dann kein neuer Druck, sondern Fortsetzung
//   onJobEnd    → Verlaufseintrag ergänzen, eindeutigen Auftrag automatisch zuordnen
//   query       → Suche und Filter für die Archivseite, CSV-Export
//   cleanup     → übernommene Dateien ohne Auftrag nach X Tagen löschen

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./store');

const ACTIVE = new Set(['preparing', 'printing', 'paused']);
const baseName = (s) => String(s || '').split(/[\\/]/).pop();
const norm = (s) => baseName(s).toLowerCase().replace(/\.gcode\.3mf$|\.3mf$|\.gcode$/i, '').replace(/[^a-z0-9]+/g, '');

class Archive {
  /**
   * ctx: { history(), saveHistory(), broadcast(ev, data), production, files, printers(), runtime, app }
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.fetching = new Set();
    setInterval(() => this.cleanup(), 6 * 3600_000).unref();
    setTimeout(() => this.cleanup(), 60_000).unref();
  }

  get settings() {
    return this.ctx.app.archive || { fetch: true, maxMb: 200, keepDays: 90, autoAssign: true };
  }

  // ================================================================ Druckbeginn

  /**
   * Neuer Job erkannt (aus trackJob). Liefert ggf. die Felder für eine Fortsetzung nach Stromausfall.
   */
  onJobStart(cfg, rt, status) {
    const job = rt.job;
    job.id ||= crypto.randomUUID();
    const resumed = this.resumeOf(cfg, status);
    if (resumed) {
      const prev = resumed;
      job.resumeOf = prev.id;
      job.resumeFrom = prev.resumeFrom != null ? prev.resumeFrom : prev.progress ?? 0;
      job.startedAt = Date.parse(prev.startedAt) || job.startedAt;
      if (prev.fileId) job.fileId = prev.fileId;
      if (prev.plate) job.plate = prev.plate;
      if (prev.external) job.external = true;
      prev.resumed = true;
      prev.failOpen = false;
      if (prev.queueId) this.ctx.production.reopenItem(prev.queueId);
      job.queueId = prev.queueId || null;
      console.log(`[${cfg.name}] Druck nach Unterbrechung fortgesetzt (ab ${Math.round(job.resumeFrom)} %): ${job.file}`);
      this.ctx.saveHistory();
      this.ctx.broadcast('history', null);
    }
    // Kam der Druck aus PrintDock? Kurz warten, bis die Warteschlange den Start zugeordnet hat.
    setTimeout(() => this.classify(cfg, rt, job).catch((err) => console.warn(`[${cfg.name}] Archiv: ${err.message}`)), 3000).unref();
  }

  /** Gleicher Druck kurz nach einem Abbruch mit ähnlichem Fortschritt = fortgesetzt (Stromausfall, Neustart des Druckers) */
  resumeOf(cfg, status) {
    const p = Number(status.progress);
    if (!(p >= 1) || !status.file) return null;
    const last = this.ctx.history().filter((h) => h.printerId === cfg.id).slice(-1)[0];
    if (!last || last.result === 'finished' || last.resumed) return null;
    if (Date.now() - Date.parse(last.endedAt) > 6 * 3600_000) return null;
    if (norm(last.file) !== norm(status.file)) return null;
    // Fortschritt knüpft an (der letzte gesehene Wert kann um ein Abfrageintervall hinterherhinken)
    const lp = last.progress ?? 0;
    if (p < lp - 2 || p > lp + 15) return null;
    return last;
  }

  async classify(cfg, rt, job) {
    if (job.classified) return;
    job.classified = true;
    const ended = rt.job !== job;
    const h = ended ? this.ctx.history().find((x) => x.id === job.id) : null;
    if (ended && (!h || h.queueId)) return; // kurzer Druck aus PrintDock – schon zugeordnet
    if (!ended) {
      const item = this.ctx.production.itemOnPrinter(cfg.id);
      if (item && this.ctx.production.sameFile(item, job.file)) {
        job.queueId = item.id;
        return;
      }
    }
    if (job.queueId) return; // Fortsetzung eines PrintDock-Drucks
    job.external = true;
    if (h) {
      // schon vorbei (sehr kurzer Druck): Verlaufseintrag nachtragen
      h.external = true;
      h.assignOpen = true;
      this.ctx.saveHistory();
      this.ctx.broadcast('history', null);
    } else this.ctx.persistJob(cfg, rt);
    this.ctx.broadcast('production', null);
    console.log(`[${cfg.name}] Druck kam nicht aus PrintDock: ${job.file}`);
    if (!job.fileId && this.settings.fetch) await this.fetchFile(cfg, rt, job);
    else if (h) this.autoAssign(h);
  }

  /** Datei des laufenden Drucks vom Drucker in die Bibliothek holen */
  async fetchFile(cfg, rt, job) {
    if (this.fetching.has(cfg.id)) return;
    this.fetching.add(cfg.id);
    const tmpDir = path.join(DATA_DIR, 'tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmp = path.join(tmpDir, `fetch-${crypto.randomUUID()}`);
    try {
      const got = await rt.driver.fetchCurrentFile(tmp, { maxBytes: this.settings.maxMb * 1024 ** 2 });
      if (!got) {
        job.fetch = 'unsupported';
        return;
      }
      const f = await this.ctx.files.addFromStream(fs.createReadStream(tmp), got.name || job.file || 'druck.gcode', {
        source: 'printer', dedupe: true, extra: { fromPrinter: cfg.name },
      });
      job.fileId = f.id;
      if (got.plate) job.plate = got.plate;
      job.fetch = 'ok';
      console.log(`[${cfg.name}] Datei vom Drucker übernommen${f.existing ? ' (schon in der Bibliothek)' : ''}: ${f.name}`);
      // Ist der Druck schon vorbei, den Verlaufseintrag nachtragen
      const h = this.ctx.history().find((x) => x.id === job.id);
      if (h) {
        h.fileId = f.id;
        if (got.plate) h.plate = got.plate;
        this.ctx.saveHistory();
        this.autoAssign(h);
      }
      this.ctx.persistJob(cfg, rt);
      this.ctx.broadcast('files', null);
      this.ctx.broadcast('history', null);
    } catch (err) {
      job.fetch = 'failed';
      job.fetchError = err.message;
      console.warn(`[${cfg.name}] Datei konnte nicht vom Drucker geholt werden: ${err.message}`);
    } finally {
      fs.rmSync(tmp, { force: true });
      this.fetching.delete(cfg.id);
    }
  }

  // ================================================================ Druckende

  /** Felder aus dem Job in den Verlaufseintrag übernehmen (vor Abbuchung und Auftragszählung) */
  enrich(entry, job) {
    if (job.id) entry.id = job.id;
    Object.defineProperty(entry, 'jobRef', { value: job, enumerable: false, configurable: true }); // nur während der Auswertung am Druckende, wird nicht gespeichert
    if (job.external) entry.external = true;
    if (job.fileId) entry.fileId = job.fileId;
    if (job.plate) entry.plate = job.plate;
    if (job.resumeOf) {
      entry.resumeOf = job.resumeOf;
      entry.resumeFrom = job.resumeFrom;
    }
    if (job.fetch && job.fetch !== 'ok') entry.fetch = job.fetch;
    if (job.slotsUsed?.length) entry.slotsUsed = job.slotsUsed;
    if (entry.external && !entry.queueId) entry.assignOpen = true;
  }

  /** Nach dem Ende: eindeutigen Auftrag automatisch zuordnen */
  afterEnd(entry, cfg, rt) {
    const job = entry.jobRef;
    delete entry.jobRef;
    // Druck endete, bevor PrintDock ihn einordnen konnte: kam er nicht aus der Warteschlange, ist es ein Fremddruck
    if (job && !job.classified && !entry.queueId && !job.queueId) {
      job.classified = true;
      job.external = true;
      entry.external = true;
      entry.assignOpen = true;
      console.log(`[${cfg?.name || '?'}] Druck kam nicht aus PrintDock: ${entry.file}`);
      if (this.settings.fetch && cfg && rt) {
        this.fetchFile(cfg, rt, job).catch(() => {});
        return;
      }
    }
    if (entry.external && !entry.queueId) this.autoAssign(entry);
  }

  autoAssign(h) {
    if (h.queueId || !this.settings.autoAssign || !this.ctx.app.moduleOn('orders')) return false;
    const c = this.ctx.production.assignCandidates(h);
    if (c.length !== 1) return false;
    try {
      this.ctx.production.attachHistory(h, c[0].orderId, c[0].positionId);
      h.autoAssigned = true;
      this.ctx.saveHistory();
      this.ctx.broadcast('history', null);
      console.log(`Fremddruck „${h.file}“ automatisch Auftrag ${c[0].nr} zugeordnet`);
      return true;
    } catch {
      return false;
    }
  }

  assign(id, body = {}) {
    const h = this.ctx.history().find((x) => x.id === id);
    if (!h) throw Object.assign(new Error('Eintrag nicht gefunden'), { status: 404 });
    if (body.none) {
      if (h.queueId) this.ctx.production.detachHistory(h);
      h.assignOpen = false;
      h.noOrder = true;
    } else if (body.orderId === null) {
      if (h.queueId) this.ctx.production.detachHistory(h);
      delete h.noOrder;
      h.assignOpen = Boolean(h.external);
    } else {
      this.ctx.production.attachHistory(h, body.orderId, body.positionId || null);
      delete h.noOrder;
      delete h.autoAssigned;
    }
    this.ctx.saveHistory();
    this.ctx.broadcast('history', null);
    return h;
  }

  candidates(id) {
    const h = this.ctx.history().find((x) => x.id === id);
    if (!h) throw Object.assign(new Error('Eintrag nicht gefunden'), { status: 404 });
    return this.ctx.production.assignCandidates(h);
  }

  /** Datei eines Archiv-Eintrags nochmal einplanen */
  reprint(id, body = {}) {
    const h = this.ctx.history().find((x) => x.id === id);
    if (!h) throw Object.assign(new Error('Eintrag nicht gefunden'), { status: 404 });
    const q = h.queueId ? this.ctx.production.getItem(h.queueId) : null;
    const fileId = q?.fileId || h.fileId;
    if (!fileId || !this.ctx.files.get(fileId)) throw Object.assign(new Error('Die Datei dieses Drucks ist nicht in der Bibliothek'), { status: 409 });
    return this.ctx.production.addToQueue({
      fileId, printerId: body.printerId === undefined ? h.printerId : body.printerId || null, count: body.count || 1,
      options: { ...(q?.options || {}), ...(h.plate ? { plate: h.plate } : {}) }, mode: body.mode || null, top: Boolean(body.top),
    });
  }

  // ================================================================ Suche

  /**
   * Filter: q (Text), from/to (YYYY-MM-DD, Druckende), printer, result (finished|cancelled|error|failed),
   * source (printdock|extern), order (with|without|open|<orderId>), offset, limit
   */
  query(params = {}, decorate = (h) => h) {
    const P = (k) => params.get?.(k) ?? params[k] ?? '';
    const q = String(P('q')).trim().toLowerCase();
    const from = /^\d{4}-\d{2}-\d{2}$/.test(P('from')) ? Date.parse(`${P('from')}T00:00:00`) : null;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(P('to')) ? Date.parse(`${P('to')}T23:59:59.999`) : null;
    const printer = String(P('printer'));
    const result = String(P('result'));
    const source = String(P('source'));
    const order = String(P('order'));
    const orders = this.ctx.production.orders();
    const orderOf = (h) => (h.orderId ? orders.find((o) => o.id === h.orderId) : null);
    let list = this.ctx.history().slice().reverse();
    list = list.filter((h) => {
      const end = Date.parse(h.endedAt);
      if (from && end < from) return false;
      if (to && end > to) return false;
      if (printer && h.printerId !== printer) return false;
      if (result === 'failed' ? !h.markedFailed : result && (h.result !== result || h.markedFailed)) return false;
      if (source === 'extern' && !h.external) return false;
      if (source === 'printdock' && h.external) return false;
      if (order === 'with' && !h.orderId) return false;
      if (order === 'without' && h.orderId) return false;
      if (order === 'open' && !(h.assignOpen && !h.orderId)) return false;
      if (order && !['with', 'without', 'open'].includes(order) && h.orderId !== order) return false;
      if (q) {
        const o = orderOf(h);
        const hay = [h.file, h.printerName, h.message, h.failReason, h.failNote, o?.nr, o?.title, o?.customer].filter(Boolean).join(' ').toLowerCase();
        if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
      }
      return true;
    });
    const total = list.length;
    const decorated = list.map(decorate);
    const sums = decorated.reduce((a, h) => {
      a.prints += 1;
      if (h.result === 'finished' && !h.markedFailed) a.ok += 1;
      a.hours += (h.durationSec || 0) / 3600;
      a.grams += h.costs?.grams || (h.filament || []).reduce((g, f) => g + (f.grams || 0), 0);
      a.cost += h.costs?.total || 0;
      return a;
    }, { prints: 0, ok: 0, hours: 0, grams: 0, cost: 0 });
    sums.hours = Math.round(sums.hours * 10) / 10;
    sums.grams = Math.round(sums.grams);
    sums.cost = Math.round(sums.cost * 100) / 100;
    const offset = Math.max(0, Number(P('offset')) || 0);
    const limit = Math.min(1000, Math.max(1, Number(P('limit')) || 100));
    const items = decorated.slice(offset, offset + limit).map((h) => {
      const o = orderOf(h);
      const fid = h.fileId || (h.queueId ? this.ctx.production.getItem(h.queueId)?.fileId : null);
      const f = fid ? this.ctx.files.get(fid) : null;
      return {
        ...h,
        order: o ? { id: o.id, nr: o.nr, title: o.title, customer: o.customer || '' } : null,
        fileInfo: f ? { id: f.id, name: f.name, thumb: Boolean(f.thumb), printable: f.printable } : null,
      };
    });
    const openAssign = this.ctx.history().filter((h) => h.assignOpen && !h.orderId).length;
    return { items, total, offset, limit, sums, openAssign };
  }

  /** CSV (Semikolon, für Excel) mit allen gefilterten Drucken */
  csv(params, decorate) {
    const { items } = this.query({ ...Object.fromEntries(params?.entries?.() || Object.entries(params || {})), offset: 0, limit: 1000000 }, decorate);
    const RES = { finished: 'erfolgreich', cancelled: 'abgebrochen', error: 'fehlgeschlagen' };
    const cell = (v) => {
      const s = v == null ? '' : String(v);
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const dt = (iso) => (iso ? new Date(iso).toLocaleString('de-DE') : '');
    const rows = [['Start', 'Ende', 'Dauer (min)', 'Drucker', 'Datei', 'Ergebnis', 'Fortschritt %', 'Quelle', 'Auftrag', 'Kunde', 'Filament (g)', 'Strom (kWh)', 'Kosten']];
    for (const h of items) {
      rows.push([
        dt(h.startedAt), dt(h.endedAt), Math.round((h.durationSec || 0) / 60), h.printerName, h.file,
        h.markedFailed ? 'Fehldruck' : RES[h.result] || h.result, h.progress ?? '', h.external ? 'am Drucker / Slicer' : 'PrintDock',
        h.order?.nr || '', h.order?.customer || '',
        Math.round(h.costs?.grams || (h.filament || []).reduce((g, f) => g + (f.grams || 0), 0)), h.costs?.kwh ?? h.energyKwh ?? '',
        h.costs?.total != null ? String(h.costs.total).replace('.', ',') : '',
      ]);
    }
    return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
  }

  // ================================================================ Aufräumen

  /** Vom Drucker übernommene Dateien ohne Auftrag nach X Tagen löschen (Archiv-Eintrag bleibt) */
  cleanup() {
    const days = Number(this.settings.keepDays) || 0;
    if (!days) return;
    const limit = Date.now() - days * 864e5;
    const used = new Set();
    for (const q of this.ctx.production.queueView()) if (q.orderId || ['queued', 'sending', 'printing'].includes(q.status)) used.add(q.fileId);
    for (const o of this.ctx.production.orders()) for (const p of o.positions || []) used.add(p.fileId);
    let n = 0;
    for (const f of this.ctx.files.list()) {
      if (f.source !== 'printer' || f.keep || used.has(f.id)) continue;
      const lastUse = Math.max(Date.parse(f.uploadedAt) || 0, ...this.ctx.history().filter((h) => h.fileId === f.id).map((h) => Date.parse(h.endedAt) || 0));
      if (lastUse > limit) continue;
      this.ctx.files.remove(f.id);
      n += 1;
    }
    if (n) {
      console.log(`Archiv: ${n} vom Drucker übernommene Datei(en) ohne Auftrag gelöscht (älter als ${days} Tage)`);
      this.ctx.broadcast('files', null);
    }
  }
}

module.exports = { Archive, ACTIVE };
