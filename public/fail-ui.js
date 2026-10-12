/* PrintDock – Fehldrucke: Grund erfassen, als Fehldruck markieren, mit einem Klick neu einreihen. */

const FAIL_REASONS = ['Haftung / abgelöst', 'Spaghetti', 'Filament leer oder gerissen', 'Düse verstopft', 'Schichtversatz', 'Verzug (Warping)', 'Strom / Verbindung weg', 'Falsche Datei / Einstellung', 'Von Hand abgebrochen', 'Sonstiges'];

/** Offene Nachfragen: nicht erfolgreiche Drucke der letzten 3 Tage, noch nicht neu eingereiht/erledigt */
const failOpenList = () => (S.history || []).filter((h) => h.failOpen && Date.now() - Date.parse(h.endedAt) < 3 * 864e5);

/** Knöpfe für einen Verlaufseintrag (Verlauf und Heute-Seite) */
function failActionsHTML(h, { compact = false } = {}) {
  if (!h) return '';
  const bad = h.result !== 'finished';
  const b = [];
  if (bad && !h.requeuedAt) b.push(`<button class="b b-sm b-go" data-hfail="requeue" data-id="${esc(h.id)}" title="${esc(t('Gleiche Datei und Farbzuordnung oben in die Warteschlange'))}">↻ ${t('Neu einreihen')}</button>`);
  if (bad && !compact) b.push(`<button class="b b-sm" data-hfail="reason" data-id="${esc(h.id)}">${h.failReason ? t('Grund ändern') : t('Grund …')}</button>`);
  if (!bad && !compact) b.push(`<button class="x h-mark" data-hfail="mark" data-id="${esc(h.id)}" title="${esc(t('Teil ist trotzdem nicht brauchbar – als Fehldruck werten'))}">${t('Fehldruck?')}</button>`);
  if (h.markedFailed && !h.requeuedAt && !compact) b.push(`<button class="x" data-hfail="unmark" data-id="${esc(h.id)}">${t('Doch in Ordnung')}</button>`);
  if (compact && h.failOpen) b.push(`<button class="b b-sm" data-hfail="dismiss" data-id="${esc(h.id)}">${t('Passt so')}</button>`);
  return b.join('');
}

/** Infozeile: Grund, neu eingereiht */
function failInfoHTML(h) {
  const parts = [];
  if (h.markedFailed) parts.push(t('nachträglich als Fehldruck gewertet'));
  if (h.failReason) parts.push(`${t('Grund')}: ${esc(t(h.failReason))}`);
  if (h.failNote) parts.push(esc(h.failNote));
  if (h.requeuedAt) parts.push(`↻ ${t('neu eingereiht')}`);
  return parts.length ? `<div class="meta">${parts.join(' · ')}</div>` : '';
}

/** Dialog: Grund wählen, optional neu einreihen */
function failDialog(h, { mode = 'reason' } = {}) {
  const finished = h.result === 'finished';
  const d = openDialog(`<form class="dlg" method="dialog">
    <h2>${finished ? t('Als Fehldruck werten') : t('Was ist passiert?')}</h2>
    <p class="meta" style="margin:0">${esc(h.file || '')} · ${esc(h.printerName || '')} · ${tfmt(h.endedAt)}</p>
    ${finished ? `<p class="hint" style="margin:0">${t('Das Teil zählt dann nicht mehr als erledigt; das Material wird als Ausschuss gebucht.')}</p>` : ''}
    <div class="fr-chips">${FAIL_REASONS.map((r) => `<label class="chip"><input type="radio" name="reason" value="${esc(r)}" ${h.failReason === r ? 'checked' : ''}>${esc(t(r))}</label>`).join('')}</div>
    <label>${t('Notiz (optional)')}<input name="note" value="${esc(h.failNote || '')}" maxlength="300" autocomplete="off"></label>
    ${h.requeuedAt ? '' : `<label class="fr-check"><input type="checkbox" name="requeue" ${mode === 'requeue' || !finished ? 'checked' : ''}> ${t('Gleich neu einreihen (oben in der Warteschlange, gleiche Farbzuordnung)')}</label>`}
    <div class="form-error" hidden></div>
    <div class="dlg-actions"><button class="b" type="button" data-close>${t('Abbrechen')}</button><button class="b b-go" value="ok">${t('Speichern')}</button></div></form>`);
  $('form', d).addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = { reason: fd.get('reason') || '', note: fd.get('note') || '' };
    try {
      if (fd.get('requeue')) {
        await api(`history/${h.id}/requeue`, { method: 'POST', body });
        toast(t('Neu eingereiht'));
      } else {
        await api(`history/${h.id}/fail`, { method: 'POST', body });
        toast(t('Gespeichert'));
      }
      d.close();
      reload('history', 'queue', 'orders', 'labels', 'summary');
    } catch (err) {
      formError(d, err.message);
    }
  });
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-hfail]');
  if (!b) return;
  const h = (S.history || []).find((x) => x.id === b.dataset.id);
  if (!h) return;
  const act = b.dataset.hfail;
  if (act === 'reason' || act === 'mark') return failDialog(h, { mode: act });
  if (act === 'requeue') await run(() => api(`history/${h.id}/requeue`, { method: 'POST', body: {} }), t('Neu eingereiht'));
  if (act === 'dismiss') await run(() => api(`history/${h.id}/dismiss`, { method: 'POST' }));
  if (act === 'unmark') await run(() => api(`history/${h.id}/unfail`, { method: 'POST' }), t('Wieder als erfolgreich gewertet'));
  reload('history', 'queue', 'orders', 'labels', 'summary');
});

// ---------------------------------------------------------------- Hängende Einträge („druckt“, Drucker längst bereit)

async function resolveItem(id, result) {
  const r = await run(() => api(`queue/${id}/resolve`, { method: 'POST', body: { result } }), result === 'finished' ? t('Als fertig abgeschlossen') : t('Als abgebrochen abgeschlossen'));
  if (r) reload('queue', 'history', 'orders', 'summary', 'filament', 'labels');
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-qresolve]');
  if (!b) return;
  const id = b.dataset.id;
  if (b.dataset.qresolve !== 'ask') return resolveItem(id, b.dataset.qresolve);
  const q = S.queue.find((x) => x.id === id);
  const d = openDialog(`<div class="dlg"><h2>${t('Eintrag hängt?')}</h2>
    <p style="margin:0">${t('Ist „{f}“ am Drucker schon beendet, aber PrintDock zeigt ihn noch als laufend? Dann hier sagen, wie er ausging – Auftrag, Verlauf und Filament werden nachgetragen.', { f: esc(q?.file?.name || '') })}</p>
    <p class="meta" style="margin:0">${t('Druckt der Drucker noch, wird das abgelehnt.')}</p>
    <div class="dlg-actions"><button class="b" data-close>${t('Abbrechen')}</button><button class="b" data-r="cancelled">${t('Abgebrochen')}</button><button class="b b-done" data-r="finished">${ICON.check}${t('War fertig')}</button></div></div>`);
  d.addEventListener('click', (ev) => {
    const r = ev.target.closest('[data-r]');
    if (!r) return;
    d.close();
    resolveItem(id, r.dataset.r);
  });
});
