/* PrintDock – Notaus über Home Assistant: Rauchmelder/Temperatursensor → Steckdosen der Drucker aus. */

loaders.emergency = async () => (S.emergency = on('homeassistant') ? await api('ha/emergency') : null);

function emergencyHTML() {
  const E = S.emergency;
  if (!E) return '';
  const withPower = S.printers.filter((p) => p.settings?.powerEntity);
  const rows = E.rules.map((r) => {
    const st = E.state?.[r.id];
    const who = r.printers.length ? r.printers.map((id) => esc(printerById(id)?.name || '?')).join(', ') : t('alle Drucker mit Steckdose');
    return `<div class="em-row"><div><b>${esc(r.name || r.entity)}</b><small>${esc(r.entity)} · ${r.mode === 'above' ? t('Alarm über {v}', { v: r.value }) : t('Alarm, wenn an')} · ${who}</small></div>
      <span class="${st?.alarm ? 'vl bad' : 'meta'}">${st ? (st.alarm ? `🚨 ${esc(st.value)}` : esc(st.value)) : '–'}</span>
      <button class="b b-sm" data-em="test" data-id="${r.id}" title="${esc(t('Nur Meldung senden, nichts ausschalten'))}">${t('Probealarm')}</button>
      <button class="x" data-em="edit" data-id="${r.id}" title="${esc(t('Bearbeiten'))}">${ICON.edit}</button></div>`;
  }).join('');
  const last = E.log?.[0];
  return `<section class="set-sec" id="ha-emergency"><div class="set-sh"><h2>${t('Notaus')}</h2></div>
    <div class="sbox">
      <label class="lrow"><div class="lt"><b>${t('Notaus aktiv')}</b><span>${t('Meldet ein Rauchmelder oder Temperatursensor Alarm, schaltet PrintDock die Steckdosen der Drucker aus und schickt die Meldung „Notaus“.')}</span></div>
        <div class="lc"><span class="tgl"><input type="checkbox" data-em-on ${E.enabled ? 'checked' : ''}><span class="sw"></span></span></div></label>
      ${rows || `<div class="st-empty"><span>${t('Noch kein Sensor eingetragen.')}</span></div>`}
      <div class="st-foot"><button class="b b-sm" data-em="add">${ICON.plus}${t('Sensor')}</button></div>
    </div>
    <p class="meta">${withPower.length ? t('Schaltbar: {p}.', { p: withPower.map((p) => esc(p.name)).join(', ') }) : t('Noch kein Drucker hat eine Steckdose – unter Drucker → Einstellen → „Strom über Home Assistant“ eintragen.')} ${t('Ersetzt keinen Rauchmelder und keine Abschaltung in der Hardware.')}${last ? ` · ${t('Zuletzt ausgelöst: {t} ({s})', { t: tfmt(last.at), s: esc(last.sensor) })}${last.test ? ` – ${t('Test')}` : ''}` : ''}</p>
  </section>`;
}

function emergencyDialog(rule = null) {
  const E = S.emergency;
  const withPower = S.printers.filter((p) => p.settings?.powerEntity);
  const d = openDialog(`<form class="dlg" method="dialog"><h2>${rule ? t('Notaus-Sensor bearbeiten') : t('Notaus-Sensor')}</h2>
    <label>${t('Entität')}<input name="entity" required value="${esc(rule?.entity || '')}" placeholder="binary_sensor.rauchmelder_werkstatt" autocomplete="off"></label>
    <label>${t('Bezeichnung')}<input name="name" value="${esc(rule?.name || '')}" placeholder="${esc(t('z. B. Rauchmelder Werkstatt'))}"></label>
    <div class="two"><label>${t('Alarm, wenn')}<select name="mode"><option value="on" ${rule?.mode !== 'above' ? 'selected' : ''}>${t('an / erkannt')}</option><option value="above" ${rule?.mode === 'above' ? 'selected' : ''}>${t('Wert über')}</option></select></label>
      <label>${t('Wert')}<input name="value" type="number" step="any" value="${esc(rule?.value ?? 60)}"></label></div>
    <fieldset><legend>${t('Ausschalten')}</legend>${withPower.length ? withPower.map((p) => `<label class="check"><input type="checkbox" name="pr" value="${p.id}" ${!rule || !rule.printers.length || rule.printers.includes(p.id) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('') : `<p class="meta">${t('Kein Drucker mit Steckdose.')}</p>`}</fieldset>
    <p class="form-error" hidden></p>
    <div class="dlg-actions">${rule ? `<button class="b b-fault left" type="button" data-emdel>${t('Entfernen')}</button>` : ''}<button class="b" type="button" data-close>${t('Abbrechen')}</button><button class="b b-done">${t('Speichern')}</button></div></form>`);
  const form = $('form', d);
  const saveRules = async (rules) => {
    const r = await api('ha/emergency', { method: 'PUT', body: { rules } });
    S.emergency = r;
    d.close();
    render();
  };
  $('[data-emdel]', d)?.addEventListener('click', () => saveRules(E.rules.filter((x) => x.id !== rule.id)).catch((err) => formError(d, err.message)));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const sel = $$('input[name=pr]:checked', d).map((x) => x.value);
    const r = { id: rule?.id, entity: form.entity.value.trim(), name: form.name.value, mode: form.mode.value, value: form.value.value, printers: sel.length === withPower.length ? [] : sel };
    try {
      await saveRules(rule ? E.rules.map((x) => (x.id === rule.id ? r : x)) : [...E.rules, r]);
      toast(t('Gespeichert'));
    } catch (err) {
      formError(d, err.message);
    }
  });
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-em]');
  if (!b) return;
  const act = b.dataset.em;
  if (act === 'add') return emergencyDialog();
  if (act === 'edit') return emergencyDialog(S.emergency.rules.find((r) => r.id === b.dataset.id));
  if (act === 'test') {
    const r = await run(() => api('ha/emergency/test', { method: 'POST', body: { id: b.dataset.id } }), t('Probealarm gesendet (nichts ausgeschaltet)'));
    if (r) reload('emergency');
  }
});
document.addEventListener('change', async (e) => {
  if (!e.target.matches('[data-em-on]')) return;
  const r = await run(() => api('ha/emergency', { method: 'PUT', body: { enabled: e.target.checked } }), e.target.checked ? t('Notaus aktiv') : t('Notaus aus'));
  if (r) S.emergency = r;
  render();
});
