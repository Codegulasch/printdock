/* PrintDock – Filament-Reservierung: frei/reserviert je Spule, Warnung „reicht nicht“, Einkaufsliste. */

loaders.reserve = async () => (S.res = on('filament') && on('queue') ? await api('filament/reservations') : null);

const colorDot = (c) => `<span class="swatch" style="background:${esc(c || 'transparent')}"></span>`;
const matLabel = (x) => `${esc(x.material || t('Filament'))}${x.colorName ? ` ${esc(t(x.colorName))}` : ''}`;

/** Zeile an der Spulenkarte: reserviert / frei */
function reserveSpoolHTML(s) {
  const r = S.res?.spools?.[s.id];
  if (!r || s.archived) return '';
  const bad = r.free < 0;
  return `<div class="meta res-line ${bad ? 'bad' : ''}" title="${esc(t('Für offene Drucke in der Warteschlange vorgemerkt'))}">🔒 ${t('{g} g reserviert ({n} Drucke)', { g: fnum(r.reserved, 0), n: r.jobs })} · ${bad ? t('es fehlen {g} g', { g: fnum(-r.free, 0) }) : t('{g} g frei', { g: fnum(r.free, 0) })}</div>`;
}

/** Warnung am Warteschlangen-Eintrag */
function reserveWarnHTML(q) {
  const it = S.res?.items?.[q.id];
  if (!it?.short?.length || !['queued', 'sending'].includes(q.status)) return '';
  return it.short.map((x) => `<div class="meta res-warn">⚠ ${t('Filament reicht nicht')}: ${colorDot(x.color)}${esc(x.material || '')}${x.nr ? ` (${esc(x.nr)})` : ''} – ${t('braucht {a} g, frei {b} g', { a: fnum(x.need, 0), b: fnum(x.free, 0) })}${x.alt ? ` · ${t('Tipp: {n} ({w}, {g} g frei)', { n: esc(x.alt.nr), w: esc(t(x.alt.where)), g: fnum(x.alt.free, 0) })}` : x.nr ? '' : ` · ${t('nichts Passendes auf Lager')}`}</div>`).join('');
}

/** Hinweis im Startdialog: Spule reicht für diesen Druck, aber danach nicht mehr für die anderen */
function reserveStartHTML(map) {
  const out = [];
  map.filaments.forEach((f, i) => {
    const key = map.suggested[i];
    const sl = map.slots.find((x) => x.key === key);
    const other = map.reservedOthers?.[key];
    if (!sl?.spool || !other) return;
    const after = sl.spool.remaining - (f.grams || 0);
    if (after < other.grams) out.push(t('{n}: danach {a} g übrig, {b} weitere Drucke in der Warteschlange brauchen {c} g', { n: esc(sl.spool.nr), a: fnum(Math.max(0, after), 0), b: other.jobs, c: fnum(other.grams, 0) }));
  });
  return out.length ? `<div class="res-start">⚠ ${out.join('<br>')}</div>` : '';
}

/** Einkaufsliste: was für alle offenen Drucke und Aufträge fehlt */
function shoppingHTML({ title = true } = {}) {
  const list = S.res?.shopping || [];
  if (!list.length) return title ? '' : `<p class="meta">${t('Für alle offenen Drucke und Aufträge ist genug Filament da.')}</p>`;
  return `<section class="sec shop">${title ? `<div class="cc-head"><h3>🛒 ${t('Einkaufsliste')}</h3><span class="meta">${t('fehlt für offene Drucke und Aufträge')}</span><button class="b b-sm" data-shop="print">${t('Drucken')}</button></div>` : ''}
    <div class="list flat">${list.map((x) => `<div class="row shop-row">${colorDot(x.color)}<b>${matLabel(x)}</b><span class="meta">${[x.orders.length ? x.orders.map(esc).join(', ') : '', x.queue ? t('{n} in der Warteschlange', { n: x.queue }) : ''].filter(Boolean).join(' · ')}</span><span class="num"><b>${fnum(x.missing, 0)} g</b> <span class="meta">${x.spools === 1 ? t('≈ 1 Spule') : t('≈ {n} Spulen', { n: x.spools })}</span></span></div>`).join('')}</div></section>`;
}

function shoppingPrint() {
  const list = S.res?.shopping || [];
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(`<!doctype html><html lang="${LANG}"><head><meta charset="utf-8"><title>${t('Einkaufsliste')}</title><style>body{font-family:system-ui,Arial,sans-serif;margin:28px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ccc;padding:8px;text-align:left}.r{text-align:right}i{display:inline-block;width:14px;height:14px;border-radius:50%;border:1px solid #999;vertical-align:-2px;margin-right:6px}</style></head><body>
    <h1>${t('Einkaufsliste Filament')}</h1><p>${new Date().toLocaleDateString(LOC)}</p>
    <table><tr><th>${t('Material')}</th><th>${t('für')}</th><th class="r">${t('fehlt')}</th><th class="r">${t('Spulen')}</th></tr>
    ${list.map((x) => `<tr><td><i style="background:${esc(x.color || '#fff')}"></i>${matLabel(x)}</td><td>${x.orders.map(esc).join(', ')}${x.queue ? ` ${t('{n} in der Warteschlange', { n: x.queue })}` : ''}</td><td class="r">${fnum(x.missing, 0)} g</td><td class="r">${x.spools}</td></tr>`).join('')}</table>
    <script>print()<\/script></body></html>`);
  w.document.close();
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-shop]');
  if (!b) return;
  if (b.dataset.shop === 'print') shoppingPrint();
  if (b.dataset.shop === 'open') openDialog(`<div class="dlg"><h2>🛒 ${t('Einkaufsliste')}</h2>${shoppingHTML({ title: false })}<div class="dlg-actions"><button class="b" data-close>${t('Schließen')}</button><button class="b b-go" data-shop="print">${t('Drucken')}</button></div></div>`, { wide: true });
});
