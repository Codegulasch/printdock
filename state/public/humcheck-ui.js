/* PrintDock – Feuchte-Check vor dem Start: Hinweis im Startdialog und Grenzwerte je Material. */

loaders.humcheck = async () => (S.humcheck = on('filament') ? await api('filament/humcheck') : null);

/** Box im Startdialog. r = Antwort von queue/:id/humcheck */
function humCheckBoxHTML(r, { otherPrinters = 0 } = {}) {
  if (!r || r.ok || !r.issues?.length) return '';
  const lines = r.issues.map((x) => x.kind === 'hum'
    ? t('{s}: {p} % Feuchte – für {m} höchstens {l} %', { s: esc(x.nr || x.slot), p: x.pct, m: esc(x.material), l: x.limit })
    : x.dryDays == null
      ? t('{s}: {m} noch nie getrocknet – empfohlen alle {d} Tage', { s: esc(x.nr || x.slot), m: esc(x.material), d: x.days })
      : t('{s}: {m} zuletzt vor {n} Tagen getrocknet – empfohlen alle {d} Tage', { s: esc(x.nr || x.slot), m: esc(x.material), n: x.dryDays, d: x.days }));
  const dry = r.dryer
    ? `<button class="b b-sm b-go" type="button" data-hc-dry>${'💧'} ${r.dryer.active ? t('Trocknet schon – danach automatisch starten') : t('Erst trocknen ({t} °C, {h} h), dann automatisch starten', { t: r.dryer.suggest?.temp ?? '–', h: r.dryer.suggest?.hours ?? '–' })}</button>`
    : `<span class="meta">${t('Für diese Stelle ist kein Trockner eingerichtet (Einstellungen → Feuchte & Trocknen).')}</span>`;
  return `<div class="hc-box"><b>💧 ${t('Filament ist zu feucht')}</b><div class="meta">${lines.join('<br>')}</div>
    <div class="hc-acts">${dry}${otherPrinters ? `<span class="meta">${t('oder oben einen anderen Drucker wählen')}</span>` : ''}</div>
    <label class="hc-anyway"><input type="checkbox" name="humAnyway"> ${t('Trotzdem drucken')}</label></div>`;
}

/** Einstellungen: Grenzwerte je Material */
function humCheckSettingsHTML() {
  const h = S.humcheck;
  if (!h) return '';
  const rows = h.limits.map((x, i) => `<tr data-hc-row="${i}">
    <td>${x.m === '*' ? `<span class="meta">${t('alle anderen')}</span><input type="hidden" name="m" value="*">` : `<input class="in" name="m" value="${esc(x.m)}" style="width:6rem" maxlength="12">`}</td>
    <td><span class="inu"><input class="in" type="number" name="hum" min="5" max="95" value="${x.hum}" style="width:4.5rem"><span>%</span></span></td>
    <td><span class="inu"><input class="in" type="number" name="days" min="0" max="365" value="${x.days}" style="width:4.5rem"><span>${t('Tage')}</span></span></td>
    <td>${x.m === '*' ? '' : `<button class="x" type="button" data-hc-del="${i}" title="${esc(t('Entfernen'))}">✕</button>`}</td></tr>`).join('');
  return `<h3 class="shead">${t('Vor dem Druck prüfen')}</h3>
    <div class="sbox hc-set">
      <label class="lrow"><div class="lt"><b>${t('Feuchte-Check beim Start')}</b><span>${t('Warnt im Startdialog, wenn das Filament feuchter ist als für sein Material erlaubt – mit „erst trocknen, dann automatisch starten“.')}</span></div><div class="lc"><label class="tgl"><input type="checkbox" data-hc-opt="enabled" ${h.enabled ? 'checked' : ''}><span class="sw"></span></label></div></label>
      <label class="lrow"><div class="lt"><b>${t('Auto-Start wartet')}</b><span>${t('Bei zu feuchtem Filament startet die Warteschlange nicht automatisch.')}</span></div><div class="lc"><label class="tgl"><input type="checkbox" data-hc-opt="blockAuto" ${h.blockAuto ? 'checked' : ''}><span class="sw"></span></label></div></label>
      <table class="hc-tab"><thead><tr><th>${t('Material')}</th><th>${t('max. Feuchte')}</th><th>${t('trocknen alle')}</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      <div class="st-foot"><button class="b b-sm" type="button" data-hc-add>${ICON.plus}${t('Material')}</button><button class="b b-sm b-go" type="button" data-hc-save>${t('Speichern')}</button></div>
    </div>
    <p class="meta">${t('„Trocknen alle … Tage“ prüft das Trocknungsdatum der Spule (0 = nicht prüfen). Gilt für den längsten passenden Namen – „PA“ deckt PA-CF und PA6 ab.')}</p>`;
}

function hcReadRows() {
  return $$('.hc-tab [data-hc-row]').map((tr) => ({ m: $('[name="m"]', tr).value, hum: $('[name="hum"]', tr).value, days: $('[name="days"]', tr).value }));
}

document.addEventListener('click', async (e) => {
  if (e.target.closest('[data-hc-add]')) {
    const rows = hcReadRows();
    rows.splice(rows.length - 1, 0, { m: '', hum: 50, days: 0 });
    S.humcheck = { ...S.humcheck, limits: rows };
    return render();
  }
  const del = e.target.closest('[data-hc-del]');
  if (del) {
    const rows = hcReadRows();
    rows.splice(Number(del.dataset.hcDel), 1);
    S.humcheck = { ...S.humcheck, limits: rows };
    return render();
  }
  const qc = e.target.closest('[data-qdry-cancel]');
  if (qc) {
    await run(() => api(`queue/${qc.dataset.qdryCancel}/dry-cancel`, { method: 'POST' }), t('Startet nicht mehr automatisch'));
    return reload('queue');
  }
  if (e.target.closest('[data-hc-save]')) {
    const r = await run(() => api('filament/humcheck', { method: 'PUT', body: { limits: hcReadRows().filter((x) => x.m) } }), t('Gespeichert'));
    if (r) S.humcheck = r;
    render();
  }
});
document.addEventListener('change', async (e) => {
  const el = e.target.closest('[data-hc-opt]');
  if (!el) return;
  const r = await run(() => api('filament/humcheck', { method: 'PUT', body: { [el.dataset.hcOpt]: el.checked } }), t('Gespeichert'));
  if (r) S.humcheck = r;
});
