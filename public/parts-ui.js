'use strict';
/* PrintDock – Teile: ein Modell mit geslicten Varianten je Drucker.
   Warteschlange und Aufträge können ein Teil einplanen – gedruckt wird die Variante für den freien Drucker. */

// Menü: Dateien → Teile (vorne) und Dateien
{
  const g = NAV_ALL.find((x) => x.g === 'files');
  g.v.unshift(['parts', 'Teile', 'files']);
}
S.ptSearch = '';

const normModel = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const printerModelOf = (p) => p.settings?.model || p.status?.model || '';
/** Drucker, zu denen eine Datei nach ihrem Druckermodell passt */
function printersForModel(model) {
  const a = normModel(model);
  if (!a) return [];
  return S.printers.filter((p) => {
    const b = normModel(printerModelOf(p));
    return b && (a.includes(b) || b.includes(a));
  }).map((p) => p.id);
}
const partById = (id) => (S.parts || []).find((p) => p.id === id);

function vParts() {
  const q = S.ptSearch.trim().toLowerCase();
  const list = (S.parts || []).filter((p) => !q || p.name.toLowerCase().includes(q) || p.variants.some((v) => v.name.toLowerCase().includes(q)));
  const cards = list.map((p) => {
    const cover = p.cover.map((c) => (typeof rsCoverHTML === 'function' && rsCoverHTML(p, c)) || `<span class="pt-cov ${c.fileId ? 'ok' : ''}" title="${esc(c.fileId ? t('Variante vorhanden') : t('Keine Variante für diesen Drucker'))}">${c.fileId ? '✓' : '–'} ${esc(c.name)}</span>`).join('');
    const vars = p.variants.map((v) => {
      const who = v.targets.length ? t('nur {p}', { p: v.targets.map((id) => esc(printerById(id)?.name || '?')).join(', ') }) : v.meta.printerModel ? t('für {m}', { m: esc(v.meta.printerModel) }) : t('Drucker unbekannt');
      return `<div class="pt-var"><div class="pt-vt"><span class="pt-vn" title="${esc(v.name)}">${esc(v.name)}</span><span class="meta">${who}${v.meta.estimatedSec ? ` · ${fmtDur(v.meta.estimatedSec)}` : ''}${v.meta.filamentG ? ` · ${fnum(v.meta.filamentG, 0)} g` : ''}${v.printable ? '' : ` · ${t('nicht gesliced')}`}</span></div>
        <button class="x" data-pt="targets" data-id="${v.id}" data-part="${p.id}" title="${esc(t('Drucker dieser Variante'))}">${ICON.gear}</button><button class="x" data-pt="unlink" data-id="${v.id}" title="${esc(t('Aus dem Teil lösen'))}">✕</button></div>`;
    }).join('');
    return `<article class="card part">
      <div class="pt-top"><div class="pic">${p.thumbFile ? `<img src="api/files/${esc(p.thumbFile)}/thumb" alt="" loading="lazy">` : '<span>3D</span>'}</div>
        <div style="min-width:0"><h3>${esc(p.name)}</h3><div class="meta">${p.variants.length === 1 ? t('1 Variante') : t('{n} Varianten', { n: p.variants.length })}</div></div></div>
      <div class="pt-covs">${cover}</div>
      <div class="pt-vars">${vars || `<div class="meta">${t('Noch keine Datei – Variante zuordnen oder hochladen.')}</div>`}</div>
      <div class="btns">
        ${p.printable && on('queue') ? `<button class="b b-sm b-go" data-act="qAdd" data-part="${p.id}">${ICON.plus}${t('Einplanen')}</button>` : ''}
        <button class="b b-sm" data-pt="addVar" data-part="${p.id}">${t('Variante …')}</button>
        <button class="b b-sm" data-pt="rename" data-part="${p.id}">${t('Umbenennen')}</button>
        <button class="x del" data-pt="del" data-part="${p.id}" title="${esc(t('Teil löschen (Dateien bleiben)'))}">${ICON.trash}</button>
      </div></article>`;
  }).join('');
  return `<div class="bar-row"><h2>${t('Teile')}</h2><input class="in" type="search" data-ptsearch value="${esc(S.ptSearch)}" placeholder="${esc(t('Suchen …'))}" style="max-width:16rem">
      <span style="flex:1"></span><button class="b b-sm" data-pt="new">${ICON.plus}${t('Neues Teil')}</button>
      <label class="b b-sm b-go" style="cursor:pointer">${ICON.upload}${t('Hochladen')}<input type="file" multiple hidden data-upload accept=".gcode,.3mf,.stl,.step,.stp,.obj"></label></div>
    <p class="meta" style="margin-top:0">${t('Ein Teil ist ein Modell mit einer geslicten Datei je Drucker(-typ). Eingeplant wird das Teil – gedruckt wird auf dem freien Drucker, für den es eine Variante gibt.')}</p>
    <div class="drop" data-drop>${t('Dateien hierher ziehen – danach fragt PrintDock, zu welchem Teil und welchen Druckern sie gehören.')}</div>
    ${list.length ? `<div class="cards">${cards}</div>` : `<div class="list"><div class="empty"><h3>${t('Keine Teile')}</h3><p>${t('Datei hochladen oder aus dem Slicer senden – PrintDock legt das Teil an.')}</p></div></div>`}`;
}
VIEW_FN.parts = vParts;

/** Drucker einer Variante: feste Drucker oder automatisch nach Druckermodell */
function variantTargetsDialog(fileId, partId) {
  const f = fileById(fileId);
  if (!f) return;
  const auto = printersForModel(f.meta?.printerModel);
  const cur = f.targets?.length ? f.targets : auto;
  const d = openDialog(`<form class="dlg" method="dialog"><h2>${t('Drucker für {f}', { f: esc(f.name) })}</h2>
    <p class="meta" style="margin:0">${f.meta?.printerModel ? t('In der Datei steht: {m}', { m: esc(f.meta.printerModel) }) : t('Die Datei nennt kein Druckermodell.')}</p>
    <div class="pt-checks">${S.printers.map((p) => `<label class="check"><input type="checkbox" name="pr" value="${p.id}" ${cur.includes(p.id) ? 'checked' : ''}> ${esc(p.name)} <span class="meta">${esc(printerModelOf(p))}</span></label>`).join('')}</div>
    <p class="form-error" hidden></p>
    <div class="dlg-actions"><button class="b left" type="button" data-auto>${t('Automatisch (nach Modell)')}</button><button class="b" type="button" data-close>${t('Abbrechen')}</button><button class="b b-go">${t('Speichern')}</button></div></form>`);
  const form = $('form', d);
  const save = async (targets) => {
    try {
      await api(`files/${fileId}/assign`, { method: 'POST', body: { partId, targets } });
      d.close();
      reload('files', 'queue');
    } catch (err) {
      formError(d, err.message);
    }
  };
  $('[data-auto]', d).addEventListener('click', () => save([]));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const sel = $$('[name=pr]:checked', d).map((i) => i.value);
    const same = sel.length === auto.length && sel.every((x) => auto.includes(x));
    save(same ? [] : sel);
  });
}

/** Vorhandene Datei einem Teil als Variante zuordnen */
function addVariantDialog(partId) {
  const p = partById(partId);
  const opts = S.files.filter((f) => f.partId !== partId).map((f) => `<option value="${f.id}">${esc(f.name)}${f.meta?.printerModel ? ` (${esc(f.meta.printerModel)})` : ''}${f.partId ? ` – ${t('jetzt bei {p}', { p: esc(partById(f.partId)?.name || '?') })}` : ''}</option>`).join('');
  const d = openDialog(`<form class="dlg" method="dialog"><h2>${t('Variante für {p}', { p: esc(p.name) })}</h2>
    ${opts ? `<label>${t('Vorhandene Datei')}<select name="file">${opts}</select></label>` : ''}
    <label class="b b-sm" style="cursor:pointer;align-self:flex-start">${ICON.upload}${t('Neue Datei hochladen …')}<input type="file" multiple hidden data-ptupload accept=".gcode,.3mf,.stl,.step,.stp,.obj"></label>
    <p class="form-error" hidden></p>
    <div class="dlg-actions"><button class="b" type="button" data-close>${t('Abbrechen')}</button>${opts ? `<button class="b b-go">${t('Zuordnen')}</button>` : ''}</div></form>`);
  const form = $('form', d);
  $('[data-ptupload]', d).addEventListener('change', (e) => {
    d.close();
    uploadFiles(e.target.files, { partId });
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api(`files/${form.file.value}/assign`, { method: 'POST', body: { partId } });
      d.close();
      reload('files');
    } catch (err) {
      formError(d, err.message);
    }
  });
}

/**
 * Nach dem Hochladen: zu welchem Teil gehört die Datei, für welche Drucker ist sie, gleich einplanen?
 * entries: Antworten des Uploads (Dateieinträge)
 */
async function uploadAssignDialog(entries, presetPartId = null) {
  [S.files, S.parts] = await Promise.all([api('files'), api('parts')]);
  const fresh = entries.map((e) => fileById(e.id) || e);
  // Vorschlag: vorhandenes Teil, dessen Name vorne im Dateinamen steht (z. B. „Kabelclip“ für „Kabelclip_X2D.3mf“)
  const nk = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const suggest = (f) => {
    const own = partById(f.partId);
    const stemN = nk(String(f.name).replace(/\.gcode\.3mf$|\.3mf$|\.gcode$|\.stl$|\.step$|\.stp$|\.obj$/i, ''));
    const other = (S.parts || []).filter((p) => p.id !== f.partId && p.variants.length && nk(p.name).length >= 4 && stemN.startsWith(nk(p.name))).sort((a, b) => nk(b.name).length - nk(a.name).length)[0];
    return other || own;
  };
  const names = [...new Set((S.parts || []).map((p) => p.name))];
  const rows = fresh.map((f, i) => {
    const auto = printersForModel(f.meta?.printerModel);
    const part = partById(presetPartId) || suggest(f);
    return `<div class="pt-up" data-i="${i}">
      <div class="pt-up-h">${f.thumb ? `<img src="api/files/${esc(f.id)}/thumb" alt="">` : `<span class="thumb ph">${esc((f.ext || '').toUpperCase())}</span>`}<div style="min-width:0"><b>${esc(f.name)}</b><div class="meta">${f.meta?.printerModel ? t('geslict für {m}', { m: esc(f.meta.printerModel) }) : f.printable ? t('Druckermodell unbekannt') : t('Modell – noch nicht gesliced')}${f.meta?.estimatedSec ? ` · ${fmtDur(f.meta.estimatedSec)}` : ''}</div></div></div>
      <div class="two"><label>${t('Teil')}<input name="part" list="pt-names" value="${esc(part?.name || '')}" required></label>
        ${f.printable && on('queue') ? `<label>${t('Gleich einplanen (Drucke)')}<input name="qty" type="number" min="0" max="200" value="0"></label>` : '<span></span>'}</div>
      ${f.printable ? `<div class="pt-checks"><span class="meta">${t('Drucker:')}</span>${S.printers.map((p) => `<label class="check"><input type="checkbox" name="pr" value="${p.id}" ${(f.targets?.length ? f.targets : auto).includes(p.id) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('')}</div>` : ''}
    </div>`;
  }).join('');
  const d = openDialog(`<form class="dlg" method="dialog" style="max-width:720px"><h2>${fresh.length === 1 ? t('Datei zuordnen') : t('{n} Dateien zuordnen', { n: fresh.length })}</h2>
    <p class="meta" style="margin:0">${t('Gleicher Teil-Name = weitere Variante desselben Teils (z. B. für einen anderen Drucker). Vorausgewählt sind die Drucker, zu denen das Druckermodell in der Datei passt.')}</p>
    <datalist id="pt-names">${names.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
    ${rows}
    <p class="form-error" hidden></p>
    <div class="dlg-actions"><button class="b" type="button" data-close>${t('Später')}</button><button class="b b-go">${t('Übernehmen')}</button></div></form>`);
  const form = $('form', d);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      let queued = 0;
      for (const row of $$('.pt-up', d)) {
        const f = fresh[Number(row.dataset.i)];
        const auto = printersForModel(f.meta?.printerModel);
        const sel = $$('[name=pr]:checked', row).map((x) => x.value);
        const targets = f.printable ? (sel.length === auto.length && sel.every((x) => auto.includes(x)) ? [] : sel) : undefined;
        const r = await api(`files/${f.id}/assign`, { method: 'POST', body: { partName: $('[name=part]', row).value, targets } });
        const qty = Number($('[name=qty]', row)?.value || 0);
        if (qty > 0 && r.part) {
          await api('queue', { method: 'POST', body: { partId: r.part.id, count: qty } });
          queued += qty;
        }
      }
      d.close();
      toast(queued ? t('Zugeordnet, {n} Drucke eingeplant', { n: queued }) : t('Zugeordnet'));
      reload('files', 'queue', 'summary');
    } catch (err) {
      formError(d, err.message);
    }
  });
}

document.addEventListener('input', (e) => {
  if (!e.target.matches('[data-ptsearch]')) return;
  S.ptSearch = e.target.value;
  const pos = e.target.selectionStart;
  render();
  const el = $('[data-ptsearch]');
  if (el) { el.focus(); el.setSelectionRange(pos, pos); }
});

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-pt]');
  if (!b) return;
  const act = b.dataset.pt;
  const p = partById(b.dataset.part);
  if (act === 'targets') return variantTargetsDialog(b.dataset.id, b.dataset.part);
  if (act === 'addVar') return addVariantDialog(b.dataset.part);
  if (act === 'unlink') {
    await run(() => api(`files/${b.dataset.id}/assign`, { method: 'POST', body: { partId: null } }), t('Aus dem Teil gelöst'));
    return reload('files');
  }
  if (act === 'new' || act === 'rename') {
    return textDialog({
      title: act === 'new' ? t('Neues Teil') : t('Teil umbenennen'), label: t('Name'), value: p?.name || '',
      onSubmit: async (name) => {
        await api(act === 'new' ? 'parts' : `parts/${p.id}`, { method: act === 'new' ? 'POST' : 'PUT', body: { name } });
        reload('files');
      },
    });
  }
  if (act === 'del') {
    if (!(await confirmBox(t('Teil löschen'), t('„{p}“ löschen? Die Dateien bleiben in der Bibliothek.', { p: p.name }), t('Löschen'), 'b-fault'))) return;
    await run(() => api(`parts/${p.id}`, { method: 'DELETE' }), t('Teil gelöscht'));
    reload('files');
  }
});

/** Kleiner Dialog mit einem Textfeld */
function textDialog({ title, label, value = '', onSubmit }) {
  const d = openDialog(`<form class="dlg" method="dialog"><h2>${esc(title)}</h2>
    <label>${esc(label)}<input name="val" required value="${esc(value)}" autofocus></label>
    <p class="form-error" hidden></p>
    <div class="dlg-actions"><button class="b" type="button" data-close>${t('Abbrechen')}</button><button class="b b-go">${t('Speichern')}</button></div></form>`);
  const form = $('form', d);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await onSubmit(form.val.value.trim());
      d.close();
    } catch (err) {
      formError(d, err.message);
    }
  });
}
