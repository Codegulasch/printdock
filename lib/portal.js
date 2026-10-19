// Anbindung an ein Druckportal mit PrintDock-Schnittstelle (z. B. auf normalem PHP-Webhosting, siehe docs/portal-api.md):
//  - holt bestätigte Aufträge ab: Modelldateien in die Bibliothek, PrintDock-Auftrag mit Positionen, Statuslink
//  - meldet den Fortschritt zurück (im Druck → versendet → abgeschlossen)
//  - schickt jede Minute den Stand für „Werkstatt live“ (Spitznamen, keine Kunden- oder Auftragsdaten)
// Alle Verbindungen gehen von PrintDock nach draußen – das Heimnetz bleibt zu, kein Port wird geöffnet.

const { store } = require('./store');
const files = require('./files');
const parts = require('./parts');
const { meshFromBuffer } = require('./meshpreview');

const MASK = '••••••';
const COLORS = ['#3F5BD8', '#16A34A', '#D9531E', '#7C3AED', '#0E7490', '#BE185D'];
const RANK = { angefragt: 0, angebot: 1, bestaetigt: 2, im_druck: 3, versendet: 4, abgeschlossen: 5, storniert: 6 };
const httpError = (status, message) => Object.assign(new Error(message), { status });

const db = store('portal.json', {
  enabled: false,
  url: '',
  key: '',
  importWhen: 'bestaetigt', // bestaetigt | bezahlt
  pollMin: 5,
  useRelay: true, // Kunden-Links (relay) über das Portal
  werkstatt: { enabled: false, hinweis: '', ownNames: true, printers: {} },
  imported: {}, // Portal-Auftrag-ID → { pdId, number, at, status }
  autoImport: true, // bestätigte Aufträge automatisch übernehmen (sonst nur per Knopf)
  notifyNew: true, // Benachrichtigung bei neuer Anfrage
  seen: null, // bereits gemeldete Anfragen (Portal-IDs); null = noch nie abgefragt
});
const d = db.data;
d.werkstatt = { enabled: false, hinweis: '', ownNames: true, printers: {}, ...(d.werkstatt || {}) };
d.imported ??= {};
d.autoImport ??= true;
d.notifyNew ??= true;
if (!Array.isArray(d.seen)) d.seen = null;

class Portal {
  /** ctx: { production, printers: () => [], runtime: Map, relay, costs, notify: (entry) => void } */
  constructor(ctx) {
    this.ctx = ctx;
    this.state = { ok: null, error: null, at: null, name: null, admin: false, shop: null };
    this.inbox = { orders: [], at: null };
    this.meshCache = new Map(); // Positions-ID → Buffer (wenige, zuletzt benutzte)
    this.cfgCache = { at: 0, data: null }; // Preise des Portals für den Preisvorschlag
    this.last = { importAt: null, imported: 0, werkstattAt: null, werkstattError: null, errors: [] };
    this.busy = false;
    this.syncTimer = null;
    this.pollTimer = null;
    this.schedule();
    setInterval(() => this.pushWerkstatt().catch(() => {}), 60_000).unref();
    setTimeout(() => this.poll().catch(() => {}), 15_000).unref();
  }

  get on() {
    return Boolean(d.enabled && d.url && d.key);
  }

  base() {
    return d.url.replace(/\/+$/, '');
  }

  /** Spitzname, Farbe und Freigabe je Drucker (Vorgaben für noch nicht eingestellte Drucker) */
  printerSetting(p, i) {
    const s = d.werkstatt.printers[p.id] || {};
    return { show: s.show !== false, name: s.name || p.name, color: /^#[0-9a-fA-F]{6}$/.test(s.color || '') ? s.color : COLORS[i % COLORS.length] };
  }

  view() {
    const printers = this.ctx.printers().map((p, i) => { const x = this.printerSetting(p, i); return { id: p.id, printer: p.name, nick: x.name, color: x.color, show: x.show }; });
    return {
      enabled: d.enabled, url: d.url, key: d.key ? MASK : '', importWhen: d.importWhen, pollMin: d.pollMin, useRelay: d.useRelay,
      autoImport: d.autoImport, notifyNew: d.notifyNew, counts: this.counts(),
      werkstatt: { enabled: d.werkstatt.enabled, hinweis: d.werkstatt.hinweis, ownNames: d.werkstatt.ownNames, printers },
      imported: Object.keys(d.imported).length, state: this.state, last: this.last,
    };
  }

  async save(body = {}) {
    if (body.url !== undefined) {
      const u = String(body.url || '').trim().replace(/\/+$/, '');
      if (u && !/^https?:\/\/[^\s/]+/i.test(u)) throw httpError(400, 'Adresse bitte mit https:// angeben');
      d.url = u;
    }
    if (body.key !== undefined && body.key !== MASK) d.key = String(body.key || '').trim();
    if (body.importWhen !== undefined) d.importWhen = body.importWhen === 'bezahlt' ? 'bezahlt' : 'bestaetigt';
    if (body.pollMin !== undefined) d.pollMin = Math.max(1, Math.min(60, Number(body.pollMin) || 5));
    if (body.useRelay !== undefined) d.useRelay = Boolean(body.useRelay);
    if (body.autoImport !== undefined) d.autoImport = Boolean(body.autoImport);
    if (body.notifyNew !== undefined) d.notifyNew = Boolean(body.notifyNew);
    if (body.enabled !== undefined) d.enabled = Boolean(body.enabled);
    if (body.werkstatt) {
      const w = body.werkstatt;
      if (w.enabled !== undefined) d.werkstatt.enabled = Boolean(w.enabled);
      if (w.hinweis !== undefined) d.werkstatt.hinweis = String(w.hinweis || '').trim().slice(0, 200);
      if (w.ownNames !== undefined) d.werkstatt.ownNames = Boolean(w.ownNames);
      if (w.printers && typeof w.printers === 'object') {
        for (const [id, s] of Object.entries(w.printers)) {
          if (!this.ctx.printers().some((p) => p.id === id)) continue;
          d.werkstatt.printers[id] = {
            show: s.show !== false,
            name: String(s.name || '').trim().slice(0, 40),
            color: /^#[0-9a-fA-F]{6}$/.test(s.color || '') ? s.color : '',
          };
        }
      }
    }
    db.save();
    this.schedule();
    if (this.on) {
      await this.test();
      // Kunden-Links über das Portal: Status-Server auf dieselbe Adresse und denselben Schlüssel stellen
      if (d.useRelay && this.ctx.relay) await this.ctx.relay.save({ url: d.url, key: d.key, enabled: true }).catch((err) => console.warn(`Druckportal → Kunden-Links: ${err.message}`));
      this.poll().catch(() => {});
      this.pushWerkstatt().catch(() => {});
    }
    return this.view();
  }

  schedule() {
    clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this.poll().catch(() => {}), Math.max(1, d.pollMin) * 60_000);
    this.pollTimer.unref?.();
  }

  /** Aufruf der Portal-Schnittstelle (api/v1/?r=…) */
  async call(route, { method = 'GET', query = {}, json, binary = false, timeout = 30_000 } = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    const qs = new URLSearchParams({ r: route, ...query }).toString();
    try {
      const r = await fetch(`${this.base()}/api/v1/?${qs}`, {
        method,
        headers: { 'X-API-Key': d.key, Accept: 'application/json', ...(json ? { 'Content-Type': 'application/json' } : {}) },
        body: json ? JSON.stringify(json) : undefined,
        signal: ctrl.signal,
      });
      if (binary && r.ok) return Buffer.from(await r.arrayBuffer());
      const data = await r.json().catch(() => ({}));
      if (!r.ok || data.ok === false) throw httpError(502, r.status === 401 ? 'Druckportal: Schlüssel falsch' : `Druckportal: ${data.error || `HTTP ${r.status}`}`);
      return data;
    } catch (err) {
      if (err.status) throw err;
      throw httpError(502, err.name === 'AbortError' ? 'Druckportal antwortet nicht' : `Druckportal nicht erreichbar (${err.cause?.code || err.message})`);
    } finally {
      clearTimeout(t);
    }
  }

  async test() {
    try {
      const r = await this.call('ping', { timeout: 10_000 });
      this.state = { ok: true, error: null, at: new Date().toISOString(), name: r.app || null, admin: Boolean(r.admin), shop: r.shop || null, version: r.version || null };
    } catch (err) {
      this.state = { ok: false, error: err.message, at: new Date().toISOString(), name: null, admin: false, shop: null };
      throw err;
    }
    return this.state;
  }

  /** Nach Änderungen an Aufträgen: Status gebündelt zurückmelden */
  changed() {
    if (!this.on || !Object.keys(d.imported).length) return;
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => this.syncStatus().catch(() => {}), 8000);
  }

  async poll() {
    if (!this.on || this.busy) return this.view();
    this.busy = true;
    try {
      if (this.state.ok === null) await this.test().catch(() => {});
      await this.refreshInbox().catch((err) => console.warn(`Druckportal (Anfragen): ${err.message}`));
      if (d.autoImport) await this.importOrders();
      await this.syncStatus();
      this.state = { ...this.state, ok: true, error: null, at: new Date().toISOString() };
    } catch (err) {
      this.state = { ...this.state, ok: false, error: err.message, at: new Date().toISOString() };
      console.warn(`Druckportal: ${err.message}`);
    } finally {
      this.busy = false;
    }
    return this.view();
  }

  /** Bestätigte (bzw. bezahlte) Aufträge abholen und in PrintDock anlegen */
  async importOrders() {
    const r = await this.call('orders', { query: { status: 'bestaetigt', items: '1' } });
    const errors = [];
    let n = 0;
    for (const o of r.orders || []) {
      if (d.imported[o.id]) continue;
      if (d.importWhen === 'bezahlt' && !o.paid_at) continue;
      try {
        await this.importOne(o);
        n += 1;
      } catch (err) {
        errors.push(`${o.number}: ${err.message}`);
      }
    }
    this.last = { ...this.last, importAt: new Date().toISOString(), imported: this.last.imported + n, errors };
    if (errors.length) console.warn(`Druckportal: ${errors.join(' · ')}`);
  }

  async importOne(o) {
    const { production } = this.ctx;
    const positions = [];
    for (const it of o.items || []) {
      const buf = await this.call('file', { query: { item: String(it.id) }, binary: true, timeout: 120_000 });
      if (!Buffer.isBuffer(buf) || !buf.length) throw new Error(`Datei „${it.filename}“ nicht erhalten`);
      const f = await files.addFromBuffer(buf, it.filename, { source: 'portal', note: `Druckportal ${o.number}`, dedupe: true });
      const colors = Array.isArray(it.colors) ? it.colors.join(', ') : '';
      positions.push({ fileId: f.id, qty: it.qty || 1, perPlate: 1, note: [it.material, colors].filter(Boolean).join(' · ') });
    }
    if (!positions.length) throw new Error('Auftrag ohne Modelle');
    const c = o.customer || {};
    const notes = [
      `Aus dem Druckportal: ${o.number}`,
      [c.name, c.company, c.email, c.phone].filter(Boolean).join(' · '),
      o.note ? `Nachricht: ${o.note}` : '',
      o.offer?.note ? `Angebot: ${o.offer.note}` : '',
      o.status_url ? `Portal: ${o.status_url}` : '',
    ].filter(Boolean).join('\n');
    const view = production.saveOrder({ title: `Auftrag ${o.number}`, customer: c.name || '', notes, prio: 2, positions });
    const shared = production.shareOrder(view.id, true);
    // vormerken, bevor das Portal antwortet – so entsteht auch bei einem Netzfehler kein doppelter Auftrag
    d.imported[o.id] = { pdId: shared.id, pdNr: shared.nr || null, number: o.number, at: new Date().toISOString(), status: 'bestaetigt' };
    db.save();
    await this.call('link', { method: 'POST', json: { id: o.id, share_token: shared.shareToken, nr: shared.nr } });
  }

  /** Portal-Status aus dem PrintDock-Auftrag ableiten (nur vorwärts) */
  targetStatus(v) {
    if (!v) return null;
    if (v.closed || v.archived) return 'abgeschlossen';
    const ship = (v.post || []).find((r) => /versend|versand|ship/i.test(r.name));
    if (ship && v.qty && ship.done >= v.qty) return 'versendet';
    if (['läuft', 'nachbearbeitung', 'fertig'].includes(v.status) || v.done > 0) return 'im_druck';
    return null;
  }

  async syncStatus() {
    if (!this.on) return;
    const orders = this.ctx.production.orders();
    for (const [portalId, m] of Object.entries(d.imported)) {
      const v = orders.find((o) => o.id === m.pdId);
      const target = this.targetStatus(v);
      if (!target || (RANK[target] ?? 0) <= (RANK[m.status] ?? 0)) continue;
      await this.call('status', { method: 'POST', json: { id: Number(portalId), status: target, notify: true, public: true } });
      m.status = target;
      db.save();
    }
  }

  // ================================================================ Portal steuern (wie der Admin im Browser)

  needOn() {
    if (!this.on) throw httpError(409, 'Druckportal ist nicht verbunden (Einstellungen → Fernzugriff → Druckportal)');
  }

  /** Zähler für Menü-Badge und Übersicht */
  counts() {
    const o = this.inbox.orders;
    return {
      neu: o.filter((x) => x.status === 'angefragt').length,
      angebot: o.filter((x) => x.status === 'angebot').length,
      bereit: o.filter((x) => x.status === 'bestaetigt' && !x.pd).length,
      at: this.inbox.at,
    };
  }

  decorate(o) {
    const m = d.imported[o.id];
    const pdNr = m ? m.pdNr || this.ctx.production.orders().find((x) => x.id === m.pdId)?.nr || null : null;
    return { ...o, pd: m ? { id: m.pdId, number: pdNr, at: m.at } : null };
  }

  /** Alle Anfragen holen; neue Anfragen melden */
  async refreshInbox() {
    this.needOn();
    const r = await this.call('orders', { query: { items: '1' } });
    this.inbox = { orders: (r.orders || []).map((o) => this.decorate(o)), at: new Date().toISOString() };
    const neu = this.inbox.orders.filter((o) => o.status === 'angefragt');
    if (!Array.isArray(d.seen)) {
      d.seen = neu.map((o) => o.id); // beim ersten Mal nichts melden, was schon da war
      db.save();
    } else {
      const fresh = neu.filter((o) => !d.seen.includes(o.id));
      if (fresh.length) {
        d.seen = [...new Set([...d.seen, ...fresh.map((o) => o.id)])].slice(-1000);
        db.save();
        if (d.notifyNew) this.ctx.notify?.(fresh);
      }
    }
    this.ctx.changed?.();
    return this.inbox;
  }

  async list(refresh = false) {
    this.needOn();
    if (refresh || !this.inbox.at || Date.now() - Date.parse(this.inbox.at) > 60_000) await this.refreshInbox();
    return { orders: this.inbox.orders, at: this.inbox.at, counts: this.counts(), shop: this.state.shop, admin: this.state.admin };
  }

  async order(id) {
    this.needOn();
    const r = await this.call('order', { query: { id: String(id) } });
    const o = this.decorate(r.order);
    const cfg = await this.portalPricing().catch(() => null);
    return { ...o, price: this.priceSuggestion(o, cfg) };
  }

  /** Preisregeln des Portals (Grundgebühr, Mindestwert, Farbaufschlag), 5 Minuten zwischengespeichert */
  async portalPricing() {
    if (this.cfgCache.data && Date.now() - this.cfgCache.at < 300_000) return this.cfgCache.data;
    const r = await this.call('config');
    this.cfgCache = { at: Date.now(), data: r.config || null };
    return this.cfgCache.data;
  }

  /** Preisvorschlag: Gewicht und Druckzeit des Portals × Kostensätze von PrintDock, dazu Grundgebühr,
      Farbaufschlag und Mindestauftragswert aus den Preisregeln des Portals */
  priceSuggestion(o, pc = null) {
    const c = this.ctx.costs;
    if (!c || !Array.isArray(o.items) || !o.items.length) return null;
    const cfg = c.c || {};
    const printers = this.ctx.printers();
    const watts = printers.length ? printers.reduce((a, p) => a + c.wattsFor(p.id), 0) / printers.length : Number(cfg.watts) || 0;
    let material = 0, energy = 0, machine = 0, grams = 0, hours = 0;
    const lines = o.items.map((it) => {
      const q = Math.max(1, Number(it.qty) || 1);
      const g = (Number(it.weight_g) || 0) * q;
      const h = (Number(it.hours) || 0) * q;
      const ppg = c.pricePerGram(it.material);
      const m = g * ppg;
      const e = ((watts * h) / 1000) * (Number(cfg.kwhPrice) || 0);
      const x = h * (Number(cfg.machineRate) || 0);
      material += m; energy += e; machine += x; grams += g; hours += h;
      return { id: it.id, filename: it.filename, qty: q, grams: Math.round(g), hours: Math.round(h * 100) / 100, ppg: Math.round(ppg * 1000) / 1000, cost: Math.round((m + e + x) * 100) / 100 };
    });
    const f = c.finish(material, energy, machine);
    const shipping = o.offer?.shipping ?? o.estimate?.shipping ?? 0;
    const baseFee = Number(pc?.base_fee) || 0;
    const colorFee = o.items.reduce((a, it) => a + Math.max(0, (it.colors || []).length - 1) * Math.max(1, Number(it.qty) || 1), 0) * (Number(pc?.color_surcharge) || 0);
    const minPrice = Number(pc?.min_price) || 0;
    const sum = f.total + baseFee + colorFee;
    const r2 = (n) => Math.round(n * 100) / 100;
    return {
      ...f, lines, grams: Math.round(grams), hours: Math.round(hours * 10) / 10, watts: Math.round(watts),
      baseFee: r2(baseFee), colorFee: r2(colorFee), minPrice: r2(minPrice), minApplied: sum < minPrice,
      price: Math.ceil(Math.max(sum, minPrice) * 10) / 10, shipping, portal: o.estimate ? { min: o.estimate.min, max: o.estimate.max } : null,
      rates: { kgPrice: Number(cfg.kgPrice) || 0, kwhPrice: Number(cfg.kwhPrice) || 0, machineRate: Number(cfg.machineRate) || 0, markup: Number(cfg.markup) || 0 },
    };
  }

  async orderUpdate(id, body = {}) {
    this.needOn();
    const allowed = ['offer_price', 'offer_shipping', 'offer_note', 'status', 'message', 'notify', 'tracking', 'admin_note'];
    const json = { id: Number(id) };
    for (const k of allowed) if (body[k] !== undefined) json[k] = body[k];
    const r = await this.call('order_update', { method: 'POST', json });
    await this.refreshInbox().catch(() => {});
    return { message: r.message, order: await this.order(id) };
  }

  async orderPaid(id, paid) {
    this.needOn();
    const r = await this.call('order_paid', { method: 'POST', json: { id: Number(id), paid: paid === undefined ? undefined : Boolean(paid) } });
    await this.refreshInbox().catch(() => {});
    return { message: r.message, order: await this.order(id) };
  }

  async orderDelete(id) {
    this.needOn();
    const r = await this.call('order_delete', { method: 'POST', json: { id: Number(id) } });
    for (const k of [String(id), Number(id)]) delete d.imported[k];
    db.save();
    await this.refreshInbox().catch(() => {});
    return { message: r.message };
  }

  /** Auftrag sofort in PrintDock übernehmen (unabhängig vom automatischen Abholen) */
  async takeOver(id) {
    this.needOn();
    if (d.imported[id]) throw httpError(409, `Schon übernommen als ${this.decorate({ id }).pd?.number || 'PrintDock-Auftrag'}`);
    const r = await this.call('order', { query: { id: String(id) } });
    await this.importOne(r.order);
    await this.refreshInbox().catch(() => {});
    return this.order(id);
  }

  async config() {
    this.needOn();
    return this.call('config');
  }

  async saveConfig(body = {}) {
    this.needOn();
    const r = await this.call('config', { method: 'POST', json: body });
    if (this.state.ok) this.state.shop = r.config?.shop_name || this.state.shop;
    return r;
  }

  async materialSave(body = {}) {
    this.needOn();
    return this.call('material', { method: 'POST', json: body });
  }

  async materialDelete(id) {
    this.needOn();
    return this.call('material_delete', { method: 'POST', json: { id: Number(id) } });
  }

  async testmail() {
    this.needOn();
    return this.call('testmail', { method: 'POST' });
  }

  async wartung() {
    this.needOn();
    return this.call('wartung');
  }

  async setWartung(ziel, an, text) {
    this.needOn();
    if (!/^[a-z0-9_-]{1,40}$/.test(String(ziel))) throw httpError(400, 'Unbekanntes Ziel');
    await this.call('wartung', { method: 'POST', query: { ziel }, json: { an: Boolean(an), ...(text !== undefined ? { text: String(text) } : {}) } });
    return this.wartung();
  }

  findItem(itemId) {
    for (const o of this.inbox.orders) for (const it of o.items || []) if (String(it.id) === String(itemId)) return it;
    return null;
  }

  /** Modelldatei einer Position (zum Herunterladen) */
  async file(itemId, name = '') {
    this.needOn();
    const buf = await this.call('file', { query: { item: String(itemId) }, binary: true, timeout: 120_000 });
    if (!Buffer.isBuffer(buf) || !buf.length) throw httpError(404, 'Datei nicht gefunden');
    return { buf, name: this.findItem(itemId)?.filename || name || `modell-${itemId}.stl` };
  }

  /** Dreiecke für die 3D-Vorschau (zwischengespeichert) */
  async mesh(itemId, name = '') {
    const key = String(itemId);
    if (this.meshCache.has(key)) return this.meshCache.get(key);
    const f = await this.file(itemId, name);
    let mesh;
    try {
      mesh = meshFromBuffer(f.buf, f.name);
    } catch (err) {
      throw httpError(err.status || 422, `Vorschau nicht möglich: ${err.message}`);
    }
    this.meshCache.set(key, mesh);
    while (this.meshCache.size > 12) this.meshCache.delete(this.meshCache.keys().next().value);
    return mesh;
  }

  /** Stand der Drucker für „Werkstatt live“ – ohne Kunden- und Auftragsdaten */
  werkstattData() {
    const { production, runtime } = this.ctx;
    const orders = new Map(production.orders().map((o) => [o.id, o]));
    const drucker = [];
    this.ctx.printers().forEach((p, i) => {
      const s = this.printerSetting(p, i);
      if (!s.show) return;
      const st = runtime.get(p.id)?.driver?.status || {};
      const state = st.state || 'offline';
      const status = ['printing', 'preparing'].includes(state) ? 'druckt' : state === 'paused' ? 'pause' : state === 'error' ? 'wartung' : state === 'offline' ? 'aus' : 'frei';
      let was = '';
      if (status === 'druckt' || status === 'pause') {
        const q = production.itemOnPrinter?.(p.id);
        const order = q?.orderId ? orders.get(q.orderId) : null;
        if (order && (order.customer || /Druckportal/.test(order.notes || ''))) was = 'Kundenauftrag';
        else if (d.werkstatt.ownNames) {
          const part = q?.partId ? parts.get(q.partId) : null;
          const name = part?.name || (q?.fileId ? files.get(q.fileId)?.name : null) || st.file || '';
          was = files.stem ? files.stem(String(name)) : String(name).replace(/\.(gcode|3mf|stl|bgcode)$/i, '');
          was = was.replace(/[_-]+/g, ' ').trim();
        }
        if (!was) was = 'Eigenes Teil';
      }
      const slot = (st.filament || []).find((f) => f.key === st.activeSlot);
      drucker.push({
        name: s.name, farbe: s.color, status, was,
        material: status === 'druckt' || status === 'pause' ? String(slot?.material || '').slice(0, 16) : '',
        fortschritt: status === 'druckt' || status === 'pause' ? Math.round(Number(st.progress) || 0) : 0,
        fertig_um: status === 'druckt' && st.remainingSec ? new Date(Date.now() + st.remainingSec * 1000).toISOString() : '',
      });
    });
    return { hinweis: d.werkstatt.hinweis, drucker };
  }

  async pushWerkstatt() {
    if (!this.on || !d.werkstatt.enabled) return null;
    try {
      const r = await this.call('werkstatt', { method: 'POST', json: this.werkstattData(), timeout: 15_000 });
      this.last = { ...this.last, werkstattAt: new Date().toISOString(), werkstattError: null };
      return r;
    } catch (err) {
      this.last = { ...this.last, werkstattError: err.message };
      throw err;
    }
  }
}

module.exports = { Portal };
