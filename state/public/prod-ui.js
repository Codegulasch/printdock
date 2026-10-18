/* PrintDock – Nachbearbeitung je Auftrag und Foto der ersten Schicht. */

/** Nachbearbeitung im Auftragsdialog: Stück je Schritt mit +1 / alle */
function orderPostHTML(o) {
  if (!o.post?.length) return '';
  const rows = o.post.map((r) => `<div class="op-row"><span><b>${esc(t(r.name))}</b> <span class="meta">${t('{a} erledigt', { a: r.done })}${r.waiting ? ` · ${t('{n} warten', { n: r.waiting })}` : ''}</span></span>
    <button class="x" type="button" data-opost="${r.i}" data-d="-1" ${r.done ? '' : 'disabled'} title="${esc(t('Eins zurück'))}">−</button>
    <button class="b b-sm" type="button" data-opost="${r.i}" data-d="1" ${r.waiting ? '' : 'disabled'}>+1</button>
    <button class="b b-sm b-done" type="button" data-opost="${r.i}" data-all ${r.waiting ? '' : 'disabled'}>${t('alle {n}', { n: r.waiting })}</button></div>`).join('');
  return `<fieldset class="oc" data-opbox="${esc(o.id)}"><legend>${t('Nachbearbeitung')}</legend>${rows}</fieldset>`;
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-opost]');
  if (!b) return;
  const box = b.closest('[data-opbox]');
  const id = box.dataset.opbox;
  const o = S.orders.find((x) => x.id === id);
  const r = o?.post?.[Number(b.dataset.opost)];
  if (!r) return;
  const body = b.hasAttribute('data-all') ? { step: r.i, count: r.done + r.waiting } : { step: r.i, delta: Number(b.dataset.d) };
  const v = await run(() => api(`orders/${id}/post`, { method: 'POST', body }));
  if (!v) return;
  const i = S.orders.findIndex((x) => x.id === id);
  if (i >= 0) S.orders[i] = { ...S.orders[i], ...v };
  box.outerHTML = orderPostHTML(S.orders[i]);
  reload('orders');
});

/** Offene Nachbearbeitung für „Heute“: [{ o, r }] je Auftrag und Schritt mit wartenden Teilen */
function postOpenList() {
  return (S.orders || []).filter((o) => !o.archived && o.post?.length).flatMap((o) => o.post.filter((r) => r.waiting).map((r) => ({ o, r })));
}

/** Foto der ersten Schicht am laufenden Druck */
const firstLayerHTML = (p) => (p.firstLayer ? `<a class="td-l1" href="api/photos/${esc(p.firstLayer)}" target="_blank" rel="noopener" title="${esc(t('Foto nach der ersten Schicht'))}"><img src="api/photos/${esc(p.firstLayer)}" alt="" loading="lazy"></a>` : '');
