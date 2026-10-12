// Einkauf: Bezugsquellen je Material/Farbe und Bestellungen.
//   Einkaufsliste (lib/reserve.js) → „Bestellt“ → unterwegs (zählt gegen die Fehlmenge) → „Eingetroffen“ legt die Spulen an.

const crypto = require('crypto');
const colors = require('./colors');

const keyOf = (material, color) => `${String(material || '?').toUpperCase()}|${colors.normalize(color) || ''}`;
const httpError = (status, message) => Object.assign(new Error(message), { status });
const str = (v, n) => String(v ?? '').trim().slice(0, n);

class Shop {
  /** ctx: { db (Filament-Ablage), filament, broadcast } */
  constructor(ctx) {
    this.ctx = ctx;
    const d = ctx.db.data;
    d.shopSources ??= {}; // key -> { url, supplier, price, brand, netWeight }
    d.shopOrders ??= []; // { id, key, material, color, colorName, brand, qty, netWeight, price, url, supplier, at, status, arrivedAt }
  }

  get d() {
    return this.ctx.db.data;
  }

  save() {
    this.ctx.db.save();
    this.ctx.broadcast('filament', null);
  }

  view() {
    return { sources: this.d.shopSources, orders: this.d.shopOrders.filter((o) => o.status === 'ordered' || Date.now() - Date.parse(o.arrivedAt || o.at) < 30 * 864e5) };
  }

  /** Unterwegs (bestellt, noch nicht da) je Schlüssel in Gramm */
  incoming() {
    const out = {};
    for (const o of this.d.shopOrders) if (o.status === 'ordered') out[o.key] = (out[o.key] || 0) + o.qty * o.netWeight;
    return out;
  }

  saveSource(body = {}) {
    const key = keyOf(body.material, body.color);
    if (!body.url && !body.supplier) {
      delete this.d.shopSources[key];
    } else {
      const url = str(body.url, 500);
      if (url && !/^https?:\/\//i.test(url)) throw httpError(400, 'Link muss mit http:// oder https:// beginnen');
      this.d.shopSources[key] = { url, supplier: str(body.supplier, 60), price: Number(body.price) || null, brand: str(body.brand, 60), netWeight: Number(body.netWeight) || 1000 };
    }
    this.save();
    return this.view();
  }

  order(body = {}) {
    const qty = Math.max(1, Math.min(100, Math.round(Number(body.qty) || 1)));
    const color = colors.normalize(body.color) || '#888888';
    const src = this.d.shopSources[keyOf(body.material, color)] || {};
    const o = {
      id: crypto.randomUUID(), key: keyOf(body.material, color), material: str(body.material, 30) || 'PLA', color, colorName: str(body.colorName, 40) || colors.nameOf(color),
      brand: str(body.brand ?? src.brand, 60), qty, netWeight: Number(body.netWeight) || src.netWeight || 1000, price: Number(body.price) || src.price || null,
      url: str(body.url ?? src.url, 500), supplier: str(body.supplier ?? src.supplier, 60), at: new Date().toISOString(), status: 'ordered',
    };
    this.d.shopOrders.push(o);
    // Bezugsquelle gleich merken
    if (o.url || o.supplier) this.d.shopSources[o.key] = { url: o.url, supplier: o.supplier, price: o.price, brand: o.brand, netWeight: o.netWeight };
    this.save();
    return o;
  }

  /** Lieferung ist da → Spulen anlegen */
  arrived(id) {
    const o = this.d.shopOrders.find((x) => x.id === id);
    if (!o) throw httpError(404, 'Bestellung nicht gefunden');
    if (o.status !== 'ordered') throw httpError(409, 'Schon eingetroffen');
    const spools = this.ctx.filament.saveSpool({
      material: o.material, brand: o.brand, color: o.color, colorName: o.colorName, netWeight: o.netWeight, remaining: o.netWeight, price: o.price, count: o.qty, location: 'Lager',
    });
    o.status = 'arrived';
    o.arrivedAt = new Date().toISOString();
    o.spools = (Array.isArray(spools) ? spools : [spools]).map((s) => s.nr);
    this.save();
    return o;
  }

  remove(id) {
    this.d.shopOrders = this.d.shopOrders.filter((x) => x.id !== id);
    this.save();
  }
}

module.exports = { Shop, keyOf };
