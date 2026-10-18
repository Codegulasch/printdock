// Filament-Reservierung: Jeder offene Druck in der Warteschlange „belegt“ die Gramm aus seiner Datei
// auf der Spule, aus der er drucken wird. Daraus ergeben sich
//   - je Spule: reserviert / frei,
//   - je Warteschlangen-Eintrag: reicht das Filament? (mit Vorschlag einer anderen Spule),
//   - eine Einkaufsliste: was für alle offenen Drucke und Aufträge im Lager fehlt.
// Wird bei Bedarf berechnet (nichts gespeichert) – so bleibt es immer zum aktuellen Stand passend.

const files = require('./files');
const colors = require('./colors');
const { sameMaterial, COLOR_MATCH } = require('./filament');
const { modelMatches } = require('./production');

const r0 = (n) => Math.round(n);

/** Filamente einer Datei aus den Metadaten: [{ type, color, grams }] */
function fileFilaments(f) {
  const m = f?.meta || {};
  const gs = m.filamentGs || (m.filamentG != null ? [m.filamentG] : []);
  let mats = (m.materials || []).map((x, i) => ({ type: x.type || null, color: colors.normalize(x.color) || null, grams: Number(x.grams ?? gs[i]) || 0 }));
  if (!mats.length) mats = gs.map((g) => ({ type: null, color: null, grams: Number(g) || 0 }));
  return mats.filter((x) => x.grams > 0);
}

const colorOk = (a, b) => !a || !b || colors.distance(a, b) <= COLOR_MATCH;
const matOk = (want, have) => !want || !have || sameMaterial(want, have);

class Reserve {
  /** ctx: { printers(), runtime, filament, production } */
  constructor(ctx) {
    this.ctx = ctx;
  }

  /** Wo liegt die Spule? (für Vorschläge) */
  where(sp) {
    if (sp.slot) return this.ctx.printers().find((p) => p.id === sp.slot.printerId)?.name || '';
    return sp.location || 'Lager';
  }

  compute() {
    const { filament, production } = this.ctx;
    const printers = this.ctx.printers();
    const spools = filament.spoolRecords().filter((s) => !s.archived);
    const free = new Map(spools.map((s) => [s.id, Number(s.remaining) || 0]));
    const reserved = new Map(); // spoolId -> [{ queueId, file, grams }]
    const items = {}; // queueId -> { printerId, uses: [], short: [] }
    const demand = []; // Bedarf ohne feste Spule (Lager): { type, color, grams, queueId?, orderId? }

    const alt = (want, grams, notId) => {
      const sp = spools
        .filter((s) => s.id !== notId && matOk(want.type, s.material) && colorOk(want.color, s.color) && free.get(s.id) >= grams)
        .sort((a, b) => Number(Boolean(a.slot)) - Number(Boolean(b.slot)) || free.get(a.id) - free.get(b.id))[0];
      return sp ? { nr: sp.nr, where: this.where(sp), free: r0(free.get(sp.id)) } : null;
    };

    const orders = production.orders();
    const orderNr = Object.fromEntries(orders.map((o) => [o.id, o.nr]));
    for (const q of production.openItems()) {
      const f = files.get(q.fileId);
      if (!f) continue;
      let p = q.printerId ? printers.find((x) => x.id === q.printerId) : null;
      if (!p) {
        // ohne festen Drucker: der passende, in dem das Filament schon liegt
        p = printers
          .filter((x) => modelMatches(f, production.modelOf(x)) !== false)
          .map((x) => ({ x, fit: filament.fitFor(x, f) }))
          .filter((c) => c.fit.ok)
          .sort((a, b) => a.fit.score - b.fit.score)[0]?.x || null;
      }
      const st = p ? this.ctx.runtime.get(p.id)?.driver.status : null;
      // laufender Druck: nur noch der Rest
      const factor = q.status === 'printing' && st?.progress != null ? Math.max(0, 1 - st.progress / 100) : 1;
      const map = p ? filament.mappingFor(p, f, q.options || {}) : null;
      const mats = map?.filaments?.length ? map.filaments.map((m) => ({ ...m, grams: Number(m.grams) || 0 })) : fileFilaments(f);
      const it = (items[q.id] = { printerId: p?.id || null, uses: [], short: [] });
      mats.forEach((m, i) => {
        const g = m.grams * factor;
        if (!(g > 0)) return;
        const key = map?.suggested?.[i];
        const sp = key ? filament.spoolAt(p.id, key) : null;
        if (sp && matOk(m.type, sp.material)) {
          const before = free.get(sp.id);
          free.set(sp.id, before - g);
          (reserved.get(sp.id) || reserved.set(sp.id, []).get(sp.id)).push({ queueId: q.id, file: f.name, grams: Math.round(g * 10) / 10 });
          it.uses.push({ spoolId: sp.id, nr: sp.nr, grams: r0(g) });
          if (before < g) {
            it.short.push({ material: m.type || sp.material, color: m.color || sp.color, need: r0(g), free: r0(Math.max(0, before)), nr: sp.nr, alt: alt(m, g, sp.id) });
            // was der Spule fehlt, muss aus dem Lager kommen (sonst Einkaufsliste)
            demand.push({ type: m.type || sp.material, color: m.color || sp.color, grams: g - Math.max(0, before), queueId: q.id, orderNr: orderNr[q.orderId] || null, swap: true });
          }
        } else {
          demand.push({ type: m.type, color: m.color, grams: g, queueId: q.id });
        }
      });
    }

    // Aufträge: noch nicht eingeplante Stücke
    for (const o of orders) {
      if (o.closed || o.archived) continue;
      for (const pos of o.positions) {
        if (!pos.open) continue;
        for (const m of fileFilaments(files.get(pos.fileId))) demand.push({ type: m.type, color: m.color, grams: m.grams * pos.open, orderId: o.id, orderNr: o.nr });
      }
    }

    // Bedarf ohne feste Spule aus dem Bestand decken (zuerst Lager, dann Spulen in Druckern)
    const shop = {};
    for (const d of demand) {
      const k = `${String(d.type || '?').toUpperCase()}|${d.color || ''}`;
      let need = d.grams;
      const cands = spools.filter((s) => matOk(d.type, s.material) && colorOk(d.color, s.color) && free.get(s.id) > 0).sort((a, b) => Number(Boolean(a.slot)) - Number(Boolean(b.slot)));
      for (const sp of cands) {
        if (need <= 0) break;
        const take = Math.min(need, free.get(sp.id));
        free.set(sp.id, free.get(sp.id) - take);
        need -= take;
      }
      if (need > 0.5) {
        const row = (shop[k] ||= { material: d.type || null, color: d.color || null, missing: 0, need: 0, orders: new Set(), queue: 0 });
        row.missing += need;
        if (d.orderNr) row.orders.add(d.orderNr);
        if (d.queueId) {
          row.queue += 1;
          if (!d.swap) items[d.queueId]?.short.push({ material: d.type, color: d.color, need: r0(d.grams), free: r0(d.grams - need), nr: null, alt: null });
        }
      }
      if (shop[k]) shop[k].need += d.grams;
    }

    const spoolOut = {};
    for (const sp of spools) {
      const list = reserved.get(sp.id) || [];
      const res = list.reduce((a, x) => a + x.grams, 0);
      if (res) spoolOut[sp.id] = { reserved: r0(res), free: r0((Number(sp.remaining) || 0) - res), jobs: list.length };
    }
    // bestellte, noch nicht eingetroffene Spulen zählen gegen die Fehlmenge
    const incoming = this.ctx.shop?.incoming() || {};
    const sources = this.ctx.shop?.view().sources || {};
    const shopping = Object.entries(shop)
      .map(([k, r]) => {
        const ordered = r0(incoming[k] || 0);
        const missing = Math.max(0, r0(r.missing - ordered));
        return { key: k, material: r.material, color: r.color, colorName: r.color ? colors.nameOf(r.color) || null : null, need: r0(r.need), missing, ordered, spools: missing ? Math.max(1, Math.ceil(missing / 1000)) : 0, orders: [...r.orders], queue: r.queue, source: sources[k] || null };
      })
      .sort((a, b) => b.missing - a.missing);
    return { spools: spoolOut, items, shopping };
  }
}

module.exports = { Reserve, fileFilaments };
