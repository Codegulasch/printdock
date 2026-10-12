/* PrintDock – Startseite „Heute“: was zu tun ist, was läuft, was als Nächstes kommt. */

const TODAY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="m9 15 2 2 4-4"/></svg>';
NAV_ICON.today = TODAY_ICON;
NAV_ALL.unshift({ g: 'today', l: 'Heute', icon: 'today', sec: 'Produktion', v: [['today', 'Heute']] });
delete NAV_ALL.find((g) => g.g === 'board').sec;
// Startseite, wenn keine Seite in der Adresse steht
// Ohne Seite in der Adresse: Startseite aus den Einstellungen (Standard „Heute“) – entschieden nach dem Laden der Einstellungen
if (!location.hash.slice(1) || location.hash === '#') S.view = 'today', S.viewFromHome = true;

loaders.labels = async () => (S.labels = on('orders') ? await api('labels') : []);

/** Eine Zeile in „Zu tun“ */
const todo = (kind, icon, title, sub, action = '') => `<div class="td-row td-${kind}"><span class="td-ic">${icon}</span><div class="td-t"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</div><div class="td-a">${action}</div></div>`;
const goBtn = (view, label) => `<button class="b b-sm" data-view="${view}">${esc(label)}</button>`;

function vToday() {
  const items = [];
  const F = S.fil || {};
  const today = todayISO();
  // Drucker: Platte räumen, Störung, pausiert
  for (const p of S.printers) {
    const v = pView(p);
    const st = p.status || {};
    const nextQ = (S.queue || []).find((q) => q.status === 'queued' && q.autoNext && q.printerId === p.id);
    if (v.mode === 'clear') items.push(todo('warn', '🧹', t('{p}: Platte räumen', { p: esc(p.name) }), [st.file ? esc(st.file) : '', nextQ ? `▶ ${t('danach startet {f}', { f: esc(nextQ.file?.name || '') })}` : ''].filter(Boolean).join(' · '), `<button class="b b-sm b-done" data-act="plateClear" data-id="${p.id}">${ICON.check}${t('Platte ist frei')}</button>`));
    else if (st.state === 'error') items.push(todo('bad', '⚠', t('{p}: Störung', { p: esc(p.name) }), esc(t(st.message || '')), goBtn('board', t('Ansehen'))));
    else if (st.state === 'paused') items.push(todo('warn', '⏸', t('{p}: pausiert', { p: esc(p.name) }), esc(t(st.message || '')), goBtn('board', t('Ansehen'))));
  }
  // Nach „Platte frei“ nicht gestartet – mit Grund
  for (const p of S.printers) {
    const si = S.summary?.startInfo?.[p.id];
    if (!si || si.ok || si.kind === 'empty' || si.kind === 'stuck') continue;
    items.push(todo('warn td-wide', '▶', t('{p}: startet nicht', { p: esc(p.name) }), esc(t(si.text)), startInfoActions(p, si)));
  }
  // Hängende Einträge: Drucker ist bereit, Eintrag „druckt“ noch
  for (const q of (S.queue || []).filter((x) => x.stale)) {
    items.push(todo('bad td-wide', '⏱', t('{p}: Druckende verpasst', { p: esc(printerById(q.printerId)?.name || '') }), `${esc(q.file?.name || '')} · ${t('Wie ging der Druck aus?')}`, `<button class="b b-sm b-done" data-qresolve="finished" data-id="${q.id}">${ICON.check}${t('War fertig')}</button><button class="b b-sm" data-qresolve="cancelled" data-id="${q.id}">${t('Abgebrochen')}</button>`));
  }
  // Fehldrucke: neu einreihen?
  if (on('queue') && typeof failOpenList === 'function') {
    for (const h of failOpenList()) items.push(todo('bad td-wide', '↻', t('{p}: Druck nicht fertig geworden', { p: esc(h.printerName) }), `${esc(h.file || '')} · ${h.result === 'cancelled' ? t('abgebrochen') : t('fehlgeschlagen')}${h.progress != null ? ` ${t('bei {n} %', { n: Math.floor(h.progress) })}` : ''}`, `${failActionsHTML(h, { compact: true })}<button class="b b-sm" data-hfail="reason" data-id="${esc(h.id)}">${t('Grund …')}</button>`));
  }
  // Etiketten fertiger Teile
  if (S.labels?.length) items.push(todo('info', '🏷', S.labels.length === 1 ? t('1 Etikett drucken') : t('{n} Etiketten drucken', { n: S.labels.length }), esc([...new Set(S.labels.map((l) => l.nr))].join(', ')), `<button class="b b-sm b-go" data-plabels="pending">${t('Drucken …')}</button>`));
  // Filament
  if (on('filament')) {
    const hum = (F.humPoints || []).filter((pt) => (pt.level === 'alarm' || pt.level === 'warn') && !(F.settings?.humHidden || []).includes(humKey(pt)));
    if (hum.length) items.push(todo(hum.some((x) => x.level === 'alarm') ? 'bad' : 'warn', '💧', t('Filament zu feucht'), hum.map((pt) => `${esc(humPointName(pt))} ${fnum(pt.value?.pct, 0)} %`).join(' · '), goBtn('hum', t('Trocknen …'))));
    const low = (F.spools || []).filter((s) => s.low && !s.archived);
    if (low.length) items.push(todo('warn', '🧵', low.length === 1 ? t('1 Spule wird knapp') : t('{n} Spulen werden knapp', { n: low.length }), low.slice(0, 5).map((s) => `${esc(s.nr)} ${esc(s.material)} ${fnum(s.remaining, 0)} g`).join(' · '), goBtn('spools', t('Spulen'))));
    const unmatched = (F.printers || []).flatMap((p) => p.slots.filter((x) => x.unmatched));
    if (unmatched.length) items.push(todo('info', '❓', unmatched.length === 1 ? t('1 Spule ohne Zuordnung') : t('{n} Spulen ohne Zuordnung', { n: unmatched.length }), '', goBtn('slots', t('Zuordnen'))));
  }
  // Einkaufsliste: Filament fehlt für offene Drucke/Aufträge
  const missingShop = (S.res?.shopping || []).filter((x) => x.missing);
  if (missingShop.length) items.push(todo('warn', '🛒', t('Filament fehlt für offene Aufträge'), missingShop.slice(0, 4).map((x) => `${esc(x.material || '?')}${x.colorName ? ` ${esc(t(x.colorName))}` : ''} ${fnum(x.missing, 0)} g`).join(' · '), `<button class="b b-sm" data-shop="open">${t('Einkaufsliste')}</button>`));
  // Nachbearbeitung: Teile warten auf einen Schritt
  if (on('orders') && typeof postOpenList === 'function') {
    const pl = postOpenList();
    if (pl.length) {
      const n = pl.reduce((a, x) => a + x.r.waiting, 0);
      items.push(todo('info', '🧰', n === 1 ? t('1 Teil wartet auf Nachbearbeitung') : t('{n} Teile warten auf Nachbearbeitung', { n }), pl.slice(0, 5).map(({ o, r }) => `${esc(o.nr)}: ${r.waiting} × ${esc(t(r.name))}`).join(' · '), pl.length === 1 ? `<button class="b b-sm" data-act="oEdit" data-id="${pl[0].o.id}">${t('Öffnen')}</button>` : goBtn('orders', t('Aufträge'))));
    }
  }
  // Wartung
  if (on('maintenance')) {
    const due = (S.maint?.tasks || []).filter((x) => x.state === 'due');
    if (due.length) items.push(todo('warn', '🔧', due.length === 1 ? t('1 Wartung fällig') : t('{n} Wartungen fällig', { n: due.length }), due.slice(0, 4).map((x) => `${esc(printerById(x.printerId)?.name || '')}: ${esc(t(x.title))}`).join(' · '), goBtn('maint', t('Wartung'))));
  }
  // Aufträge: überfällig oder heute fällig
  if (on('orders')) {
    for (const o of S.orders.filter((x) => !x.closed && x.status !== 'fertig' && x.due && x.due <= today)) {
      items.push(todo(o.late ? 'bad' : 'warn', '📅', `${esc(o.nr)} ${esc(o.title)}`, `${o.late ? t('überfällig seit {d}', { d: dfmt(o.due) }) : t('heute fällig')} · ${t('{a} von {b}', { a: o.done, b: o.qty })}`, `<button class="b b-sm" data-act="oEdit" data-id="${o.id}">${t('Öffnen')}</button>`));
    }
  }
  // Warteschlange mit Fehlern
  if (on('queue')) {
    const errs = S.queue.filter((q) => q.status === 'queued' && q.error);
    if (errs.length) items.push(todo('bad', '⛔', errs.length === 1 ? t('1 Druck konnte nicht starten') : t('{n} Drucke konnten nicht starten', { n: errs.length }), esc(t(errs[0].error)), goBtn('queue', t('Warteschlange'))));
  }
  if (S.app?.update) items.push(todo('info', '⬆', t('PrintDock {v} ist verfügbar', { v: esc(S.app.update) }), '', goBtn('system', t('Aktualisieren'))));

  // Läuft gerade
  const running = S.printers.filter((p) => ['printing', 'preparing', 'paused'].includes(p.status?.state));
  const runHTML = running.map((p) => {
    const st = p.status;
    const pct = Math.floor(st.progress || 0);
    const end = st.remainingSec ? new Date(Date.now() + st.remainingSec * 1000) : null;
    return `<div class="td-run"><div class="td-run-h"><b>${esc(p.name)}</b><span class="num">${pct} %</span></div>
      <div class="meta td-file">${esc(st.file || '')}</div><div class="bar"><i style="width:${pct}%"></i></div>
      <div class="meta">${st.state === 'paused' ? t('pausiert') : end ? t('fertig um {t}', { t: end.toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' }) }) + ` · ${t('noch {d}', { d: fmtDur(st.remainingSec) })}` : t(pView(p).lamp)}</div>${typeof firstLayerHTML === 'function' ? firstLayerHTML(p) : ''}</div>`;
  }).join('');

  // Als Nächstes
  const next = on('queue') ? S.queue.filter((q) => q.status === 'queued').slice(0, 6) : [];
  const nextHTML = next.map((q) => {
    const p = q.printerId ? printerById(q.printerId) : null;
    return `<div class="td-next">${thumbHTML(q.file)}<div style="min-width:0"><b>${esc(q.file?.name || '–')}</b>
      <div class="meta">${p ? esc(p.name) : t('passender Drucker')}${q.order ? ` · ${esc(q.order.nr)}` : ''} · ${fmtDur(q.file?.meta?.estimatedSec)}</div>
      ${q.waitReason ? `<div class="meta">⏳ ${esc(t(q.waitReason))}</div>` : ''}</div>
      <button class="b b-sm b-go" data-act="qStart" data-id="${q.id}" ${q.file?.printable && S.printers.some(printerReady) ? '' : 'disabled'}>${ICON.play}${t('Start')}</button></div>`;
  }).join('');

  // Termine der nächsten 7 Tage
  const soon = on('orders') ? S.orders.filter((o) => !o.closed && o.status !== 'fertig' && o.due && o.due > today && o.due <= new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)).sort((a, b) => a.due.localeCompare(b.due)) : [];
  const soonHTML = soon.map((o) => `<button class="td-due" data-act="oEdit" data-id="${o.id}"><b>${dfmt(o.due)}</b><span>${esc(o.nr)} ${esc(o.title)}</span><span class="meta">${t('{a} von {b}', { a: o.done, b: o.qty })}</span></button>`).join('');

  const dateTxt = new Date().toLocaleDateString(LOC, { weekday: 'long', day: 'numeric', month: 'long' });
  return `<div class="page-head"><h1>${TODAY_ICON}${t('Heute')}</h1><span class="meta">${esc(dateTxt)}</span></div>
    ${stripHTML()}
    <div class="today">
      <section class="td-card td-todo"><h3>${t('Zu tun')}</h3>${items.length ? items.join('') : `<div class="td-empty">✓ ${t('Alles erledigt – nichts zu tun.')}</div>`}</section>
      <section class="td-card"><h3>${t('Läuft gerade')}</h3>${runHTML || `<div class="td-empty">${t('Kein Drucker druckt gerade.')}</div>`}</section>
      ${on('queue') ? `<section class="td-card"><h3>${t('Als Nächstes')}</h3>${nextHTML || `<div class="td-empty">${t('Nichts in der Warteschlange.')}</div>`}</section>` : ''}
      ${soon.length ? `<section class="td-card"><h3>${t('Termine diese Woche')}</h3><div class="td-dues">${soonHTML}</div></section>` : ''}
    </div>`;
}
VIEW_FN.today = vToday;

// Etiketten-Knopf auf der Heute-Seite
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-plabels]');
  if (!b) return;
  partLabelsDialog(b.dataset.plabels === 'pending' ? null : b.dataset.plabels);
});
