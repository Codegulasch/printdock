/* PrintDock – Kosten (Material, Strom, Maschinenstunde), Angebot, Fotos fertiger Teile, Auftragsarchiv. */

const cmoney = (v, cur) => (v == null ? '–' : `${Number(v).toLocaleString(LANG === 'de' ? 'de-DE' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\u00a0${cur || S.app?.costs?.currency || '€'}`);

/** Kurz: „12,40 €“ mit Aufschlüsselung im Tooltip */
function costPill(c) {
  if (!c) return '';
  const tip = `${t('Material')} ${cmoney(c.material, c.currency)} · ${t('Strom')} ${cmoney(c.energy, c.currency)}${c.machine ? ` · ${t('Maschine')} ${cmoney(c.machine, c.currency)}` : ''}${c.markup ? ` · ${t('Aufschlag')} ${cmoney(c.markup, c.currency)}` : ''}`;
  return `<span class="num" title="${esc(tip)}">${cmoney(c.total, c.currency)}</span>`;
}

/** Abschnitt im Auftrag: Kalkulation, Ist-Kosten, Fotos */
function orderCostsHTML(o) {
  const c = o?.costs;
  if (!c) return '';
  const e = c.estimate;
  const a = c.actual;
  const cur = e.currency;
  const posRows = e.positions.map((p) => `<tr><td>${esc(p.file)}</td><td class="num">${p.qty}</td><td class="num">${fnum(p.grams, 0)} g</td><td class="num">${fmtDur(p.hours * 3600)}</td><td class="num">${cmoney(p.total, cur)}</td></tr>`).join('');
  const photos = a.entries.filter((x) => x.photo);
  return `<fieldset class="oc"><legend>${t('Kosten')}</legend>
    <table class="ctab"><thead><tr><th>${t('Position')}</th><th>${t('Stück')}</th><th>${t('Filament')}</th><th>${t('Druckzeit')}</th><th>${t('Kalkulation')}</th></tr></thead>
      <tbody>${posRows}</tbody>
      <tfoot><tr><td colspan="4">${t('Material')} ${cmoney(e.material, cur)} · ${t('Strom')} ${cmoney(e.energy, cur)}${e.machine ? ` · ${t('Maschine')} ${cmoney(e.machine, cur)}` : ''}${e.markup ? ` · ${t('Aufschlag')} ${cmoney(e.markup, cur)}` : ''}</td><td class="num"><b>${cmoney(e.total, cur)}</b></td></tr></tfoot></table>
    ${a.prints ? `<div class="oc-act"><b>${t('Bisher gedruckt')}:</b> ${a.prints === 1 ? t('1 Druck') : t('{n} Drucke', { n: a.prints })}${a.failed ? ` (${t('{n} nicht erfolgreich', { n: a.failed })})` : ''} · ${fnum(a.grams, 0)} g · ${fmtDur(a.hours * 3600)} · ${fnum(a.kwh, 2)} kWh · <b>${cmoney(a.total, cur)}</b></div>` : ''}
    <div class="btns"><button class="b b-sm" type="button" data-quote="${esc(o.id)}">${t('Kalkulation / Angebot drucken …')}</button></div>
    <p class="hint" style="margin:0">${t('Preise unter Einstellungen → Drucker & Filament → Kosten. Filament nach Spulenpreis, Strom gemessen (Home Assistant) oder geschätzt.')}</p>
  </fieldset>
  ${photos.length ? `<fieldset class="oc"><legend>${t('Fotos der fertigen Teile')}</legend><div class="ophotos">${photos.map((x) => `<a href="api/history/${esc(x.id)}/photo" target="_blank" rel="noopener" title="${esc(`${x.printerName} · ${tfmt(x.endedAt)}`)}"><img src="api/history/${esc(x.id)}/photo" alt="" loading="lazy"></a>`).join('')}</div></fieldset>` : ''}`;
}

/** Kalkulation bzw. Angebot als druckbare Seite */
function quoteWindow(o) {
  const c = o.costs;
  if (!c) return;
  const e = c.estimate;
  const cur = e.currency;
  const rows = e.positions.map((p) => `<tr><td>${esc(p.file)}</td><td class="r">${p.qty}</td><td class="r">${fnum(p.grams, 0)} g</td><td class="r">${fmtDur(p.hours * 3600)}</td><td class="r">${cmoney(p.each.total, cur)}</td><td class="r">${cmoney(p.total, cur)}</td></tr>`).join('');
  const html = `<!doctype html><html lang="${LANG}"><head><meta charset="utf-8"><title>${esc(o.nr)} – ${esc(o.title)}</title>
    <style>body{font-family:system-ui,Segoe UI,Arial,sans-serif;color:#111;margin:32px;font-size:14px}h1{font-size:22px;margin:0 0 4px}.m{color:#555}table{border-collapse:collapse;width:100%;margin:18px 0}th,td{border-bottom:1px solid #ddd;padding:7px 6px;text-align:left}th{font-size:12px;text-transform:uppercase;color:#555}.r{text-align:right}tfoot td{border:0;padding:4px 6px}.tot td{font-weight:700;font-size:16px;border-top:2px solid #111}@media print{button{display:none}body{margin:12mm}}</style></head><body>
    <h1>${t('Kalkulation')} ${esc(o.nr)}</h1>
    <div class="m">${esc(o.title)}${o.customer ? ` · ${esc(o.customer)}` : ''}${o.due ? ` · ${t('Termin')} ${dfmt(o.due)}` : ''} · ${new Date().toLocaleDateString(LANG === 'de' ? 'de-DE' : 'en-GB')}</div>
    <table><thead><tr><th>${t('Position')}</th><th class="r">${t('Stück')}</th><th class="r">${t('Filament')}</th><th class="r">${t('Druckzeit')}</th><th class="r">${t('je Stück')}</th><th class="r">${t('Summe')}</th></tr></thead><tbody>${rows}</tbody>
    <tfoot>
      <tr><td colspan="5" class="r">${t('Material')}</td><td class="r">${cmoney(e.material, cur)}</td></tr>
      <tr><td colspan="5" class="r">${t('Strom')}</td><td class="r">${cmoney(e.energy, cur)}</td></tr>
      ${e.machine ? `<tr><td colspan="5" class="r">${t('Maschinenzeit')}</td><td class="r">${cmoney(e.machine, cur)}</td></tr>` : ''}
      ${e.markup ? `<tr><td colspan="5" class="r">${t('Aufschlag')}</td><td class="r">${cmoney(e.markup, cur)}</td></tr>` : ''}
      <tr class="tot"><td colspan="5" class="r">${t('Gesamt')}</td><td class="r">${cmoney(e.total, cur)}</td></tr>
    </tfoot></table>
    <p class="m">${t('Gesamt: {g} g Filament, {h} Druckzeit.', { g: fnum(e.grams, 0), h: fmtDur(e.hours * 3600) })}</p>
    <button onclick="print()">${t('Drucken')}</button></body></html>`;
  const w = window.open('', '_blank');
  if (!w) return toast(t('Pop-up wurde blockiert – bitte für PrintDock erlauben'), true);
  w.document.write(html);
  w.document.close();
}

document.addEventListener('click', (e) => {
  const q = e.target.closest('[data-quote]');
  if (q) {
    const o = S.orders.find((x) => x.id === q.dataset.quote);
    if (o) quoteWindow(o);
    return;
  }
  const ar = e.target.closest('[data-oarch]');
  if (ar) {
    const archived = ar.dataset.oarch === '1';
    run(() => api(`orders/${ar.dataset.id}/archive`, { method: 'POST', body: { archived } }), archived ? t('Auftrag archiviert') : t('Auftrag zurückgeholt')).then(() => reload('orders'));
  }
});

/** Einstellungen: Preise */
function costsSettingsHTML() {
  const c = S.app?.costs || {};
  const inp = (k, step, unit, min = 0) => `<span class="cin"><input class="in" type="number" step="${step}" min="${min}" data-cost="${k}" value="${esc(c[k] ?? '')}"><span class="meta">${unit}</span></span>`;
  const cur = esc(c.currency || '€');
  return `<div class="sbox">
    ${lrow(t('Strompreis'), t('Für den Verbrauch je Druck – gemessen über die Steckdose in Home Assistant, sonst geschätzt.'), inp('kwhPrice', '0.01', `${cur}/kWh`))}
    ${lrow(t('Leistung ohne Messung'), t('Schätzwert, wenn keine Steckdose mit Messung da ist. Mit Messung lernt PrintDock den Durchschnitt je Drucker.'), inp('watts', '10', 'W'))}
    ${lrow(t('Filament ohne Spulenpreis'), t('Wenn eine Spule keinen Preis hat, nimmt PrintDock den Durchschnitt gleicher Materialien, sonst diesen Wert.'), inp('kgPrice', '0.5', `${cur}/kg`))}
    ${lrow(t('Maschinenstunde'), t('Abnutzung, Wartung, Anschaffung – je Druckstunde. 0 = nicht berechnen.'), inp('machineRate', '0.1', `${cur}/h`))}
    ${lrow(t('Aufschlag'), t('Auf die Summe, z. B. für Arbeit oder Gewinn.'), inp('markup', '1', '%'))}
    ${lrow(t('Währung'), '', `<input class="in" style="width:5rem" maxlength="4" data-cost="currency" value="${cur}">`)}
    ${lrow(t('Foto am Druckende'), t('Speichert ein Kamerabild des fertigen Teils im Verlauf und am Auftrag.'), `<label class="tgl"><input type="checkbox" data-photos ${S.app?.photos !== false ? 'checked' : ''}><span class="sw"></span></label>`)}
  </div>`;
}

document.addEventListener('change', async (e) => {
  const el = e.target.closest('[data-cost],[data-photos]');
  if (!el) return;
  const body = el.matches('[data-photos]') ? { photos: el.checked } : { costs: { [el.dataset.cost]: el.value } };
  const r = await run(() => api('app', { method: 'PUT', body }), t('Gespeichert'));
  if (r) S.app = { ...S.app, ...r };
  reload('app', 'orders', 'history');
});
