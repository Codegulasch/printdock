// Aufträge, Druckwarteschlange und Wartungsplaner.
//
// Ablauf:  Auftrag (z. B. "20 Halter für Kunde X")
//            └─ Positionen (Datei + Stückzahl)
//                 └─ "Einplanen" erzeugt Warteschlangen-Einträge (je Druck einer)
//          Warteschlange → Start auf einem Drucker (von Hand oder automatisch,
//          sobald der Drucker frei ist UND die Druckplatte als geräumt bestätigt wurde)
//          Druckende → Eintrag fertig/fehlgeschlagen, Auftrag zählt mit, Wartung zählt Stunden.

const crypto = require('crypto');
const { store } = require('./store');
const files = require('./files');

const ordersDb = store('orders.json', []);
const queueDb = store('queue.json', []);
const maintDb = store('maintenance.json', { tasks: [], log: [] });
const plateDb = store('printer-state.json', {}); // printerId -> { plateClear }

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const ACTIVE = new Set(['preparing', 'printing', 'paused']);
const READY_STATES = new Set(['idle', 'finished', 'cancelled']);
const OPEN_ITEM = new Set(['queued', 'sending', 'printing']);

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Passt eine geslicte Datei zum Druckermodell? (nur wenn beide bekannt sind) */
function modelMatches(file, printerModel) {
  const a = norm(file?.meta?.printerModel);
  const b = norm(printerModel);
  if (!a || !b) return null; // unbekannt
  return a.includes(b) || b.includes(a);
}

// ------------------------------------------------------------------ Wartungsvorlagen

const MAINT_TEMPLATES = [
  { title: 'Druckplatte reinigen', every: 10, unit: 'prints', note: 'Mit Spülmittel oder IPA, je nach Platte.' },
  { title: 'Düse prüfen und reinigen', every: 100, unit: 'h', note: 'Auf Ablagerungen und Verschleiß prüfen, ggf. tauschen.' },
  { title: 'Führungen reinigen und schmieren', every: 200, unit: 'h', note: 'Linearschienen/Stangen laut Herstelleranleitung.' },
  { title: 'Riemenspannung prüfen', every: 300, unit: 'h', note: '' },
  { title: 'Lüfter und Filter prüfen', every: 90, unit: 'days', note: 'Staub entfernen, Aktivkohlefilter tauschen falls vorhanden.' },
  { title: 'Firmware-Updates prüfen', every: 30, unit: 'days', note: '' },
];

const UNIT_LABEL = { h: 'Betriebsstunden', prints: 'Drucke', days: 'Tage' };

// ------------------------------------------------------------------ Klasse

class Production {
  /**
   * @param ctx {
   *   printers: () => [{ id, name, driver, settings }],
   *   runtime: Map(printerId -> { driver }),
   *   history: () => Verlaufseinträge,
   *   broadcast(event, data),
   *   notify(event, printerCfg, status, extra),
   * }
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.starting = new Set(); // printerIds, an die gerade gesendet wird
    // Einträge, die beim letzten Beenden "sendet" waren, zurück in die Warteschlange
    for (const q of queueDb.data) {
      if (q.status === 'sending') {
        q.status = 'queued';
        q.error = 'Übertragung wurde durch Neustart unterbrochen';
      }
    }
    queueDb.save();
    setInterval(() => this.watchdog(), 30_000).unref();
  }

  // ================================================================ Druckplatte

  plateClear(printerId) {
    return plateDb.data[printerId]?.plateClear === true;
  }

  setPlateClear(printerId, value) {
    plateDb.data[printerId] = { ...(plateDb.data[printerId] || {}), plateClear: value, at: now() };
    plateDb.save();
    this.ctx.broadcast('production', null);
    if (value) this.dispatch();
  }

  // ================================================================ Statushaken

  /** Vom Server bei jedem Status-Update aufgerufen. */
  onStatus(cfg, status, historyEntry) {
    // Erstkontakt ohne gespeicherten Zustand: leerer Drucker gilt als geräumt
    if (!(cfg.id in plateDb.data) && status.online) {
      this.setPlateClear(cfg.id, status.state === 'idle');
    }

    const item = queueDb.data.find((q) => q.printerId === cfg.id && (q.status === 'printing' || q.status === 'sending'));

    // Druck läuft tatsächlich → bestätigen
    if (item && item.status === 'printing' && ACTIVE.has(status.state) && !item.confirmed) {
      item.confirmed = true;
      queueDb.save();
    }

    if (historyEntry) {
      // Jeder beendete Druck belegt die Platte
      this.setPlateClear(cfg.id, false);
      if (item && item.status === 'printing') {
        item.status = { finished: 'done', cancelled: 'cancelled', error: 'failed' }[historyEntry.result] || 'failed';
        item.endedAt = now();
        item.historyId = historyEntry.id;
        item.error = historyEntry.result === 'error' ? historyEntry.message : null;
        historyEntry.queueId = item.id;
        historyEntry.orderId = item.orderId || null;
        queueDb.save();
        this.ctx.broadcast('production', null);
      }
      this.checkMaintenance(cfg);
    }

    if (READY_STATES.has(status.state)) this.dispatch();
  }

  /** Einträge, deren Start nie bestätigt wurde, wieder freigeben. */
  watchdog() {
    let changed = false;
    for (const q of queueDb.data) {
      if (q.status === 'printing' && !q.confirmed && Date.now() - Date.parse(q.startedAt) > 4 * 60_000) {
        q.status = 'queued';
        q.error = 'Der Drucker hat den Druck nicht begonnen – bitte am Drucker prüfen.';
        changed = true;
      }
    }
    if (changed) {
      queueDb.save();
      this.ctx.broadcast('production', null);
    }
  }

  // ================================================================ Warteschlange

  queueView() {
    const printers = this.ctx.printers();
    return queueDb.data
      .slice()
      .sort((a, b) => this.rank(a) - this.rank(b))
      .map((q) => {
        const f = files.get(q.fileId);
        const order = q.orderId ? ordersDb.data.find((o) => o.id === q.orderId) : null;
        const p = printers.find((x) => x.id === q.printerId);
        return {
          ...q,
          file: f ? { id: f.id, name: f.name, kind: f.kind, thumb: !!f.thumb, meta: f.meta, printable: f.printable } : null,
          order: order ? { id: order.id, nr: order.nr, title: order.title, due: order.due, prio: order.prio } : null,
          modelMatch: p ? modelMatches(f, p.settings?.model) : null,
        };
      });
  }

  /** Reihenfolge: offene Einträge nach Priorität, Termin, Position; erledigte danach. */
  rank(q) {
    const order = q.orderId ? ordersDb.data.find((o) => o.id === q.orderId) : null;
    const open = OPEN_ITEM.has(q.status) ? 0 : 1e15;
    const prio = (order?.prio || 2) * 1e13;
    const due = order?.due ? Date.parse(order.due) / 1e3 : 9e9;
    return open + prio + due * 1e3 + (q.sort || 0);
  }

  addToQueue({ fileId, printerId = null, count = 1, options = {}, orderId = null, positionId = null, top = false }) {
    const f = files.get(fileId);
    if (!f) throw httpError(404, 'Datei nicht gefunden');
    if (!f.printable) throw httpError(400, `„${f.name}“ ist nicht gesliced und kann nicht gedruckt werden. Erst im Slicer öffnen.`);
    if (printerId && !this.ctx.printers().some((p) => p.id === printerId)) throw httpError(404, 'Drucker nicht gefunden');
    const n = Math.max(1, Math.min(200, Number(count) || 1));
    const base = top ? Math.min(0, ...queueDb.data.map((q) => q.sort || 0)) - n : Math.max(0, ...queueDb.data.map((q) => q.sort || 0)) + 1;
    const created = [];
    for (let i = 0; i < n; i++) {
      const item = {
        id: uid(),
        fileId,
        printerId: printerId || null,
        orderId,
        positionId,
        status: 'queued',
        sort: base + i,
        options: cleanOptions(options),
        createdAt: now(),
      };
      queueDb.data.push(item);
      created.push(item);
    }
    queueDb.save();
    this.ctx.broadcast('production', null);
    this.dispatch();
    return created;
  }

  updateItem(id, patch) {
    const q = queueDb.data.find((x) => x.id === id);
    if (!q) throw httpError(404, 'Eintrag nicht gefunden');
    if (q.status !== 'queued') throw httpError(409, 'Nur wartende Einträge lassen sich ändern');
    if ('printerId' in patch) {
      if (patch.printerId && !this.ctx.printers().some((p) => p.id === patch.printerId)) throw httpError(404, 'Drucker nicht gefunden');
      q.printerId = patch.printerId || null;
    }
    if (patch.options) q.options = cleanOptions(patch.options);
    q.error = null;
    queueDb.save();
    this.ctx.broadcast('production', null);
    this.dispatch();
    return q;
  }

  removeItem(id) {
    const idx = queueDb.data.findIndex((x) => x.id === id);
    if (idx < 0) throw httpError(404, 'Eintrag nicht gefunden');
    const q = queueDb.data[idx];
    if (q.status === 'printing' || q.status === 'sending') throw httpError(409, 'Läuft gerade – zuerst den Druck am Drucker abbrechen');
    queueDb.data.splice(idx, 1);
    queueDb.save();
    this.ctx.broadcast('production', null);
  }

  /** Fehlgeschlagenen/abgebrochenen Druck erneut einreihen (oben). */
  requeue(id) {
    const q = queueDb.data.find((x) => x.id === id);
    if (!q) throw httpError(404, 'Eintrag nicht gefunden');
    if (!['failed', 'cancelled'].includes(q.status)) throw httpError(409, 'Nur fehlgeschlagene oder abgebrochene Drucke');
    q.status = 'retried';
    return this.addToQueue({ fileId: q.fileId, printerId: q.printerId, options: q.options, orderId: q.orderId, positionId: q.positionId, top: true })[0];
  }

  reorder(ids) {
    ids.forEach((id, i) => {
      const q = queueDb.data.find((x) => x.id === id);
      if (q) q.sort = i;
    });
    queueDb.save();
    this.ctx.broadcast('production', null);
  }

  /** Erledigte Einträge aufräumen. */
  clearFinished() {
    queueDb.data = queueDb.data.filter((q) => OPEN_ITEM.has(q.status) || (q.orderId && ordersDb.data.some((o) => o.id === q.orderId && !o.closed)));
    queueDb.save();
    this.ctx.broadcast('production', null);
  }

  /** Ist der Drucker bereit für den nächsten Druck? Liefert Grund oder null. */
  notReady(printerId) {
    const rt = this.ctx.runtime.get(printerId);
    if (!rt) return 'Drucker nicht aktiv';
    const s = rt.driver.status;
    if (!s.online) return 'Drucker nicht erreichbar';
    if (!READY_STATES.has(s.state)) return 'Drucker ist beschäftigt';
    if (this.starting.has(printerId)) return 'Übertragung läuft bereits';
    if (queueDb.data.some((q) => q.printerId === printerId && (q.status === 'printing' || q.status === 'sending'))) return 'Drucker hat schon einen Auftrag';
    return null;
  }

  /**
   * Eintrag auf einem Drucker starten.
   * Von Hand: das Drücken auf "Start" gilt als Bestätigung, dass die Platte frei ist.
   */
  async start(itemId, printerId, { manual = false } = {}) {
    const q = queueDb.data.find((x) => x.id === itemId);
    if (!q) throw httpError(404, 'Eintrag nicht gefunden');
    if (q.status !== 'queued') throw httpError(409, 'Eintrag wartet nicht');
    printerId = printerId || q.printerId;
    if (!printerId) throw httpError(400, 'Bitte einen Drucker wählen');
    const cfg = this.ctx.printers().find((p) => p.id === printerId);
    if (!cfg) throw httpError(404, 'Drucker nicht gefunden');
    const reason = this.notReady(printerId);
    if (reason) throw httpError(409, reason);
    if (!manual && !this.plateClear(printerId)) throw httpError(409, 'Druckplatte ist nicht als geräumt bestätigt');
    const f = files.get(q.fileId);
    if (!f) throw httpError(404, 'Datei wurde gelöscht');
    const rt = this.ctx.runtime.get(printerId);
    const cannot = rt.driver.canPrint(f);
    if (cannot) throw httpError(400, cannot);

    this.starting.add(printerId);
    q.status = 'sending';
    q.printerId = printerId;
    q.error = null;
    queueDb.save();
    this.ctx.broadcast('production', null);
    try {
      await rt.driver.startPrint({ path: files.filePath(f), name: f.name, kind: f.kind, meta: f.meta, options: q.options || {} });
      q.status = 'printing';
      q.startedAt = now();
      q.confirmed = false;
      this.setPlateClear(printerId, false);
      console.log(`[${cfg.name}] Druck gestartet: ${f.name}`);
    } catch (err) {
      q.status = 'queued';
      q.error = err.message;
      console.warn(`[${cfg.name}] Start fehlgeschlagen: ${err.message}`);
      throw httpError(502, err.message);
    } finally {
      this.starting.delete(printerId);
      queueDb.save();
      this.ctx.broadcast('production', null);
    }
    return q;
  }

  /** Automatischer Start auf allen bereiten Druckern mit "Auto-Start". */
  dispatch() {
    clearTimeout(this.dispatchTimer);
    this.dispatchTimer = setTimeout(() => this.runDispatch(), 300);
  }

  runDispatch() {
    if (!require('./app').moduleOn('queue')) return;
    for (const p of this.ctx.printers()) {
      if (!p.settings?.autoStart) continue;
      if (this.notReady(p.id) || !this.plateClear(p.id)) continue;
      const next = this.nextFor(p);
      if (!next) continue;
      this.start(next.id, p.id).catch(() => {
        /* Fehler steht am Eintrag */
      });
    }
  }

  /** Nächster passender Eintrag für einen Drucker. */
  nextFor(p) {
    const rt = this.ctx.runtime.get(p.id);
    return queueDb.data
      .filter((q) => q.status === 'queued' && !q.error)
      .sort((a, b) => this.rank(a) - this.rank(b))
      .find((q) => {
        const f = files.get(q.fileId);
        if (!f || (rt && rt.driver.canPrint(f))) return false;
        if (q.printerId) return q.printerId === p.id;
        return modelMatches(f, p.settings?.model) === true; // nicht zugewiesen: nur bei passendem Modell
      });
  }

  /** Demo-Daten übernehmen (Einträge tragen demo: true). */
  importDemo({ orders = [], queue = [], tasks = [], plate = {}, log = [] }) {
    ordersDb.data.push(...orders);
    queueDb.data.push(...queue);
    Object.assign(plateDb.data, plate);
    for (const t of tasks) {
      const printer = this.ctx.printers().find((p) => p.id === t.printerId);
      const st = this.printerStats(printer);
      const used = t.used || 0;
      maintDb.data.tasks.push({
        id: uid(), printerId: t.printerId, title: t.title, every: t.every, unit: t.unit, note: t.note || '', demo: true,
        createdAt: new Date(Date.now() - 200 * 864e5).toISOString(),
        last: {
          at: new Date(Date.now() - (t.unit === 'days' ? used : 20) * 864e5).toISOString(),
          hours: t.unit === 'h' ? Math.max(0, st.hours - used) : st.hours,
          prints: t.unit === 'prints' ? Math.max(0, st.prints - used) : st.prints,
        },
        notifiedAt: null,
      });
    }
    maintDb.data.log.push(...log);
    ordersDb.save();
    queueDb.save();
    plateDb.save();
    maintDb.save();
    this.ctx.broadcast('production', null);
  }

  removeDemo(printerIds) {
    ordersDb.data = ordersDb.data.filter((o) => !o.demo);
    queueDb.data = queueDb.data.filter((q) => !q.demo);
    maintDb.data.tasks = maintDb.data.tasks.filter((t) => !t.demo);
    maintDb.data.log = maintDb.data.log.filter((l) => !l.demo);
    for (const id of printerIds) delete plateDb.data[id];
    ordersDb.save();
    queueDb.save();
    plateDb.save();
    maintDb.save();
    this.ctx.broadcast('production', null);
  }

  getItem(id) {
    return queueDb.data.find((q) => q.id === id) || null;
  }

  /** Drucker wurde entfernt: wartende Einträge freigeben. */
  printerRemoved(printerId) {
    for (const q of queueDb.data) if (q.printerId === printerId && q.status === 'queued') q.printerId = null;
    delete plateDb.data[printerId];
    queueDb.save();
    plateDb.save();
    this.ctx.broadcast('production', null);
  }

  // ================================================================ Aufträge

  nextOrderNr() {
    const year = new Date().getFullYear();
    const nums = ordersDb.data.map((o) => String(o.nr).match(new RegExp(`^A-${year}-(\\d+)$`))).filter(Boolean).map((m) => Number(m[1]));
    return `A-${year}-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`;
  }

  orderView(o) {
    const items = queueDb.data.filter((q) => q.orderId === o.id);
    const positions = (o.positions || []).map((pos) => {
      const its = items.filter((q) => q.positionId === pos.id);
      const done = its.filter((q) => q.status === 'done').length;
      const planned = its.filter((q) => OPEN_ITEM.has(q.status)).length;
      const running = its.filter((q) => q.status === 'printing' || q.status === 'sending').length;
      const failed = its.filter((q) => q.status === 'failed').length;
      const f = files.get(pos.fileId);
      return {
        ...pos,
        file: f ? { id: f.id, name: f.name, kind: f.kind, thumb: !!f.thumb, printable: f.printable, meta: f.meta } : null,
        done,
        planned,
        running,
        failed,
        open: Math.max(0, pos.qty - done - planned),
      };
    });
    const qty = positions.reduce((a, p) => a + p.qty, 0);
    const done = positions.reduce((a, p) => a + Math.min(p.done, p.qty), 0);
    const running = positions.some((p) => p.running);
    const planned = positions.some((p) => p.planned);
    let status = 'offen';
    if (o.closed) status = 'abgeschlossen';
    else if (qty && done >= qty) status = 'fertig';
    else if (running) status = 'läuft';
    else if (planned || done) status = 'geplant';
    const restSec = positions.reduce((a, p) => a + (p.qty - Math.min(p.done, p.qty)) * (p.file?.meta?.estimatedSec || 0), 0);
    const today = new Date().toISOString().slice(0, 10);
    return {
      ...o,
      positions,
      qty,
      done,
      status,
      restSec,
      late: !o.closed && status !== 'fertig' && o.due && o.due < today,
    };
  }

  orders() {
    return ordersDb.data
      .map((o) => this.orderView(o))
      .sort((a, b) => Number(a.closed) - Number(b.closed) || (a.prio || 2) - (b.prio || 2) || String(a.due || '9').localeCompare(String(b.due || '9')));
  }

  saveOrder(body, id = null) {
    const existing = id ? ordersDb.data.find((o) => o.id === id) : null;
    if (id && !existing) throw httpError(404, 'Auftrag nicht gefunden');
    const title = String(body.title || '').trim();
    if (!title) throw httpError(400, 'Bitte eine Bezeichnung eingeben');
    const positions = (Array.isArray(body.positions) ? body.positions : []).map((p) => {
      if (!files.get(p.fileId)) throw httpError(400, 'Eine Position verweist auf eine gelöschte Datei');
      return {
        id: p.id && existing?.positions?.some((x) => x.id === p.id) ? p.id : uid(),
        fileId: p.fileId,
        qty: Math.max(1, Math.min(9999, Number(p.qty) || 1)),
        note: p.note ? String(p.note).slice(0, 200) : '',
      };
    });
    const o = {
      id: existing?.id || uid(),
      nr: existing?.nr || this.nextOrderNr(),
      title: title.slice(0, 120),
      customer: String(body.customer || '').trim().slice(0, 120),
      due: /^\d{4}-\d{2}-\d{2}$/.test(body.due || '') ? body.due : null,
      prio: [1, 2, 3].includes(Number(body.prio)) ? Number(body.prio) : 2,
      notes: String(body.notes || '').slice(0, 2000),
      closed: Boolean(body.closed),
      positions,
      createdAt: existing?.createdAt || now(),
    };
    if (existing) Object.assign(existing, o);
    else ordersDb.data.push(o);
    // Wartende Einträge entfernter Positionen löschen
    const posIds = new Set(positions.map((p) => p.id));
    queueDb.data = queueDb.data.filter((q) => !(q.orderId === o.id && q.status === 'queued' && !posIds.has(q.positionId)));
    if (o.closed) queueDb.data = queueDb.data.filter((q) => !(q.orderId === o.id && q.status === 'queued'));
    ordersDb.save();
    queueDb.save();
    this.ctx.broadcast('production', null);
    return this.orderView(o);
  }

  deleteOrder(id) {
    const idx = ordersDb.data.findIndex((o) => o.id === id);
    if (idx < 0) throw httpError(404, 'Auftrag nicht gefunden');
    if (queueDb.data.some((q) => q.orderId === id && (q.status === 'printing' || q.status === 'sending'))) {
      throw httpError(409, 'Zu diesem Auftrag läuft gerade ein Druck');
    }
    ordersDb.data.splice(idx, 1);
    queueDb.data = queueDb.data.filter((q) => !(q.orderId === id && q.status === 'queued'));
    ordersDb.save();
    queueDb.save();
    this.ctx.broadcast('production', null);
  }

  /** Offene Stückzahl einer oder aller Positionen in die Warteschlange stellen. */
  planOrder(id, { positionId = null, printerId = null } = {}) {
    const o = ordersDb.data.find((x) => x.id === id);
    if (!o) throw httpError(404, 'Auftrag nicht gefunden');
    if (o.closed) throw httpError(409, 'Auftrag ist abgeschlossen');
    const view = this.orderView(o);
    let total = 0;
    for (const pos of view.positions) {
      if (positionId && pos.id !== positionId) continue;
      if (!pos.open) continue;
      if (!pos.file?.printable) throw httpError(400, `„${pos.file?.name || 'Datei'}“ ist nicht gesliced`);
      this.addToQueue({ fileId: pos.fileId, printerId, count: pos.open, orderId: o.id, positionId: pos.id });
      total += pos.open;
    }
    if (!total) throw httpError(409, 'Alles bereits eingeplant');
    return { planned: total };
  }

  // ================================================================ Wartung

  printerStats(cfg) {
    const hist = this.ctx.history().filter((h) => h.printerId === cfg.id);
    const hours = hist.reduce((a, h) => a + (h.durationSec || 0), 0) / 3600 + (Number(cfg.settings?.hoursOffset) || 0);
    const prints = hist.length;
    const ok = hist.filter((h) => h.result === 'finished').length;
    return { hours: Math.round(hours * 10) / 10, prints, successRate: prints ? Math.round((ok / prints) * 100) : null };
  }

  taskState(t, stats) {
    const last = t.last || { at: t.createdAt, hours: 0, prints: 0 };
    let used;
    if (t.unit === 'h') used = stats.hours - (last.hours || 0);
    else if (t.unit === 'prints') used = stats.prints - (last.prints || 0);
    else used = (Date.now() - Date.parse(last.at || t.createdAt)) / 86_400_000;
    used = Math.max(0, Math.round(used * 10) / 10);
    const ratio = t.every ? used / t.every : 0;
    return { used, ratio, state: ratio >= 1 ? 'due' : ratio >= 0.85 ? 'soon' : 'ok', remaining: Math.max(0, Math.round((t.every - used) * 10) / 10) };
  }

  maintenanceView() {
    const printers = this.ctx.printers();
    const stats = Object.fromEntries(printers.map((p) => [p.id, this.printerStats(p)]));
    const tasks = maintDb.data.tasks
      .filter((t) => stats[t.printerId])
      .map((t) => ({ ...t, unitLabel: UNIT_LABEL[t.unit], ...this.taskState(t, stats[t.printerId]) }))
      .sort((a, b) => b.ratio - a.ratio);
    return { stats, tasks, log: maintDb.data.log.slice(-200).reverse(), templates: MAINT_TEMPLATES, units: UNIT_LABEL };
  }

  saveTask(body, id = null) {
    const existing = id ? maintDb.data.tasks.find((t) => t.id === id) : null;
    if (id && !existing) throw httpError(404, 'Aufgabe nicht gefunden');
    const printer = this.ctx.printers().find((p) => p.id === (body.printerId || existing?.printerId));
    if (!printer) throw httpError(400, 'Bitte einen Drucker wählen');
    const title = String(body.title || '').trim();
    if (!title) throw httpError(400, 'Bitte eine Bezeichnung eingeben');
    if (!UNIT_LABEL[body.unit]) throw httpError(400, 'Ungültige Einheit');
    const every = Number(body.every);
    if (!(every > 0)) throw httpError(400, 'Intervall muss größer als 0 sein');
    const t = {
      id: existing?.id || uid(),
      printerId: printer.id,
      title: title.slice(0, 120),
      every,
      unit: body.unit,
      note: String(body.note || '').slice(0, 500),
      createdAt: existing?.createdAt || now(),
      last: existing?.last || { at: now(), ...pick(this.printerStats(printer), 'hours', 'prints') },
      notifiedAt: existing?.notifiedAt || null,
    };
    if (existing) Object.assign(existing, t);
    else maintDb.data.tasks.push(t);
    maintDb.save();
    this.ctx.broadcast('production', null);
    return t;
  }

  deleteTask(id) {
    const idx = maintDb.data.tasks.findIndex((t) => t.id === id);
    if (idx < 0) throw httpError(404, 'Aufgabe nicht gefunden');
    maintDb.data.tasks.splice(idx, 1);
    maintDb.save();
    this.ctx.broadcast('production', null);
  }

  taskDone(id, note) {
    const t = maintDb.data.tasks.find((x) => x.id === id);
    if (!t) throw httpError(404, 'Aufgabe nicht gefunden');
    const printer = this.ctx.printers().find((p) => p.id === t.printerId);
    const stats = this.printerStats(printer);
    t.last = { at: now(), hours: stats.hours, prints: stats.prints };
    t.notifiedAt = null;
    maintDb.data.log.push({ id: uid(), taskId: t.id, printerId: t.printerId, printerName: printer?.name, title: t.title, at: now(), hours: stats.hours, note: String(note || '').slice(0, 500) });
    maintDb.data.log = maintDb.data.log.slice(-1000);
    maintDb.save();
    this.ctx.broadcast('production', null);
  }

  addTemplates(printerId) {
    if (!this.ctx.printers().some((p) => p.id === printerId)) throw httpError(404, 'Drucker nicht gefunden');
    let added = 0;
    for (const tpl of MAINT_TEMPLATES) {
      if (maintDb.data.tasks.some((t) => t.printerId === printerId && t.title === tpl.title)) continue;
      this.saveTask({ ...tpl, printerId });
      added++;
    }
    return { added };
  }

  /** Nach jedem Druck: fällige Aufgaben einmalig melden. */
  checkMaintenance(cfg) {
    const stats = this.printerStats(cfg);
    const due = [];
    for (const t of maintDb.data.tasks.filter((x) => x.printerId === cfg.id)) {
      if (t.notifiedAt) continue;
      if (this.taskState(t, stats).state === 'due') {
        t.notifiedAt = now();
        due.push(t.title);
      }
    }
    if (due.length) {
      maintDb.save();
      this.ctx.notify('maintenance', cfg, null, { tasks: due });
    }
  }

  /** Kennzahlen für die Leiste oben. */
  summary() {
    const today = new Date().toISOString().slice(0, 10);
    const orders = ordersDb.data.map((o) => this.orderView(o)).filter((o) => !o.closed);
    const m = this.maintenanceView();
    return {
      queued: queueDb.data.filter((q) => q.status === 'queued').length,
      queueErrors: queueDb.data.filter((q) => q.status === 'queued' && q.error).length,
      ordersOpen: orders.filter((o) => o.status !== 'fertig').length,
      ordersLate: orders.filter((o) => o.status !== 'fertig' && o.due && o.due < today).length,
      maintDue: m.tasks.filter((t) => t.state === 'due').length,
      plate: Object.fromEntries(this.ctx.printers().map((p) => [p.id, this.plateClear(p.id)])),
      next: Object.fromEntries(this.ctx.printers().map((p) => [p.id, this.nextFor(p)?.id || null])),
    };
  }
}

function cleanOptions(o = {}) {
  const out = {};
  if (o.plate) out.plate = Math.max(1, Number(o.plate) || 1);
  if (o.useAms === false || o.useAms === 'false') out.useAms = false;
  if (o.amsMapping) out.amsMapping = String(o.amsMapping).replace(/[^\d,\s-]/g, '').slice(0, 60);
  if (o.timelapse === true || o.timelapse === 'true') out.timelapse = true;
  return out;
}

function pick(obj, ...keys) {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}

module.exports = { Production, modelMatches, MAINT_TEMPLATES };
