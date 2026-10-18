// Aufträge, Druckwarteschlange und Wartungsplaner.
//
// Ablauf:  Auftrag (z. B. "20 Halter für Kunde X")
//            └─ Positionen (Datei + Stückzahl)
//                 └─ "Einplanen" erzeugt Warteschlangen-Einträge (je Druck einer)
//          Warteschlange → Start auf einem Drucker (von Hand oder automatisch,
//          sobald der Drucker frei ist UND die Druckplatte als geräumt bestätigt wurde)
//          Druckende → Eintrag fertig/fehlgeschlagen, Auftrag zählt mit, Wartung zählt Stunden.

const crypto = require('crypto');
const path = require('path');
const { store, DATA_DIR } = require('./store');
const toolmap = require('./toolmap');
const files = require('./files');
const parts = require('./parts');

const ordersDb = store('orders.json', []);
const queueDb = store('queue.json', []);
const maintDb = store('maintenance.json', { tasks: [], log: [] });
const plateDb = store('printer-state.json', {}); // printerId -> { plateClear }

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const ACTIVE = new Set(['preparing', 'printing', 'paused']);
const READY_STATES = new Set(['idle', 'finished', 'cancelled']);
const OPEN_ITEM = new Set(['queued', 'sending', 'printing']);
// Druckart je Auftrag bzw. Eintrag: Seriendruck automatisch, Seriendruck von Hand, Einzeldruck
const MODES = ['auto', 'manual', 'single'];
const MODE_LABEL = { auto: 'Seriendruck (automatisch)', manual: 'Seriendruck (manuell)', single: 'Einzeldruck' };
const baseName = (s) => String(s || '').split(/[\\/]/).pop().toLowerCase();

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
    this.starting = new Map(); // printerId -> Kennung des laufenden Startversuchs
    this.sendWait = new Map(); // printerId -> resolve: Drucker hat mit dem gesendeten Druck begonnen
    this.humWait = new Map(); // queueId -> Grund, warum Auto-Start wegen Feuchte wartet
    // Einträge, die beim letzten Beenden „überträgt“ waren: Der Drucker kann die Datei längst bekommen
    // (und gedruckt) haben. Als „druckt, unbestätigt“ übernehmen – meldet der Drucker den Druck, läuft es
    // normal weiter; steht der Druck schon im Verlauf, wird der Eintrag damit abgeschlossen; sonst geht er
    // nach 4 Minuten mit Hinweis zurück in die Warteschlange (ohne automatischen Neustart).
    for (const q of queueDb.data) {
      if (q.status === 'sending') {
        q.status = 'printing';
        q.confirmed = false;
        q.sentAt ||= Date.parse(q.createdAt) || Date.now();
        q.startedAt = now();
        q.wasSending = true;
      }
    }
    this.migrateModes();
    queueDb.save();
    setInterval(() => this.watchdog(), 30_000).unref();
  }

  // ================================================================ Druckart

  /**
   * Einmalig: Bisher entschieden „Auto-Start“ und „Aufträge weiterdrucken“ am Drucker. Jetzt hat jeder
   * Auftrag und jeder Eintrag eine Druckart – übernommen aus den alten Drucker-Einstellungen.
   */
  migrateModes() {
    const printers = this.ctx.printers();
    const autoOn = (id) => Boolean(printers.find((p) => p.id === id)?.settings?.autoStart);
    const anyAuto = printers.some((p) => p.settings?.autoStart || ['same', 'prio'].includes(p.settings?.orderNext));
    let changed = false;
    for (const o of ordersDb.data) {
      if (!MODES.includes(o.mode)) {
        o.mode = anyAuto ? 'auto' : 'manual';
        changed = true;
      }
    }
    for (const q of queueDb.data) {
      if (MODES.includes(q.mode)) continue;
      const o = q.orderId ? ordersDb.data.find((x) => x.id === q.orderId) : null;
      q.mode = q.autoNext ? 'auto' : q.printerId ? (autoOn(q.printerId) ? 'auto' : 'manual') : o?.mode || (anyAuto ? 'auto' : 'manual');
      changed = true;
    }
    if (changed) {
      ordersDb.save();
      queueDb.save();
    }
  }

  /** Standard-Druckart für neue Einträge und Aufträge (Einstellungen → Drucker & Filament → Druckstart) */
  defaultMode() {
    const m = require('./app').printMode;
    return MODES.includes(m) ? m : 'auto';
  }

  modeOf(q) {
    if (MODES.includes(q?.mode)) return q.mode;
    const o = q?.orderId ? ordersDb.data.find((x) => x.id === q.orderId) : null;
    return MODES.includes(o?.mode) ? o.mode : this.defaultMode();
  }

  // ================================================================ Druckplatte

  plateClear(printerId) {
    return plateDb.data[printerId]?.plateClear === true;
  }

  setPlateClear(printerId, value) {
    plateDb.data[printerId] = { ...(plateDb.data[printerId] || {}), plateClear: value, at: now() };
    plateDb.save();
    this.startInfo ||= {};
    delete this.startInfo[printerId];
    if (value) {
      // Hängt am Drucker noch ein „druckt“-Eintrag? Dann gleich nachfragen statt 3 Minuten zu warten
      for (const q of queueDb.data) if (q.printerId === printerId && this.isStale(q) && !q.stale) q.stale = true;
      // sofort versuchen zu starten – und sagen, warum nicht
      clearTimeout(this.dispatchTimer);
      this.runDispatch();
      const p = this.ctx.printers().find((x) => x.id === printerId);
      if (p) {
        this.startInfo[printerId] = this.explainStart(p);
        if (!this.startInfo[printerId].ok) console.log(`[${p.name}] Platte frei – startet nicht: ${this.startInfo[printerId].text}`);
      }
      queueDb.save();
    }
    this.ctx.broadcast('production', null);
  }

  /** Wird nach „Platte frei“ etwas gestartet? { ok, text, kind, queueId } – für Druckerkarte und „Heute“ */
  explainStart(p) {
    const fileName = (q) => files.get(q?.fileId)?.name || '';
    const sending = queueDb.data.find((q) => q.printerId === p.id && (q.status === 'sending' || (q.status === 'printing' && !q.confirmed && Date.now() - Date.parse(q.startedAt) < 60_000)));
    if (sending || this.starting.has(p.id)) return { ok: true, text: `Startet: ${fileName(sending)}`, queueId: sending?.id || null };
    const stuck = queueDb.data.find((q) => q.printerId === p.id && this.isStale(q));
    if (stuck) return { ok: false, kind: 'stuck', queueId: stuck.id, text: `„${fileName(stuck)}“ steht noch auf „druckt“ – war der Druck fertig?` };
    const ext = this.ctx.externalJob?.(p.id);
    if (ext) return { ok: false, kind: 'printer', text: `Drucker ist belegt durch einen Druck, der nicht aus PrintDock kam („${ext}“)` };
    const nr = this.notReady(p.id);
    if (nr) return { ok: false, kind: 'printer', text: nr };
    const mine = queueDb.data.filter((q) => q.status === 'queued' && (q.printerId === p.id || (!q.printerId && this.inArea(q, p)))).sort((a, b) => this.rank(a) - this.rank(b));
    if (!mine.length) return { ok: false, kind: 'empty', text: 'Nichts in der Warteschlange' };
    const autos = mine.filter((q) => this.modeOf(q) === 'auto');
    if (!autos.length) {
      const fits = mine.find((q) => q.printerId === p.id) || mine.find((q) => modelMatches(files.get(q.fileId), this.modelOf(p)) === true);
      if (fits) return { ok: false, kind: 'manual', queueId: fits.id, text: `„${fileName(fits)}“ ist ${this.modeOf(fits) === 'single' ? 'ein Einzeldruck' : 'ein Seriendruck (manuell)'} – von Hand starten` };
      return { ok: false, kind: 'none', text: 'Kein Eintrag in der Warteschlange passt zu diesem Drucker' };
    }
    for (const q of autos) {
      const r = this.whyNot(q, p);
      if (r) return { ok: false, kind: r.kind, queueId: q.id, text: `${fileName(q)}: ${r.text}` };
    }
    return { ok: false, kind: 'none', text: 'Kein passender Eintrag für diesen Drucker' };
  }

  /** Warum startet ein Eintrag nicht automatisch auf diesem Drucker? null = er könnte */
  whyNot(q, p) {
    if (q.afterDry) return { kind: 'dry', text: 'wartet aufs Trocknen' };
    if (q.error && !this.retryable(q)) return { kind: 'error', text: `letzter Startversuch fehlgeschlagen (${q.error})` };
    if (q.printerId && q.printerId !== p.id) return null;
    const f = files.get(q.fileId);
    if (!f) return { kind: 'file', text: 'Datei wurde gelöscht' };
    const rt = this.ctx.runtime.get(p.id);
    const cannot = rt?.driver.canPrint(f);
    if (cannot) return { kind: 'file', text: cannot };
    const model = modelMatches(f, this.modelOf(p));
    if (model === false) return { kind: 'model', text: `für ${f.meta?.printerModel} geslict` };
    if (!q.printerId && model !== true) return { kind: 'model', text: 'Druckerprofil der Datei unbekannt – Drucker fest zuweisen' };
    if (this.modeOf(q) !== 'auto') return { kind: 'manual', text: this.modeOf(q) === 'single' ? 'Einzeldruck – von Hand starten' : 'Seriendruck (manuell) – von Hand starten' };
    const wet = this.ctx.humBlock ? this.ctx.humBlock(p, f, q.options || {}) : null;
    if (wet) return { kind: 'humidity', text: wet };
    const rule = this.ctx.startRule ? this.ctx.startRule(p, f) : null;
    if (rule) return { kind: 'rule', text: rule };
    if (!q.printerId && this.ctx.fit) {
      const fit = this.ctx.fit(p, f);
      if (!fit.ok) return { kind: 'filament', text: `Filament: ${fit.reason}` };
    }
    return null;
  }

  /** Fehlgeschlagener Start: nach 2 Minuten automatisch noch einmal (höchstens 3 Versuche) */
  retryable(q) {
    return Boolean(q.error && q.errorAt && (q.tries || 0) < 3 && Date.now() - q.errorAt > 2 * 60_000);
  }

  // ================================================================ Statushaken

  /** Vom Server bei jedem Status-Update aufgerufen. */
  onStatus(cfg, status, historyEntry) {
    // Erstkontakt ohne gespeicherten Zustand: leerer Drucker gilt als geräumt
    if (!(cfg.id in plateDb.data) && status.online) {
      this.setPlateClear(cfg.id, status.state === 'idle');
    }

    const item = queueDb.data.find((q) => q.printerId === cfg.id && (q.status === 'printing' || q.status === 'sending'));

    // Übertragung: Der Drucker hat schon angefangen (oder ist schon fertig), auch wenn die Antwort auf das
    // Hochladen noch aussteht (z. B. Snapmaker U1 antwortet erst spät) → als laufend übernehmen
    // Nur wenn der Drucker auch diese Datei druckt – am Drucker gestartete andere Drucke nicht verwechseln
    if (item && item.status === 'sending' && (ACTIVE.has(status.state) || historyEntry)) {
      const shown = historyEntry?.file || status.file;
      if (this.sameFile(item, shown)) this.promote(item, 'Drucker meldet den Druck');
      else if (item.otherFile !== shown) {
        item.otherFile = shown;
        console.log(`[${cfg.name}] Drucker druckt „${shown}“ – nicht „${files.get(item.fileId)?.name}“, Eintrag wird nicht übernommen`);
      }
    }

    // Druck läuft tatsächlich → bestätigen
    if (item && item.status === 'printing' && ACTIVE.has(status.state)) {
      if (status.progress != null) item.lastProgress = status.progress; // für das Aufräumen hängender Einträge
      item.lastSeenAt = Date.now();
      if (item.stale) {
        delete item.stale;
        this.ctx.broadcast('production', null);
      }
      if (!item.confirmed) {
        item.confirmed = true;
        queueDb.save();
      }
    }

    if (ACTIVE.has(status.state) && this.startInfo?.[cfg.id]) {
      delete this.startInfo[cfg.id];
      this.ctx.broadcast('production', null);
    }

    if (historyEntry) {
      // Jeder beendete Druck belegt die Platte
      this.setPlateClear(cfg.id, false);
      if (item && item.status === 'printing') this.closeItem(item, historyEntry);
      this.checkMaintenance(cfg);
    }

    if (READY_STATES.has(status.state)) this.dispatch();
  }

  // ================================================================ Archiv: Fremddrucke einem Auftrag zuordnen

  /**
   * Verlaufseintrag (z. B. aus dem Slicer direkt gedruckt) einem Auftrag zuordnen. Wartet in der Warteschlange
   * schon ein Druck dieser Position, gilt er damit als erledigt; sonst zählt ein neuer, erledigter Eintrag mit.
   */
  attachHistory(h, orderId, positionId = null) {
    const o = ordersDb.data.find((x) => x.id === orderId);
    if (!o) throw httpError(404, 'Auftrag nicht gefunden');
    const pos = (o.positions || []).find((x) => x.id === positionId) || (o.positions || []).find((x) => this.posMatches(x, h)) || (o.positions?.length === 1 ? o.positions[0] : null);
    if (!pos) throw httpError(400, 'Bitte die Position wählen');
    if (h.queueId) this.detachHistory(h);
    const status = { finished: 'done', cancelled: 'cancelled', error: 'failed' }[h.result] || 'failed';
    let q = queueDb.data.filter((x) => x.orderId === o.id && x.positionId === pos.id && x.status === 'queued').sort((a, b) => this.rank(a) - this.rank(b))[0];
    if (q && status === 'done') {
      q.consumedFrom = 'queued';
    } else {
      q = { id: uid(), fileId: h.fileId || pos.fileId, printerId: h.printerId, orderId: o.id, positionId: pos.id, sort: 0, options: {}, mode: this.modeOf({ orderId: o.id }), createdAt: h.startedAt || now() };
      queueDb.data.push(q);
      q.consumedFrom = 'new';
    }
    Object.assign(q, { status, printerId: h.printerId, startedAt: h.startedAt, endedAt: h.endedAt, historyId: h.id, fromArchive: true, confirmed: true });
    delete q.autoNext;
    h.queueId = q.id;
    h.orderId = o.id;
    delete h.assignOpen;
    queueDb.save();
    this.ctx.broadcast('production', null);
    return { orderId: o.id, positionId: pos.id, queueId: q.id };
  }

  /** Zuordnung wieder lösen */
  detachHistory(h) {
    const q = queueDb.data.find((x) => x.id === h.queueId);
    if (q?.fromArchive) {
      if (q.consumedFrom === 'queued') {
        Object.assign(q, { status: 'queued' });
        for (const k of ['startedAt', 'endedAt', 'historyId', 'fromArchive', 'confirmed', 'consumedFrom']) delete q[k];
      } else queueDb.data = queueDb.data.filter((x) => x.id !== q.id);
    }
    delete h.queueId;
    delete h.orderId;
    queueDb.save();
    this.ctx.broadcast('production', null);
  }

  /** Passt eine Auftragsposition zu einem Verlaufseintrag? (gleiche Datei, gleicher Inhalt oder gleicher Name) */
  posMatches(pos, h) {
    if (h.fileId && pos.fileId === h.fileId) return true;
    if (pos.partId && h.fileId && files.get(h.fileId)?.partId === pos.partId) return true; // andere Variante desselben Teils
    const pf = files.get(pos.fileId);
    const hf = h.fileId ? files.get(h.fileId) : null;
    if (pf?.hash && hf?.hash && pf.hash === hf.hash) return true;
    const norm2 = (x) => files.stem(baseName(x).replace(/\.(gcode|3mf)$/i, '')).replace(/[^a-z0-9]+/g, '');
    return Boolean(pf && h.file && norm2(pf.name) === norm2(h.file));
  }

  /** Aufträge mit offener Position, die zu diesem Druck passt – für Vorschläge und automatische Zuordnung */
  assignCandidates(h) {
    const out = [];
    for (const o of ordersDb.data.filter((x) => !x.closed && !x.archived)) {
      const v = this.orderView(o);
      for (const pos of v.positions) {
        if (!this.posMatches(pos, h)) continue;
        const waiting = queueDb.data.some((q) => q.orderId === o.id && q.positionId === pos.id && q.status === 'queued');
        if (pos.open > 0 || waiting) out.push({ orderId: o.id, nr: o.nr, title: o.title, customer: o.customer || '', positionId: pos.id, file: pos.file?.name || '', open: pos.open + (waiting ? 1 : 0) });
      }
    }
    return out;
  }

  /** Fortsetzen nach Stromausfall: Der Eintrag läuft weiter statt abgebrochen */
  reopenItem(queueId) {
    const q = queueDb.data.find((x) => x.id === queueId);
    if (!q || q.status === 'printing') return;
    q.status = 'printing';
    q.confirmed = true;
    delete q.endedAt;
    delete q.historyId;
    queueDb.save();
    this.ctx.broadcast('production', null);
  }

  /** „Überträgt“ → „druckt“: Der Drucker hat den Druck begonnen */
  promote(q, why = '') {
    if (q.status !== 'sending') return;
    q.status = 'printing';
    q.startedAt = now();
    q.confirmed = true;
    delete q.tries;
    delete q.errorAt;
    q.error = null;
    this.starting.delete(q.printerId); // Start ist erledigt, auch wenn die Antwort noch aussteht
    this.sendWait.get(q.printerId)?.();
    this.sendWait.delete(q.printerId);
    plateDb.data[q.printerId] = { ...(plateDb.data[q.printerId] || {}), plateClear: false, at: now() };
    plateDb.save();
    queueDb.save();
    this.ctx.broadcast('production', null);
    if (why) console.log(`[${this.ctx.printers().find((p) => p.id === q.printerId)?.name || q.printerId}] Druck läuft (${why}): ${files.get(q.fileId)?.name || ''}`);
  }

  /** Druckt der Drucker die Datei dieses Eintrags? (unbekannter Name zählt als ja) */
  sameFile(q, shown) {
    if (!shown) return true;
    const a = files.stem(baseName(shown).replace(/\.(gcode|3mf)$/i, ''));
    const f = files.get(q.fileId);
    if (!f) return true;
    const b = files.stem(f.name);
    const norm2 = (x) => x.replace(/[^a-z0-9]+/g, '');
    return a === b || norm2(a) === norm2(b);
  }

  /** Steht ein Druck dieses Eintrags schon im Verlauf (Ende verpasst, während er noch „überträgt“ war)? */
  matchHistory(q) {
    const since = (q.sentAt || Date.parse(q.startedAt) || 0) - 60_000;
    const name = baseName(files.get(q.fileId)?.name);
    if (!name) return null;
    return this.ctx.history().find((h) => h.printerId === q.printerId && !h.queueId && Date.parse(h.endedAt) >= since && (baseName(h.file) === name || this.sameFile(q, h.file))) || null;
  }

  /** Laufenden Eintrag mit dem Verlaufseintrag seines Druckendes abschließen */
  closeItem(item, historyEntry) {
    // eine noch ausstehende Antwort auf das Hochladen blockiert den Drucker nicht weiter
    this.sendWait.get(item.printerId)?.();
    this.sendWait.delete(item.printerId);
    this.starting.delete(item.printerId);
    item.status = { finished: 'done', cancelled: 'cancelled', error: 'failed' }[historyEntry.result] || 'failed';
    item.endedAt = now();
    item.historyId = historyEntry.id;
    item.error = historyEntry.result === 'error' ? historyEntry.message : null;
    delete item.stale;
    historyEntry.queueId = item.id;
    historyEntry.orderId = item.orderId || null;
    queueDb.save();
    this.ctx.broadcast('production', null);
    if (historyEntry.result === 'finished' && this.modeOf(item) === 'auto') {
      try {
        this.queueNextOrderPart(item.printerId, item.orderId);
      } catch (err) {
        console.warn(`Auftrags-Auto-Start: ${err.message}`);
      }
    }
  }

  /**
   * Seriendruck (automatisch): Nach einem fertigen Druck das nächste Teil – desselben Auftrags zuerst,
   * sonst eines anderen automatischen Auftrags nach Priorität und Termin – fest an diesem Drucker einreihen.
   * Gestartet wird es, sobald die Platte als frei bestätigt ist.
   */
  queueNextOrderPart(printerId, lastOrderId = null) {
    const p = this.ctx.printers().find((x) => x.id === printerId);
    if (!p || !require('./app').moduleOn('orders')) return null;
    // schon etwas fest für diesen Drucker vorgemerkt?
    if (queueDb.data.some((q) => q.status === 'queued' && q.printerId === p.id && q.autoNext)) return null;
    // 1. wartende Teile desselben Auftrags (Seriendruck automatisch) an diesem Drucker vormerken
    const waiting = queueDb.data
      .filter((q) => q.status === 'queued' && lastOrderId && q.orderId === lastOrderId && this.modeOf(q) === 'auto' && !q.afterDry && !q.error && (q.printerId === p.id || (!q.printerId && this.candidate(q, p, false, { noRules: true }))))
      .sort((a, b) => this.rank(a) - this.rank(b));
    if (waiting[0]) {
      const q = waiting[0];
      q.printerId = p.id;
      q.autoNext = true;
      queueDb.save();
      this.ctx.broadcast('production', null);
      console.log(`[${p.name}] Auftrags-Auto-Start: nächstes Teil vorgemerkt (${files.get(q.fileId)?.name})`);
      return q;
    }
    // Steht schon ein anderer automatischer Eintrag bereit, nimmt ihn die normale Verteilung
    if (this.nextFor(p, { autoOnly: true })) return null;
    // 2. noch nicht eingeplante Stücke offener Aufträge mit Seriendruck (automatisch) – gleicher Auftrag zuerst
    const orders = this.orders().filter((o) => !o.closed && !o.archived && this.modeOf({ orderId: o.id }) === 'auto')
      .sort((a, b) => Number(b.id === lastOrderId) - Number(a.id === lastOrderId) || (a.prio || 2) - (b.prio || 2) || String(a.due || '9').localeCompare(String(b.due || '9')));
    for (const o of orders) {
      for (const pos of o.positions) {
        if (!pos.open || !pos.file?.printable) continue;
        const f = pos.partId && parts.get(pos.partId) ? parts.variantFor(pos.partId, p, this.modelOf(p)) : files.get(pos.fileId);
        if (!f) continue; // keine Variante für diesen Drucker
        if (!(pos.partId && parts.get(pos.partId)) && modelMatches(f, this.modelOf(p)) === false) continue;
        if (o.areaId && !this.inArea({ orderId: o.id }, p)) continue; // Auftrag gehört zu einem anderen Bereich
        const fit = this.ctx.fit ? this.ctx.fit(p, f) : { ok: true };
        if (!fit.ok) continue;
        const [q] = this.addToQueue({ fileId: f.id, partId: pos.partId || null, printerId: p.id, count: 1, orderId: o.id, positionId: pos.id });
        q.autoNext = true;
        queueDb.save();
        this.ctx.broadcast('production', null);
        console.log(`[${p.name}] Auftrags-Auto-Start: ${o.nr} – nächstes Teil eingeplant (${f?.name})`);
        return q;
      }
    }
    return null;
  }

  /**
   * Hängt ein Eintrag auf „druckt“, obwohl der Drucker längst bereit ist?
   * (Druckende verpasst, z. B. PrintDock wurde während des Drucks neu gestartet.)
   */
  isStale(q) {
    if (q.status !== 'printing' || !q.confirmed) return false;
    const st = this.ctx.runtime.get(q.printerId)?.driver.status;
    return Boolean(st?.online && READY_STATES.has(st.state) && !this.ctx.hasJob?.(q.printerId));
  }

  /** Einträge, deren Start nie bestätigt wurde, wieder freigeben; hängende Einträge erkennen. */
  watchdog() {
    if (queueDb.data.some((q) => q.status === 'queued' && (q.afterDry || this.retryable(q)))) this.dispatch();
    let changed = false;
    for (const q of queueDb.data) {
      // Drucker seit 3 Minuten bereit, aber Eintrag „druckt“ noch → als hängend markieren (Oberfläche bietet Aufräumen an);
      // stand der Druck kurz vor Schluss, gilt er als fertig
      if (this.isStale(q)) {
        q.staleSince ||= Date.now();
        if (Date.now() - q.staleSince > 3 * 60_000) {
          if ((q.lastProgress ?? 0) >= 95 && this.ctx.resolveLost) {
            console.log(`Hängender Eintrag automatisch abgeschlossen (Fortschritt ${Math.round(q.lastProgress)} %)`);
            this.ctx.resolveLost(q, 'finished', { auto: true });
            changed = true;
          } else if (!q.stale) {
            q.stale = true;
            changed = true;
          }
        }
        continue;
      }
      delete q.staleSince;
      // Start nie bestätigt, aber der Druck steht schon im Verlauf (Ende während der Übertragung verpasst)
      if ((q.status === 'printing' && !q.confirmed) || (q.status === 'sending' && !this.starting.has(q.printerId))) {
        const h = this.matchHistory(q);
        if (h) {
          q.status = 'printing';
          console.log(`Eintrag „${files.get(q.fileId)?.name || ''}“ mit dem Verlauf abgeschlossen (Druck lief bereits)`);
          this.closeItem(q, h);
          this.ctx.onHistoryLinked?.();
          changed = true;
          continue;
        }
      }
      if (q.status === 'printing' && !q.confirmed && Date.now() - Date.parse(q.startedAt) > 4 * 60_000) {
        q.status = 'queued';
        q.error = q.wasSending
          ? 'Übertragung wurde durch einen Neustart unterbrochen – bitte am Drucker prüfen, ob gedruckt wurde, dann neu starten oder entfernen.'
          : 'Der Drucker hat den Druck nicht begonnen – bitte am Drucker prüfen.';
        delete q.wasSending;
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
        const part = q.partId ? parts.get(q.partId) : null;
        const p = printers.find((x) => x.id === q.printerId);
        // Teil mit festem Drucker: die Variante für diesen Drucker anzeigen
        const f = (part && p && q.status === 'queued' && this.fileFor(q, p, { assigned: true })) || files.get(q.fileId);
        const order = q.orderId ? ordersDb.data.find((o) => o.id === q.orderId) : null;
        return {
          ...q,
          file: f ? { id: f.id, name: f.name, kind: f.kind, thumb: !!f.thumb, meta: f.meta, printable: f.printable } : null,
          part: part ? { id: part.id, name: part.name } : null,
          order: order ? { id: order.id, nr: order.nr, title: order.title, due: order.due, prio: order.prio } : null,
          modelMatch: p ? (f?.targets?.length ? f.targets.includes(p.id) : modelMatches(f, this.modelOf(p))) : null,
          mode: this.modeOf(q),
          waitReason: q.status === 'queued' && !q.afterDry && this.modeOf(q) === 'auto'
            ? this.humWait.get(q.id) || (!q.printerId ? this.waitReason(q) : f && this.ctx.humBlock ? this.ctx.humBlock(p, f, q.options || {}) : null)
            : null,
        };
      });
  }

  /** Reihenfolge: offene Einträge nach Priorität, Termin, Position; erledigte danach. */
  rank(q) {
    const order = q.orderId ? ordersDb.data.find((o) => o.id === q.orderId) : null;
    // laufende zuerst, dann neu eingereihte Fehldrucke, dann der Rest; erledigte ans Ende
    const open = q.status === 'printing' || q.status === 'sending' ? -2e15 : OPEN_ITEM.has(q.status) ? (q.urgent ? -1e15 : 0) : 1e15;
    const prio = (order?.prio || 2) * 1e13;
    const due = order?.due ? Date.parse(order.due) / 1e3 : 9e9;
    return open + prio + due * 1e3 + (q.sort || 0);
  }

  addToQueue({ fileId, partId = null, printerId = null, count = 1, options = {}, orderId = null, positionId = null, top = false, urgent = false, mode = null, areaId = null }) {
    // Teil: irgendeine druckfertige Variante als Platzhalter – gestartet wird die zum Drucker passende
    if (partId) {
      const part = parts.get(partId);
      if (!part) throw httpError(404, 'Teil nicht gefunden');
      const vs = parts.variants(partId).filter((x) => x.printable);
      if (!vs.length) throw httpError(400, `„${part.name}“ hat noch keine druckfertige Variante`);
      if (!fileId || !vs.some((x) => x.id === fileId)) fileId = vs[0].id;
    }
    const f = files.get(fileId);
    if (!f) throw httpError(404, 'Datei nicht gefunden');
    if (!f.printable) throw httpError(400, `„${f.name}“ ist nicht gesliced und kann nicht gedruckt werden. Erst im Slicer öffnen.`);
    if (printerId && !this.ctx.printers().some((p) => p.id === printerId)) throw httpError(404, 'Drucker nicht gefunden');
    const m = MODES.includes(mode) ? mode : this.modeOf({ orderId });
    // Einzeldruck: immer nur ein Druck
    const n = m === 'single' ? 1 : Math.max(1, Math.min(200, Number(count) || 1));
    const base = top ? Math.min(0, ...queueDb.data.map((q) => q.sort || 0)) - n : Math.max(0, ...queueDb.data.map((q) => q.sort || 0)) + 1;
    const created = [];
    for (let i = 0; i < n; i++) {
      const item = {
        id: uid(),
        fileId,
        ...(partId ? { partId } : {}),
        printerId: printerId || null,
        orderId,
        positionId,
        status: 'queued',
        sort: base + i,
        options: cleanOptions(options),
        mode: m,
        ...(!printerId && areaId ? { areaId: String(areaId).slice(0, 40) } : {}),
        ...(urgent ? { urgent: true } : {}),
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
    if ('areaId' in patch) {
      q.areaId = patch.areaId ? String(patch.areaId).slice(0, 40) : null;
      if (q.areaId) q.printerId = null;
    }
    if ('printerId' in patch) {
      if (patch.printerId && !this.ctx.printers().some((p) => p.id === patch.printerId)) throw httpError(404, 'Drucker nicht gefunden');
      q.printerId = patch.printerId || null;
      if (q.printerId) q.areaId = null;
      delete q.autoNext;
    }
    if (patch.options) q.options = cleanOptions(patch.options);
    if ('mode' in patch) {
      if (!MODES.includes(patch.mode)) throw httpError(400, 'Unbekannte Druckart');
      q.mode = patch.mode;
      if (q.mode !== 'auto') delete q.autoNext;
    }
    q.error = null;
    delete q.tries;
    delete q.errorAt;
    queueDb.save();
    this.ctx.broadcast('production', null);
    this.dispatch();
    return q;
  }

  removeItem(id) {
    const idx = queueDb.data.findIndex((x) => x.id === id);
    if (idx < 0) throw httpError(404, 'Eintrag nicht gefunden');
    const q = queueDb.data[idx];
    if ((q.status === 'printing' || q.status === 'sending') && !q.stale && !this.isStale(q)) throw httpError(409, 'Läuft gerade – zuerst den Druck am Drucker abbrechen');
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
    return this.addToQueue({ fileId: q.fileId, printerId: q.printerId, options: q.options, orderId: q.orderId, positionId: q.positionId, top: true, urgent: true, mode: this.modeOf(q), areaId: q.areaId || null })[0];
  }

  /** Fertigen Druck nachträglich als Fehldruck werten (bzw. zurück) – zählt dann nicht als erledigt */
  itemFailed(id, failed = true) {
    const q = queueDb.data.find((x) => x.id === id);
    if (!q) return;
    if (failed && q.status === 'done') q.status = 'failed';
    else if (!failed && q.status === 'failed') q.status = 'done';
    else return;
    queueDb.save();
    this.ctx.broadcast('production', null);
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
    // Teil: die Variante für diesen Drucker nehmen
    if (q.partId && parts.get(q.partId)) {
      const v = this.fileFor(q, cfg, { assigned: true });
      if (!v) throw httpError(409, `Für ${cfg.name} gibt es keine Variante von „${parts.get(q.partId).name}“ – bitte für diesen Drucker slicen und dem Teil zuordnen.`);
      if (v.id !== q.fileId) q.fileId = v.id;
    }
    const f = files.get(q.fileId);
    if (!f) throw httpError(404, 'Datei wurde gelöscht');
    const fixed = Array.isArray(f.targets) && f.targets.length ? f.targets.includes(printerId) : null;
    if (fixed === false) throw httpError(409, `„${f.name}“ ist nur für andere Drucker vorgesehen. Beim Teil die Drucker der Variante anpassen.`);
    if (fixed !== true && modelMatches(f, this.modelOf(cfg)) === false) throw httpError(409, `Die Datei ist für ${f.meta.printerModel} geslict – ${cfg.name} ist ein ${this.modelOf(cfg)}. Bitte für diesen Drucker neu slicen.`);
    const rt = this.ctx.runtime.get(printerId);
    const cannot = rt.driver.canPrint(f);
    if (cannot) throw httpError(400, cannot);

    const token = uid();
    this.starting.set(printerId, token);
    q.status = 'sending';
    q.printerId = printerId;
    q.error = null;
    q.sentAt = Date.now();
    delete q.wasSending;
    queueDb.save();
    this.ctx.broadcast('production', null);
    // Meldet der Drucker den Druck, ist der Start gelungen – egal, ob die Antwort auf das Hochladen schon da ist
    const begun = new Promise((resolve) => this.sendWait.set(printerId, () => resolve('begun')));
    let tmp = null;
    try {
      let filePath = await files.localPath(f); // vom NAS holen, falls nötig
      const tm = q.options?.toolMap;
      if (f.kind === 'gcode' && Array.isArray(tm) && tm.length && !toolmap.isIdentity(tm)) {
        // Filament-Zuordnung aus dem Startdialog: Werkzeuge im G-code umnummerieren
        tmp = await toolmap.remapFile(filePath, tm, path.join(DATA_DIR, 'tmp'));
        filePath = tmp.path;
        console.log(`[${cfg.name}] Werkzeuge umgestellt (${tm.map((v, i) => `T${i}→T${v}`).join(', ')}), ${tmp.changed} Zeilen`);
      }
      const upload = rt.driver.startPrint({ path: filePath, name: f.name, kind: f.kind, meta: f.meta, options: q.options || {} });
      upload.catch((err) => {
        if (q.status !== 'sending') console.log(`[${cfg.name}] Antwort auf das Hochladen kam nicht (${err.message}) – der Druck läuft trotzdem`);
      });
      const how = await Promise.race([upload.then(() => 'answered'), begun]);
      if (how === 'answered' && q.status === 'sending') {
        q.status = 'printing';
        q.startedAt = now();
        q.confirmed = false;
        delete q.tries;
        delete q.errorAt;
        this.setPlateClear(printerId, false);
        console.log(`[${cfg.name}] Druck gestartet: ${f.name}`);
      }
    } catch (err) {
      // Hat der Drucker inzwischen doch angefangen (oder ist schon fertig), zählt das
      if (q.status !== 'sending') return q;
      q.status = 'queued';
      q.error = err.message;
      q.errorAt = Date.now();
      q.tries = (q.tries || 0) + 1;
      console.warn(`[${cfg.name}] Start fehlgeschlagen (Versuch ${q.tries}): ${err.message}`);
      throw httpError(502, err.message);
    } finally {
      if (tmp) setTimeout(() => require('fs').promises.unlink(tmp.path).catch(() => {}), 20 * 60_000).unref(); // Upload kann noch laufen
      if (this.starting.get(printerId) === token) this.starting.delete(printerId);
      if (this.sendWait.has(printerId) && q.status !== 'sending') this.sendWait.delete(printerId);
      queueDb.save();
      this.ctx.broadcast('production', null);
    }
    return q;
  }

  /** Automatischer Start der Einträge mit „Seriendruck (automatisch)“ auf bereiten Druckern. */
  dispatch() {
    clearTimeout(this.dispatchTimer);
    this.dispatchTimer = setTimeout(() => this.runDispatch(), 300);
  }

  /**
   * Automatischer Start: nur Einträge mit Druckart „Seriendruck (automatisch)“, der Reihe nach, auf Druckern,
   * die bereit sind und deren Platte als frei bestätigt ist. Ohne festen Drucker bekommt ihn der freie Drucker,
   * zu dessen Profil die Datei geslict ist und in dem das Filament schon liegt – bei mehreren der mit den
   * ähnlichsten Farben.
   */
  runDispatch() {
    if (!require('./app').moduleOn('queue')) return;
    this.runAfterDry();
    this.humWait.clear();
    const free = new Set(this.ctx.printers().filter((p) => !this.notReady(p.id) && this.plateClear(p.id)).map((p) => p.id));
    if (!free.size) return;
    const items = queueDb.data
      .filter((q) => q.status === 'queued' && this.modeOf(q) === 'auto' && (!q.error || this.retryable(q)) && !q.afterDry)
      .sort((a, b) => this.rank(a) - this.rank(b));
    // vorgemerkte Auftragsteile zuerst an ihren Drucker
    items.sort((a, b) => Number(Boolean(b.autoNext)) - Number(Boolean(a.autoNext)));
    for (const q of items) {
      if (!free.size) break;
      let target = null;
      if (q.printerId) {
        if (free.has(q.printerId) && this.candidate(q, this.ctx.printers().find((p) => p.id === q.printerId), true)) target = q.printerId;
      } else {
        const best = [...free].map((id) => this.ctx.printers().find((p) => p.id === id)).map((p) => ({ p, c: this.candidate(q, p) })).filter((x) => x.c).sort((a, b) => a.c.score - b.c.score)[0];
        target = best?.p.id || null;
      }
      if (!target) continue;
      free.delete(target);
      this.start(q.id, target).catch(() => {
        /* Fehler steht am Eintrag */
      });
    }
  }

  /** „Erst trocknen, dann starten“: nach dem Trocknen auf dem gewählten Drucker starten */
  setAfterDry(id, afterDry) {
    const q = queueDb.data.find((x) => x.id === id);
    if (!q) throw httpError(404, 'Eintrag nicht gefunden');
    if (q.status !== 'queued') throw httpError(409, 'Eintrag wartet nicht');
    if (afterDry) {
      q.afterDry = afterDry;
      q.printerId = afterDry.printerId;
    } else delete q.afterDry;
    q.error = null;
    queueDb.save();
    this.ctx.broadcast('production', null);
    return q;
  }

  runAfterDry() {
    for (const q of queueDb.data.filter((x) => x.status === 'queued' && x.afterDry)) {
      const a = q.afterDry;
      if (this.ctx.dryActive?.(a.key)) continue;
      if (Date.now() - Date.parse(a.at) < 90_000) continue; // Gerät meldet den Start erst nach einer Weile
      if (this.ctx.dryDone && !this.ctx.dryDone(a)) {
        delete q.afterDry;
        q.error = 'Trocknen wurde nicht abgeschlossen – Druck bitte von Hand starten';
        queueDb.save();
        this.ctx.broadcast('production', null);
        continue;
      }
      if (this.notReady(a.printerId) || !this.plateClear(a.printerId)) continue;
      delete q.afterDry;
      queueDb.save();
      console.log(`Nach dem Trocknen: Druck wird gestartet (${files.get(q.fileId)?.name || q.fileId})`);
      this.start(q.id, a.printerId).catch(() => {
        /* Fehler steht am Eintrag */
      });
    }
  }

  /** Bereich des Eintrags (bzw. seines Auftrags) – null = jeder Drucker. Gelöschte Bereiche gelten nicht mehr. */
  areaOf(q) {
    const o = q?.orderId ? ordersDb.data.find((x) => x.id === q.orderId) : null;
    const a = q?.areaId || o?.areaId || null;
    return a && (require('./app').areas || []).some((x) => x.id === a) ? a : null;
  }

  /** Darf ein Eintrag ohne festen Drucker auf diesen Drucker? (Bereich passt) */
  inArea(q, p) {
    const a = this.areaOf(q);
    return !a || p?.settings?.area === a;
  }

  /** Kann dieser Drucker den Eintrag drucken? { score } oder null */
  candidate(q, p, assigned = false, { noRules = false } = {}) {
    if (!p) return null;
    if (!assigned && !this.inArea(q, p)) return null; // anderer Bereich
    const f = this.fileFor(q, p, { assigned });
    const rt = this.ctx.runtime.get(p.id);
    if (!f || (rt && rt.driver.canPrint(f))) return null;
    const fixed = Array.isArray(f.targets) && f.targets.length ? f.targets.includes(p.id) : null;
    const model = fixed ?? modelMatches(f, this.modelOf(p));
    if (model === false) return null; // für ein anderes Druckerprofil geslict
    if (!assigned && model !== true) return null; // nicht zugewiesen: nur bei sicher passendem Profil
    // Filament zu feucht → nicht automatisch starten (Grund für die Anzeige merken)
    const wet = this.ctx.humBlock ? this.ctx.humBlock(p, f, q.options || {}) : null;
    if (wet) {
      this.humWait.set(q.id, `${p.name}: ${wet}`);
      return null;
    }
    // Startzeitfenster / günstiger Strom (nur automatische Starts)
    const rule = !noRules && this.ctx.startRule ? this.ctx.startRule(p, f) : null;
    if (rule) {
      this.humWait.set(q.id, `${p.name}: ${rule}`);
      return null;
    }
    if (assigned) return { score: 0 };
    const fit = this.ctx.fit ? this.ctx.fit(p, f) : { ok: true, score: 0 };
    return fit.ok ? { score: fit.score } : null;
  }

  /** Datei, die auf diesem Drucker gedruckt würde: bei einem Teil die passende Variante, sonst die Datei des Eintrags */
  fileFor(q, p, { assigned = false } = {}) {
    if (q.partId && parts.get(q.partId)) return parts.variantFor(q.partId, p, this.modelOf(p), { loose: assigned });
    return files.get(q.fileId);
  }

  /** Druckermodell: beim Drucker eingetragen, sonst wie der Drucker es meldet */
  modelOf(p) {
    return p.settings?.model || this.ctx.runtime.get(p.id)?.driver.status?.model || null;
  }

  /** Warum wartet ein Eintrag ohne festen Drucker? (für die Anzeige) */
  waitReason(q) {
    if (q.partId && parts.get(q.partId)) {
      const part = parts.get(q.partId);
      const withVar = this.ctx.printers().filter((p) => this.inArea(q, p) && parts.variantFor(q.partId, p, this.modelOf(p)));
      if (!withVar.length) return `keine Variante von „${part.name}“ für einen Drucker${this.areaOf(q) ? ' im Bereich' : ''} – im Teil zuordnen`;
      const ok = withVar.filter((p) => !this.ctx.fit || this.ctx.fit(p, parts.variantFor(q.partId, p, this.modelOf(p))).ok);
      if (!ok.length) return `Filament fehlt (${this.ctx.fit(withVar[0], parts.variantFor(q.partId, withVar[0], this.modelOf(withVar[0]))).reason})`;
      return null;
    }
    const f = files.get(q.fileId);
    if (!f) return null;
    const printers = this.ctx.printers();
    const fitting = printers.filter((p) => modelMatches(f, this.modelOf(p)) === true && this.inArea(q, p));
    const area = this.areaOf(q);
    if (!fitting.length && area) return `kein passender Drucker im Bereich ${(require('./app').areas || []).find((x) => x.id === area)?.name || ''}`;
    if (!fitting.length) return f.meta?.printerModel ? `kein Drucker mit Profil ${f.meta.printerModel}` : 'Druckerprofil in der Datei unbekannt – bitte einen Drucker wählen';
    const withFil = fitting.filter((p) => !this.ctx.fit || this.ctx.fit(p, f).ok);
    if (!withFil.length) return `Filament fehlt (${this.ctx.fit(fitting[0], f).reason})`;
    return null;
  }

  /** Nächster passender Eintrag für einen Drucker. */
  nextFor(p, { autoOnly = false } = {}) {
    return queueDb.data
      .filter((q) => q.status === 'queued' && !q.error && (!autoOnly || this.modeOf(q) === 'auto'))
      .sort((a, b) => this.rank(a) - this.rank(b))
      .find((q) => (q.printerId ? q.printerId === p.id && this.candidate(q, p, true) : this.candidate(q, p)));
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

  /** Offene Einträge in Druckreihenfolge (laufende zuerst) – für die Filament-Reservierung */
  openItems() {
    return queueDb.data.filter((q) => OPEN_ITEM.has(q.status)).sort((a, b) => Number(a.status === 'queued') - Number(b.status === 'queued') || this.rank(a) - this.rank(b));
  }

  /** Laufender PrintDock-Eintrag auf diesem Drucker („überträgt“ oder „druckt“) */
  itemOnPrinter(printerId) {
    return queueDb.data.find((q) => q.printerId === printerId && (q.status === 'printing' || q.status === 'sending')) || null;
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
    // Mehrere Teile pro Platte: ein Druck liefert perPlate Stück. done/planned/qty in Stück, open/prints in Drucken.
    const positions = (o.positions || []).map((pos) => {
      const pp = Math.max(1, Number(pos.perPlate) || 1);
      const its = items.filter((q) => q.positionId === pos.id);
      const donePrints = its.filter((q) => q.status === 'done').length;
      const plannedPrints = its.filter((q) => OPEN_ITEM.has(q.status)).length;
      const running = its.filter((q) => q.status === 'printing' || q.status === 'sending').length;
      const failed = its.filter((q) => q.status === 'failed').length;
      const f = files.get(pos.fileId);
      const part = pos.partId ? parts.get(pos.partId) : null;
      const prints = Math.ceil(pos.qty / pp);
      return {
        ...pos,
        perPlate: pp,
        file: f ? { id: f.id, name: part ? part.name : f.name, kind: f.kind, thumb: !!f.thumb, printable: part ? parts.variants(part.id).some((x) => x.printable) : f.printable, meta: f.meta } : null,
        part: part ? { id: part.id, name: part.name, variants: parts.variants(part.id).length } : null,
        done: Math.min(pos.qty, donePrints * pp),
        planned: plannedPrints * pp,
        donePrints,
        plannedPrints,
        prints,
        running,
        failed,
        open: Math.max(0, prints - donePrints - plannedPrints),
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
    const restSec = positions.reduce((a, p) => a + Math.max(0, p.prints - p.donePrints) * (p.file?.meta?.estimatedSec || 0), 0);
    // Nachbearbeitung (optional): Stück je Schritt; wartend an Schritt i = Stück aus Schritt i-1 (bzw. fertig gedruckt) minus erledigte
    const steps = require('./app').post;
    let post = null;
    if (steps?.enabled && steps.steps.length) {
      let prev = done;
      post = steps.steps.map((name, i) => {
        const cnt = Math.min(prev, Number(o.post?.[i]) || 0);
        const row = { i, name, done: cnt, waiting: Math.max(0, prev - cnt) };
        prev = cnt;
        return row;
      });
    }
    if (post && status === 'fertig' && post[post.length - 1].done < qty) status = 'nachbearbeitung';
    const today = new Date().toISOString().slice(0, 10);
    return {
      ...o,
      positions,
      qty,
      done,
      status,
      restSec,
      prints: positions.reduce((a, p) => a + p.prints, 0),
      post,
      late: !o.closed && status !== 'fertig' && o.due && o.due < today,
    };
  }

  /** Nachbearbeitung: Stückzahl eines Schritts setzen (oder um delta ändern) */
  setPost(id, { step, count, delta }) {
    const o = ordersDb.data.find((x) => x.id === id);
    if (!o) throw httpError(404, 'Auftrag nicht gefunden');
    const v = this.orderView(o);
    const row = v.post?.[Number(step)];
    if (!row) throw httpError(400, 'Nachbearbeitung ist aus oder Schritt unbekannt');
    const max = row.done + row.waiting;
    const next = delta != null ? row.done + Number(delta) : Number(count);
    o.post = { ...(o.post || {}), [row.i]: Math.max(0, Math.min(max, Math.round(next) || 0)) };
    ordersDb.save();
    this.ctx.broadcast('production', null);
    return this.orderView(o);
  }

  /** Statuslink für Kunden ein- bzw. ausschalten (neuer Link = alter wird ungültig) */
  shareOrder(id, enabled = true) {
    const o = ordersDb.data.find((x) => x.id === id);
    if (!o) throw httpError(404, 'Auftrag nicht gefunden');
    if (o.shareToken) this.ctx.onShareRemoved?.(o.shareToken); // alten Link auch auf dem Status-Server löschen
    o.shareToken = enabled ? crypto.randomBytes(12).toString('hex') : null;
    ordersDb.save();
    this.ctx.broadcast('production', null);
    return this.orderView(o);
  }

  orderByShareToken(token) {
    if (!/^[a-f0-9]{24}$/.test(String(token || ''))) return null;
    return ordersDb.data.find((o) => o.shareToken === token) || null;
  }

  /** Auftrag ins Archiv (nur abgeschlossene oder fertige) bzw. zurückholen */
  archiveOrder(id, archived = true) {
    const o = ordersDb.data.find((x) => x.id === id);
    if (!o) throw httpError(404, 'Auftrag nicht gefunden');
    if (archived && !o.closed && this.orderView(o).status !== 'fertig') throw httpError(409, 'Nur fertige oder abgeschlossene Aufträge lassen sich archivieren');
    o.archived = Boolean(archived);
    if (o.archived) {
      o.closed = true;
      o.archivedAt = now();
    }
    ordersDb.save();
    this.ctx.broadcast('production', null);
    return this.orderView(o);
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
      let fileId = p.fileId;
      const part = p.partId ? parts.get(p.partId) : null;
      if (p.partId && !part) throw httpError(400, 'Eine Position verweist auf ein gelöschtes Teil');
      if (part) {
        const vs = parts.variants(part.id);
        if (!vs.length) throw httpError(400, `„${part.name}“ hat noch keine Datei`);
        if (!vs.some((x) => x.id === fileId)) fileId = (vs.find((x) => x.printable) || vs[0]).id;
      }
      if (!files.get(fileId)) throw httpError(400, 'Eine Position verweist auf eine gelöschte Datei');
      return {
        id: p.id && existing?.positions?.some((x) => x.id === p.id) ? p.id : uid(),
        fileId,
        ...(part ? { partId: part.id } : {}),
        qty: Math.max(1, Math.min(9999, Number(p.qty) || 1)),
        perPlate: Math.max(1, Math.min(500, Number(p.perPlate) || 1)),
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
      archived: existing?.archived || false,
      shareToken: existing?.shareToken || null,
      post: existing?.post || {},
      mode: existing?.mode || (MODES.includes(body.mode) ? body.mode : this.defaultMode()),
      areaId: body.areaId !== undefined ? (body.areaId ? String(body.areaId).slice(0, 40) : null) : existing?.areaId || null,
      positions,
      createdAt: existing?.createdAt || now(),
    };
    if (existing) Object.assign(existing, o);
    else ordersDb.data.push(o);
    if (existing && MODES.includes(body.mode)) this.setOrderMode(existing, body.mode);
    // Bereich geändert: wartende Drucke ohne festen Drucker ziehen mit
    if (existing && body.areaId !== undefined) for (const q of queueDb.data) if (q.orderId === o.id && q.status === 'queued' && !q.printerId) q.areaId = o.areaId || null;
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
    if (ordersDb.data[idx].shareToken) this.ctx.onShareRemoved?.(ordersDb.data[idx].shareToken);
    ordersDb.data.splice(idx, 1);
    queueDb.data = queueDb.data.filter((q) => !(q.orderId === id && q.status === 'queued'));
    ordersDb.save();
    queueDb.save();
    this.ctx.broadcast('production', null);
  }

  /**
   * Offene Drucke einer oder aller Positionen in die Warteschlange stellen.
   * Einzeldruck: immer nur einen Druck (das nächste einzelne Teil), und nur, wenn keiner mehr wartet.
   */
  planOrder(id, { positionId = null, printerId = null } = {}) {
    const o = ordersDb.data.find((x) => x.id === id);
    if (!o) throw httpError(404, 'Auftrag nicht gefunden');
    if (o.closed) throw httpError(409, 'Auftrag ist abgeschlossen');
    const view = this.orderView(o);
    const single = this.modeOf({ orderId: o.id }) === 'single';
    if (single && queueDb.data.some((q) => q.orderId === o.id && q.status === 'queued')) throw httpError(409, 'Einzeldruck: Ein Teil wartet schon in der Warteschlange – erst das drucken');
    let total = 0;
    for (const pos of view.positions) {
      if (positionId && pos.id !== positionId) continue;
      if (!pos.open) continue;
      if (!pos.file?.printable) throw httpError(400, `„${pos.file?.name || 'Datei'}“ ist nicht gesliced`);
      const n = single ? 1 : pos.open;
      this.addToQueue({ fileId: pos.fileId, partId: pos.partId || null, printerId, count: n, orderId: o.id, positionId: pos.id, areaId: printerId ? null : o.areaId || null });
      total += n;
      if (single) break;
    }
    if (!total) throw httpError(409, 'Alles bereits eingeplant');
    return { planned: total, mode: this.modeOf({ orderId: o.id }) };
  }

  /** Neu geslicte Version einer Datei für einen Auftrag übernehmen (Positionen und wartende Drucke) */
  useFile(orderId, fromId, toId) {
    const o = ordersDb.data.find((x) => x.id === orderId);
    if (!o) throw httpError(404, 'Auftrag nicht gefunden');
    if (!files.get(toId)) throw httpError(404, 'Datei nicht gefunden');
    let n = 0;
    for (const pos of o.positions || []) {
      if (pos.fileId !== fromId) continue;
      pos.fileId = toId;
      n += 1;
    }
    for (const q of queueDb.data) if (q.orderId === o.id && q.status === 'queued' && q.fileId === fromId) q.fileId = toId;
    ordersDb.save();
    queueDb.save();
    this.ctx.broadcast('production', null);
    return { changed: n, order: this.orderView(o) };
  }

  /** Aufträge, die noch eine ältere Version dieser Datei nutzen (offene Teile) */
  ordersUsingFile(fileId) {
    return ordersDb.data.filter((o) => !o.closed && !o.archived && (o.positions || []).some((p) => p.fileId === fileId) && this.orderView(o).positions.some((p) => p.fileId === fileId && (p.open > 0 || p.plannedPrints > 0)))
      .map((o) => ({ id: o.id, nr: o.nr, title: o.title }));
  }

  orderMode(id, mode) {
    const o = ordersDb.data.find((x) => x.id === id);
    if (!o) throw httpError(404, 'Auftrag nicht gefunden');
    if (!MODES.includes(mode)) throw httpError(400, 'Unbekannte Druckart');
    this.setOrderMode(o, mode);
    ordersDb.save();
    queueDb.save();
    this.ctx.broadcast('production', null);
    this.dispatch();
    return this.orderView(o);
  }

  /** Druckart eines Auftrags ändern – wartende Einträge des Auftrags ziehen mit */
  setOrderMode(o, mode) {
    if (!MODES.includes(mode) || o.mode === mode) return;
    o.mode = mode;
    for (const q of queueDb.data) {
      if (q.orderId === o.id && q.status === 'queued') {
        q.mode = mode;
        if (mode !== 'auto') delete q.autoNext;
      }
    }
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
      startInfo: this.startInfo || {},
      external: Object.fromEntries(this.ctx.printers().map((p) => [p.id, this.ctx.externalJob?.(p.id) || null]).filter((x) => x[1])),
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
  if (Array.isArray(o.toolMap)) out.toolMap = o.toolMap.slice(0, 16).map((v) => Math.max(0, Math.min(63, Math.round(Number(v) || 0))));
  if (Array.isArray(o.slotMap)) out.slotMap = o.slotMap.slice(0, 16).map((k) => String(k || '').replace(/[^\w-]/g, '').slice(0, 24));
  return out;
}

function pick(obj, ...keys) {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}

module.exports = { Production, modelMatches, MAINT_TEMPLATES, MODES, MODE_LABEL };
