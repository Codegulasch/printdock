// Anbindung an den PrintDock Status-Server (relay/): freigegebene Aufträge werden dorthin veröffentlicht,
// der Kunden-Link zeigt dann auf https://<Server>/s/<code> – das Heimnetz bleibt zu.
// Gesendet wird nur, was die Statusseite zeigt (ohne Kosten) plus die Fotos der fertigen Teile.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { store } = require('./store');
const { statusData } = require('./statuspage');

const db = store('relay.json', { enabled: false, url: '', key: '', keepDays: 30, brand: { name: '', url: '' }, sent: {} });
db.data.sent ??= {}; // shareToken -> Hash der zuletzt gesendeten Daten
db.data.brand ??= { name: '', url: '' };
const MASK = '••••••';
const httpError = (status, message) => Object.assign(new Error(message), { status });

class Relay {
  /** ctx: { production, history(), photoDir, lang() } */
  constructor(ctx) {
    this.ctx = ctx;
    this.timer = null;
    this.state = { ok: null, error: null, at: null, name: null };
    setInterval(() => this.syncAll().catch(() => {}), 10 * 60_000).unref(); // voraussichtliches Ende aktuell halten
  }

  get on() {
    return Boolean(db.data.enabled && db.data.url && db.data.key);
  }

  view() {
    return { enabled: db.data.enabled, url: db.data.url, key: db.data.key ? MASK : '', keepDays: db.data.keepDays, brand: db.data.brand, state: this.state };
  }

  /** Basis-Adresse für Kunden-Links (null = lokal über PrintDock) */
  linkBase() {
    return this.on ? db.data.url.replace(/\/+$/, '') : null;
  }

  linkFor(token) {
    return this.on ? `${this.linkBase()}/s/${token}` : null;
  }

  async save(body = {}) {
    if (body.url !== undefined) {
      const u = String(body.url || '').trim().replace(/\/+$/, '');
      if (u && !/^https?:\/\/[^\s/]+/i.test(u)) throw httpError(400, 'Adresse bitte mit https:// angeben');
      db.data.url = u;
    }
    if (body.key !== undefined && body.key !== MASK) db.data.key = String(body.key || '').trim();
    if (body.keepDays !== undefined) db.data.keepDays = Math.max(1, Math.min(365, Number(body.keepDays) || 30));
    if (body.brand) db.data.brand = { name: String(body.brand.name || '').trim().slice(0, 80), url: /^https?:\/\//.test(body.brand.url || '') ? String(body.brand.url).slice(0, 200) : '' };
    if (body.enabled !== undefined) db.data.enabled = Boolean(body.enabled);
    db.data.sent = {}; // alles neu senden
    db.save();
    if (this.on) {
      await this.test();
      this.syncAll().catch(() => {});
    }
    return this.view();
  }

  async call(method, p, { json, raw, timeout = 20_000 } = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      // PUT/DELETE als POST mit Kopfzeile – manche Webhoster lassen nur GET/POST durch (PHP-Version des Status-Servers)
      const tunnel = method === 'PUT' || method === 'DELETE';
      const r = await fetch(`${db.data.url.replace(/\/+$/, '')}${p}`, {
        method: tunnel ? 'POST' : method,
        headers: {
          Authorization: `Bearer ${db.data.key}`, 'X-Relay-Key': db.data.key, ...(tunnel ? { 'X-HTTP-Method-Override': method } : {}),
          ...(json ? { 'Content-Type': 'application/json' } : raw ? { 'Content-Type': 'image/jpeg' } : {}),
        },
        body: json ? JSON.stringify(json) : raw || undefined,
        signal: ctrl.signal,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw httpError(502, r.status === 401 ? 'Status-Server: Schlüssel falsch' : `Status-Server: ${data.error || `HTTP ${r.status}`}`);
      return data;
    } catch (err) {
      if (err.status) throw err;
      throw httpError(502, err.name === 'AbortError' ? 'Status-Server antwortet nicht' : `Status-Server nicht erreichbar (${err.cause?.code || err.message})`);
    } finally {
      clearTimeout(t);
    }
  }

  async test() {
    try {
      const r = await this.call('GET', '/api/v1/ping', { timeout: 10_000 });
      this.state = { ok: true, error: null, at: new Date().toISOString(), name: r.name || null };
    } catch (err) {
      this.state = { ok: false, error: err.message, at: new Date().toISOString(), name: null };
      throw err;
    }
    return this.state;
  }

  /** Nach Änderungen (Auftrag, Verlauf) – gebündelt nach ein paar Sekunden */
  changed() {
    if (!this.on) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.syncAll().catch(() => {}), 5000);
  }

  async syncAll() {
    if (!this.on) return;
    const orders = this.ctx.production.orders().filter((o) => o.shareToken);
    for (const o of orders) {
      try {
        await this.publish(o);
      } catch (err) {
        this.state = { ...this.state, ok: false, error: err.message, at: new Date().toISOString() };
        console.warn(`Status-Server: ${err.message}`);
        return;
      }
    }
    if (orders.length) this.state = { ...this.state, ok: true, error: null, at: new Date().toISOString() };
  }

  async publish(o) {
    const data = statusData({ production: this.ctx.production, history: this.ctx.history }, o);
    const done = o.status === 'fertig' || o.closed;
    const expiresAt = done ? new Date(Date.now() + db.data.keepDays * 864e5).toISOString() : null;
    // nur senden, wenn sich etwas geändert hat (ETA auf 10 Minuten gerundet)
    const sig = crypto.createHash('sha1').update(JSON.stringify({ ...data, updatedAt: null, eta: data.eta ? Math.round(Date.parse(data.eta) / 600_000) : null, brand: db.data.brand, done })).digest('hex');
    if (db.data.sent[o.shareToken] === sig) return;
    const r = await this.call('PUT', `/api/v1/orders/${o.shareToken}`, { json: { lang: this.ctx.lang(), data, brand: db.data.brand.name ? db.data.brand : null, expiresAt } });
    for (const id of r.missing || []) {
      const f = this.ctx.photoFile ? await this.ctx.photoFile(`${id}.jpg`) : this.ctx.photoPath ? this.ctx.photoPath(`${id}.jpg`) : path.join(this.ctx.photoDir, `${id}.jpg`);
      if (f && fs.existsSync(f)) await this.call('PUT', `/api/v1/orders/${o.shareToken}/photos/${id}`, { raw: fs.readFileSync(f), timeout: 60_000 });
    }
    db.data.sent[o.shareToken] = sig;
    db.save();
  }

  /** Link abgeschaltet oder Auftrag gelöscht → Seite auf dem Server löschen */
  async remove(token) {
    if (!token) return;
    delete db.data.sent[token];
    db.save();
    if (!this.on) return;
    await this.call('DELETE', `/api/v1/orders/${token}`).catch((err) => console.warn(`Status-Server: ${err.message}`));
  }
}

module.exports = { Relay };
