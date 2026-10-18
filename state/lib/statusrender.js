// Statusseite für Kunden – reine Darstellung (Daten → HTML).
// Wird von PrintDock (/status/<code>) und vom Status-Server (relay/) gleich benutzt.
// Daten: { nr, title, customer, status, qty, done, due, eta, printing, post: [{ name, done }], photos: [id], brand: { name, url }, updatedAt }

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

const POST_EN = { 'Stützen entfernen': 'Support removal', 'Prüfen': 'Quality check', Verpackt: 'Packed', Versendet: 'Shipped' };

function gone(lang = 'de') {
  return page(lang === 'en' ? 'en' : 'de', `<div class="card"><p>${TXT[lang === 'en' ? 'en' : 'de'].gone}</p></div>`);
}

/** @param opts { photoUrl(id) } */
function renderOrder(lang, d, { photoUrl }) {
  lang = lang === 'en' ? 'en' : 'de';
  const T = TXT[lang];
  const pct = d.qty ? Math.round((d.done / d.qty) * 100) : 0;
  const loc = lang === 'de' ? 'de-DE' : 'en-GB';
  const tz = d.tz || undefined;
  const date = (x) => (x ? new Date(x).toLocaleDateString(loc, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: tz }) : '–');
  const done = d.status === 'fertig' || d.status === 'abgeschlossen';
  const brand = d.brand?.name ? (d.brand.url ? `<a href="${esc(d.brand.url)}" rel="noopener">${esc(d.brand.name)}</a>` : esc(d.brand.name)) : 'PrintDock';
  const body = `<div class="card"><div class="m">${T.title} ${esc(d.nr)}</div><h1>${esc(d.title)}</h1>
      ${d.customer ? `<div class="m">${esc(d.customer)}</div>` : ''}<span class="st ${done ? 'done' : ''}">${esc(T.status[d.status] || d.status)}</span></div>
    <div class="card"><div class="row"><span>${T.progress}</span><b>${T.parts.replace('{a}', d.done).replace('{b}', d.qty)}</b></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      ${d.printing ? `<div class="m">${T.printing}</div>` : ''}
      <div class="row"><span>${T.due}</span><b>${date(d.due)}</b></div>
      ${d.eta ? `<div class="row"><span>${T.eta}</span><b>${new Date(d.eta).toLocaleString(loc, { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: tz })}</b></div>` : ''}</div>
    ${d.post?.length && d.done ? `<div class="card"><b>${T.post}</b>${d.post.map((r) => `<div class="row"><span>${esc(lang === 'en' ? (POST_EN[r.name] || r.name) : r.name)}</span><b>${T.parts.replace('{a}', r.done).replace('{b}', d.qty)}</b></div>`).join('')}</div>` : ''}
    ${d.photos?.length ? `<div class="card"><b>${T.photos}</b><div class="ph" style="margin-top:10px">${d.photos.map((id) => `<img src="${esc(photoUrl(id))}" alt="" loading="lazy">`).join('')}</div></div>` : ''}
    <footer>${T.updated} ${new Date(d.updatedAt || Date.now()).toLocaleString(loc, { timeZone: tz })} · ${brand}</footer>`;
  return page(lang, body, `${d.nr} – ${d.title}`);
}

module.exports = { renderOrder, gone, esc };
