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
        <h3><span class="meta num">${esc(s.nr)}</span> ${esc(s.material)}${s.colorName ? ` · ${esc(t(s.colorName))}` : ''}</h3>
        <div class="meta">${esc(s.brand || t('Hersteller unbekannt'))}${s.diameter !== 1.75 ? ` · ${s.diameter} mm` : ''}${s.rfid ? ' · RFID' : ''}</div></div></div>
      <div class="sp-amt"><b class="num">${fnum(s.remaining, 0)} g</b><span class="meta">${t('von {g} g', { g: fnum(s.netWeight, 0) })}</span>${s.low && !s.archived ? `<span class="pill pause">${t('knapp')}</span>` : ''}</div>
      <div class="bar ${s.remaining <= low ? 'warn' : ''}"><i style="width:${pctOf(s)}%"></i></div>
      <div class="facts" style="margin-top:8px"><span>${spoolPlace(s)}</span>${s.pricePerKg ? `<span><b>${money(s.pricePerKg)}</b>/kg</span>` : ''}${s.lastUsedAt ? `<span>${t('zuletzt {t}', { t: tfmt(s.lastUsedAt) })}</span>` : ''}</div>
      <div class="btns">
        ${s.archived ? '' : s.slot ? `<button class="b b-sm" data-fact="unload" data-id="${s.id}">${t('Entnehmen')}</button>` : `<button class="b b-sm b-go" data-fact="load" data-id="${s.id}">${t('Einlegen')}</button>`}
        ${s.archived ? '' : `<button class="b b-sm" data-fact="weigh" data-id="${s.id}" title="${t('Restmenge durch Wiegen bestimmen')}">${t('Wiegen')}</button><button class="b b-sm" data-fact="book" data-id="${s.id}" title="${t('Verbrauch von Hand abbuchen')}">− g</button>`}
        <button class="x" data-fact="editSpool" data-id="${s.id}" title="${t('Bearbeiten')}" aria-label="${esc(t('{n} bearbeiten', { n: s.nr }))}">${ICON.edit}</button>
      </div></article>`).join('');
  return `${stripHTML()}<div class="bar-row"><h2>${t('Spulen')}</h2><div class="chips">${chips}</div>
      ${mats.length > 1 ? `<select class="in" data-fact-change="spMaterial" aria-label="${t('Material')}"><option value="">${t('Alle Materialien')}</option>${mats.map((m) => `<option ${m === S.spMaterial ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>` : ''}
      <button class="b b-sm b-go" data-fact="editSpool">${ICON.plus}${t('Neue Spule')}</button></div>
    <div class="strip" style="margin-top:-4px"><div><b class="num">${active.length}</b><span>${t('Spulen')}</span></div>
      <div><b class="num">${fnum(active.reduce((a, s) => a + s.remaining, 0) / 1000, 1)} kg</b><span>${t('auf Lager')}</span></div>
      <div><b class="num">${active.filter((s) => s.slot).length}</b><span>${t('im Drucker')}</span></div>
      <div class="${active.some((s) => s.low) ? 'warn' : ''}"><b class="num">${active.filter((s) => s.low).length}</b><span>${t('unter {g} g', { g: low })}</span></div></div>
    ${list.length ? `<div class="cards">${cards}</div>` : `<div class="list"><div class="empty"><h3>${F.spools.length ? t('Keine Spulen in dieser Auswahl') : t('Noch keine Spulen angelegt')}</h3>
      <p>${t('Spulen mit Material, Farbe und Gewicht anlegen, dann unter „Belegung“ in die Drucker legen. Nach jedem Druck bucht PrintDock den Verbrauch ab.')}</p>
      <button class="b b-go" data-fact="editSpool">${ICON.plus}${t('Neue Spule')}</button></div></div>`}`;
}

function spoolDialog(s = null) {
  const F = fil();
  const d = openDialog(`<form class="dlg" method="dialog"><h2>${s ? t('Spule {nr}', { nr: esc(s.nr) }) : t('Neue Spule')}</h2>
    <div class="two"><label>${t('Material')}<input name="material" list="mats" required value="${esc(s?.material || '')}" placeholder="${esc(t('z. B. PLA'))}"></label>
      <label>${t('Hersteller')}<input name="brand" value="${esc(s?.brand || '')}" placeholder="${esc(t('z. B. Bambu Lab'))}"></label></div>
    <datalist id="mats">${F.materials.map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
    <div class="two"><label>${t('Farbe')}<input name="colorName" value="${esc(s?.colorName || '')}" placeholder="${esc(t('z. B. Schwarz'))}"></label>
      <label>${t('Farbton')}<input name="color" type="color" value="${esc(s?.color || '#888888')}" style="padding:2px;height:42px"></label></div>
    <div class="two"><label>${t('Nettogewicht (g)')}<input name="netWeight" type="number" min="1" value="${esc(s?.netWeight || 1000)}"></label>
      <label>${s ? t('Restmenge (g)') : t('Restmenge (g, leer = voll)')}<input name="remaining" type="number" min="0" step="0.1" value="${s ? esc(s.remaining) : ''}"></label></div>
    <div class="two"><label>${t('Leerspule (g)')}<input name="tare" type="number" min="0" value="${esc(s?.tare || '')}" placeholder="${esc(t('fürs Wiegen, z. B. 250'))}"></label>
      <label>${t('Preis je Spule (€)')}<input name="price" type="number" min="0" step="0.01" value="${s?.price ?? ''}"></label></div>
    <div class="two"><label>${t('Lagerort')}<input name="location" value="${esc(s?.location || '')}" placeholder="${esc(t('z. B. Trockenbox 2'))}"></label>
      <label>${t('Durchmesser')}<select name="diameter"><option value="1.75" ${s?.diameter !== 2.85 ? 'selected' : ''}>${fnum(1.75, 2)} mm</option><option value="2.85" ${s?.diameter === 2.85 ? 'selected' : ''}>${fnum(2.85, 2)} mm</option></select></label></div>
    ${s ? `<label>${t('RFID-Kennung')}<input name="rfid" value="${esc(s.rfid || '')}" placeholder="${esc(t('wird bei Bambu-Spulen automatisch erkannt'))}"></label>` : `<label>${t('Anzahl gleicher Spulen')}<input name="count" type="number" min="1" max="50" value="1"></label>`}
    <label>${t('Notiz')}<input name="note" value="${esc(s?.note || '')}"></label>
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
      await api(s ? `spools/${s.id}` : 'spools', { method: s ? 'PUT' : 'POST', body });
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
    ${unmatched.length ? `<div class="newspool big"><span>${BI.spool}</span><div><b>${unmatched.length === 1 ? t('Neue Spule erkannt') : t('{n} neue Spulen erkannt', { n: unmatched.length })}</b><small>${t('Die Drucker melden Filament, zu dem es noch keine Spule im Lager gibt.')}</small></div><button class="b b-sm b-go" data-fact="newSpools">${t('Spulen anlegen')}</button></div>` : ''}
    <div style="display:grid;gap:14px">${cards}</div>
    <p class="meta">${t('Bambu-AMS meldet Material, Farbe und – bei Bambu-Spulen – RFID und Restmenge. RFID-Spulen ordnet PrintDock automatisch zu.')}
    ${t('Bei Snapmaker U1 und Anycubic mit ACE die Spulen hier von Hand zuordnen; die Plätze lassen sich beim Drucker benennen (z. B. „ACE 1, ACE 2, …“).')}</p>`;
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

Object.assign(VIEW_FN, { spools: vSpools, slots: vSlots, usage: vUsage });

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
