'use strict';
/* PrintDock – Filament: Spulen, Belegung der Plätze, Verbrauch.
   Ergänzt app.js (nutzt dessen Hilfsfunktionen und Zustand S). */

const fil = () => S.fil || { spools: [], printers: [], usage: [], stats30: [], settings: { lowGrams: 100 }, materials: [] };
const spoolById = (id) => fil().spools.find((s) => s.id === id);
S.spFilter = 'aktiv';
S.spMaterial = '';

function spoolPlace(s) {
  if (!s.slot) return s.location ? `${t('Lager')}: ${esc(s.location)}` : t('Lager');
  const p = fil().printers.find((x) => x.id === s.slot.printerId);
  const slot = p?.slots.find((x) => x.key === s.slot.key);
  return `${esc(p?.name || t('Drucker'))} · ${esc(slot?.label || s.slot.key)}`;
}

/** Spulen-Symbol: Ring zeigt die Restmenge. */
function spoolRing(color, pct, size = 54) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct ?? 0));
  return `<svg width="${size}" height="${size}" viewBox="0 0 54 54" aria-hidden="true" style="flex:none">
    <circle cx="27" cy="27" r="${r}" fill="none" stroke="var(--line)" stroke-width="9" opacity=".55"/>
    <circle cx="27" cy="27" r="${r}" fill="none" stroke="${esc(color || '#888')}" stroke-width="9" stroke-dasharray="${(c * p) / 100} ${c}" transform="rotate(-90 27 27)"/>
    <circle cx="27" cy="27" r="${r + 4.5}" fill="none" stroke="var(--line)" stroke-width="1"/>
    <circle cx="27" cy="27" r="7" fill="var(--panel)" stroke="var(--line)"/></svg>`;
}

const pctOf = (s) => (s.netWeight ? Math.round((s.remaining / s.netWeight) * 100) : 0);

// ================================================================ Druckerkachel: Plätze

function slotChipsHTML(p) {
  const fp = fil().printers.find((x) => x.id === p.id);
  if (!fp || !fp.slots.length) return '';
  const chips = fp.slots.map((sl) => {
    const sp = sl.spoolId ? spoolById(sl.spoolId) : null;
    const color = sp?.color || sl.color || 'transparent';
    const empty = !sp && !sl.material;
    const txt = sp ? `${esc(sp.material)} <b class="num">${Math.round(sp.remaining)} g</b>` : sl.material ? `${esc(sl.material)} <span class="meta">${t('nicht zugeordnet')}</span>` : `<span class="meta">${t('leer')}</span>`;
    const cls = [sp?.low ? 'low' : '', sl.mismatch ? 'bad' : '', fp.activeSlot === sl.key ? 'act' : '', empty ? 'empty' : ''].join(' ');
    return `<button class="slotchip ${cls}" data-fact="pickSpool" data-printer="${p.id}" data-key="${esc(sl.key)}" title="${esc(t(sl.label))}${sl.mismatch ? ` – ${t('Material passt nicht zur zugeordneten Spule')}` : ''}">
      <span class="swatch" style="background:${esc(color)}"></span><span class="sl">${esc(t(sl.label))}</span>${txt}</button>`;
  }).join('');
  return `<div class="slots">${chips}</div>`;
}

/** Hinweise im Start-Dialog. */
function filamentCheckHTML(list) {
  if (!list?.length) return '';
  const rows = list.map((c) => {
    let state = `<span class="vl ok">${t('passt')}</span>`;
    if (!c.spool) state = `<span class="vl warn">${t('keine Spule zugeordnet')}</span>`;
    else if (c.enough === false) state = `<span class="vl bad">${t('zu wenig: {g} g da', { g: Math.round(c.spool.remaining) })}</span>`;
    else if (c.materialOk === false) state = `<span class="vl warn">${t('Material: {a} statt {b}', { a: esc(c.spool.material), b: esc(c.material) })}</span>`;
    return `<div class="chk"><span class="swatch" style="background:${esc(c.spool?.color || 'transparent')}"></span>
      <span>${esc(t(c.slot))}${c.spool ? ` · ${esc(c.spool.nr)}` : ''}</span><span class="num">${c.need} g${c.material ? ` ${esc(c.material)}` : ''}</span>${state}</div>`;
  }).join('');
  return `<div class="chks">${rows}</div>`;
}

// ================================================================ Filament-Zuordnung beim Druckstart

const hexRgb = (h) => (/^#[0-9a-f]{6}$/i.test(h || '') ? [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) : null);
function colorDist(a, b) {
  const x = hexRgb(a);
  const y = hexRgb(b);
  return x && y ? Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) : null;
}
const matKey = (m) => String(m || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);

/** Zustand einer Zeile: passt / andere Farbe / anderes Material / zu wenig / leer */
function fmapState(f, sl) {
  if (!sl) return `<span class="vl warn">${t('kein Filament gewählt')}</span>`;
  if (sl.spool && f.grams && sl.spool.remaining < f.grams) return `<span class="vl bad">${t('zu wenig: {g} g da', { g: Math.round(sl.spool.remaining) })}</span>`;
  if (f.type && sl.material && matKey(f.type) !== matKey(sl.material)) return `<span class="vl warn">${t('Material: {a} statt {b}', { a: esc(sl.material), b: esc(f.type) })}</span>`;
  const d = colorDist(f.color, sl.color);
  if (d != null && d > 70) return `<span class="vl warn">${t('andere Farbe')}</span>`;
  return `<span class="vl ok">${t('passt')}</span>`;
}

function filamentMapHTML(map) {
  if (!map?.filaments?.length || !map.slots?.length) return '';
  const slotLabel = (sl) => `${t(sl.label)} – ${sl.material || '?'}${sl.spool ? ` · ${sl.spool.nr}${sl.spool.colorName ? ` ${sl.spool.colorName}` : ''} (${Math.round(sl.spool.remaining)} g)` : ''}`;
  const rows = map.filaments.map((f, i) => {
    const key = map.suggested[i];
    const sl = map.slots.find((x) => x.key === key);
    const target = map.mappable
      ? `<select class="in" data-fm="${i}">${map.slots.map((x) => `<option value="${esc(x.key)}" ${x.key === key ? 'selected' : ''}>${esc(slotLabel(x))}</option>`).join('')}</select>`
      : `<span class="meta">${sl ? esc(slotLabel(sl)) : t('kein Filament')}</span>`;
    return `<div class="fm-row" data-i="${i}">
      <span class="swatch" style="background:${esc(f.color || 'transparent')}" title="${esc(t('Farbe im Slice'))}"></span>
      <span class="fm-need"><b>${esc(f.type || t('Filament {n}', { n: i + 1 }))}</b>${f.grams ? ` <span class="meta">${Math.round(f.grams)} g</span>` : ''}</span>
      <span class="fm-arrow">→</span>
      <span class="swatch" data-fm-sw style="background:${esc(sl?.color || 'transparent')}" title="${esc(t('Farbe im Drucker'))}"></span>
      <span class="fm-target">${target}</span>
      <span class="fm-state" data-fm-st>${fmapState(f, sl)}</span></div>`;
  }).join('');
  return `<div class="fmap"><div class="meta" style="margin-bottom:6px">${map.mappable ? t('Filament – vorgewählt nach Farbe und Material aus dem Slice, bei Bedarf ändern:') : t('Filament laut Slice – der Drucker nimmt die Werkzeuge so, wie im Slicer zugeordnet:')}</div>${rows}</div>`;
}

/** Nach Änderung einer Auswahl Farbe und Zustand der Zeile aktualisieren. */
function filamentMapUpdate(box, map, sel) {
  const i = Number(sel.dataset.fm);
  const row = sel.closest('.fm-row');
  const sl = map.slots.find((x) => x.key === sel.value);
  map.suggested[i] = sel.value;
  $('[data-fm-sw]', row).style.background = sl?.color || 'transparent';
  $('[data-fm-st]', row).innerHTML = fmapState(map.filaments[i], sl);
}

// ================================================================ Spulen

function vSpools() {
  const F = fil();
  const low = F.settings.lowGrams;
  const mats = [...new Set(F.spools.filter((s) => !s.archived).map((s) => s.material))].sort();
  let list = F.spools.filter((s) => {
    if (S.spFilter === 'archiv') return s.archived;
    if (s.archived) return false;
    if (S.spFilter === 'drucker') return Boolean(s.slot);
    if (S.spFilter === 'lager') return !s.slot;
    if (S.spFilter === 'knapp') return s.low;
    return true;
  });
  if (S.spMaterial) list = list.filter((s) => s.material === S.spMaterial);
  list.sort((a, b) => Number(Boolean(b.slot)) - Number(Boolean(a.slot)) || a.material.localeCompare(b.material) || a.remaining - b.remaining);
  const chips = [['aktiv', 'Alle'], ['drucker', 'Im Drucker'], ['lager', 'Im Lager'], ['knapp', 'Knapp'], ['archiv', 'Aufgebraucht']]
    .map(([k, l]) => `<button class="chip" data-fact="spFilter" data-k="${k}" aria-pressed="${S.spFilter === k}">${t(l)}</button>`).join('');
  const active = F.spools.filter((s) => !s.archived);
  const cards = list.map((s) => `<article class="card spool ${s.low ? 'is-low' : ''}">
      <div class="sp-top">${spoolRing(s.color, pctOf(s))}<div style="min-width:0">
        <h3 class="sp-open" data-fact="sheet" data-id="${s.id}" title="${esc(t('Spule öffnen'))}"><span class="meta num">${esc(s.nr)}</span> ${esc(s.material)}${s.colorName ? ` · ${esc(t(s.colorName))}` : ''}</h3>
        <div class="meta">${esc(s.brand || t('Hersteller unbekannt'))}${s.diameter !== 1.75 ? ` · ${s.diameter} mm` : ''}${s.rfid ? ' · RFID' : ''}</div></div></div>
      <div class="sp-amt"><b class="num">${fnum(s.remaining, 0)} g</b><span class="meta">${t('von {g} g', { g: fnum(s.netWeight, 0) })}</span>${s.low && !s.archived ? `<span class="pill pause">${t('knapp')}</span>` : ''}</div>
      <div class="bar ${s.remaining <= low ? 'warn' : ''}"><i style="width:${pctOf(s)}%"></i></div>
      <div class="facts" style="margin-top:8px"><span>${spoolPlace(s)}</span>${s.pricePerKg ? `<span><b>${money(s.pricePerKg)}</b>/kg</span>` : ''}${s.lastUsedAt ? `<span>${t('zuletzt {t}', { t: tfmt(s.lastUsedAt) })}</span>` : ''}${s.driedAt ? `<span title="${esc(tfmt(s.driedAt))}">💧 ${t('getrocknet vor {d}', { d: agoDays(s.driedAt) })}</span>` : ''}${s.spoolmanId ? `<span class="pill">Spoolman #${s.spoolmanId}</span>` : ''}</div>
      <div class="btns">
        ${s.archived ? '' : s.slot ? `<button class="b b-sm" data-fact="unload" data-id="${s.id}">${t('Entnehmen')}</button>` : `<button class="b b-sm b-go" data-fact="load" data-id="${s.id}">${t('Einlegen')}</button>`}
        ${s.archived ? '' : `<button class="b b-sm" data-fact="weigh" data-id="${s.id}" title="${t('Restmenge durch Wiegen bestimmen')}">${t('Wiegen')}</button><button class="b b-sm" data-fact="book" data-id="${s.id}" title="${t('Verbrauch von Hand abbuchen')}">− g</button>`}
        ${s.archived ? '' : `<button class="b b-sm" data-fact="dried" data-id="${s.id}" title="${esc(t('Heute getrocknet'))}">${t('Getrocknet')}</button>`}
        <button class="x" data-fact="editSpool" data-id="${s.id}" title="${t('Bearbeiten')}" aria-label="${esc(t('{n} bearbeiten', { n: s.nr }))}">${ICON.edit}</button>
      </div></article>`).join('');
  return `${stripHTML()}<div class="bar-row"><h2>${t('Spulen')}</h2><div class="chips">${chips}</div>
      ${mats.length > 1 ? `<select class="in" data-fact-change="spMaterial" aria-label="${t('Material')}"><option value="">${t('Alle Materialien')}</option>${mats.map((m) => `<option ${m === S.spMaterial ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>` : ''}
      <button class="b b-sm" data-fact="labels">${t('Etiketten')}</button><button class="b b-sm b-go" data-fact="editSpool">${ICON.plus}${t('Neue Spule')}</button></div>
    ${pendingTagHTML(F)}${armedHTML(F)}
    <div class="strip" style="margin-top:-4px"><div><b class="num">${active.length}</b><span>${t('Spulen')}</span></div>
      <div><b class="num">${fnum(active.reduce((a, s) => a + s.remaining, 0) / 1000, 1)} kg</b><span>${t('auf Lager')}</span></div>
      <div><b class="num">${active.filter((s) => s.slot).length}</b><span>${t('im Drucker')}</span></div>
      <div class="${active.some((s) => s.low) ? 'warn' : ''}"><b class="num">${active.filter((s) => s.low).length}</b><span>${t('unter {g} g', { g: low })}</span></div></div>
    ${list.length ? `<div class="cards">${cards}</div>` : `<div class="list"><div class="empty"><h3>${F.spools.length ? t('Keine Spulen in dieser Auswahl') : t('Noch keine Spulen angelegt')}</h3>
      <p>${t('Spulen mit Material, Farbe und Gewicht anlegen, dann unter „Belegung“ in die Drucker legen. Nach jedem Druck bucht PrintDock den Verbrauch ab.')}</p>
      <button class="b b-go" data-fact="editSpool">${ICON.plus}${t('Neue Spule')}</button></div></div>`}`;
}

/** „3 Tagen“, „heute“ … */
function agoDays(iso) {
  const d = Math.floor((Date.now() - Date.parse(iso)) / 864e5);
  return d <= 0 ? t('weniger als 1 Tag') : d === 1 ? t('1 Tag') : t('{n} Tagen', { n: d });
}

function spoolDialog(edit = null, pre = null, onCreated = null) {
  const F = fil();
  const s = edit;
  const v = edit || pre; // Vorbelegung (z. B. aus einem gelesenen Tag)
  const d = openDialog(`<form class="dlg" method="dialog"><h2>${s ? t('Spule {nr}', { nr: esc(s.nr) }) : t('Neue Spule')}</h2>
    <div class="two"><label>${t('Material')}<input name="material" list="mats" required value="${esc(v?.material || '')}" placeholder="${esc(t('z. B. PLA'))}"></label>
      <label>${t('Hersteller')}<input name="brand" value="${esc(v?.brand || '')}" placeholder="${esc(t('z. B. Bambu Lab'))}"></label></div>
    <datalist id="mats">${F.materials.map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
    <div class="two"><label>${t('Farbe')}<input name="colorName" value="${esc(v?.colorName || '')}" placeholder="${esc(t('z. B. Schwarz'))}"></label>
      <label>${t('Farbton')}<input name="color" type="color" value="${esc(v?.color || '#888888')}" style="padding:2px;height:42px"></label></div>
    <div class="two"><label>${t('Nettogewicht (g)')}<input name="netWeight" type="number" min="1" value="${esc(v?.netWeight || 1000)}"></label>
      <label>${s ? t('Restmenge (g)') : t('Restmenge (g, leer = voll)')}<input name="remaining" type="number" min="0" step="0.1" value="${s ? esc(s.remaining) : ''}"></label></div>
    <div class="two"><label>${t('Leerspule (g)')}<input name="tare" type="number" min="0" value="${esc(v?.tare || '')}" placeholder="${esc(t('fürs Wiegen, z. B. 250'))}"></label>
      <label>${t('Preis je Spule (€)')}<input name="price" type="number" min="0" step="0.01" value="${s?.price ?? ''}"></label></div>
    <div class="two"><label>${t('Lagerort')}<input name="location" value="${esc(v?.location || '')}" placeholder="${esc(t('z. B. Trockenbox 2'))}"></label>
      <label>${t('Durchmesser')}<select name="diameter"><option value="1.75" ${v?.diameter !== 2.85 ? 'selected' : ''}>${fnum(1.75, 2)} mm</option><option value="2.85" ${v?.diameter === 2.85 ? 'selected' : ''}>${fnum(2.85, 2)} mm</option></select></label></div>
    ${s ? `<label>${t('RFID-Kennung')}<input name="rfid" value="${esc(s.rfid || '')}" placeholder="${esc(t('wird bei Bambu-Spulen automatisch erkannt'))}"></label>` : `<label>${t('Anzahl gleicher Spulen')}<input name="count" type="number" min="1" max="50" value="1"></label>`}
    <label>${t('Notiz')}<input name="note" value="${esc(v?.note || '')}"></label>
    ${s ? `<label class="check"><input type="checkbox" name="archived" ${s.archived ? 'checked' : ''}> ${t('Aufgebraucht / ausgemustert')}</label>` : ''}
    <p class="form-error" hidden></p>
    <div class="dlg-actions">${s ? `<button class="b b-fault left" type="button" data-del>${t('Löschen')}</button>` : ''}<button class="b" type="button" data-close>${t('Abbrechen')}</button><button class="b b-done">${t('Speichern')}</button></div></form>`);
  const form = $('form', d);
  $('[data-del]', d)?.addEventListener('click', async () => {
    if (!(await confirmBox(t('Spule löschen'), t('{nr} endgültig löschen? Für leere Spulen besser „Aufgebraucht“ ankreuzen – dann bleibt der Verbrauch nachvollziehbar.', { nr: s.nr }), t('Löschen'), 'b-fault'))) return;
    await run(() => api(`spools/${s.id}`, { method: 'DELETE' }), t('Spule gelöscht'));
    d.close();
    reload('filament', 'summary');
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(['material', 'brand', 'colorName', 'color', 'netWeight', 'remaining', 'tare', 'price', 'location', 'diameter', 'note', 'rfid', 'count']
      .filter((k) => form[k]).map((k) => [k, form[k].value]));
    if (form.archived) body.archived = form.archived.checked;
    try {
      const r = await api(s ? `spools/${s.id}` : 'spools', { method: s ? 'PUT' : 'POST', body });
      if (!s && onCreated) await onCreated(Array.isArray(r) ? r[0] : r);
      d.close();
      toast(s ? t('Gespeichert') : t('Spule angelegt'));
      reload('filament', 'summary');
    } catch (err) {
      formError(d, err.message);
    }
  });
}

function numberDialog({ title, text, label, unit, okLabel, onSubmit, note = false }) {
  const d = openDialog(`<form class="dlg" method="dialog"><h2>${esc(title)}</h2><p style="margin:0">${text}</p>
    <label>${esc(label)}<input name="val" type="number" min="0" step="0.1" required autofocus placeholder="${esc(unit)}"></label>
    ${note ? `<label>${t('Notiz')}<input name="note" placeholder="${esc(t('optional, z. B. Fehldruck'))}"></label>` : ''}
    <p class="form-error" hidden></p>
    <div class="dlg-actions"><button class="b" type="button" data-close>${t('Abbrechen')}</button><button class="b b-done">${esc(okLabel)}</button></div></form>`);
  const form = $('form', d);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await onSubmit(form.val.value, form.note?.value);
      d.close();
    } catch (err) {
      formError(d, err.message);
    }
  });
}

/** Spule in einen Platz legen – zuerst Drucker/Platz wählen. */
function loadDialog(spool) {
  const F = fil();
  const opts = F.printers.flatMap((p) => p.slots.map((sl) => {
    const cur = sl.spoolId ? spoolById(sl.spoolId) : null;
    return `<option value="${esc(p.id)}|${esc(sl.key)}">${esc(p.name)} · ${esc(t(sl.label))}${cur ? ` (${t('belegt: {nr}', { nr: esc(cur.nr) })})` : sl.material ? ` (${t('meldet {m}', { m: esc(sl.material) })})` : ''}</option>`;
  })).join('');
  if (!opts) return toast(t('Erst einen Drucker anlegen'), true);
  const d = openDialog(`<form class="dlg" method="dialog"><h2>${t('{nr} einlegen', { nr: esc(spool.nr) })}</h2>
    <p style="margin:0">${esc(spool.material)} ${esc(t(spool.colorName || ''))} · ${fnum(spool.remaining, 0)} g</p>
    <label>${t('Drucker und Platz')}<select name="target">${opts}</select></label>
    <p class="hint" style="margin:0">${t('Eine Spule, die dort schon liegt, kommt zurück ins Lager.')}</p>
    <div class="dlg-actions"><button class="b" type="button" data-close>${t('Abbrechen')}</button><button class="b b-go">${t('Einlegen')}</button></div></form>`);
  $('form', d).addEventListener('submit', async (e) => {
    e.preventDefault();
    const [printerId, key] = $('form', d).target.value.split('|');
    await run(() => api('filament/assign', { method: 'POST', body: { printerId, key, spoolId: spool.id } }), t('Eingelegt'));
    d.close();
    reload('filament', 'summary');
  });
}

/** Platz antippen → Spule wählen (passende zuerst). */
function pickSpoolDialog(printerId, key) {
  const F = fil();
  const p = F.printers.find((x) => x.id === printerId);
  const sl = p?.slots.find((x) => x.key === key);
  if (!sl) return;
  const cur = sl.spoolId ? spoolById(sl.spoolId) : null;
  const norm = (x) => String(x || '').toUpperCase().replace(/[^A-Z]/g, '');
  const cands = F.spools.filter((s) => !s.archived && s.id !== cur?.id)
    .map((s) => ({ s, score: (sl.material && norm(s.material).startsWith(norm(sl.material).slice(0, 3)) ? 2 : 0) + (sl.color && s.color === sl.color ? 1 : 0) + (s.slot ? -3 : 0) }))
    .sort((a, b) => b.score - a.score || a.s.remaining - b.s.remaining);
  const d = openDialog(`<div class="dlg"><h2>${esc(p.name)} · ${esc(t(sl.label))}</h2>
    ${sl.material || sl.color ? `<p style="margin:0" class="meta">${t('Drucker meldet:')} <span class="swatch" style="background:${esc(sl.color || 'transparent')}"></span>${esc(sl.material || '–')}${sl.remainPct != null ? ` · ${sl.remainPct} %` : ''}${sl.uid ? ` · ${t('RFID-Spule')}` : ''}</p>` : ''}
    ${cur ? `<div class="card" style="display:flex;gap:12px;align-items:center">${spoolRing(cur.color, pctOf(cur), 44)}<div style="flex:1"><b>${esc(cur.nr)} ${esc(cur.material)} ${esc(t(cur.colorName || ''))}</b><div class="meta">${fnum(cur.remaining, 0)} g</div></div>
      <button class="b b-sm" data-fact="assign" data-printer="${esc(printerId)}" data-key="${esc(key)}" data-spool="">${t('Herausnehmen')}</button></div>` : `<p style="margin:0">${t('Keine Spule zugeordnet.')}</p>`}
    ${sl.material && !cur ? `<button class="b b-go" data-fact="fromSlot" data-printer="${esc(printerId)}" data-key="${esc(key)}">${ICON.plus}${sl.uid ? t('Diese RFID-Spule anlegen') : t('Spule aus Druckerangaben anlegen')}</button>` : ''}
    <div class="list pick-list">${cands.length ? cands.map(({ s }) => `<button class="pick" data-fact="assign" data-printer="${esc(printerId)}" data-key="${esc(key)}" data-spool="${s.id}">
        ${spoolRing(s.color, pctOf(s), 36)}<span style="flex:1;min-width:0"><b>${esc(s.nr)} ${esc(s.material)}</b> ${esc(t(s.colorName || ''))}<span class="meta" style="display:block">${esc(s.brand || '')} · ${s.slot ? spoolPlace(s) : esc(s.location || t('Lager'))}</span></span>
        <b class="num">${fnum(s.remaining, 0)} g</b></button>`).join('') : `<div class="empty" style="padding:16px">${t('Keine weiteren Spulen.')} <button class="b b-sm" data-fact="editSpoolHere" data-printer="${esc(printerId)}" data-key="${esc(key)}">${t('Neue Spule anlegen')}</button></div>`}</div>
    <div class="dlg-actions"><button class="b" data-close>${t('Schließen')}</button></div></div>`);
  d.dataset.pick = '1';
}

/**
 * Gemeldete Belegung ohne Spule → Spulen anlegen. Je Platz: anlegen, ignorieren oder später.
 * printerId = null: alle Drucker.
 */
function newSpoolsDialog(printerId = null) {
  const F = fil();
  const rows = F.printers.filter((p) => !printerId || p.id === printerId)
    .flatMap((p) => p.slots.filter((sl) => sl.unmatched).map((sl) => ({ p, sl })));
  if (!rows.length) return toast(t('Alle gemeldeten Spulen sind zugeordnet'));
  const d = openDialog(`<form class="dlg" method="dialog"><h2>${t('Neue Spulen anlegen')}</h2>
    <p style="margin:0">${t('Diese Plätze melden Filament, zu dem es im Lager keine passende Spule gibt. Angelegte Spulen werden gleich zugeordnet und nach jedem Druck abgebucht.')}</p>
    <div class="list ns-list">${rows.map(({ p, sl }, i) => `<div class="row ns-row" data-i="${i}">
      <span class="swatch big" style="background:${esc(sl.color || 'transparent')}"></span>
      <div class="c-main"><b>${esc(sl.material)}</b> ${esc(sl.brand && sl.brand !== sl.material ? sl.brand : sl.vendor || '')}<div class="meta">${esc(p.name)} · ${esc(t(sl.label))}${sl.remainPct != null ? ` · ${sl.remainPct} %` : ''}</div></div>
      <label class="fl">${t('Netto (g)')}<input class="in" type="number" min="1" name="net" value="${esc(sl.weight || 1000)}"></label>
      <label class="fl">${t('Rest (g)')}<input class="in" type="number" min="0" name="rest" placeholder="${esc(sl.remainPct != null ? Math.round(((sl.weight || 1000) * sl.remainPct) / 100) : t('voll'))}"></label>
      <select class="in" name="what"><option value="create">${t('Anlegen')}</option><option value="ignore">${t('Ignorieren')}</option><option value="later">${t('Später')}</option></select>
    </div>`).join('')}</div>
    <p class="hint" style="margin:0">${t('„Ignorieren“: für diesen Platz nicht mehr nachfragen, bis dort eine andere Spule liegt.')}</p>
    <p class="form-error" hidden></p>
    <div class="dlg-actions"><button class="b" type="button" data-close>${t('Abbrechen')}</button><button class="b b-go">${ICON.plus}${t('Übernehmen')}</button></div></form>`, { wide: true });
  $('form', d).addEventListener('submit', async (e) => {
    e.preventDefault();
    let created = 0;
    try {
      for (const el of $$('.ns-row', d)) {
        const { p, sl } = rows[Number(el.dataset.i)];
        const what = $('[name=what]', el).value;
        if (what === 'create') {
          await api('filament/from-slot', { method: 'POST', body: { printerId: p.id, key: sl.key, netWeight: $('[name=net]', el).value, remaining: $('[name=rest]', el).value } });
          created += 1;
        } else if (what === 'ignore') await api('filament/ignore', { method: 'POST', body: { printerId: p.id, key: sl.key } });
      }
      d.close();
      if (created) toast(created === 1 ? t('1 Spule angelegt') : t('{n} Spulen angelegt', { n: created }));
      reload('filament', 'summary');
    } catch (err) {
      formError(d, err.message);
    }
  });
}

/** Neue, nicht zugeordnete Spulen einmal je Sitzung von selbst anbieten. */
S.seenUnmatched = new Set();
function offerNewSpools() {
  if (!on('filament') || S.view !== 'board' || $('dialog[open]') || $('#overlay')) return;
  const fresh = fil().printers.flatMap((p) => p.slots.filter((x) => x.unmatched).map((x) => `${p.id}:${x.key}:${x.material}:${x.color}`)).filter((k) => !S.seenUnmatched.has(k));
  if (!fresh.length) return;
  fresh.forEach((k) => S.seenUnmatched.add(k));
  newSpoolsDialog(null);
}
setInterval(offerNewSpools, 4000);

// ================================================================ Belegung

function vSlots() {
  const F = fil();
  if (!F.printers.length) return `<div class="list"><div class="empty">${t('Erst einen Drucker anlegen.')}</div></div>`;
  const cards = F.printers.map((p) => {
    const boxes = p.slots.map((sl) => {
      const sp = sl.spoolId ? spoolById(sl.spoolId) : null;
      return `<button class="slotbox ${p.activeSlot === sl.key ? 'act' : ''} ${sl.mismatch ? 'bad' : ''} ${sl.unmatched ? 'new' : ''}" data-fact="pickSpool" data-printer="${p.id}" data-key="${esc(sl.key)}">
        <div class="sb-h"><b>${esc(t(sl.label))}</b>${p.activeSlot === sl.key ? `<span class="pill run">${t('aktiv')}</span>` : ''}</div>
        <div class="sb-m">${spoolRing(sp?.color || sl.color, sp ? pctOf(sp) : sl.remainPct ?? 0, 58)}
          <div style="min-width:0">${sp ? `<b>${esc(sp.nr)} ${esc(sp.material)}</b><div class="meta">${esc(t(sp.colorName || ''))} ${esc(sp.brand || '')}</div><div class="vl num">${fnum(sp.remaining, 0)} g</div>`
            : sl.material ? `<b>${esc(sl.material)}</b><div class="meta">${esc(sl.brand && sl.brand !== sl.material ? sl.brand : sl.vendor || '')}</div><div class="meta">${sl.unmatched ? t('noch keine Spule angelegt') : t('nicht zugeordnet – antippen')}</div>` : `<span class="meta">${t('leer')}</span>`}</div></div>
        ${sl.material && sl.live !== undefined ? `<div class="meta sb-live">${sl.live ? t('Drucker meldet') : t('Zuletzt gemeldet')}: ${esc(sl.material)}${sl.remainPct != null ? ` · ${sl.remainPct} %` : ''}${sl.uid ? ' · RFID' : ''}</div>` : ''}
        ${sl.mismatch ? `<div class="sb-warn">${t('Material passt nicht zur Spule')}</div>` : ''}
      </button>`;
    }).join('');
    return `<article class="card mcard"><div class="mhead"><h3>${esc(p.name)}</h3><span>${p.online ? t('online') : t('offline')}</span><span>${t('{n} Plätze', { n: p.slots.length })}</span></div>
      <div class="slotgrid">${boxes}</div></article>`;
  }).join('');
  const unmatched = F.printers.flatMap((p) => p.slots.filter((x) => x.unmatched));
  return `${stripHTML()}<div class="bar-row"><h2>${t('Belegung')}</h2><span class="meta">${t('Platz antippen = Spule einlegen oder wechseln')}</span></div>
    ${pendingTagHTML(F)}${armedHTML(F)}${humAlertHTML(F)}
    ${unmatched.length ? `<div class="newspool big"><span>${BI.spool}</span><div><b>${unmatched.length === 1 ? t('Neue Spule erkannt') : t('{n} neue Spulen erkannt', { n: unmatched.length })}</b><small>${t('Die Drucker melden Filament, zu dem es noch keine Spule im Lager gibt.')}</small></div><button class="b b-sm b-go" data-fact="newSpools">${t('Spulen anlegen')}</button></div>` : ''}
    <div style="display:grid;gap:14px">${cards}</div>
    <p class="meta">${t('Bambu-AMS meldet Material, Farbe und – bei Bambu-Spulen – RFID und Restmenge. RFID-Spulen ordnet PrintDock automatisch zu.')}
    ${t('Bei Snapmaker U1 und Anycubic mit ACE die Spulen hier von Hand zuordnen; die Plätze lassen sich beim Drucker benennen (z. B. „ACE 1, ACE 2, …“).')}</p>`;
}

// ================================================================ Spulen-Seite (QR/NFC), Etiketten, RFID

/** Link, den QR-Code und NFC-Tag enthalten: öffnet die Spule in PrintDock */
const spoolLink = (sp) => `${S.app?.directUrl || location.origin}/#spool=${encodeURIComponent(sp.nr)}`;

function qrSVG(text, px = 120) {
  if (typeof qrcode !== 'function') return '';
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }).replace('<svg ', `<svg width="${px}" height="${px}" `);
}

/** Kompakte Spulen-Ansicht mit den wichtigsten Aktionen – öffnet sich beim Scannen von QR-Code oder NFC-Tag. */
function spoolSheet(sp) {
  if (!sp) return toast(t('Spule nicht gefunden'), true);
  const nfc = 'NDEFReader' in window;
  const d = openDialog(`<div class="dlg sheet">
    <div class="sh-top">${spoolRing(sp.color, pctOf(sp), 74)}<div style="min-width:0"><div class="meta num">${esc(sp.nr)}${sp.spoolmanId ? ` · Spoolman #${sp.spoolmanId}` : ''}</div>
      <h2 style="margin:0">${esc(sp.material)}${sp.colorName ? ` · ${esc(t(sp.colorName))}` : ''}</h2>
      <div class="meta">${esc(sp.brand || t('Hersteller unbekannt'))} · ${fnum(sp.diameter || 1.75, 2)} mm${sp.rfid ? ` · RFID ${esc(sp.rfid)}` : ''}</div></div></div>
    <div class="strip" style="margin:12px 0"><div><b class="num">${fnum(sp.remaining, 0)} g</b><span>${t('von {g} g', { g: fnum(sp.netWeight, 0) })}</span></div>
      <div><b>${spoolPlace(sp)}</b><span>${t('Ort')}</span></div>
      <div><b>${sp.driedAt ? agoDays(sp.driedAt) : '–'}</b><span>${t('seit dem Trocknen')}</span></div></div>
    <div class="sh-acts">
      ${sp.archived ? '' : sp.slot ? `<button class="b" data-fact="unload" data-id="${sp.id}">${t('Entnehmen')}</button>` : `<button class="b b-go" data-fact="load" data-id="${sp.id}">${t('In Drucker legen')}</button>`}
      <button class="b" data-fact="weigh" data-id="${sp.id}">${t('Wiegen')}</button>
      <button class="b" data-fact="dried" data-id="${sp.id}">${t('Getrocknet')}</button>
      <button class="b" data-fact="labels" data-id="${sp.id}">${t('Etikett')}</button>
      ${nfc || (fil().stations?.list || []).length ? `<button class="b" data-fact="tagWrite" data-id="${sp.id}">${t('Tag beschreiben')}</button>` : ''}
      <button class="b" data-fact="editSpool" data-id="${sp.id}">${ICON.edit}${t('Bearbeiten')}</button>
    </div>
    <div class="dlg-actions"><button class="b" data-close>${t('Schließen')}</button></div></div>`);
  d.addEventListener('click', (e) => { if (e.target.closest('[data-fact]:not([data-fact="labels"])')) d.close(); });
}

/** #spool=S-012 in der Adresse (vom QR-Code/NFC-Tag) → Spule öffnen */
function openSpoolFromHash() {
  const m = /^#spool=(.+)$/.exec(location.hash);
  if (!m || !S.fil) return false;
  const key = decodeURIComponent(m[1]);
  const sp = fil().spools.find((x) => x.nr === key || x.id === key);
  history.replaceState(null, '', `#${on('filament') ? 'spools' : 'board'}`);
  if (on('filament') && S.view !== 'spools') setView('spools');
  spoolSheet(sp);
  return true;
}
window.addEventListener('hashchange', openSpoolFromHash);
// nach dem ersten Laden (boot) prüfen
setTimeout(function waitFil() { if (S.fil) openSpoolFromHash(); else setTimeout(waitFil, 300); }, 300);

const LABEL_FORMATS = {
  ql62: { name: '62 × 29 mm (Brother QL, DK-11209)', w: 62, h: 29 },
  l5030: { name: '50 × 30 mm', w: 50, h: 30 },
  l4030: { name: '40 × 30 mm', w: 40, h: 30 },
  l5725: { name: '57 × 25 mm (Thermo, Niimbot/Phomemo)', w: 57, h: 25 },
  a4: { name: 'A4-Bogen 3 × 8 (70 × 37 mm)', w: 70, h: 37.1, sheet: true },
};

function labelHTML(sp, f) {
  const qr = qrSVG(spoolLink(sp));
  const sub = sp.brand || '';
  const spec = [`${fnum(sp.diameter || 1.75, 2)} mm`, `${fnum(sp.netWeight, 0)} g`].join(' · ');
  return `<div class="lbl" style="--c:${esc(sp.color || '#888')};width:${f.w}mm;height:${f.h}mm">
    <div class="lbl-band"></div>
    <div class="lbl-txt"><div class="lbl-mat">${esc(sp.material)}</div><div class="lbl-col">${esc(t(sp.colorName || ''))}</div>
      ${sub ? `<div class="lbl-sub">${esc(sub)}</div>` : ''}<div class="lbl-sub">${esc(spec)}</div><div class="lbl-nr">${esc(sp.nr)}</div></div>
    <div class="lbl-qr">${qr}</div></div>`;
}

const LABEL_CSS = `.lbl,.lbl *{box-sizing:border-box}body{margin:0;font-family:Barlow,Arial,sans-serif;color:#000}
.lbl{display:flex;align-items:stretch;gap:1.6mm;padding:1.6mm;overflow:hidden;background:#fff;color:#000;page-break-inside:avoid}
.lbl *{color:#000}.lbl .lbl-sub{color:#333}
.lbl-band{width:3.5mm;border-radius:1mm;background:var(--c);border:0.2mm solid #000;flex:none;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.lbl-txt{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;line-height:1.08}
.lbl-mat{font-weight:700;font-size:4.2mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lbl-col{font-size:3.2mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lbl-sub{font-size:2.2mm;color:#333;margin-top:0.3mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lbl-nr{font-size:3mm;font-weight:700;margin-top:0.8mm;letter-spacing:.02em}
.lbl-qr{flex:none;height:100%;aspect-ratio:1;display:flex;align-items:center}
.lbl-qr svg{width:100%;height:100%}
.lsheet{display:grid;grid-template-columns:repeat(3,70mm);grid-auto-rows:37.1mm;width:210mm}`;

/** Etiketten drucken: Format wählen, Spulen auswählen, Vorschau, Drucken */
function labelsDialog(preId = null) {
  const F = fil();
  const list = F.spools.filter((x) => !x.archived);
  let fmt = 'ql62';
  try { fmt = localStorage.getItem('pd-label') || 'ql62'; } catch {}
  const d = openDialog(`<div class="dlg" style="max-width:760px"><h2>${t('Spulen-Etiketten')}</h2>
    <label>${t('Format')}<select name="fmt">${Object.entries(LABEL_FORMATS).map(([k, f]) => `<option value="${k}" ${k === fmt ? 'selected' : ''}>${esc(t(f.name))}</option>`).join('')}</select></label>
    <div class="lbl-pick"><div class="meta" style="display:flex;gap:10px;align-items:center"><span>${t('Spulen')}</span><button class="x" type="button" data-all>${t('alle')}</button><button class="x" type="button" data-none>${t('keine')}</button></div>
      <div class="lbl-list">${list.map((x) => `<label class="check"><input type="checkbox" value="${x.id}" ${preId ? (x.id === preId ? 'checked' : '') : 'checked'}> <span class="swatch" style="background:${esc(x.color)}"></span>${esc(x.nr)} ${esc(x.material)} ${esc(t(x.colorName || ''))}</label>`).join('')}</div></div>
    <div class="meta">${t('Vorschau')}</div><div class="lbl-prev" data-prev></div>
    <p class="meta">${t('Der QR-Code öffnet die Spule in PrintDock ({u}) – im Heimnetz mit jeder Handykamera.', { u: esc(S.app?.directUrl || location.origin) })}</p>
    <div class="dlg-actions"><button class="b" type="button" data-close>${t('Abbrechen')}</button><button class="b b-go" type="button" data-print>${t('Drucken')}</button></div></div>`);
  const chosen = () => $$('.lbl-list input:checked', d).map((i) => spoolById(i.value)).filter(Boolean);
  const prev = () => {
    const f = LABEL_FORMATS[$('[name=fmt]', d).value];
    const first = chosen()[0];
    $('[data-prev]', d).innerHTML = first ? `<style>${LABEL_CSS.replace(/body\{[^}]*\}/, '')}</style><div class="lbl-scale">${labelHTML(first, f)}</div><span class="meta">${t('{n} Etiketten', { n: chosen().length })}</span>` : `<span class="meta">${t('Keine Spule gewählt')}</span>`;
  };
  d.addEventListener('change', prev);
  $('[data-all]', d).addEventListener('click', () => { $$('.lbl-list input', d).forEach((i) => (i.checked = true)); prev(); });
  $('[data-none]', d).addEventListener('click', () => { $$('.lbl-list input', d).forEach((i) => (i.checked = false)); prev(); });
  $('[data-print]', d).addEventListener('click', () => {
    const key = $('[name=fmt]', d).value;
    const f = LABEL_FORMATS[key];
    try { localStorage.setItem('pd-label', key); } catch {}
    const items = chosen();
    if (!items.length) return toast(t('Keine Spule gewählt'), true);
    const body = f.sheet ? `<div class="lsheet">${items.map((x) => labelHTML(x, f)).join('')}</div>` : items.map((x) => labelHTML(x, f)).join('');
    const page = f.sheet ? '@page{size:A4;margin:10.8mm 0 0 0}' : `@page{size:${f.w}mm ${f.h}mm;margin:0}`;
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    document.body.appendChild(fr);
    fr.contentDocument.write(`<!doctype html><html><head><meta charset="utf-8"><title>PrintDock</title><style>${page}${LABEL_CSS}</style></head><body>${body}</body></html>`);
    fr.contentDocument.close();
    setTimeout(() => { fr.contentWindow.focus(); fr.contentWindow.print(); setTimeout(() => fr.remove(), 60_000); }, 300);
  });
  prev();
}

/** Spulen-Link auf einen NFC-Tag schreiben (Chrome auf Android) */
async function nfcWrite(sp, format = 'link') {
  try {
    const w = new NDEFReader();
    const tag = format === 'link' ? null : await api(`spools/${sp.id}/tag`);
    const records = [];
    if (format !== 'openspool') records.push({ recordType: 'url', data: tag?.url || spoolLink(sp) });
    if (format !== 'link') records.push({ recordType: 'mime', mediaType: 'application/json', data: new TextEncoder().encode(tag.openspool) });
    toast(t('Tag ans Handy halten …'));
    await w.write({ records });
    toast(t('{nr} auf den Tag geschrieben', { nr: sp.nr }));
  } catch (err) {
    toast(t('NFC: {e}', { e: err.message }), true);
  }
}

/** Hinweis bei unbekanntem Tag vom Leser */
const TAG_FORMATS = {
  universal: ['PrintDock + OpenSpool', 'Link zur Spule und Materialdaten – NTAG215/216'],
  openspool: ['OpenSpool', 'Nur Materialdaten – z. B. Snapmaker U1 mit Community-Firmware'],
  link: ['Nur Link', 'Handy öffnet die Spule – passt auch auf NTAG213'],
  ace: ['Anycubic ACE', 'ACE Pro / Kobra S1 erkennt Material und Farbe'],
};

/** Hinweis bei unbekanntem Tag vom Leser bzw. von der Station */
function pendingTagHTML(F) {
  const p = F.pendingTag;
  if (!p) return '';
  const opts = F.spools.filter((x) => !x.archived).map((x) => `<option value="${x.id}">${esc(x.nr)} ${esc(x.material)} ${esc(t(x.colorName || ''))}${x.rfid ? ' (RFID)' : ''}</option>`).join('');
  const d = p.data;
  const where = p.stationName ? t('an Station „{s}“', { s: esc(p.stationName) }) : p.printerName ? t('gelesen an {p}', { p: esc(p.printerName) }) : t('vom Leser gemeldet');
  const title = d ? t('Neue Spule auf dem Tag: {m}', { m: esc([d.brand, d.material].filter(Boolean).join(' ')) }) : p.blank ? t('Leerer Tag {t}', { t: esc(p.tag) }) : t('Unbekannter RFID-Tag {t}', { t: esc(p.tag) });
  const sub = d ? `${d.color ? `<span class="swatch" style="background:${esc(d.color)}"></span>` : ''}${t(TAG_FORMATS[p.format]?.[0] || p.format)} · ${where}` : `${where} · ${p.blank && p.writable ? t('anlegen oder zuordnen – danach lässt er sich beschreiben') : t('welche Spule ist das?')}`;
  return `<div class="newspool big"><span>${BI.spool}</span><div><b>${title}</b><small>${sub}</small></div>
    ${d ? `<button class="b b-sm b-go" data-fact="tagCreate">${ICON.plus}${t('Anlegen')}</button>` : `<button class="b b-sm" data-fact="tagNew">${ICON.plus}${t('Neue Spule')}</button>`}
    <select class="in" data-tagspool>${opts}</select><button class="b b-sm ${d ? '' : 'b-go'}" data-fact="tagAssign">${t('Zuordnen')}</button><button class="x" data-fact="tagDismiss">${t('Verwerfen')}</button></div>`;
}

/** An der Station gescannte Spule wartet aufs Einlegen */
function armedHTML(F) {
  const a = F.armed;
  const sp = a && spoolById(a.spoolId);
  if (!sp) return '';
  const st = (F.stations?.list || []).find((x) => x.id === a.source?.stationId);
  const pr = a.source?.printerId && F.printers.find((x) => x.id === a.source.printerId);
  return `<div class="newspool armed"><span>${spoolRing(sp.color, pctOf(sp), 40)}</span><div><b>${t('{nr} {m} wartet aufs Einlegen', { nr: esc(sp.nr), m: esc(sp.material) })}</b>
    <small>${st ? t('gescannt an „{s}“', { s: esc(st.name) }) : ''} · ${pr ? t('jetzt in {p} einlegen – PrintDock erkennt das Fach', { p: esc(pr.name) }) : t('jetzt in einen Drucker einlegen – PrintDock erkennt das Fach')} · ${t('bis {t}', { t: new Date(a.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}</small></div>
    <button class="b b-sm" data-fact="load" data-id="${sp.id}">${t('Platz wählen')}</button><button class="x" data-fact="disarm">${t('Abbrechen')}</button></div>`;
}

/** Tag beschreiben: an einer Station oder mit dem Handy (Web NFC) */
function tagWriteDialog(sp) {
  const F = fil();
  const sts = (F.stations?.list || []).filter((x) => x.online && x.caps?.nfc !== false);
  const nfc = 'NDEFReader' in window;
  let fmt = 'universal';
  try { fmt = localStorage.getItem('pd-tagfmt') || 'universal'; } catch {}
  const targets = [...sts.map((x) => `<option value="st:${esc(x.id)}">${t('Station „{s}“', { s: esc(x.name) })}${x.tag ? ` – ${t('Tag liegt auf')}` : ''}</option>`), nfc ? `<option value="phone">${t('Dieses Handy (NFC)')}</option>` : ''].join('');
  if (!targets) return toast(t('Keine Station verbunden'), true);
  const d = openDialog(`<form class="dlg" method="dialog"><h2>${t('Tag für {nr} beschreiben', { nr: esc(sp.nr) })}</h2>
    <label>${t('Womit')}<select name="target">${targets}</select></label>
    <div class="fmt-pick">${Object.entries(TAG_FORMATS).map(([k, [n, h]]) => `<label class="radio-card"><input type="radio" name="fmt" value="${k}" ${k === fmt ? 'checked' : ''}><span><b>${t(n)}</b><small>${t(h)}</small></span></label>`).join('')}</div>
    <p class="meta" data-state>${t('Leeren NTAG-Sticker bereithalten. Bambu- und Snapmaker-Original-Tags lassen sich nicht beschreiben.')}</p>
    <p class="form-error" hidden></p>
    <div class="dlg-actions"><button class="b" type="button" data-close>${t('Abbrechen')}</button><button class="b b-go">${t('Beschreiben')}</button></div></form>`);
  const form = $('form', d);
  const sync = () => {
    const phone = form.target.value === 'phone';
    $$('input[name=fmt]', d).forEach((i) => { i.disabled = phone && i.value === 'ace'; });
    if (phone && form.fmt.value === 'ace') form.querySelector('input[value=universal]').checked = true;
  };
  form.addEventListener('change', sync);
  sync();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const format = form.fmt.value;
    try { localStorage.setItem('pd-tagfmt', format); } catch {}
    if (form.target.value === 'phone') { d.close(); return nfcWrite(sp, format); }
    const btn = $('.b-go', d);
    btn.disabled = true;
    $('[data-state]', d).innerHTML = `<b>${t('Tag auf die Station legen …')}</b> ${t('(wartet bis zu 60 Sekunden)')}`;
    try {
      await api(`stations/${form.target.value.slice(3)}/write`, { method: 'POST', body: { spoolId: sp.id, format } });
      d.close();
      toast(t('{nr} auf den Tag geschrieben', { nr: sp.nr }));
      reload('filament');
    } catch (err) {
      btn.disabled = false;
      $('[data-state]', d).textContent = '';
      formError(d, err.message);
    }
  });
}

// ================================================================ Verbrauch

function vUsage() {
  const F = fil();
  const KIND = { print: 'Druck', manual: 'von Hand', weigh: 'gewogen', correction: 'Korrektur' };
  const rows = F.usage.slice(0, 200).map((u) => `<div class="row u-row">
      <div class="num"><span class="lbl">${t('Zeit')}</span>${tfmt(u.at)}</div>
      <div><span class="lbl">${t('Wo')}</span>${esc(u.printerName || '–')}${u.slot ? `<div class="meta">${esc(t(u.slot))}</div>` : ''}</div>
      <div class="c-main"><span class="swatch" style="background:${esc(u.color || 'transparent')}"></span><b>${esc(u.spoolNr || t('keine Spule'))}</b> ${esc(u.material || '')}
        <div class="meta">${esc(u.file || t(u.note || ''))}${u.file && u.note ? ` · ${esc(t(u.note))}` : ''}</div></div>
      <div class="num"><span class="lbl">${t('Menge')}</span><b>${fnum(u.grams, 1)} g</b>${u.estimated ? `<div class="meta">${t('geschätzt')}</div>` : ''}</div>
      <div class="num"><span class="lbl">${t('Kosten')}</span>${u.cost != null ? money(u.cost) : '–'}</div>
      <div><span class="pill ${u.spoolId ? '' : 'pause'}">${t(KIND[u.kind] || u.kind)}</span></div></div>`).join('');
  const total = F.stats30.reduce((a, x) => a + x.grams, 0);
  const cost = F.stats30.reduce((a, x) => a + x.cost, 0);
  return `<div class="bar-row"><h2>${t('Verbrauch')}</h2>
      <label class="meta" style="display:flex;gap:8px;align-items:center">${t('Warnen unter')} <input class="in" style="width:90px" type="number" min="0" value="${esc(F.settings.lowGrams)}" data-fact-change="lowGrams"> g</label></div>
    <div class="strip"><div><b class="num">${fnum(total / 1000, 2)} kg</b><span>${t('in 30 Tagen')}</span></div><div><b class="num">${money(cost)}</b><span>${t('Materialkosten')}</span></div>
      ${F.stats30.map((x) => `<div><b class="num">${fnum(x.grams, 0)} g</b><span>${esc(x.material)}</span></div>`).join('')}</div>
    <div class="list">${rows ? `<div class="row u-row head"><div>${t('Zeit')}</div><div>${t('Drucker')}</div><div>${t('Spule')}</div><div>${t('Menge')}</div><div>${t('Kosten')}</div><div>${t('Art')}</div></div>${rows}`
      : `<div class="empty"><h3>${t('Noch kein Verbrauch')}</h3><p>${t('Nach jedem Druck steht hier, welche Spule wie viel verloren hat.')}</p></div>`}</div>
    <p class="meta">${t('Bei Drucken aus PrintDock kommt die Menge aus der Slicer-Datei (bei Abbruch anteilig). Bei Drucken, die direkt am Drucker gestartet wurden, schätzt PrintDock sie aus der gemeldeten Filamentlänge (Klipper) – Bambu meldet sie nicht; dort bei Bedarf an der Spule über „− g“ nachtragen.')}</p>`;
}

// ================================================================ Einstellungen → Filament

function vFilSettings() {
  const F = fil();
  const st = F.settings;
  const sm = F.spoolman || {};
  const smState = !sm.enabled ? `<span class="meta">${t('aus')}</span>`
    : sm.error ? `<span class="vl bad">${esc(t(sm.error))}</span>`
      : sm.syncedAt ? `<span class="vl ok">${t('verbunden')}</span> <span class="meta">· ${t('{n} Spulen verknüpft', { n: sm.linked })} · ${t('abgeglichen {t}', { t: tfmt(sm.syncedAt) })}${sm.pending ? ` · ${t('{n} Buchungen warten', { n: sm.pending })}` : ''}</span>` : `<span class="meta">${t('noch nicht abgeglichen')}</span>`;
  const row = (label, hint, control) => `<div class="lrow"><div class="lt"><b>${label}</b>${hint ? `<span>${hint}</span>` : ''}</div><div class="lc">${control}</div></div>`;
  const num = (key, val, unit, w = '5rem') => `<span class="inu"><input class="in" type="number" min="0" style="width:${w}" value="${esc(val)}" data-fset="${key}"><span>${unit}</span></span>`;
  return `<div class="page-head"><h1>${NAV_ICON.gear}${t('Filament')}</h1></div>
    <div class="gen-grid">
      <div>
        <h3 class="shead">${t('Warnungen')}</h3>
        <div class="sbox">
          ${row(t('Spule wird knapp'), t('Meldung und Markierung, wenn die Restmenge darunter fällt.'), num('lowGrams', st.lowGrams, 'g'))}
        </div>
        <h3 class="shead">${t('Etiketten und Belegung')}</h3>
        <div class="sbox">
          ${row(t('Spulen-Etiketten'), t('Mit QR-Code – Scannen öffnet die Spule in PrintDock.'), `<button class="b b-sm" data-fact="labels">${t('Etiketten drucken …')}</button>`)}
          ${row(t('Belegung ans AMS übertragen'), t('Bambu: Material und Farbe einer eingelegten Spule ohne Bambu-Chip gleich am AMS-Fach eintragen.'), `<label class="tgl"><input type="checkbox" data-fset-chk="pushAms" ${st.pushAms !== false ? 'checked' : ''}><span class="sw"></span></label>`)}
        </div>
      </div>
      <div>
        <h3 class="shead">Spoolman</h3>
        <div class="sbox">
          ${row(t('Spoolman verwenden'), t('Spulenbestand aus Spoolman übernehmen, Verbrauch und Ort zurückmelden.'), `<label class="tgl"><input type="checkbox" data-smset="enabled" ${sm.enabled ? 'checked' : ''}><span class="sw"></span></label>`)}
          ${row(t('Adresse'), t('z. B. http://homeassistant.local:7912 (Spoolman-Add-on) oder http://nas:7912'), `<input class="in" id="smUrl" value="${esc(sm.url || '')}" placeholder="http://homeassistant.local:7912" style="width:17rem"><button class="b b-sm" data-fact="smTest">${t('Testen')}</button>`)}
          ${row(t('Status'), '', `${smState}${sm.enabled ? `<button class="b b-sm" data-fact="smSync">${t('Jetzt abgleichen')}</button>` : ''}`)}
          ${row(t('Ort mitschicken'), t('In Spoolman steht dann, in welchem Drucker und Platz die Spule steckt.'), `<label class="tgl"><input type="checkbox" data-smset="syncLocation" ${sm.syncLocation !== false ? 'checked' : ''}><span class="sw"></span></label>`)}
          ${row(t('Neue Spulen anlegen'), t('Spulen, die in PrintDock angelegt werden, auch in Spoolman eintragen (Hersteller und Filament werden gesucht oder angelegt).'), `<label class="tgl"><input type="checkbox" data-smset="pushNew" ${sm.pushNew !== false ? 'checked' : ''}><span class="sw"></span></label>`)}
        </div>
        <p class="meta">${t('Mit Spoolman bleibt Spoolman die Quelle: Änderungen an Material, Farbe oder Gewicht dort vornehmen. PrintDock gleicht alle 5 Minuten ab; ist Spoolman nicht erreichbar, holt PrintDock die Buchungen nach.')}</p>
      </div>
    </div>`;
}

// ================================================================ Stationen (NFC + Waage)

/**
 * Geräte mit PrintDock-Firmware. mode 'station': mit NFC-Leser (Station), mode 'sensor': nur Feuchtesensor.
 * Gleiche Firmware – ohne NFC-Leser und Waage arbeitet sie als reiner Feuchtesensor.
 */
function stationsHTML(F, mode = 'station') {
  const S0 = F.stations || { list: [], pairing: [] };
  const isSensor = (x) => x.caps?.nfc === false;
  const mine = (x) => (mode === 'sensor' ? isSensor(x) : !isSensor(x));
  const pr = (id) => F.printers.find((p) => p.id === id);
  const pair = S0.pairing.filter(mine).map((p) => `<div class="st-pair"><span class="st-dot run"></span><div><b>${mode === 'sensor' ? t('Neuer Feuchtesensor möchte sich koppeln') : t('Neue Station möchte sich koppeln')}</b>
      <small>${esc(p.name || p.id)} · ${esc(p.ip || '')}${p.fw ? ` · Firmware ${esc(p.fw)}` : ''}</small></div>
      <div class="st-code num">${esc(p.code)}</div>
      <button class="b b-sm b-go" data-fact="stPair" data-hw="${esc(p.id)}">${t('Koppeln')}</button><button class="x" data-fact="stReject" data-hw="${esc(p.id)}">${t('Ablehnen')}</button></div>`).join('');
  const rows = S0.list.filter(mine).map((x) => {
    const humPt = (F.humPoints || []).find((pt) => pt.source?.kind === 'station' && pt.source.stationId === x.id);
    const humWhere = humPt ? (humPt.type === 'storage' ? humPt.name : `${humPt.printerName}${humPt.unit ? ` · ${t(humPt.unit)}` : ''}`) : null;
    const where = x.caps?.nfc === false ? `${t('Feuchtesensor')} → ${humWhere ? esc(humWhere) : t('noch nicht zugeordnet')}`
      : `${x.role === 'printer' && x.printerId ? t('am Drucker {p}', { p: esc(pr(x.printerId)?.name || '?') }) : t('Lager / Werkbank')}${humWhere ? ` · 💧 → ${esc(humWhere)}` : ''}`;
    const live = x.online ? [x.env ? `<span class="hum ${humLevelOf(x.env.h)}" title="${esc(t('Feuchtesensor {s}', { s: x.env.sensor || '' }))}">💧 ${fnum(x.env.h, 0)} %</span>` : '', x.weight ? `<b class="num">${fnum(x.weight.g, 0)} g</b>` : '', x.spool ? `<span class="pill">${esc(x.spool.nr)}</span>` : x.tag ? `<span class="pill pause">${t('Tag {f}', { f: esc(t(TAG_FORMATS[x.tag.format]?.[0] || x.tag.format || '')) })}</span>` : '', x.writing ? `<span class="pill run">${t('wartet auf Tag')}</span>` : ''].filter(Boolean).join(' ') : `<span class="meta">${x.lastSeen ? t('zuletzt {t}', { t: tfmt(x.lastSeen) }) : t('noch nie verbunden')}</span>`;
    return `<div class="st-row"><span class="st-dot ${x.online ? 'ok' : 'off'}" title="${x.online ? t('verbunden') : t('getrennt')}"></span>
      <div class="st-main"><b>${esc(x.name)}</b><small>${where}${x.fw ? ` · ${esc(x.fw)}` : ''}${x.ip ? ` · ${esc(x.ip)}` : ''}</small></div>
      <div class="st-live">${live}</div>
      <div class="st-acts">${x.online && x.caps?.scale !== false ? `<button class="b b-sm" data-fact="stTare" data-id="${x.id}" title="${esc(t('Waage auf 0 setzen (nichts auflegen)'))}">${t('Tara')}</button><button class="b b-sm" data-fact="stCal" data-id="${x.id}">${t('Kalibrieren')}</button>` : ''}
        ${x.online ? `<button class="b b-sm" data-fact="stFind" data-id="${x.id}" title="${esc(t('Display und LED blinken lassen'))}">${t('Finden')}</button>` : ''}
        <button class="x" data-fact="stEdit" data-id="${x.id}" title="${t('Bearbeiten')}">${ICON.edit}</button></div></div>`;
  }).join('');
  if (mode === 'sensor') {
    return `<div class="sbox st-box"><div class="st-intro">${BI.drop}<div><b>${t('PrintDock Sensor')}</b>
        <span>${t('Ein ESP32 mit Feuchtesensor (SHT31, SHT40, AHT20 oder HTU21D) – für Trockenboxen, AMS oder ACE ohne eigene Messung. Gleiche Firmware wie die Station, nur ohne NFC-Leser und Waage.')}</span></div></div>
      ${pair}${rows || (!pair ? `<div class="st-empty"><span>${t('Noch kein Sensor gekoppelt.')}</span></div>` : '')}
      <div class="st-foot"><a class="b b-sm" href="${STATION_REPO}/blob/main/docs/wiring.md#nur-als-feuchtemesser" target="_blank" rel="noopener">${t('Bauanleitung')} ↗</a><button class="b b-sm" data-fact="stHelp" data-sensor="1">${t('Sensor einrichten …')}</button></div></div>`;
  }
  return `<div class="sbox st-box"><div class="st-intro">${BI.spool}<div><b>${t('NFC-Leser, Waage und Display für deine Spulen')}</b>
      <span>${t('Ein kleiner ESP32 mit eigener Firmware: Spule auflegen – PrintDock erkennt sie, bucht die Restmenge nach Gewicht und ordnet sie dem Fach zu, in das sie danach eingelegt wird. Beschreibt auch NFC-Tags.')}</span></div></div>
    ${pair}${rows || (!pair ? `<div class="st-empty"><span>${t('Noch keine Station gekoppelt.')}</span></div>` : '')}
    <div class="st-foot"><a class="b b-sm" href="${STATION_REPO}" target="_blank" rel="noopener">${t('Projekt und Firmware')} ↗</a><button class="b b-sm" data-fact="stHelp">${t('Station einrichten …')}</button></div></div>`;
}

/** PrintDock-Adresse, die in der Station eingetragen wird */
function stationAddress() {
  const u = new URL(S.app?.directUrl || location.origin);
  return u.host;
}

const STATION_REPO = 'https://github.com/Codegulasch/printdock-station';

function stationHelpDialog(sensor = false) {
  const addr = stationAddress();
  const build = sensor
    ? t('ESP32 (z. B. D1 Mini ESP32) und ein Feuchtesensor-Modul (SHT31, SHT40, AHT20 oder HTU21D) an GPIO 21 (SDA) und 22 (SCL), optional ein 0,96″-OLED am selben Bus. Der Sensor gehört in die Box, das ESP32 kann außen bleiben.')
    : t('ESP32 (WROOM-Devkit oder D1 Mini ESP32), PN532-NFC-Modul, HX711 mit 5-kg-Wägezelle, 0,96″-OLED (SSD1306), optional WS2812-LED und Taster.');
  openDialog(`<div class="dlg" style="max-width:720px"><h2>${sensor ? t('PrintDock Sensor einrichten') : t('PrintDock Station einrichten')}</h2>
    <p style="margin:0">${t('Station und Sensor sind ein eigenes Projekt mit Firmware, Stückliste und Verdrahtung – eine Firmware für beide:')}</p>
    <div class="copyline"><a class="b b-sm" href="${STATION_REPO}" target="_blank" rel="noopener">github.com/Codegulasch/printdock-station ↗</a>
      <a class="b b-sm" href="${STATION_REPO}/releases/latest" target="_blank" rel="noopener">${t('Firmware herunterladen')} ↗</a>
      <a class="b b-sm" href="${STATION_REPO}/blob/main/docs/wiring.md" target="_blank" rel="noopener">${t('Verdrahtung')} ↗</a></div>
    <ol class="steps-ol">
      <li><b>${t('Bauen')}</b> – ${build}</li>
      <li><b>${t('Firmware flashen')}</b> – ${t('Datei …factory.bin aus „Firmware herunterladen“ im Browser über web.esphome.io („Connect“) aufspielen, oder mit esptool.')}</li>
      <li><b>${t('WLAN')}</b> – ${t('Das Gerät öffnet beim ersten Start das WLAN „PrintDock-Station“. Damit verbinden, Heim-WLAN wählen und als PrintDock-Adresse eintragen:')}
        <div class="copyline"><code>${esc(addr)}</code><button class="b b-sm" data-act="copy" data-text="${esc(addr)}">${t('Kopieren')}</button></div></li>
      <li><b>${t('Koppeln')}</b> – ${sensor ? t('Der Code vom Display (ohne Display: einfach den neuen Eintrag) erscheint unter Einstellungen → Drucker & Filament → Feuchte & Trocknen – „Koppeln“ drücken und danach einer Messstelle zuordnen.') : t('Die Station zeigt einen sechsstelligen Code. Er erscheint hier unter „PrintDock Station“ – vergleichen und „Koppeln“ drücken.')}</li>
      ${sensor ? '' : `<li><b>${t('Waage kalibrieren')}</b> – ${t('„Tara“ mit leerer Waage, dann ein bekanntes Gewicht (z. B. eine volle 1-kg-Spule mit bekanntem Leergewicht oder ein Paket Mehl) auflegen und „Kalibrieren“.')}</li>`}
    </ol>
    ${sensor ? '' : `<p class="meta">${t('Tags: NTAG215 oder NTAG216 (Format „PrintDock + OpenSpool“), NTAG213 für „Nur Link“ oder „Anycubic ACE“. Bambu- und Snapmaker-Original-Tags werden an ihrer Kennung erkannt.')}</p>`}
    <div class="dlg-actions"><button class="b" data-close>${t('Schließen')}</button></div></div>`);
}

function stationEditDialog(x) {
  const F = fil();
  const d = openDialog(`<form class="dlg" method="dialog"><h2>${t('Station „{s}“', { s: esc(x.name) })}</h2>
    <label>${t('Name')}<input name="name" value="${esc(x.name)}" required></label>
    <label>${t('Steht')}<select name="role"><option value="storage" ${x.role !== 'printer' ? 'selected' : ''}>${t('im Lager / an der Werkbank')}</option><option value="printer" ${x.role === 'printer' ? 'selected' : ''}>${t('an einem Drucker')}</option></select></label>
    <div class="two" data-pr><label>${t('Drucker')}<select name="printerId"><option value="">–</option>${F.printers.map((p) => `<option value="${esc(p.id)}" ${p.id === x.printerId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label>${t('Fach')}<select name="slotKey"></select></label></div>
    <p class="hint" data-pr style="margin:0">${t('Mit festem Fach legt PrintDock eine gescannte Spule sofort hinein; ohne wartet es, in welches Fach des Druckers sie eingelegt wird.')}</p>
    <label class="check"><input type="checkbox" name="autoWeigh" ${x.autoWeigh ? 'checked' : ''}> ${t('Restmenge beim Auflegen nach Gewicht buchen')}</label>
    <p class="form-error" hidden></p>
    <div class="dlg-actions"><button class="b b-fault left" type="button" data-del>${t('Entfernen')}</button><button class="b" type="button" data-close>${t('Abbrechen')}</button><button class="b b-done">${t('Speichern')}</button></div></form>`);
  const form = $('form', d);
  const sync = () => {
    $$('[data-pr]', d).forEach((n) => (n.hidden = form.role.value !== 'printer'));
    const p = F.printers.find((pp) => pp.id === form.printerId.value);
    const cur = form.slotKey.value || x.slotKey || '';
    form.slotKey.innerHTML = `<option value="">${t('beim Einlegen erkennen')}</option>${(p?.slots || []).map((sl) => `<option value="${esc(sl.key)}" ${sl.key === cur ? 'selected' : ''}>${esc(t(sl.label))}</option>`).join('')}`;
  };
  form.addEventListener('change', sync);
  sync();
  $('[data-del]', d).addEventListener('click', async () => {
    if (!(await confirmBox(t('Station entfernen'), t('„{s}“ entfernen? Die Station vergisst ihren Schlüssel und lässt sich danach neu koppeln.', { s: x.name }), t('Entfernen'), 'b-fault'))) return;
    await run(() => api(`stations/${x.id}`, { method: 'DELETE' }), t('Station entfernt'));
    d.close();
    reload('filament');
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api(`stations/${x.id}`, { method: 'PUT', body: { name: form.name.value, role: form.role.value, printerId: form.printerId.value || null, slotKey: form.slotKey.value || null, autoWeigh: form.autoWeigh.checked } });
      d.close();
      toast(t('Gespeichert'));
      reload('filament');
    } catch (err) {
      formError(d, err.message);
    }
  });
}

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset?.fsetChk) {
    await run(() => api('filament/settings', { method: 'PUT', body: { [el.dataset.fsetChk]: el.checked } }), t('Gespeichert'));
    return reload('filament');
  }
  if (el.dataset?.fset) {
    await run(() => api('filament/settings', { method: 'PUT', body: { [el.dataset.fset]: el.value } }), t('Gespeichert'));
    return reload('filament');
  }
  if (el.dataset?.smset) {
    const body = { [el.dataset.smset]: el.checked };
    if (el.dataset.smset === 'enabled') body.url = $('#smUrl')?.value || '';
    await run(() => api('spoolman', { method: 'PUT', body }), el.dataset.smset === 'enabled' ? (el.checked ? t('Spoolman eingeschaltet') : t('Spoolman ausgeschaltet')) : t('Gespeichert'));
    return reload('filament');
  }
});

/** Einstellungen → PrintDock Station */
function vStationSettings() {
  const F = fil();
  return `<div class="page-head"><h1>${NAV_ICON.gear}PrintDock Station</h1></div>
    <div class="gen-grid"><div>${stationsHTML(F, 'station')}</div>
      <div><h3 class="shead">${t('So arbeitet die Station')}</h3><div class="sbox st-how">
        <ol class="steps-ol"><li>${t('Spule auflegen – PrintDock erkennt sie am Tag (oder legt sie neu an) und zeigt sie im Display.')}</li>
        <li>${t('Mit Waage: Restmenge wird gebucht, bei neuen Spulen lernt PrintDock das Leergewicht.')}</li>
        <li>${t('Spule in einen Drucker einlegen – PrintDock ordnet sie dem Fach zu (Bambu: Material und Farbe gehen ans AMS).')}</li>
        <li>${t('Leere NFC-Tags lassen sich aus der Spulenansicht beschreiben.')}</li></ol></div>
        <p class="meta">${t('Feuchtesensoren ohne NFC-Leser findest du unter Einstellungen → Drucker & Filament → Feuchte & Trocknen.')}</p></div></div>`;
}

Object.assign(VIEW_FN, { spools: vSpools, slots: vSlots, usage: vUsage, filset: vFilSettings, station: vStationSettings });

// ================================================================ Aktionen

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-fact]');
  if (!el || el.disabled) return;
  const { fact, id } = el.dataset;
  const closeDlg = () => el.closest('dialog')?.close();
  switch (fact) {
    case 'spFilter': S.spFilter = el.dataset.k; return render();
    case 'editSpool': return spoolDialog(id ? spoolById(id) : null);
    case 'load': return loadDialog(spoolById(id));
    case 'unload': {
      const s = spoolById(id);
      await run(() => api('filament/assign', { method: 'POST', body: { printerId: s.slot.printerId, key: s.slot.key, spoolId: null } }), t('{nr} ins Lager', { nr: s.nr }));
      return reload('filament', 'summary');
    }
    case 'smTest': {
      const r = await run(() => api('spoolman/test', { method: 'POST', body: { url: $('#smUrl').value } }));
      if (r) toast(t('Spoolman erreichbar{v}', { v: r.version ? ` (${r.version})` : '' }));
      return reload('filament');
    }
    case 'smSync': {
      el.disabled = true;
      const r = await run(() => api('spoolman/sync', { method: 'POST' }));
      if (r) toast(t('Abgeglichen: {a} neu, {u} aktualisiert', { a: r.added, u: r.updated }));
      return reload('filament');
    }
    case 'labels': return labelsDialog(id || null);
    case 'nfcWrite': return nfcWrite(spoolById(id));
    case 'tagWrite': return tagWriteDialog(spoolById(id));
    case 'stHelp': return stationHelpDialog(Boolean(el.dataset.sensor));
    case 'humAdd': return humSourceDialog(el.dataset.storage ? { storage: true } : { printerId: el.dataset.printer, unit: el.dataset.unit || null });
    case 'humEdit': return humSourceDialog({ src: (fil().humPoints || []).map((x) => x.source).find((x) => x?.id === id) });
    case 'stPair': {
      const r = await run(() => api('stations/pair', { method: 'POST', body: { id: el.dataset.hw } }));
      if (r) toast(t('Station „{s}“ gekoppelt', { s: r.name }));
      return reload('filament');
    }
    case 'stReject': await run(() => api('stations/reject', { method: 'POST', body: { id: el.dataset.hw } })); return reload('filament');
    case 'stTare': return run(() => api(`stations/${id}/tare`, { method: 'POST' }), t('Waage auf 0 gesetzt'));
    case 'stFind': return run(() => api(`stations/${id}/identify`, { method: 'POST' }));
    case 'stEdit': return stationEditDialog((fil().stations?.list || []).find((x) => x.id === id));
    case 'stCal': return numberDialog({
      title: t('Waage kalibrieren'), label: t('Bekanntes Gewicht'), unit: 'g', okLabel: t('Kalibrieren'),
      text: esc(t('Vorher mit leerer Waage „Tara“ drücken. Dann ein Gewicht auflegen, dessen Masse du genau kennst, und hier eintragen.')),
      onSubmit: async (v) => {
        await api(`stations/${id}/calibrate`, { method: 'POST', body: { grams: v } });
        toast(t('Kalibrierung gesendet'));
      },
    });
    case 'disarm': await run(() => api('filament/disarm', { method: 'POST' })); return reload('filament');
    case 'tagCreate': {
      const p = fil().pendingTag;
      const d0 = p?.data || {};
      return spoolDialog(null, { material: d0.material, brand: d0.brand, color: d0.color, colorName: '', netWeight: d0.netWeight, diameter: d0.diameter }, async (sp) => {
        await api('rfid/assign', { method: 'POST', body: { spoolId: sp.id } });
      });
    }
    case 'tagNew': return spoolDialog(null, null, async (sp) => {
      await api('rfid/assign', { method: 'POST', body: { spoolId: sp.id } });
    });
    case 'sheet': return spoolSheet(spoolById(id));
    case 'tagAssign': {
      const sel = $('[data-tagspool]');
      const r = await run(() => api('rfid/assign', { method: 'POST', body: { spoolId: sel.value } }), t('Tag zugeordnet'));
      if (r) reload('filament');
      return;
    }
    case 'tagDismiss': {
      await run(() => api('rfid/dismiss', { method: 'POST' }));
      return reload('filament');
    }
    case 'dried': {
      await run(() => api(`spools/${el.dataset.id}/dried`, { method: 'POST' }), t('Als getrocknet vermerkt'));
      return reload('filament');
    }
    case 'weigh': {
      const s = spoolById(id);
      return numberDialog({
        title: t('{nr} wiegen', { nr: s.nr }), label: t('Gewicht mit Spule'), unit: 'g', okLabel: t('Übernehmen'),
        text: s.tare ? esc(t('Spule samt Leerspule auf die Waage legen. Leerspule: {g} g.', { g: fnum(s.tare, 0) })) : `<b>${t('Für diese Spule ist kein Leergewicht hinterlegt.')}</b> ${t('Bitte zuerst unter „Bearbeiten“ eintragen (steht oft auf der Spule oder beim Hersteller).')}`,
        onSubmit: async (v) => {
          await api(`spools/${s.id}/weigh`, { method: 'POST', body: { gross: v } });
          toast(t('Restmenge aktualisiert'));
          reload('filament', 'summary');
        },
      });
    }
    case 'book': {
      const s = spoolById(id);
      return numberDialog({
        title: t('Von {nr} abbuchen', { nr: s.nr }), label: t('Verbrauch'), unit: 'g', okLabel: t('Abbuchen'), note: true,
        text: esc(t('Zum Beispiel für Drucke, die PrintDock nicht erfassen konnte. Aktuell: {g} g.', { g: fnum(s.remaining, 0) })),
        onSubmit: async (v, note) => {
          await api(`spools/${s.id}/book`, { method: 'POST', body: { grams: v, note } });
          toast(t('Abgebucht'));
          reload('filament', 'summary');
        },
      });
    }
    case 'pickSpool': return pickSpoolDialog(el.dataset.printer, el.dataset.key);
    case 'assign':
      await run(() => api('filament/assign', { method: 'POST', body: { printerId: el.dataset.printer, key: el.dataset.key, spoolId: el.dataset.spool || null } }), el.dataset.spool ? t('Spule eingelegt') : t('Spule herausgenommen'));
      closeDlg();
      return reload('filament', 'summary');
    case 'fromSlot': {
      const s = await run(() => api('filament/from-slot', { method: 'POST', body: { printerId: el.dataset.printer, key: el.dataset.key } }));
      if (s) toast(t('{nr} angelegt und zugeordnet', { nr: s.nr }));
      closeDlg();
      return reload('filament', 'summary');
    }
    case 'newSpools': return newSpoolsDialog(el.dataset.printer || null);
    case 'ignoreSlots': {
      const fp = fil().printers.find((x) => x.id === el.dataset.printer);
      for (const sl of fp?.slots.filter((x) => x.unmatched) || []) await run(() => api('filament/ignore', { method: 'POST', body: { printerId: fp.id, key: sl.key } }));
      toast(t('Wird nicht mehr nachgefragt, bis eine andere Spule eingelegt wird'));
      return reload('filament');
    }
    case 'editSpoolHere':
      closeDlg();
      return spoolDialog(null);
    default:
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target.closest('[data-fact-change]');
  if (!el) return;
  if (el.dataset.factChange === 'spMaterial') {
    S.spMaterial = el.value;
    return render();
  }
  if (el.dataset.factChange === 'lowGrams') {
    await run(() => api('filament/settings', { method: 'PUT', body: { lowGrams: el.value } }), t('Gespeichert'));
    reload('filament', 'summary');
  }
});
