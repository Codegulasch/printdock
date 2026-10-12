/* PrintDock – Station live: was auf der PrintDock Station liegt (Tag-Daten, Gewicht, Restmenge),
   Wiegen direkt über die Station und Inventur aller Spulen. */

// Menü: Filament → Station (nur, wenn eine Station mit NFC oder Waage gekoppelt ist)
{
  const g = NAV_ALL.find((x) => x.g === 'fil');
  const i = g.v.findIndex((v) => v[0] === 'slots');
  g.v.splice(i + 1, 0, ['stlive', 'Station', 'filament', undefined, () => stationsLive().length > 0]);
}

/**
 * Stationen für die Station-Seite: alle außer reinen Feuchtesensoren (wie in Einstellungen → PrintDock Station).
 * Ein Board ohne Module (noch nichts angeschlossen) zählt als Station – sonst verschwindet die Seite, sobald es sich meldet.
 */
const stationsLive = () => (S.fil?.stations?.list || []).filter((x) => !(x.caps?.nfc === false && x.caps?.scale !== true && x.caps?.humidity === true));
const stationBare = (x) => x.caps && Object.keys(x.caps).length > 0 && !x.caps.nfc && !x.caps.scale && !x.caps.humidity;
const scaleStations = () => stationsLive().filter((x) => x.online && x.caps?.scale !== false);

/** Live-Gewicht von der Station (SSE „station“) */
function onStationLive(d) {
  const st = (S.fil?.stations?.list || []).find((x) => x.id === d.id);
  if (!st) return;
  st.weight = d.weight;
  for (const el of $$(`[data-stg="${d.id}"]`)) el.textContent = `${fnum(d.weight.g, 0)} g`;
  for (const el of $$(`[data-stnet="${d.id}"]`)) {
    const tare = Number(el.dataset.tare) || 0;
    el.textContent = tare ? `${fnum(Math.max(0, d.weight.g - tare), 0)} g` : '–';
  }
  for (const el of $$(`[data-ststable="${d.id}"]`)) el.textContent = d.weight.stable ? t('ruhig') : t('schwankt …');
}

const weighBig = (x, tare = 0) => `<div class="stw"><div><span class="meta">${t('brutto')}</span><b class="num" data-stg="${x.id}">${x.weight ? `${fnum(x.weight.g, 0)} g` : '–'}</b></div>
  <div><span class="meta">${t('netto (Rest)')}</span><b class="num" data-stnet="${x.id}" data-tare="${tare}">${x.weight && tare ? `${fnum(Math.max(0, x.weight.g - tare), 0)} g` : '–'}</b></div>
  <div><span class="meta">${t('Waage')}</span><span data-ststable="${x.id}">${x.weight?.stable ? t('ruhig') : x.weight ? t('schwankt …') : t('kein Wert')}</span></div></div>`;

function vStationLive() {
  const F = fil();
  const list = stationsLive();
  const cards = list.map((x) => {
    const sp = x.spool;
    const d = x.tag?.data;
    const fmt = x.tag ? (x.tag.blank || x.tag.format === 'blank' ? t('leerer Tag') : t(TAG_FORMATS[x.tag.format]?.[0] || (x.tag.format === 'unknown' ? 'unbekanntes Format' : x.tag.format) || 'unbekanntes Format')) : null;
    const tagInfo = x.tag ? `<div class="stl-tag"><b>${t('Tag')}</b> <span class="code">${esc(x.tag.uid)}</span> · ${esc(fmt)}${x.tag.capacity ? ` · ${x.tag.capacity} B` : ''}
        ${d ? `<div>${d.color ? `<span class="swatch" style="background:${esc(d.color)}"></span>` : ''}${esc([d.brand, d.material].filter(Boolean).join(' '))}${d.netWeight ? ` · ${fnum(d.netWeight, 0)} g` : ''}${d.diameter ? ` · ${d.diameter} mm` : ''}${d.tempMin ? ` · ${d.tempMin}–${d.tempMax} °C` : ''}</div>` : ''}
        ${x.tag.spoolRef ? `<div class="meta">${t('Link auf {nr}', { nr: esc(x.tag.spoolRef) })}</div>` : ''}${x.tag.blank ? `<div class="meta">${t('leer – lässt sich beschreiben')}</div>` : ''}</div>` : `<div class="meta">${x.caps?.nfc === false ? t('ohne NFC-Leser') : t('kein Tag aufgelegt')}</div>`;
    const spoolInfo = sp ? `<div class="stl-sp">${spoolRing(sp.color, sp.netWeight ? Math.round((sp.remaining / sp.netWeight) * 100) : 0, 64)}<div>
        <b class="num">${esc(sp.nr)}</b> ${esc(sp.material)}${sp.colorName ? ` · ${esc(t(sp.colorName))}` : ''}<div class="meta">${esc(sp.brand || '')}${sp.tare ? ` · ${t('Leerspule {g} g', { g: fnum(sp.tare, 0) })}` : ` · ${t('Leergewicht unbekannt')}`}</div>
        <div><b class="num">${fnum(sp.remaining, 0)} g</b> <span class="meta">${t('von {g} g', { g: fnum(sp.netWeight, 0) })}</span></div></div></div>` : '';
    const acts = [
      sp ? `<button class="b b-sm" data-fact="sheet" data-id="${sp.id}">${t('Spule öffnen')}</button>` : '',
      sp && x.weight ? `<button class="b b-sm b-go" data-stl="weigh" data-st="${x.id}" data-sp="${sp.id}">${t('Gewicht übernehmen')}</button>` : '',
      sp && x.caps?.nfc !== false ? `<button class="b b-sm" data-fact="tagWrite" data-id="${sp.id}">${t('Tag beschreiben')}</button>` : '',
      x.caps?.scale !== false ? `<button class="b b-sm" data-fact="stTare" data-id="${x.id}" title="${esc(t('Waage auf 0 setzen (nichts auflegen)'))}">${t('Tara')}</button>` : '',
    ].filter(Boolean).join('');
    return `<section class="sec stl ${x.online ? '' : 'off'}"><div class="cc-head"><h3>${esc(x.name)}</h3><span class="pill ${x.online ? 'run' : ''}">${x.online ? t('verbunden') : t('getrennt')}</span></div>
      ${x.online && stationBare(x) ? `<p class="meta">${t('Noch keine Module erkannt – NFC-Leser (PN532) und Waage (HX711) anschließen und die Station neu starten. Bis dahin ist sie verbunden, kann aber noch nichts lesen oder wiegen.')}</p>`
        : x.online ? `${x.caps?.scale !== false ? weighBig(x, sp?.tare || 0) : ''}${tagInfo}${spoolInfo}<div class="btns">${acts}</div>` : `<p class="meta">${x.lastSeen ? t('zuletzt {t}', { t: tfmt(x.lastSeen) }) : t('noch nie verbunden')}</p>`}</section>`;
  }).join('');
  return `${stripHTML()}<div class="bar-row"><h2>${t('Station')}</h2>${scaleStations().length ? `<button class="b b-sm ${S.inv ? 'b-fault' : ''}" data-stl="${S.inv ? 'invEnd' : 'invStart'}">${S.inv ? t('Inventur beenden') : t('Inventur starten')}</button>` : ''}</div>
    ${pendingTagHTML(F)}${armedHTML(F)}
    ${S.inv ? inventoryHTML() : ''}
    <div class="stl-grid">${cards || `<div class="empty">${t('Keine Station gekoppelt.')}</div>`}</div>`;
}
VIEW_FN.stlive = vStationLive;

// ---------------------------------------------------------------- Inventur

/** Inventur: alle Spulen nacheinander auf die Waage – mit Tag geht es von selbst, ohne Tag Spule wählen */
function inventoryHTML() {
  const F = fil();
  const inv = S.inv;
  const weighed = new Set(F.spools.filter((s) => s.weighedAt && Date.parse(s.weighedAt) >= inv.at).map((s) => s.id));
  for (const id of inv.done || []) weighed.add(id);
  const all = F.spools.filter((s) => !s.archived);
  const open = all.filter((s) => !weighed.has(s.id));
  const st = scaleStations().find((x) => x.id === inv.stationId) || scaleStations()[0];
  return `<section class="sec inv"><div class="cc-head"><h3>📋 ${t('Inventur')}</h3><span class="meta">${t('{a} von {b} Spulen gewogen', { a: all.length - open.length, b: all.length })}</span></div>
    <div class="bar"><i style="width:${all.length ? Math.round(((all.length - open.length) / all.length) * 100) : 0}%"></i></div>
    <p class="meta">${t('Spule für Spule auf die Waage legen. Spulen mit Tag bucht PrintDock von selbst; bei Spulen ohne Tag hier „wiegen“ drücken, während sie aufliegt.')}</p>
    ${st ? weighBig(st) : ''}
    <div class="list flat inv-list">${open.slice(0, 60).map((s) => `<div class="row inv-row"><span class="swatch" style="background:${esc(s.color)}"></span><span><b class="num">${esc(s.nr)}</b> ${esc(s.material)}${s.colorName ? ` · ${esc(t(s.colorName))}` : ''} <span class="meta">${spoolPlace(s)}</span></span><span class="meta num">${fnum(s.remaining, 0)} g</span>
      ${st ? `<button class="b b-sm" data-stl="weigh" data-st="${st.id}" data-sp="${s.id}" data-inv>${t('wiegen')}</button>` : ''}<button class="x" data-stl="skip" data-sp="${s.id}" title="${esc(t('Überspringen'))}">✕</button></div>`).join('') || `<div class="empty">✓ ${t('Alle Spulen gewogen.')}</div>`}</div></section>`;
}

// ---------------------------------------------------------------- Wiegen-Dialog über die Station

/** Wiegen einer Spule: liegt eine Station mit Waage vor, das Gewicht live von dort. true = Dialog geöffnet */
function stationWeighDialog(s) {
  const sts = scaleStations();
  if (!sts.length) return false;
  let st = sts[0];
  const d = openDialog(`<div class="dlg"><h2>${t('{nr} wiegen', { nr: esc(s.nr) })}</h2>
    ${sts.length > 1 ? `<label>${t('Station')}<select class="in" data-wst>${sts.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label>` : `<p class="meta" style="margin:0">${t('Spule auf die Station „{s}“ legen.', { s: esc(st.name) })}</p>`}
    <div data-wbox>${weighBig(st, s.tare || 0)}</div>
    <p class="meta" style="margin:0">${s.tare ? t('Leerspule: {g} g', { g: fnum(s.tare, 0) }) : t('Kein Leergewicht hinterlegt – bei einer neuen, vollen Spule lernt PrintDock es jetzt.')}</p>
    <p class="form-error" hidden></p>
    <div class="dlg-actions"><button class="b left" data-wmanual>${t('Von Hand eingeben …')}</button><button class="b" data-close>${t('Abbrechen')}</button><button class="b b-go" data-wok>${t('Übernehmen')}</button></div></div>`);
  $('[data-wst]', d)?.addEventListener('change', (e) => {
    st = sts.find((x) => x.id === e.target.value);
    $('[data-wbox]', d).innerHTML = weighBig(st, s.tare || 0);
  });
  $('[data-wmanual]', d).addEventListener('click', () => {
    d.close();
    numberDialog({
      title: t('{nr} wiegen', { nr: s.nr }), label: t('Gewicht mit Spule'), unit: 'g', okLabel: t('Übernehmen'), text: '',
      onSubmit: async (v) => {
        await api(`spools/${s.id}/weigh`, { method: 'POST', body: { gross: v } });
        toast(t('Restmenge aktualisiert'));
        reload('filament', 'summary');
      },
    });
  });
  $('[data-wok]', d).addEventListener('click', async () => {
    try {
      const r = await api(`stations/${st.id}/weigh`, { method: 'POST', body: { spoolId: s.id } });
      d.close();
      toast(r.learnedTare ? t('Leerspule {g} g gelernt', { g: r.learnedTare }) : t('Restmenge aktualisiert: {g} g', { g: fnum(r.spool.remaining, 0) }));
      reload('filament', 'summary');
    } catch (err) {
      formError(d, err.message);
    }
  });
  return true;
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-stl]');
  if (!b) return;
  const act = b.dataset.stl;
  if (act === 'invStart') {
    S.inv = { at: Date.now(), stationId: scaleStations()[0]?.id, done: [] };
    return render();
  }
  if (act === 'invEnd') {
    S.inv = null;
    return render();
  }
  if (act === 'skip') {
    S.inv.done.push(b.dataset.sp);
    return render();
  }
  if (act === 'weigh') {
    const r = await run(() => api(`stations/${b.dataset.st}/weigh`, { method: 'POST', body: { spoolId: b.dataset.sp } }));
    if (!r) return;
    if (b.hasAttribute('data-inv') && S.inv) S.inv.done.push(b.dataset.sp);
    toast(r.learnedTare ? t('Leerspule {g} g gelernt', { g: r.learnedTare }) : t('{nr}: {g} g', { nr: r.spool.nr, g: fnum(r.spool.remaining, 0) }));
    reload('filament', 'summary');
  }
});
