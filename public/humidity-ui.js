/* PrintDock – Feuchte und Trocknen: Ansicht Filament → Feuchte, Einstellungen, Sensoren zuordnen, Trockner. */

/** Kleiner Verlauf (48 h) als SVG-Linie mit Warn- und Alarmlinie */
function humSpark(series, st) {
  if (!series?.length) return '';
  const w = 160;
  const h = 34;
  const t0 = series[0][0];
  const t1 = series[series.length - 1][0] || t0 + 1;
  const x = (tt) => (series.length === 1 ? w : ((tt - t0) / Math.max(1, t1 - t0)) * w);
  const y = (v) => h - (Math.min(100, Math.max(0, v)) / 80) * h;
  const pts = series.map(([tt, v]) => `${x(tt).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return `<svg class="hspark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <line x1="0" x2="${w}" y1="${y(st.humWarn)}" y2="${y(st.humWarn)}" class="hw"/><line x1="0" x2="${w}" y1="${y(st.humAlarm)}" y2="${y(st.humAlarm)}" class="ha"/>
    <polyline points="${pts}" fill="none"/></svg>`;
}

// ================================================================ Messstellen und Trockner zusammenführen

/** Schlüssel einer Messstelle – gleich wie auf dem Server (lib/drying.js) */
const humKey = (pt) => (pt.type === 'storage' ? `@lager|${pt.name}` : `${pt.printerId}|${pt.unit || ''}`);
const humPointName = (pt) => (pt.type === 'storage' ? pt.name : `${pt.printerName}${pt.unit ? ` · ${t(pt.unit)}` : ''}`);

/** Verlauf (48 h) zur Messstelle */
function humSeriesFor(F, pt) {
  const list = F.humidity || [];
  if (pt.type === 'storage') return list.find((h) => h.storage && h.printerName === pt.name);
  const unit = pt.unit || pt.source?.name || 'Sensor';
  return list.find((h) => h.printerId === pt.printerId && (h.unit === unit || (pt.builtin && h.unit === pt.unit)));
}

const dryerFor = (F, pt) => (F.dryers || []).find((d) => d.key === humKey(pt));
const leftTxt = (iso) => {
  const m = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h` : `${m} min`;
};

/** Hinweis in der Belegung, wenn etwas zu feucht ist */
function humAlertHTML(F) {
  const bad = (F.humPoints || []).filter((pt) => pt.level === 'warn' || pt.level === 'alarm');
  if (!bad.length) return '';
  const alarm = bad.some((pt) => pt.level === 'alarm');
  return `<div class="newspool hum-alert ${alarm ? 'alarm' : ''}"><span>${BI.drop}</span><div><b>${bad.length === 1 ? t('{n} ist zu feucht', { n: esc(humPointName(bad[0])) }) : t('{n} Messstellen zu feucht', { n: bad.length })}</b>
    <small>${esc(bad.map((pt) => `${humPointName(pt)}: ${Math.round(pt.value?.pct ?? 0)} %`).join(' · '))}</small></div>
    <button class="b b-sm ${alarm ? 'b-go' : ''}" data-view="hum">${t('Feuchte & Trocknen')}</button></div>`;
}

// ================================================================ Ansicht Filament → Feuchte

function vHum() {
  const F = fil();
  const st = F.settings;
  const pts = (F.humPoints || []);
  const tiles = pts.map((pt) => {
    const has = pt.builtin || pt.source;
    const ser = humSeriesFor(F, pt);
    const dr = dryerFor(F, pt);
    const v = pt.value;
    const lvl = has && v ? pt.level : 'none';
    const state = !has ? `<span class="meta">${t('keine eigene Messung')}</span>`
      : !v ? `<span class="meta">${t('kein aktueller Wert')}</span>`
        : pt.level === 'alarm' ? `<b class="vl bad">${t('Filament trocknen')}</b>` : pt.level === 'warn' ? `<b class="vl warn">${t('Trockenmittel prüfen')}</b>` : `<span class="vl ok">${t('trocken genug')}</span>`;
    const dry = dr
      ? (dr.pending
        ? `<div class="hd-run"><span class="hd-anim">♨</span><div><b>${t('Wird gestartet …')}</b><small>${t('warte auf Rückmeldung des Geräts')}</small></div><button class="b b-sm" data-hact="dryStop" data-key="${esc(dr.key)}">${t('Abbrechen')}</button></div>`
        : dr.active
        ? `<div class="hd-run"><span class="hd-anim">♨</span><div><b>${t('Trocknet')}${dr.temp ? ` · ${dr.temp} °C` : ''}</b><small>${dr.until ? t('noch {t}', { t: leftTxt(dr.until) }) : ''}</small></div><button class="b b-sm" data-hact="dryStop" data-key="${esc(dr.key)}">${t('Stopp')}</button></div>`
        : `<button class="b b-sm ${pt.level === 'alarm' || pt.level === 'warn' ? 'b-go' : ''}" data-hact="dry" data-key="${esc(dr.key)}">♨ ${t('Trocknen …')}</button>`)
      : '';
    const spools = pt.type === 'storage' ? (pt.spools || []) : [];
    return `<article class="card humcard ${lvl}">
      <div class="hc-h"><div><b>${esc(humPointName(pt))}</b><small>${pt.builtin ? t('misst selbst') : pt.source ? (pt.source.kind === 'station' ? t('PrintDock Sensor') : esc(pt.source.name || pt.source.entity)) : t('ohne Sensor')}${dr?.model ? ` · ${esc(dr.model)}` : ''}</small></div>
        ${v ? `<div class="hc-v"><span class="num">${fnum(v.pct, 0)}<i> %</i></span>${v.temp != null ? `<small>${fnum(v.temp, 0)} °C</small>` : ''}</div>` : ''}</div>
      ${ser?.series?.length ? humSpark(ser.series, st) : ''}
      ${dr?.error ? `<div class="hd-err">⚠ ${esc(dryErrorText(dr.error))}</div>` : ''}
      <div class="hc-f"><div>${state}${spools.length ? `<small class="meta" style="display:block">${t('Spulen: {s}', { s: esc(spools.join(', ')) })}</small>` : ''}</div>
        <div class="hc-a">${dry}${!has ? `<button class="b b-sm" data-fact="humAdd" data-printer="${esc(pt.printerId || '')}" data-unit="${esc(pt.unit || '')}" ${pt.type === 'storage' ? 'data-storage="1"' : ''}>${t('Sensor zuordnen')}</button>` : ''}</div></div>
    </article>`;
  }).join('');
  const running = (F.dryers || []).filter((d) => d.active).length;
  return `${stripHTML()}<div class="bar-row"><h2>${t('Feuchte & Trocknen')}</h2>
      <span class="meta">${t('Warnung ab {w} %, Alarm ab {a} %', { w: st.humWarn, a: st.humAlarm })}${running ? ` · ${t('{n} Trockner laufen', { n: running })}` : ''}</span>
      <button class="b b-sm" data-view="humset">${NAV_ICON.gear}${t('Einrichten')}</button></div>
    ${pts.length ? `<div class="humcards">${tiles}</div>` : `<div class="list"><div class="empty"><h3>${t('Noch keine Messstellen')}</h3><p>${t('Sobald Drucker angelegt sind, erscheinen hier ihre AMS/ACE-Einheiten.')}</p></div></div>`}
    <p class="meta">${t('Trocknen per Knopf: Bambu AMS 2 Pro und AMS HT sowie Anycubic ACE Pro (LAN-Modus) direkt, Klipper-Drucker über ein Makro (z. B. ACE Pro), alles andere über Home Assistant – Trockenbox an einer Steckdose oder ein Trockner mit eigener Integration. Einrichten unter Einstellungen → Drucker & Filament → Feuchte & Trocknen.')}</p>`;
}

/** Trocknen starten – Temperatur und Dauer mit Vorschlag nach Material */
function dryDialog(key) {
  const dr = (fil().dryers || []).find((x) => x.key === key);
  if (!dr) return;
  const sg = dr.suggest || {};
  const d = openDialog(`<form class="dlg" method="dialog"><h2>♨ ${t('{n} trocknen', { n: esc(dr.name) })}</h2>
    ${sg.materials?.length ? `<p class="meta" style="margin:0">${t('Vorschlag für {m}: {t} °C · {h} h (die empfindlichste Spule bestimmt die Temperatur)', { m: esc(sg.materials.join(', ')), t: sg.temp, h: sg.hours })}</p>` : ''}
    <div class="two">${dr.tempControl ? `<label>${t('Temperatur (°C)')}<input name="temp" type="number" min="${dr.minTemp || 30}" max="${dr.maxTemp || 90}" value="${sg.temp}" required></label>` : ''}
      <label>${t('Dauer (Stunden)')}<input name="hours" type="number" min="0.5" max="48" step="0.5" value="${sg.hours}" required></label></div>
    ${dr.maxTemp ? `<p class="hint" style="margin:0">${t('Dieses Gerät: {a}–{b} °C', { a: dr.minTemp || '–', b: dr.maxTemp })}</p>` : ''}
    ${dr.tempControl ? '' : `<p class="hint" style="margin:0">${t('Die Temperatur stellst du am Trockner ein – PrintDock schaltet ein und nach Ablauf wieder aus.')}</p>`}
    <p class="form-error" hidden></p>
    <div class="dlg-actions"><button class="b" type="button" data-close>${t('Abbrechen')}</button><button class="b b-go">♨ ${t('Trocknen starten')}</button></div></form>`);
  $('form', d).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('filament/dry', { method: 'POST', body: { key, temp: f.temp?.value, hours: f.hours.value } });
      d.close();
      toast(t('Trocknen gestartet – warte auf Rückmeldung des Geräts'));
      reload('filament');
      for (const ms of [10000, 25000, 50000, 85000]) setTimeout(() => reload('filament'), ms);
    } catch (err) {
      formError(d, err.message);
    }
  });
}

// ================================================================ Einstellungen → Drucker & Filament → Feuchte & Trocknen

function vHumSettings() {
  const F = fil();
  const st = F.settings;
  const row = (label, hint, control) => `<div class="lrow"><div class="lt"><b>${label}</b>${hint ? `<span>${hint}</span>` : ''}</div><div class="lc">${control}</div></div>`;
  const num = (key, val, unit) => `<span class="inu"><input class="in" type="number" min="0" style="width:5rem" value="${esc(val)}" data-fset="${key}"><span>${unit}</span></span>`;
  return `<div class="page-head"><h1>${NAV_ICON.gear}${t('Feuchte & Trocknen')}</h1></div>
    <div class="gen-grid">
      <div>
        <h3 class="shead">${t('Messstellen')}</h3>
        ${humPointsHTML(F)}
      </div>
      <div>
        <h3 class="shead">${t('Grenzwerte')}</h3>
        <div class="sbox">
          ${row(t('Warnung ab'), t('Gelb markieren – an Drucker, Karte und Belegung.'), num('humWarn', st.humWarn, '%'))}
          ${row(t('Alarm ab'), t('Rot markieren und melden („Filament zu feucht“).'), num('humAlarm', st.humAlarm, '%'))}
        </div>
        <h3 class="shead">${t('Feuchtesensoren')}</h3>
        ${stationsHTML(F, 'sensor')}
        <p class="meta">${t('Jeder Feuchtesensor aus Home Assistant geht ebenso – z. B. ein Zigbee- oder Bluetooth-Thermometer in der Box. Zuordnen über „Sensor zuordnen“ bei der Messstelle.')}</p>
      </div>
    </div>`;
}

function humPointsHTML(F) {
  const pts = F.humPoints || [];
  const srcLabel = (src) => src.kind === 'station'
    ? `${t('PrintDock Sensor')} „${esc((F.stations?.list || []).find((x) => x.id === src.stationId)?.name || '?')}“`
    : `${esc(src.name || src.entity)} <span class="meta">(${t('Home Assistant')})</span>`;
  const val = (pt) => pt.value ? `<span class="hum ${pt.level || ''}"><b class="num">${fnum(pt.value.pct, 0)} %</b></span>` : `<span class="meta">–</span>`;
  const rows = pts.map((pt) => {
    const dr = dryerFor(F, pt);
    const sens = pt.builtin ? t('misst selbst') : pt.source ? srcLabel(pt.source) : `<span class="hp-miss">${t('keine eigene Messung')}</span>`;
    const dry = dr ? (dr.kind === 'builtin' ? `${t('trocknet selbst')} (${esc(dr.model || '')} ${dr.maxTemp ? `≤ ${dr.maxTemp} °C` : ''})` : `${dr.kind === 'gcode' ? t('Makro') : t('Home Assistant')}${dr.config?.label ? ` · ${esc(dr.config.label)}` : ''}`) : t('kein Trockner');
    const name = pt.type === 'storage' ? `<b>${esc(pt.name)}</b><small>${t('Trockenbox / Lagerort')}${pt.spools?.length ? ` · ${pt.spools.length === 1 ? t('1 Spule') : t('{n} Spulen', { n: pt.spools.length })}` : ''}</small>`
      : `<b>${esc(pt.printerName)}${pt.unit ? ` · ${esc(t(pt.unit))}` : ''}</b>`;
    return `<div class="hp-row2">
      <div class="hp-n">${name}</div><div class="hp-v">${pt.builtin || pt.source ? val(pt) : ''}</div>
      <div class="hp-line"><span class="hp-k">💧</span><span class="hp-t">${sens}</span>
        ${pt.builtin ? '' : pt.source ? `<button class="x" data-fact="humEdit" data-id="${esc(pt.source.id)}" title="${t('Sensor ändern')}">${ICON.edit}</button>` : `<button class="b b-sm" data-fact="humAdd" data-printer="${esc(pt.printerId || '')}" data-unit="${esc(pt.unit || '')}">${t('Sensor zuordnen')}</button>`}</div>
      <div class="hp-line"><span class="hp-k">♨</span><span class="hp-t ${dr ? '' : 'meta'}">${dry}</span>
        ${dr?.kind === 'builtin' ? '' : `<button class="${dr ? 'x' : 'b b-sm'}" data-hact="dryerSetup" data-key="${esc(humKey(pt))}" title="${t('Trockner einrichten')}">${dr ? ICON.edit : t('Trockner einrichten')}</button>`}</div>
    </div>`;
  }).join('');
  return `<div class="sbox hp-box">${rows || `<div class="st-empty"><span>${t('Noch keine Drucker.')}</span></div>`}
    <div class="st-foot"><button class="b b-sm" data-fact="humAdd" data-storage="1">${ICON.plus}${t('Trockenbox / Lagerort')}</button></div></div>
    <p class="meta">${t('Nicht jedes AMS, ACE oder jede Trockenbox misst selbst oder trocknet selbst. Fehlt die Messung, einen Feuchtesensor zuordnen (Home Assistant oder PrintDock Sensor). Zum Trocknen per Knopf einen Trockner einrichten: G-Code-Makro bei Klipper-Druckern oder eine Entität aus Home Assistant (Steckdose, Taste, Skript).')}</p>`;
}

/** Trockner für eine Messstelle einrichten (G-Code-Makro oder Home Assistant) */
function dryerSetupDialog(key) {
  const F = fil();
  const pt = (F.humPoints || []).find((x) => humKey(x) === key);
  if (!pt) return;
  const dr = dryerFor(F, pt);
  const c = dr?.config || {};
  const pr = pt.type === 'printer' ? S.printers.find((p) => p.id === pt.printerId) : null;
  const gcodeOk = pr && ['moonraker', 'octoprint'].includes(pr.driver);
  const method = c.method || (gcodeOk ? 'gcode' : 'ha');
  const d = openDialog(`<form class="dlg" method="dialog"><h2>♨ ${t('Trockner für {n}', { n: esc(humPointName(pt)) })}</h2>
    <label>${t('Steuerung')}<select name="method">
      ${gcodeOk ? `<option value="gcode" ${method === 'gcode' ? 'selected' : ''}>${t('G-Code-Makro am Drucker (Klipper)')}</option>` : ''}
      <option value="ha" ${method === 'ha' ? 'selected' : ''}>${t('Home Assistant (Steckdose, Taste, Skript, Integration)')}</option></select></label>
    <div data-m="gcode">
      <label>${t('Vorlage')}<select name="preset"><option value="ace">${t('ACE Pro mit Klipper-ACE-Treiber')}</option><option value="own">${t('Eigenes Makro')}</option></select></label>
      <label>${t('Start-Befehl')}<input name="start" value="${esc(c.start || 'ACE_START_DRYING TEMP={temp} DURATION={minutes}')}"></label>
      <label>${t('Stopp-Befehl')}<input name="stop" value="${esc(c.stop ?? 'ACE_STOP_DRYING')}"></label>
      <p class="hint" style="margin:0">${t('Platzhalter: {temp} (°C), {hours}, {minutes}.')}</p>
    </div>
    <div data-m="ha">
      <label>${t('Einschalten bzw. Starten')}<div data-pick="startEntity">${entityPickerHTML('startEntity', c.startEntity || '', '', S.haDryEnt ?? null, t('– bitte wählen –'))}</div></label>
      <label>${t('Stoppen (optional)')}<div data-pick="stopEntity">${entityPickerHTML('stopEntity', c.stopEntity || '', '', S.haDryEnt ?? null, t('– wie Einschalten (aus) –'))}</div></label>
      <div class="two"><label>${t('Temperatur-Entität (optional)')}<div data-pick="tempEntity">${entityPickerHTML('tempEntity', c.tempEntity || '', '', S.haDryEnt ?? null, t('– keine –'))}</div></label>
        <label>${t('Dauer-Entität (optional)')}<div data-pick="durationEntity">${entityPickerHTML('durationEntity', c.durationEntity || '', '', S.haDryEnt ?? null, t('– keine –'))}</div></label></div>
      <label>${t('Dauer angeben in')}<select name="durationUnit"><option value="min" ${c.durationUnit !== 'h' ? 'selected' : ''}>${t('Minuten')}</option><option value="h" ${c.durationUnit === 'h' ? 'selected' : ''}>${t('Stunden')}</option></select></label>
      <p class="hint" style="margin:0">${t('Steckdose oder Schalter: PrintDock schaltet ein und nach Ablauf aus. Trockner mit Integration (z. B. Anycubic ACE): Start-Taste, Stopp-Taste und die Zahl-Entitäten für Temperatur und Dauer wählen.')}</p>
    </div>
    <div class="two"><label>${t('Bezeichnung (optional)')}<input name="label" value="${esc(c.label || '')}" placeholder="${esc(t('z. B. ACE Pro, Sunlu S4'))}"></label>
      <label>${t('Höchsttemperatur (°C)')}<input name="maxTemp" type="number" min="30" max="120" value="${esc(c.maxTemp || (method === 'gcode' ? 55 : ''))}"></label></div>
    <p class="form-error" hidden></p>
    <div class="dlg-actions">${dr ? `<button class="b b-fault left" type="button" data-del>${t('Entfernen')}</button>` : ''}<button class="b" type="button" data-close>${t('Abbrechen')}</button><button class="b b-done">${t('Speichern')}</button></div></form>`);
  const form = $('form', d);
  const sync = () => $$('[data-m]', d).forEach((n) => (n.hidden = n.dataset.m !== form.method.value));
  form.method.addEventListener('change', sync);
  sync();
  form.preset?.addEventListener('change', () => {
    if (form.preset.value === 'ace') { form.start.value = 'ACE_START_DRYING TEMP={temp} DURATION={minutes}'; form.stop.value = 'ACE_STOP_DRYING'; form.maxTemp.value = 55; }
    else { form.start.value = ''; form.stop.value = ''; }
  });
  if (!S.haDryEnt && on('homeassistant')) {
    api('ha/entities?kind=dryer').then((l) => (S.haDryEnt = l)).catch(() => (S.haDryEnt = [])).finally(() => {
      if (!d.open) return;
      for (const n of ['startEntity', 'stopEntity', 'tempEntity', 'durationEntity']) {
        const box = $(`[data-pick="${n}"]`, d);
        const cur = form[n]?.value || c[n] || '';
        box.innerHTML = entityPickerHTML(n, cur, '', S.haDryEnt, n === 'startEntity' ? t('– bitte wählen –') : n === 'stopEntity' ? t('– wie Einschalten (aus) –') : t('– keine –'));
      }
    });
  }
  $('[data-del]', d)?.addEventListener('click', async () => {
    await run(() => api(`filament/dryers/${dr.config.id}`, { method: 'DELETE' }), t('Trockner entfernt'));
    d.close();
    reload('filament');
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const target = pt.type === 'storage' ? { type: 'storage', name: pt.name } : { type: 'printer', printerId: pt.printerId, unit: pt.unit || null };
    const body = {
      method: form.method.value, target, label: form.label.value, maxTemp: form.maxTemp.value,
      start: form.start?.value, stop: form.stop?.value,
      startEntity: form.startEntity?.value, stopEntity: form.stopEntity?.value, tempEntity: form.tempEntity?.value, durationEntity: form.durationEntity?.value, durationUnit: form.durationUnit.value,
    };
    try {
      await api(dr?.config ? `filament/dryers/${dr.config.id}` : 'filament/dryers', { method: dr?.config ? 'PUT' : 'POST', body });
      d.close();
      toast(t('Gespeichert'));
      reload('filament');
    } catch (err) {
      formError(d, err.message);
    }
  });
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-hact]');
  if (!el || el.disabled) return;
  const { hact, key } = el.dataset;
  if (hact === 'dry') return dryDialog(key);
  if (hact === 'dryerSetup') return dryerSetupDialog(key);
  if (hact === 'dryStop') {
    el.disabled = true;
    await run(() => api('filament/dry', { method: 'POST', body: { key, stop: true } }), t('Trocknen beendet'));
    return reload('filament');
  }
});

Object.assign(VIEW_FN, { hum: vHum, humset: vHumSettings });

/** Sensor einer Messstelle zuordnen bzw. ändern */
function humSourceDialog({ printerId = null, unit = null, storage = false, src = null } = {}) {
  const F = fil();
  const tg = src?.target || (storage ? { type: 'storage', name: '' } : { type: 'printer', printerId, unit: unit || null });
  const isStorage = tg.type === 'storage';
  const pr = F.printers.find((p) => p.id === tg.printerId);
  const sts = F.stations?.list || [];
  const locs = [...new Set(F.spools.filter((x) => !x.archived && x.location).map((x) => x.location))];
  const d = openDialog(`<form class="dlg" method="dialog"><h2>${isStorage ? (src ? esc(tg.name) : t('Trockenbox / Lagerort')) : `${esc(pr?.name || '')}${tg.unit ? ` · ${esc(t(tg.unit))}` : ''}`}</h2>
    ${isStorage ? `<label>${t('Name (wie der Lagerort der Spulen)')}<input name="loc" list="hum-locs" required value="${esc(tg.name || '')}" placeholder="${esc(t('z. B. Trockenbox 2'))}"></label><datalist id="hum-locs">${locs.map((l) => `<option value="${esc(l)}">`).join('')}</datalist>` : ''}
    <label>${t('Sensor')}<select name="kind"><option value="ha" ${src?.kind !== 'station' ? 'selected' : ''}>${t('Feuchtesensor aus Home Assistant')}</option><option value="station" ${src?.kind === 'station' ? 'selected' : ''}>PrintDock Station</option></select></label>
    <label data-k="ha">${t('Sensor in Home Assistant')}<div data-hum-pick>${entityPickerHTML('entity', src?.entity || '', '', S.haHumidity ?? null, t('– bitte wählen –'))}</div></label>
    <label data-k="station">${t('Station')}<select name="stationId">${sts.length ? sts.map((x) => `<option value="${esc(x.id)}" ${src?.stationId === x.id ? 'selected' : ''}>${esc(x.name)}${x.env ? ` – ${fnum(x.env.h, 0)} %` : x.online ? ` – ${t('kein Feuchtesensor erkannt')}` : ` – ${t('getrennt')}`}</option>`).join('') : `<option value="">${t('Keine Station gekoppelt')}</option>`}</select></label>
    <p class="form-error" hidden></p>
    <div class="dlg-actions">${src ? `<button class="b b-fault left" type="button" data-del>${t('Entfernen')}</button>` : ''}<button class="b" type="button" data-close>${t('Abbrechen')}</button><button class="b b-done">${t('Speichern')}</button></div></form>`);
  const form = $('form', d);
  const sync = () => $$('[data-k]', d).forEach((n) => (n.hidden = n.dataset.k !== form.kind.value));
  form.kind.addEventListener('change', sync);
  sync();
  if (!S.haHumidity) {
    api('ha/humidity-sensors').then((l) => (S.haHumidity = l)).catch(() => (S.haHumidity = [])).finally(() => {
      const box = $('[data-hum-pick]', d);
      if (box && d.open) box.innerHTML = entityPickerHTML('entity', form.entity?.value || src?.entity || '', '', S.haHumidity, t('– bitte wählen –'));
    });
  }
  $('[data-del]', d)?.addEventListener('click', async () => {
    await run(() => api(`filament/hum-sources/${src.id}`, { method: 'DELETE' }), t('Sensor entfernt'));
    d.close();
    reload('filament');
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const kind = form.kind.value;
    const entity = form.entity?.value.trim() || '';
    const body = {
      kind, entity, stationId: form.stationId.value,
      name: kind === 'ha' ? (S.haHumidity || []).find((x) => x.entity_id === entity)?.name || null : null,
      target: isStorage ? { type: 'storage', name: form.loc.value } : tg,
    };
    try {
      await api(src ? `filament/hum-sources/${src.id}` : 'filament/hum-sources', { method: src ? 'PUT' : 'POST', body });
      d.close();
      toast(t('Gespeichert'));
      reload('filament');
    } catch (err) {
      formError(d, err.message);
    }
  });
}


/** Grund, warum ein Trockner nicht gestartet ist */
function dryErrorText(e) {
  if (e.code === 'refused') return e.reason ? t('Der Drucker lehnt das Trocknen ab: {why}', { why: e.reason }) : t('Der Drucker lehnt das Trocknen ab');
  return t('Das Gerät hat nicht reagiert. Bei Bambu muss für Befehle aus PrintDock der LAN-Modus mit Entwicklermodus aktiv sein; während eines Drucks trocknet manches AMS nicht.');
}
