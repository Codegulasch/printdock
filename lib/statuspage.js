// Statusseite für Kunden: ein Auftrag, ohne Anmeldung, über einen geheimen Link (/status/<token>).
// Zeigt Fortschritt, Termin, voraussichtliches Ende und Fotos der fertigen Teile – keine Kosten,
// keine Dateinamen-Details anderer Aufträge, keine Druckerdaten.
// Dieselben Daten gehen an den Status-Server (lib/relay.js), wenn einer eingerichtet ist.

const fs = require('fs');
const path = require('path');
const { renderOrder, gone } = require('./statusrender');

/** Daten für die Statusseite eines Auftrags (ohne Kosten) */
function statusData(ctx, o) {
  const v = ctx.production.orderView(o);
  const photos = ctx.history().filter((h) => h.orderId === o.id && h.photo && h.result === 'finished').slice(-12).reverse().map((h) => h.id);
  return {
    nr: o.nr, title: o.title, customer: o.customer || '', status: v.status, qty: v.qty, done: v.done, due: o.due || null,
    eta: v.status !== 'fertig' && !v.closed && v.restSec ? new Date(Date.now() + v.restSec * 1000).toISOString() : null,
    printing: v.positions.some((p) => p.running), post: (v.post || []).map((r) => ({ name: r.name, done: r.done })), photos,
    tz: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone, updatedAt: new Date().toISOString(),
  };
}

/**
 * @param ctx { production, history: () => [], lang, photoDir }
 */
function render(ctx, token) {
  const o = ctx.production.orderByShareToken(token);
  if (!o) return { status: 404, html: gone(ctx.lang) };
  return { status: 200, html: renderOrder(ctx.lang, { ...statusData(ctx, o), brand: ctx.brand || null }, { photoUrl: (id) => `/status/${token}/photo/${id}` }) };
}

function photo(ctx, token, id) {
  const o = ctx.production.orderByShareToken(token);
  if (!o) return null;
  const h = ctx.history().find((x) => x.id === id && x.orderId === o.id && x.photo);
  if (!h) return null;
  const f = path.join(ctx.photoDir, `${h.id}.jpg`);
  return fs.existsSync(f) ? f : null;
}

module.exports = { render, photo, statusData };
