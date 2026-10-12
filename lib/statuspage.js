// Statusseite für Kunden: ein Auftrag, ohne Anmeldung, über einen geheimen Link (/status/<token>).
// Zeigt Fortschritt, Termin, voraussichtliches Ende und Fotos der fertigen Teile – keine Kosten,
// keine Dateinamen-Details anderer Aufträge, keine Druckerdaten.

const fs = require('fs');
const path = require('path');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TXT = {
  de: { title: 'Auftrag', status: { offen: 'Angenommen', geplant: 'Eingeplant', 'läuft': 'Wird gedruckt', nachbearbeitung: 'In der Nachbearbeitung', fertig: 'Fertig', abgeschlossen: 'Abgeschlossen' }, post: 'Nachbearbeitung', due: 'Termin', progress: 'Fortschritt', parts: '{a} von {b} Teilen', eta: 'Voraussichtlich fertig', photos: 'Fertige Teile', updated: 'Stand', gone: 'Dieser Link ist nicht mehr gültig.', printing: 'gerade im Druck' },
  en: { title: 'Order', status: { offen: 'Received', geplant: 'Scheduled', 'läuft': 'Printing', nachbearbeitung: 'Finishing', fertig: 'Finished', abgeschlossen: 'Closed' }, post: 'Finishing', due: 'Due', progress: 'Progress', parts: '{a} of {b} parts', eta: 'Expected to be ready', photos: 'Finished parts', updated: 'As of', gone: 'This link is no longer valid.', printing: 'printing right now' },
};

function page(lang, body, title = 'PrintDock') {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title><meta http-equiv="refresh" content="120">
<style>:root{--bg:#F3F5F7;--panel:#fff;--ink:#15233B;--muted:#5B6676;--line:#DDE2E8;--acc:#3F5BD8;--ok:#16A34A}
@media (prefers-color-scheme:dark){:root{--bg:#171C23;--panel:#212933;--ink:#E8EDF3;--muted:#9BA7B6;--line:#384452;--acc:#7B93FF}}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:640px;margin:0 auto;padding:24px 16px 40px}.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px 18px 16px;margin-bottom:14px}
h1{font-size:1.5rem;margin:0 0 2px}.m{color:var(--muted);font-size:.9rem}.st{display:inline-block;margin-top:10px;padding:3px 10px;border-radius:999px;background:var(--acc);color:#fff;font-weight:600;font-size:.85rem}
.st.done{background:var(--ok)}.bar{height:10px;background:var(--line);border-radius:6px;overflow:hidden;margin:8px 0 4px}.bar i{display:block;height:100%;background:var(--acc)}
.row{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-top:1px solid var(--line)}.row:first-of-type{border-top:0}
.ph{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}.ph img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px;border:1px solid var(--line)}
footer{text-align:center;color:var(--muted);font-size:.8rem}</style></head><body><main>${body}</main></body></html>`;
}

/**
 * @param ctx { production, history: () => [], lang, photoDir }
 */
const POST_EN = { 'Stützen entfernen': 'Support removal', 'Prüfen': 'Quality check', Verpackt: 'Packed', Versendet: 'Shipped' };

function render(ctx, token) {
  const lang = ctx.lang === 'en' ? 'en' : 'de';
  const T = TXT[lang];
  const o = ctx.production.orderByShareToken(token);
  if (!o) return { status: 404, html: page(lang, `<div class="card"><p>${T.gone}</p></div>`) };
  const v = ctx.production.orderView(o);
  const pct = v.qty ? Math.round((v.done / v.qty) * 100) : 0;
  const loc = lang === 'de' ? 'de-DE' : 'en-GB';
  const date = (d) => (d ? new Date(d).toLocaleDateString(loc, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }) : '–');
  const eta = v.status !== 'fertig' && !v.closed && v.restSec ? new Date(Date.now() + v.restSec * 1000) : null;
  const photos = ctx.history().filter((h) => h.orderId === o.id && h.photo && h.result === 'finished').slice(-12).reverse();
  const done = v.status === 'fertig' || v.status === 'abgeschlossen';
  const body = `<div class="card"><div class="m">${T.title} ${esc(o.nr)}</div><h1>${esc(o.title)}</h1>
      ${o.customer ? `<div class="m">${esc(o.customer)}</div>` : ''}<span class="st ${done ? 'done' : ''}">${esc(T.status[v.status] || v.status)}</span></div>
    <div class="card"><div class="row"><span>${T.progress}</span><b>${T.parts.replace('{a}', v.done).replace('{b}', v.qty)}</b></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      ${v.positions.some((p) => p.running) ? `<div class="m">${T.printing}</div>` : ''}
      <div class="row"><span>${T.due}</span><b>${date(o.due)}</b></div>
      ${eta ? `<div class="row"><span>${T.eta}</span><b>${eta.toLocaleString(loc, { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</b></div>` : ''}</div>
    ${v.post?.length && v.done ? `<div class="card"><b>${T.post}</b>${v.post.map((r) => `<div class="row"><span>${esc(lang === 'en' ? (POST_EN[r.name] || r.name) : r.name)}</span><b>${T.parts.replace('{a}', r.done).replace('{b}', v.qty)}</b></div>`).join('')}</div>` : ''}
    ${photos.length ? `<div class="card"><b>${T.photos}</b><div class="ph" style="margin-top:10px">${photos.map((h) => `<img src="/status/${esc(token)}/photo/${esc(h.id)}" alt="" loading="lazy">`).join('')}</div></div>` : ''}
    <footer>${T.updated} ${new Date().toLocaleString(loc)} · PrintDock</footer>`;
  return { status: 200, html: page(lang, body, `${o.nr} – ${o.title}`) };
}

function photo(ctx, token, id) {
  const o = ctx.production.orderByShareToken(token);
  if (!o) return null;
  const h = ctx.history().find((x) => x.id === id && x.orderId === o.id && x.photo);
  if (!h) return null;
  const f = path.join(ctx.photoDir, `${h.id}.jpg`);
  return fs.existsSync(f) ? f : null;
}

module.exports = { render, photo };
