/* PrintDock – Archiv: alle Drucke mit Start und Ende, nach Tagen gruppiert, mit Suche und Filtern.
   Auch Drucke, die nicht aus PrintDock kamen (Slicer direkt an den Drucker, Touchscreen) – mit Auftrag zuordnen,
   nochmal drucken und CSV-Export. */

NAV_ICON.archive = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M10 12h4"/></svg>';
// eigener Menüpunkt unter „Produktion“ (bisher versteckt als Reiter unter „Auswertung“)
for (const g of NAV_ALL) if (g.g === 'ana') g.v = g.v.filter((v) => v[0] !== 'history');
NAV_ALL.splice(NAV_ALL.findIndex((g) => g.g === 'orders') + 1, 0, { g: 'arch', l: 'Archiv', icon: 'archive', v: [['history', 'Archiv', 'history']] });

S.arch = { q: '', range: '30', from: '', to: '', printer: '', result: '', source: '', order: '', limit: 100 };
S.archData = null;

const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Zeitraum-Chip → von/bis */
function archRange() {
  const a = S.arch;
  const now = new Date();
  const back = (n) => isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));
  if (a.range === 'today') return { from: isoDay(now), to: '' };
  if (a.range === '7') return { from: back(6), to: '' };
  if (a.range === '30') return { from: back(29), to: '' };
  if (a.range === 'month') return { from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: '' };
  if (a.range === 'year') return { from: `${now.getFullYear()}-01-01`, to: '' };
  if (a.range === 'custom') return { from: a.from, to: a.to };
  return { from: '', to: '' };
}

function archParams(extra = {}) {
  const a = S.arch;
  const r = archRange();
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ q: a.q, from: r.from, to: r.to, printer: a.printer, result: a.result, source: a.source, order: a.order, limit: a.limit, ...extra })) if (v !== '' && v != null) p.set(k, v);
  return p.toString();
}

loaders.archive = async () => {
  S.archData = await api(`archive?${archParams()}`);
};
// Live-Updates des Verlaufs laden auch das Archiv nach
{
  const orig = loaders.history;
  loaders.history = async () => {
    await orig();
    await loaders.archive().catch(() => {});
  };
}

let archTimer = null;
function archReload(delay = 0) {
  clearTimeout(archTimer);
  archTimer = setTimeout(async () => {
    await loaders.archive().catch((err) => toast(err.message, true));
    render();
  }, delay);
}

const hm2 = (iso) => (iso ? new Date(iso).toLocaleTimeString(S.app?.lang === 'en' ? 'en-GB' : 'de-DE', { hour: '2-digit', minute: '2-digit' }) : '');
const dayLabel = (iso) => new Date(iso).toLocaleDateString(S.app?.lang === 'en' ? 'en-GB' : 'de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });

/** Von–bis: gleicher Tag nur Uhrzeiten, sonst mit Datum */
function spanHTML(h) {
  const s = h.startedAt ? new Date(h.startedAt) : null;
  const e = new Date(h.endedAt);
  if (!s) return `<span class="num">– ${hm2(h.endedAt)}</span>`;
  const same = isoDay(s) === isoDay(e);
  return `<span class="num ar-span">${same ? hm2(h.startedAt) : `${dfmt(isoDay(s))} ${hm2(h.startedAt)}`} – ${hm2(h.endedAt)}</span>`;
}

function archRowHTML(h) {
  const RES = { finished: ['erfolgreich', 'run'], cancelled: ['abgebrochen', 'pause'], error: ['fehlgeschlagen', 'bad'] };
  const [l, c] = h.markedFailed ? ['Fehldruck', 'bad'] : h.resumed ? ['unterbrochen', 'pause'] : RES[h.result] || [h.result, ''];
  const grams = h.costs?.grams || (h.filament || []).reduce((g, f) => g + (f.grams || 0), 0);
  const pic = h.photo
    ? `<a class="h-photo" href="api/history/${esc(h.id)}/photo" target="_blank" rel="noopener" title="${esc(t('Foto des fertigen Teils'))}"><img src="api/history/${esc(h.id)}/photo" alt="" loading="lazy"></a>`
    : h.fileInfo?.thumb ? `<span class="h-photo"><img src="api/files/${esc(h.fileInfo.id)}/thumb" alt="" loading="lazy"></span>` : '';
  const tags = [
    h.external ? `<span class="ar-tag ext" title="${esc(t('Nicht aus PrintDock gestartet – direkt aus dem Slicer oder am Drucker'))}">${t('am Drucker / Slicer')}</span>` : '',
    h.resumeOf ? `<span class="ar-tag">${t('fortgesetzt ab {n} %', { n: Math.round(h.resumeFrom || 0) })}</span>` : '',
    h.resumed ? `<span class="ar-tag">${t('danach fortgesetzt')}</span>` : '',
    h.plate ? `<span class="ar-tag">${t('Platte {n}', { n: h.plate })}</span>` : '',
    h.external && !h.fileInfo && h.fetch === 'unsupported' ? `<span class="ar-tag" title="${esc(t('Dieser Drucker bietet die Datei nicht zum Herunterladen an'))}">${t('ohne Datei')}</span>` : '',
  ].join('');
  const orderCell = h.order
    ? `<b>${esc(h.order.nr)}</b><div class="meta">${esc(h.order.title)}${h.autoAssigned ? ` · ${t('automatisch')}` : ''}</div>`
    : h.assignOpen && on('orders') ? `<button class="b b-sm b-go" data-arassign="${esc(h.id)}">${t('Auftrag zuordnen …')}</button>`
    : `<span class="meta">${h.noOrder ? t('kein Auftrag') : '–'}</span>`;
  const acts = [];
  if (h.order || (h.external && on('orders') && !h.assignOpen)) acts.push(`<button class="x" data-arassign="${esc(h.id)}" title="${esc(t('Auftrag ändern'))}">${t('Auftrag …')}</button>`);
  if (h.fileInfo?.printable && on('queue')) acts.push(`<button class="b b-sm" data-arreprint="${esc(h.id)}" title="${esc(t('Gleiche Datei wieder einplanen'))}">↻ ${t('Nochmal')}</button>`);
  if (typeof failActionsHTML === 'function' && on('queue')) acts.push(failActionsHTML(h));
  return `<div class="row ar-row ${h.resumed ? 'dim' : ''}">
    <div><span class="lbl">${t('Zeit')}</span>${spanHTML(h)}<div class="meta num">${fmtDur(h.durationSec)}</div></div>
    <div class="c-main h-file">${pic}<div style="min-width:0"><b>${esc(h.fileInfo?.name || h.file || '–')}</b>
      <div class="meta">${esc(h.printerName || '')}${grams ? ` · ${fnum(grams, 0)} g` : ''}${h.costs?.total ? ` · ${costPill(h.costs)}` : ''}</div>
      ${tags ? `<div class="ar-tags">${tags}</div>` : ''}
      ${h.message && h.result !== 'finished' && !h.markedFailed ? `<div class="meta">${esc(t(h.message))}</div>` : ''}${typeof failInfoHTML === 'function' ? failInfoHTML(h) : ''}</div></div>
    <div><span class="lbl">${t('Auftrag')}</span>${orderCell}</div>
    <div><span class="lbl">${t('Ergebnis')}</span><span class="pill ${c}">${t(l)}</span>${h.result !== 'finished' && !h.markedFailed && h.progress != null ? `<div class="meta">${t('bei {n} %', { n: Math.floor(h.progress) })}</div>` : ''}</div>
    <div class="acts">${acts.join('')}</div>
  </div>`;
}

function vArchive() {
  const a = S.arch;
  const d = S.archData || { items: [], total: 0, sums: {}, openAssign: 0 };
  const sel = (key, opts) => `<select class="in" data-arf="${key}" aria-label="${esc(t(opts[0][1]))}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${a[key] === v ? 'selected' : ''}>${esc(t(l))}</option>`).join('')}</select>`;
  const ranges = [['today', 'Heute'], ['7', '7 Tage'], ['30', '30 Tage'], ['month', 'Dieser Monat'], ['year', 'Dieses Jahr'], ['all', 'Alle'], ['custom', 'Zeitraum …']];
  const filters = `<div class="ar-filter">
      <div class="ar-search"><input class="in" type="search" data-arf="q" value="${esc(a.q)}" placeholder="${esc(t('Suchen: Datei, Auftrag, Kunde, Drucker …'))}" autocomplete="off"></div>
      <div class="chips">${ranges.map(([k, l]) => `<button class="chip" data-arrange="${k}" aria-pressed="${a.range === k}">${t(l)}</button>`).join('')}</div>
      ${a.range === 'custom' ? `<div class="ar-dates"><label>${t('von')}<input class="in" type="date" data-arf="from" value="${esc(a.from)}"></label><label>${t('bis')}<input class="in" type="date" data-arf="to" value="${esc(a.to)}"></label></div>` : ''}
      <div class="ar-sels">
        ${sel('printer', [['', 'Alle Drucker'], ...S.printers.map((p) => [p.id, p.name])])}
        ${sel('result', [['', 'Alle Ergebnisse'], ['finished', 'erfolgreich'], ['cancelled', 'abgebrochen'], ['error', 'fehlgeschlagen'], ['failed', 'Fehldruck']])}
        ${sel('source', [['', 'Alle Quellen'], ['printdock', 'aus PrintDock'], ['extern', 'am Drucker / Slicer']])}
        ${on('orders') ? sel('order', [['', 'Alle Aufträge'], ['with', 'mit Auftrag'], ['without', 'ohne Auftrag'], ['open', 'Auftrag zuordnen offen'], ...S.orders.map((o) => [o.id, `${o.nr} ${o.title}`])]) : ''}
        ${a.q || a.printer || a.result || a.source || a.order || a.range !== '30' ? `<button class="x" data-arreset>${t('Filter zurücksetzen')}</button>` : ''}
      </div></div>`;
  const s = d.sums || {};
  const sums = `<div class="ar-sums">
      <div><b class="num">${s.prints || 0}</b><span>${t('Drucke')}</span></div>
      <div><b class="num">${s.prints ? Math.round((s.ok / s.prints) * 100) : 0} %</b><span>${t('erfolgreich')}</span></div>
      <div><b class="num">${fnum(s.hours || 0, 1)} h</b><span>${t('Druckzeit')}</span></div>
      <div><b class="num">${fnum((s.grams || 0) / 1000, 2)} kg</b><span>${t('Filament')}</span></div>
      ${s.cost ? `<div><b class="num">${fnum(s.cost, 2)} ${esc(S.app?.costs?.currency || '€')}</b><span>${t('Kosten')}</span></div>` : ''}
    </div>`;
  const banner = d.openAssign && on('orders') && a.order !== 'open'
    ? `<div class="ar-banner">📥 ${d.openAssign === 1 ? t('1 Druck vom Drucker/Slicer hat noch keinen Auftrag.') : t('{n} Drucke vom Drucker/Slicer haben noch keinen Auftrag.', { n: d.openAssign })} <button class="b b-sm" data-arshowopen>${t('Anzeigen')}</button></div>` : '';
  // nach Tagen gruppieren (Druckende)
  let lastDay = null;
  const dayStats = {};
  for (const h of d.items) {
    const k = isoDay(new Date(h.endedAt));
    dayStats[k] ||= { n: 0, sec: 0 };
    dayStats[k].n += 1;
    dayStats[k].sec += h.durationSec || 0;
  }
  let rows = '';
  for (const h of d.items) {
    const k = isoDay(new Date(h.endedAt));
    if (k !== lastDay) {
      lastDay = k;
      rows += `<div class="q-group ar-day"><b>${esc(dayLabel(h.endedAt))}</b><span class="meta">${dayStats[k].n === 1 ? t('1 Druck') : t('{n} Drucke', { n: dayStats[k].n })} · ${fmtDur(dayStats[k].sec)}</span></div>`;
    }
    rows += archRowHTML(h);
  }
  const more = d.total > d.items.length ? `<div class="ar-more"><button class="b" data-armore>${t('Weitere laden ({n} von {m})', { n: d.items.length, m: d.total })}</button></div>` : '';
  return `<div class="bar-row"><h2>${t('Archiv')}</h2><span class="meta">${d.total === 1 ? t('1 Druck') : t('{n} Drucke', { n: d.total })}</span>
      <a class="b b-sm" href="api/archive/export.csv?${esc(archParams({ limit: '' }))}" download>${t('CSV exportieren')}</a></div>
    ${filters}${banner}${sums}
    <div class="list">${d.items.length ? `<div class="row ar-row head"><div>${t('Von – bis')}</div><div>${t('Datei')}</div><div>${t('Auftrag')}</div><div>${t('Ergebnis')}</div><div></div></div>${rows}`
      : `<div class="empty"><h3>${t('Keine Drucke gefunden')}</h3><p>${t('Jeder beendete Druck landet hier – auch die, die direkt aus dem Slicer oder am Drucker gestartet wurden. Filter anpassen oder Zeitraum vergrößern.')}</p></div>`}</div>${more}
    ${S.history.length ? `<p style="margin-top:14px"><button class="x" data-act="hClear">${t('Archiv leeren')}</button></p>` : ''}`;
}
VIEW_FN.history = vArchive;

// ---------------------------------------------------------------- Bedienung

document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-arf="q"]');
  if (!el) return;
  S.arch.q = el.value;
  S.arch.limit = 100;
  archReload(300);
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-arf]');
  if (!el || el.dataset.arf === 'q') return;
  S.arch[el.dataset.arf] = el.value;
  S.arch.limit = 100;
  archReload();
});
document.addEventListener('click', async (e) => {
  const r = e.target.closest('[data-arrange]');
  if (r) {
    S.arch.range = r.dataset.arrange;
    if (S.arch.range === 'custom' && !S.arch.from) S.arch.from = archRange().from || isoDay(new Date(Date.now() - 30 * 864e5));
    S.arch.limit = 100;
    return archReload();
  }
  if (e.target.closest('[data-arreset]')) {
    Object.assign(S.arch, { q: '', range: '30', from: '', to: '', printer: '', result: '', source: '', order: '', limit: 100 });
    return archReload();
  }
  if (e.target.closest('[data-arshowopen]')) {
    Object.assign(S.arch, { order: 'open', range: 'all', limit: 100 });
    return archReload();
  }
  if (e.target.closest('[data-armore]')) {
    S.arch.limit += 100;
    return archReload();
  }
  const as = e.target.closest('[data-arassign]');
  if (as) return assignDialog(as.dataset.arassign);
  const rp = e.target.closest('[data-arreprint]');
  if (rp) return reprintDialog(rp.dataset.arreprint);
});

/** Archiv-Eintrag finden (Archivseite oder Verlauf) */
const archEntry = (id) => S.archData?.items.find((x) => x.id === id) || S.history.find((x) => x.id === id);

async function assignDialog(id) {
  const h = archEntry(id);
  if (!h) return;
  let cands = [];
  try {
    cands = await api(`archive/${id}/candidates`);
  } catch {
    /* keine Vorschläge */
  }
  const open = S.orders.filter((o) => !o.closed && !o.archived);
  const candKeys = new Set(cands.map((c) => `${c.orderId}|${c.positionId}`));
  const others = open.flatMap((o) => o.positions.map((p) => ({ o, p }))).filter(({ o, p }) => !candKeys.has(`${o.id}|${p.id}`));
  const d = openDialog(`<form class="dlg" method="dialog">
    <h2>${t('Auftrag zuordnen')}</h2>
    <p class="meta" style="margin:0">${esc(h.fileInfo?.name || h.file || '')} · ${esc(h.printerName || '')} · ${tfmt(h.endedAt)}</p>
    ${cands.length ? `<fieldset><legend>${t('Passt dazu')}</legend>${cands.map((c, i) => `<label class="fr-check"><input type="radio" name="t" value="${esc(c.orderId)}|${esc(c.positionId)}" ${i === 0 ? 'checked' : ''}> <b>${esc(c.nr)}</b> ${esc(c.title)}${c.customer ? ` · ${esc(c.customer)}` : ''} <span class="meta">${esc(c.file)} · ${t('{n} offen', { n: c.open })}</span></label>`).join('')}</fieldset>` : `<p class="hint" style="margin:0">${t('Kein offener Auftrag mit dieser Datei gefunden.')}</p>`}
    ${others.length ? `<label>${t('Anderer Auftrag')}<select name="other"><option value="">–</option>${others.map(({ o, p }) => `<option value="${esc(o.id)}|${esc(p.id)}">${esc(o.nr)} ${esc(o.title)} – ${esc(p.file?.name || '')}</option>`).join('')}</select></label>` : ''}
    <label class="fr-check"><input type="radio" name="t" value="none" ${!cands.length ? 'checked' : ''}> ${t('Kein Auftrag (Lager, Eigenbedarf, Test)')}</label>
    ${h.order ? `<label class="fr-check"><input type="radio" name="t" value="detach"> ${t('Zuordnung lösen')}</label>` : ''}
    <p class="hint" style="margin:0">${t('Zugeordnete Drucke zählen im Auftrag als fertige Teile – mit Kosten, Foto, Etikett und Kunden-Statuslink.')}</p>
    <div class="form-error" hidden></div>
    <div class="dlg-actions"><button class="b" type="button" data-close>${t('Abbrechen')}</button><button class="b b-go" value="ok">${t('Speichern')}</button></div></form>`);
  $('form', d).addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const pick = fd.get('other') || fd.get('t') || '';
    let body;
    if (pick === 'none') body = { none: true };
    else if (pick === 'detach') body = { orderId: null };
    else if (pick) {
      const [orderId, positionId] = pick.split('|');
      body = { orderId, positionId };
    } else return formError(d, t('Bitte einen Auftrag wählen'));
    try {
      await api(`archive/${id}/assign`, { method: 'POST', body });
      d.close();
      toast(body.none ? t('Als „kein Auftrag“ markiert') : body.orderId === null ? t('Zuordnung gelöst') : t('Dem Auftrag zugeordnet'));
      reload('history', 'orders', 'queue', 'summary', 'labels');
    } catch (err) {
      formError(d, err.message);
    }
  });
}

function reprintDialog(id) {
  const h = archEntry(id);
  if (!h) return;
  const d = openDialog(`<form class="dlg" method="dialog">
    <h2>${t('Nochmal drucken')}</h2>
    <p class="meta" style="margin:0">${esc(h.fileInfo?.name || h.file || '')}${h.plate ? ` · ${t('Platte {n}', { n: h.plate })}` : ''}</p>
    <div class="two"><label>${t('Drucker')}<select name="printerId"><option value="">${t('Passender Drucker (nach Modell)')}</option>${S.printers.map((p) => `<option value="${p.id}" ${p.id === h.printerId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
    <label data-count>${t('Anzahl Drucke')}<input name="count" type="number" min="1" max="200" value="1"></label></div>
    ${pmodePickHTML('mode', null)}
    <div class="form-error" hidden></div>
    <div class="dlg-actions"><button class="b" type="button" data-close>${t('Abbrechen')}</button><button class="b b-go" value="ok">${t('Einplanen')}</button></div></form>`);
  const form = $('form', d);
  const sync = () => ($('[data-count]', d).hidden = form.mode.value === 'single');
  $$('[name=mode]', d).forEach((r) => r.addEventListener('change', sync));
  sync();
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await api(`archive/${id}/reprint`, { method: 'POST', body: { printerId: form.printerId.value || null, count: Number(form.count.value) || 1, mode: form.mode.value } });
      d.close();
      toast(t('Eingeplant'));
      reload('queue', 'summary');
    } catch (err) {
      formError(d, err.message);
    }
  });
}
