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
    ${a.prints ? `<div class="oc-act"><b>${t('Bisher gedruckt')}:</b> ${a.prints === 1 ? t('1 Druck') : t('{n} Drucke', { n: a.prints })}${a.failed ? ` (${t('{n} nicht erfolgreich', { n: a.failed })}${a.scrap ? `, ${t('Ausschuss {c}', { c: cmoney(a.scrap, cur) })}` : ''})` : ''} · ${fnum(a.grams, 0)} g · ${fmtDur(a.hours * 3600)} · ${fnum(a.kwh, 2)} kWh · <b>${cmoney(a.total, cur)}</b></div>` : ''}
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
  const rows = e.positions.map((p) => `<tr><td>${esc(p.file)}</td><td class="r">${p.qty}</td><td class="r">${fnum(p.grams, 0)} g</td><td class="r">${fmtDur(p.hours * 3600)}</td><td class="r">${cmoney(p.total / p.qty, cur)}</td><td class="r">${cmoney(p.total, cur)}</td></tr>`).join('');
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
    ${lrow(t('Foto nach der ersten Schicht'), t('Kamerabild, sobald die erste Schicht liegt – auf „Heute“ und als Benachrichtigung („Foto nach der ersten Schicht“). So siehst du früh, ob die Haftung passt.'), `<label class="tgl"><input type="checkbox" data-l1opt ${S.app?.firstLayer ? 'checked' : ''}><span class="sw"></span></label>`)}
    ${lrow(t('Nachbearbeitung'), t('Fertige Teile eines Auftrags durchlaufen Schritte – Stand je Schritt im Auftrag, auf „Heute“ und im Kunden-Statuslink.'), `<label class="tgl"><input type="checkbox" data-postopt ${S.app?.post?.enabled ? 'checked' : ''}><span class="sw"></span></label>`)}
    ${S.app?.post?.enabled ? lrow(t('Schritte'), t('Mit Komma getrennt, in dieser Reihenfolge.'), `<input class="in" style="min-width:18rem" data-poststeps value="${esc((S.app.post.steps || []).map((x) => t(x)).join(', '))}">`) : ''}
    ${lrow(t('Etikett nach dem Druck'), t('Jedes fertige Teil eines Auftrags bekommt ein Etikett (Auftrag, Teil x von y, Kunde, QR-Code). Gedruckt wird gesammelt über „Heute“.'), `<label class="tgl"><input type="checkbox" data-plabelopt ${S.app?.partLabels ? 'checked' : ''}><span class="sw"></span></label>`)}
  </div>`;
}

document.addEventListener('change', async (e) => {
  const el = e.target.closest('[data-cost],[data-photos],[data-plabelopt],[data-l1opt],[data-postopt],[data-poststeps]');
  if (!el) return;
  const body = el.matches('[data-photos]') ? { photos: el.checked } : el.matches('[data-plabelopt]') ? { partLabels: el.checked }
    : el.matches('[data-l1opt]') ? { firstLayer: el.checked }
      : el.matches('[data-postopt]') ? { post: { ...(S.app.post || {}), enabled: el.checked } }
        : el.matches('[data-poststeps]') ? { post: { ...(S.app.post || {}), steps: el.value.split(',').map((x) => x.trim()).filter(Boolean) } }
          : { costs: { [el.dataset.cost]: el.value } };
  const r = await run(() => api('app', { method: 'PUT', body }), t('Gespeichert'));
  if (r) S.app = { ...S.app, ...r };
  reload('app', 'orders', 'history');
});

// ================================================================ Etiketten für fertige Teile

/** Etikett für ein fertiges Teil: Auftrag, Teil x von y, Kunde, Datum, QR (Statuslink oder Auftrag in PrintDock) */
function partLabelHTML(l, f) {
  const base = S.app?.directUrl || location.origin;
  const link = l.shareToken ? `${base}/status/${l.shareToken}` : `${base}/#orders`;
  const name = String(l.file || '').replace(/\.(gcode\.3mf|3mf|gcode|stl)$/i, '');
  return `<div class="lbl" style="--c:${esc(l.color || '#888')};width:${f.w}mm;height:${f.h}mm">
    <div class="lbl-band"></div>
    <div class="lbl-txt"><div class="lbl-mat" style="font-size:3.4mm">${esc(l.nr)}</div><div class="lbl-col" style="font-size:2.7mm">${esc(l.title)}</div>
      ${l.customer ? `<div class="lbl-sub">${esc(l.customer)}</div>` : ''}<div class="lbl-sub">${esc(name)}</div>
      <div class="lbl-nr" style="font-size:2.6mm">${t('Teil {n} von {m}', { n: l.n, m: l.of })} · ${new Date(l.endedAt).toLocaleDateString(LOC)}</div></div>
    <div class="lbl-qr">${qrSVG(link)}</div></div>`;
}

/** Druckdialog: offene Etiketten (orderId = null) oder alle Teile eines Auftrags */
async function partLabelsDialog(orderId = null) {
  let list;
  try {
    list = orderId ? await api(`labels?order=${encodeURIComponent(orderId)}`) : S.labels || (await api('labels'));
  } catch (err) {
    return toast(err.message, true);
  }
  if (!list.length) return toast(t('Keine Etiketten offen'), true);
  let fmt = 'ql62';
  try { fmt = localStorage.getItem('pd-plabel') || localStorage.getItem('pd-label') || 'ql62'; } catch {}
  const d = openDialog(`<div class="dlg" style="max-width:760px"><h2>${t('Etiketten für fertige Teile')}</h2>
    <label>${t('Format')}<select name="fmt">${Object.entries(LABEL_FORMATS).map(([k, f]) => `<option value="${k}" ${k === fmt ? 'selected' : ''}>${esc(t(f.name))}</option>`).join('')}</select></label>
    <div class="lbl-pick"><div class="lbl-list">${list.map((l) => `<label class="check"><input type="checkbox" value="${esc(l.id)}" checked> ${esc(l.nr)} · ${t('Teil {n} von {m}', { n: l.n, m: l.of })} · ${esc(l.file)}</label>`).join('')}</div></div>
    <div class="meta">${t('Vorschau')}</div><div class="lbl-prev" data-prev></div>
    <p class="meta">${t('Der QR-Code öffnet den Statuslink des Auftrags (wenn geteilt), sonst die Aufträge in PrintDock.')}</p>
    <div class="dlg-actions"><button class="b" type="button" data-close>${t('Abbrechen')}</button><button class="b b-go" type="button" data-print>${t('Drucken')}</button></div></div>`);
  const chosen = () => $$('.lbl-list input:checked', d).map((i) => list.find((l) => l.id === i.value)).filter(Boolean);
  const prev = () => {
    const f = LABEL_FORMATS[$('[name=fmt]', d).value];
    const first = chosen()[0];
    $('[data-prev]', d).innerHTML = first ? `<style>${LABEL_CSS.replace(/body\{[^}]*\}/, '')}</style><div class="lbl-scale">${partLabelHTML(first, f)}</div><span class="meta">${t('{n} Etiketten', { n: chosen().length })}</span>` : '';
  };
  d.addEventListener('change', prev);
  $('[data-print]', d).addEventListener('click', async () => {
    const key = $('[name=fmt]', d).value;
    const f = LABEL_FORMATS[key];
    try { localStorage.setItem('pd-plabel', key); } catch {}
    const items = chosen();
    if (!items.length) return;
    const body = f.sheet ? `<div class="lsheet">${items.map((x) => partLabelHTML(x, f)).join('')}</div>` : items.map((x) => partLabelHTML(x, f)).join('');
    const page = f.sheet ? '@page{size:A4;margin:10.8mm 0 0 0}' : `@page{size:${f.w}mm ${f.h}mm;margin:0}`;
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    document.body.appendChild(fr);
    fr.contentDocument.write(`<!doctype html><html><head><meta charset="utf-8"><title>PrintDock</title><style>${page}${LABEL_CSS}</style></head><body>${body}</body></html>`);
    fr.contentDocument.close();
    setTimeout(() => { fr.contentWindow.focus(); fr.contentWindow.print(); setTimeout(() => fr.remove(), 60_000); }, 300);
    await api('labels/printed', { method: 'POST', body: { ids: items.map((x) => x.id) } }).catch(() => {});
    d.close();
    reload('labels');
  });
  prev();
}

// ================================================================ Statuslink für Kunden

function orderShareHTML(o) {
  if (!o) return '';
  const link = o.shareToken ? `${S.app?.directUrl || location.origin}/status/${o.shareToken}` : null;
  return `<fieldset class="oc"><legend>${t('Status für den Kunden')}</legend>
    ${link ? `<div class="copyline"><code>${esc(link)}</code><button class="b b-sm" type="button" data-act="copy" data-text="${esc(link)}">${t('Kopieren')}</button></div>
      <div class="btns"><button class="b b-sm" type="button" data-oshare="${esc(o.id)}" data-on="1">${t('Neuer Link')}</button><button class="b b-sm" type="button" data-oshare="${esc(o.id)}" data-on="0">${t('Link abschalten')}</button>
        ${o.done ? `<button class="b b-sm" type="button" data-plabels="${esc(o.id)}">${t('Etiketten drucken …')}</button>` : ''}</div>`
      : `<div class="btns"><button class="b b-sm" type="button" data-oshare="${esc(o.id)}" data-on="1">${t('Link erstellen')}</button>${o.done ? `<button class="b b-sm" type="button" data-plabels="${esc(o.id)}">${t('Etiketten drucken …')}</button>` : ''}</div>`}
    <p class="hint" style="margin:0">${t('Eine Seite ohne Anmeldung mit Fortschritt, Termin und Fotos – ohne Kosten. Von außerhalb des Heimnetzes nur erreichbar, wenn PrintDock eine öffentliche Adresse hat (Einstellungen → Home Assistant → Öffentliche Adresse).')}</p>
  </fieldset>`;
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-oshare]');
  if (!b) return;
  const on1 = b.dataset.on === '1';
  const r = await run(() => api(`orders/${b.dataset.oshare}/share`, { method: 'POST', body: { enabled: on1 } }), on1 ? t('Statuslink erstellt') : t('Statuslink abgeschaltet'));
  if (!r) return;
  await loaders.orders();
  const box = b.closest('fieldset.oc');
  const o = S.orders.find((x) => x.id === b.dataset.oshare);
  if (box && o) box.outerHTML = orderShareHTML(o);
});

