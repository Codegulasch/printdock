'use strict';
/* PrintDock – Druckerübersicht: Karten mit Bild, Plaketten, Status, Temperaturen
   mit Verlauf, Lüftern, Steuerung und Filament-Fächern. Ergänzt app.js. */

S.boardFilter = 'alle';
S.boardSearch = '';
S.tempHist = {}; // printerId -> { key: [werte] }

// ================================================================ Symbole

const BI = {
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  wifi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3 2 20h20zM12 10v4M12 17v.5"/></svg>',
  wrench: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 6.5a4 4 0 0 0 5 5L12 19l-3 1 1-3 7.5-7.5m-3-3L17 3l4 4-3.5 3.5"/></svg>',
  layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5"/></svg>',
  power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0"/></svg>',
  cube: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  thermo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z"/></svg>',
  fan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="2"/><path d="M12 10c0-4 1-7 4-7s3 4-1 6M14 12c4 0 7 1 7 4s-4 3-6-1M12 14c0 4-1 7-4 7s-3-4 1-6M10 12c-4 0-7-1-7-4s4-3 6 1"/></svg>',
  bulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/></svg>',
  drop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/></svg>',
  spool: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v6M12 15v6"/></svg>',
};

/** Druckerbild nach Bauform – Strichzeichnung, passt sich dem Farbschema an. */
function printerArt(p) {
  const key = `${p.settings?.model || ''} ${p.config?.variant || ''} ${p.name}`.toLowerCase();
  let kind = 'open';
  if (/u1|tool ?changer|werkzeug/.test(key)) kind = 'toolchanger';
  else if (/\ba1\b|bedslinger|ender|mk4|mk3|kobra 3|neptune|a1 mini/.test(key)) kind = 'bedslinger';
  else if (/x1|x2|p1|h2|s1|voron|k1|k2|enclosed|core ?one|qidi|\bx2d\b/.test(key)) kind = 'enclosed';
  const acc = 'var(--accent)';
  const art = {
    enclosed: `<svg viewBox="0 0 60 60" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="5" width="46" height="50" rx="4"/><rect x="12" y="11" width="36" height="32" rx="2" stroke-opacity=".5"/><path d="M15 17h30" stroke-width="2.5"/><rect x="26" y="15" width="8" height="7" rx="1.5" fill="${acc}" stroke="none"/><path d="M30 22v4" stroke="${acc}"/><rect x="18" y="36" width="24" height="3" rx="1" fill="currentColor" stroke="none" opacity=".5"/><rect x="24" y="30" width="12" height="6" rx="1" fill="${acc}" stroke="none" opacity=".8"/><path d="M12 49h36" stroke-opacity=".4"/></svg>`,
    bedslinger: `<svg viewBox="0 0 60 60" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 52V8h32v44"/><path d="M14 20h32" stroke-width="2.5"/><rect x="25" y="17" width="9" height="8" rx="1.5" fill="${acc}" stroke="none"/><path d="M29.5 25v4" stroke="${acc}"/><path d="M6 46h48M10 52h40"/><rect x="18" y="40" width="24" height="3" rx="1" fill="currentColor" stroke="none" opacity=".5"/><rect x="25" y="33" width="10" height="7" rx="1" fill="${acc}" stroke="none" opacity=".8"/></svg>`,
    toolchanger: `<svg viewBox="0 0 60 60" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="5" width="48" height="50" rx="4"/><path d="M10 15h40" stroke-width="2.5"/>${[0, 1, 2, 3].map((i) => `<rect x="${11 + i * 10}" y="9" width="7" height="5" rx="1" fill="${i === 1 ? acc : 'currentColor'}" stroke="none" opacity="${i === 1 ? 1 : 0.45}"/>`).join('')}<rect x="25" y="17" width="8" height="7" rx="1.5" fill="${acc}" stroke="none"/><rect x="16" y="42" width="28" height="3" rx="1" fill="currentColor" stroke="none" opacity=".5"/><rect x="23" y="33" width="12" height="9" rx="1" fill="${acc}" stroke="none" opacity=".8"/></svg>`,
    open: `<svg viewBox="0 0 60 60" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 54V8h40v46M10 8h40"/><path d="M10 22h40" stroke-width="2.5"/><rect x="26" y="19" width="8" height="8" rx="1.5" fill="${acc}" stroke="none"/><rect x="16" y="46" width="28" height="3" rx="1" fill="currentColor" stroke="none" opacity=".5"/><rect x="24" y="38" width="12" height="8" rx="1" fill="${acc}" stroke="none" opacity=".8"/></svg>`,
  };
  return art[kind];
}

// ================================================================ Temperaturverlauf

function recordTemps() {
  for (const p of S.printers) {
    const s = p.status;
    if (!s?.online) continue;
    const h = (S.tempHist[p.id] ||= {});
    const push = (k, v) => {
      if (v == null) return;
      (h[k] ||= []).push(v);
      if (h[k].length > 90) h[k].shift();
    };
    (s.nozzles || []).forEach((n, i) => push(`n${i}`, n.current));
    push('bed', s.bed?.current);
    push('ch', s.chamber?.current);
  }
}
setInterval(recordTemps, 2000);

function spark(values = [], color = 'var(--run)') {
  if (values.length < 3) return '';
  const min = Math.min(...values) - 2;
  const max = Math.max(...values) + 2;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(1)},${(30 - ((v - min) / (max - min || 1)) * 28 - 1).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts} 100,30 0,30" fill="${color}" opacity=".18"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
}

function tempTile(label, t, hist, { active = false } = {}) {
  const cur = t?.current;
  const hot = cur != null && cur > 45;
  return `<div class="tt ${hot ? 'hot' : 'cold'} ${active ? 'act' : ''}">${spark(hist, hot ? '#E8743B' : '#4C8DE0')}
    <div class="tl">${BI.thermo}${esc(label)}</div>
    <div class="tv num">${cur != null ? `${Math.round(cur)}°` : '–'}${t?.target ? `<small> / ${Math.round(t.target)}°</small>` : ''}</div></div>`;
}

// ================================================================ Karte

function cardState(p) {
  return pView(p).cls;
}

/** Statusleuchte mit Text – Farbe nie allein (Text steht immer daneben). */
/** Feuchte-Stufe nach den Grenzwerten unter Einstellungen → Filament */
const humLevelOf = (pct) => { const st = S.fil?.settings || {}; return pct >= (st.humAlarm ?? 55) ? 'alarm' : pct >= (st.humWarn ?? 40) ? 'warn' : 'ok'; };
/** Feuchte je Einheit eines Druckers: AMS/ACE-Messung und zugeordnete Sensoren (nur aktuelle Werte) */
function humFor(p) {
  const out = (p.status?.filamentUnits || []).filter((u) => u.humidityPct != null).map((u) => ({ unit: u.name, pct: u.humidityPct, temp: u.temp ?? null, level: humLevelOf(u.humidityPct), ext: false }));
  for (const h of S.fil?.humidity || []) if (h.printerId === p.id && !h.stale && !out.some((u) => u.unit === h.unit)) out.push({ unit: h.unit, pct: h.pct, temp: h.temp, level: h.level, ext: true });
  return out;
}
const DROP12 = () => BI.drop.replace('<svg', '<svg width="12" height="12" style="vertical-align:-1px"');
const lampHTML = (v) => `<span class="lamp ${v.cls}"><i class="led ${v.cls}"></i>${esc(v.lamp)}</span>`;

function headSummary() {
  const ps = S.printers;
  const st = (p) => p.status?.state || 'offline';
  const printing = ps.filter((p) => ['printing', 'preparing'].includes(st(p)));
  const n = (cls) => ps.filter((p) => pView(p).cls === cls).length;
  const item = (cls, label) => `<span class="hs-i"><i class="led ${n(cls) ? cls : 'off'}"></i><b class="num">${n(cls)}</b> ${esc(label)}</span>`;
  const next = printing.filter((p) => p.status.remainingSec != null).sort((a, b) => a.status.remainingSec - b.status.remainingSec)[0];
  return `<div class="head-sum">
    ${(() => {
      if (!on('filament')) return '';
      const all = [...ps.flatMap((p) => humFor(p)), ...(S.fil?.humidity || []).filter((h) => h.storage && !h.stale)];
      const bad = all.filter((h) => h.level === 'alarm' || h.level === 'warn');
      if (!bad.length) return '';
      const alarm = bad.some((h) => h.level === 'alarm');
      return `<button class="hs-i hs-hum ${alarm ? 'alarm' : 'warn'}" data-view="hum" title="${esc(bad.map((h) => `${h.printerName || ''} ${t(h.unit)} ${Math.round(h.pct)} %`).join(' · '))}">${DROP12()}<b class="num">${bad.length}</b> ${alarm ? t('zu feucht') : t('Feuchte prüfen')}</button>`;
    })()}
    ${item('free', t('frei'))}${item('run', t('druckt'))}${n('wait') ? item('wait', t('wartet')) : ''}${n('fault') ? item('fault', t('Störung')) : ''}${n('off') ? item('off', t('offline')) : ''}
    ${next ? `<span class="vsep"></span><span><span class="nxt">${t('Als Nächstes frei:')}</span> <b>${esc(next.name)}</b></span>
      <span class="mini"><i style="width:${next.status.progress || 0}%"></i></span><b class="num">${Math.floor(next.status.progress || 0)} %</b>
      <span class="meta" data-end-short="${Date.now() + next.status.remainingSec * 1000}">(${fmtDur(next.status.remainingSec)})</span>` : ''}
  </div>`;
}

function cardHTML(p) {
  const s = p.status || { state: 'offline', nozzles: [] };
  const v = pView(p);
  const sc = cardState(p);
  const drv = S.drivers.find((d) => d.id === p.driver);
  const item = S.queue.find((q) => q.printerId === p.id && (q.status === 'printing' || q.status === 'sending'));
  const queued = S.queue.filter((q) => q.status === 'queued' && q.printerId === p.id);
  const nextId = S.summary?.next?.[p.id];
  const next = nextId ? S.queue.find((q) => q.id === nextId) : null;
  const caps = s.capabilities || [];
  const hist = S.tempHist[p.id] || {};
  const tasks = on('maintenance') ? (S.maint?.tasks || []).filter((x) => x.printerId === p.id) : [];
  const due = tasks.filter((x) => x.state === 'due').length;
  const soon = tasks.filter((x) => x.state === 'soon').length;
  const active = ['printing', 'preparing', 'paused'].includes(s.state);
  const lastHist = S.history.find((h) => h.printerId === p.id);

  // --- Plaketten
  const badges = [];
  badges.push(`<button class="pb ${s.online ? 'ok' : 'off'}" data-act="editPrinter" data-id="${p.id}" title="${esc(t('Verbindung einstellen'))}">${BI.link}${s.online ? t('Verbunden') : t('Offline')}</button>`);
  if (s.wifi != null) badges.push(`<span class="pb ${s.wifi < -75 ? 'warn' : ''}" title="${t('WLAN-Signal')}">${BI.wifi}${s.wifi} dBm</span>`);
  if (s.online && (s.hms || p.driver === 'bambu')) badges.push(s.hms?.length ? `<button class="pb bad" data-bact="hms" data-id="${p.id}" title="${esc(t('Meldungen anzeigen'))}">${BI.alert}${s.hms.length > 1 ? t('{n} Meldungen', { n: s.hms.length }) : t('1 Meldung')}</button>` : `<span class="pb ok">${BI.alert}OK</span>`);
  if (on('filament')) {
    const hb = humFor(p).filter((h) => h.level === 'alarm' || h.level === 'warn').sort((a, b) => (a.level === 'alarm' ? -1 : 1) - (b.level === 'alarm' ? -1 : 1));
    if (hb.length) badges.push(`<button class="pb ${hb[0].level === 'alarm' ? 'bad' : 'warn'}" data-view="hum" title="${esc(hb.map((h) => `${t(h.unit)}: ${Math.round(h.pct)} % – ${h.level === 'alarm' ? t('Filament trocknen') : t('Trockenmittel prüfen')}`).join('\n'))}">${DROP12()}${esc(t(hb[0].unit))} ${Math.round(hb[0].pct)} %${hb.length > 1 ? ` +${hb.length - 1}` : ''}</button>`);
  }
  if (on('filament')) {
    for (const d of (S.fil?.dryers || []).filter((x) => x.active && x.target?.printerId === p.id)) {
      const m = d.until ? Math.max(0, Math.round((Date.parse(d.until) - Date.now()) / 60_000)) : null;
      badges.push(`<button class="pb info" data-view="hum" title="${esc(t('Trocknet'))}${d.temp ? ` · ${d.temp} °C` : ''}">♨ ${esc(t(d.target.unit || ''))} ${m != null ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h` : t('trocknet')}</button>`);
    }
  }
  if (tasks.length) badges.push(`<button class="pb ${due ? 'bad' : soon ? 'warn' : 'ok'}" data-view="maint" title="${t('Wartung')}">${BI.wrench}${due ? t('{n} fällig', { n: due }) : soon ? t('bald fällig') : 'OK'}</button>`);
  if (queued.length && on('queue')) badges.push(`<button class="pb acc" data-view="queue" title="${t('Eingeplante Drucke')}">${BI.layers}${queued.length}</button>`);
  if (p.demo) badges.push(`<span class="pb info">${t('Demo')}</span>`);

  // --- Status
  const thumbFile = item?.file || (v.mode === 'clear' ? S.files.find((f) => f.name === lastHist?.file) : null) || (active ? S.files.find((f) => f.name === s.file) : null);
  const pic = thumbFile?.thumb ? `<img src="api/files/${esc(thumbFile.id)}/thumb" alt="">` : BI.cube;
  let label;
  let info = '';
  if (item?.status === 'sending') {
    label = t('Wird übertragen');
    const slow = item.sentAt && Date.now() - item.sentAt > 3 * 60_000;
    info = `<div class="st-file">${esc(item.file?.name)}</div><div class="st-meta">${slow ? t('Der Drucker hat den Druck noch nicht gemeldet.') : t('Datei geht an den Drucker …')}</div>
      ${slow ? `<div class="btns" style="margin-top:8px"><button class="b b-sm" data-qresolve="ask" data-id="${item.id}">${t('Hängt?')}</button></div>` : ''}`;
  } else if (active || (v.mode === 'error' && s.progress != null)) {
    label = v.mode === 'error' ? t('Störung') : t(STATE_LABEL[s.state]);
    const end = s.remainingSec != null ? Date.now() + s.remainingSec * 1000 : null;
    const pct = s.progress ?? 0;
    info = `<div class="st-file">${esc(item?.file?.name || s.file || t('Druck'))}</div>
      <div class="st-meta">${item?.order ? `${esc(item.order.nr)} · ${esc(item.order.title)}` : item ? t('aus der Warteschlange') : t('am Drucker gestartet')}</div>
      <div class="prog"><div class="bar st ${sc}"><i style="width:${pct}%"></i></div><b class="num">${Math.floor(pct)} %</b></div>
      <div class="st-times">${s.remainingSec != null ? `<span>${t('noch')} <b class="num" ${s.state === 'printing' ? `data-end="${end}"` : ''}>${fmtTimer(s.remainingSec)}</b></span><span>${t('fertig um')} <b class="num">${hm(new Date(end))}</b></span>` : ''}
        ${s.layer != null && s.totalLayers ? `<span>${t('Schicht')} <b class="num">${s.layer}/${s.totalLayers}</b></span>` : ''}</div>`;
  } else if (v.mode === 'clear') {
    label = s.state === 'cancelled' ? t('Abgebrochen – Platte räumen') : t('Fertig – Platte räumen');
    info = `<div class="st-file">${esc(lastHist?.file || s.file || '')}</div><div class="st-meta">${t('Teil entnehmen, Platte prüfen und bestätigen.')}</div>
      <div class="btns" style="margin-top:10px"><button class="b b-done b-sm" data-act="plateClear" data-id="${p.id}">${ICON.check}${t('Platte ist frei')}</button></div>`;
  } else if (v.mode === 'offline') {
    label = t('Nicht erreichbar');
    info = `<div class="st-meta">${esc(t(s.message || 'Keine Verbindung.'))}</div>${on('homeassistant') && p.settings?.powerEntity && p.power === 'off' ? `<div class="btns" style="margin-top:10px"><button class="b b-go b-sm" data-bact="power" data-on="1" data-id="${p.id}">${BI.power}${t('Einschalten')}</button></div>` : ''}`;
  } else if (v.mode === 'error') {
    label = t('Störung');
  } else {
    label = t('Bereit');
    info = `<div class="st-meta">${t('Kein aktiver Druck')}</div>`;
  }
  const fault = v.mode === 'error' || (s.message && active) ? `<div class="fault"><strong>${v.mode === 'error' ? t('Störung') : t('Hinweis')}</strong>${esc(t(s.message || s.hms?.[0]?.text || 'Der Drucker meldet einen Fehler.'))}</div>` : '';

  const nextRow = !on('queue') ? '' : next && !item
    ? `<div class="nextq"><span class="ni">${BI.cal}</span><div class="nt"><small>${t('Als Nächstes')}${queued.length > 1 ? ` · ${t('+{n} weitere', { n: queued.length - 1 })}` : ''}</small><b>${esc(next.file?.name)}</b></div>
        ${v.mode === 'free' ? `<button class="b b-go b-sm" data-act="qStart" data-id="${next.id}" data-printer="${p.id}">${ICON.play}${t('Start')}</button>` : `<span class="meta">${pmodeOf(next.mode) === 'auto' ? t('startet nach „Platte frei“') : t('Start von Hand')}</span>`}</div>`
      + (typeof startInfoHTML === 'function' ? startInfoHTML(p) : '')
    : !item && v.mode === 'free' ? `<div class="nextq"><span class="ni">${BI.cal}</span><div class="nt"><small>${t('Warteschlange')}</small><b>${t('Nichts eingeplant')}</b></div><button class="b b-sm" data-act="qAdd" data-printer="${p.id}">${ICON.plus}${t('Einplanen')}</button></div>` : '';

  // --- Temperaturen
  const noz = s.nozzles || [];
  const activeNozzle = s.activeSlot?.startsWith('T') ? Number(s.activeSlot.slice(1)) : null;
  const temps = s.online
    ? `<div class="sect">${t('TEMPERATUREN')}</div><div class="pbody"><div class="temps">
        ${noz.map((n, i) => tempTile(noz.length > 1 ? t('Düse {n}', { n: t(n.name) }) : t('Düse'), n, hist[`n${i}`], { active: activeNozzle === i })).join('')}
        ${s.bed ? tempTile(t('Bett'), s.bed, hist.bed) : ''}${s.chamber ? tempTile(t('Kammer'), s.chamber, hist.ch) : ''}</div>
        ${s.fans?.length ? `<div class="fans">${s.fans.map((f) => `<span class="fan ${f.pct > 0 ? 'spin' : ''}" title="${esc(t(f.name))}">${BI.fan}${esc(t(f.name))} <b class="num">${f.pct} %</b></span>`).join('')}</div>` : ''}</div>`
    : '';

  // --- Steuerung
  const cam = s.camera && on('camera');
  const ctrls = s.online
    ? `<div class="sect">${t('STEUERUNG')}</div><div class="pbody"><div class="ctrls">
        ${caps.includes('light') ? `<button class="ibtn ${s.light ? 'on' : ''}" data-bact="light" data-id="${p.id}" data-on="${s.light ? 0 : 1}" title="${s.light ? t('Licht aus') : t('Licht an')}" aria-label="${s.light ? t('Licht ausschalten') : t('Licht einschalten')}">${BI.bulb}</button>` : ''}
        ${cam ? `<button class="ibtn ${S.cameraOpen.has(p.id) ? 'on' : ''}" data-act="cam" data-id="${p.id}" title="${t('Kamera')}" aria-label="${S.cameraOpen.has(p.id) ? t('Kamera ausblenden') : t('Kamera zeigen')}">${ICON.cam}</button>` : ''}
        ${caps.includes('speed') ? `<select class="in" data-bact-change="speed" data-id="${p.id}" aria-label="${t('Geschwindigkeit')}" ${!active ? 'disabled' : ''}>${[1, 2, 3, 4].map((l) => `<option value="${l}" ${s.speed?.level === l || (!s.speed?.level && l === 2) ? 'selected' : ''}>${t(['', 'Leise', 'Standard', 'Sport', 'Turbo'][l])}${s.speed?.level === l && s.speed?.pct ? ` · ${s.speed.pct} %` : ''}</option>`).join('')}</select>` : ''}
        <span class="grow"></span>
        ${active ? (s.state === 'paused'
          ? `<button class="b b-sm b-go" data-act="cmd" data-cmd="resume" data-id="${p.id}">${ICON.play}${t('Weiter')}</button>`
          : `<button class="b b-sm" data-act="cmd" data-cmd="pause" data-id="${p.id}" ${s.state !== 'printing' ? 'disabled' : ''}>${ICON.pause}${t('Pause')}</button>`)
          + `<button class="b b-sm b-fault" data-act="cmd" data-cmd="cancel" data-id="${p.id}">${ICON.stop}${t('Stopp')}</button>` : ''}
      </div>${cam && S.cameraOpen.has(p.id) ? '<div data-cam-slot></div>' : ''}</div>`
    : '';

  const pwr = on('homeassistant') && p.settings?.powerEntity;
  return `<article class="pc" data-id="${esc(p.id)}" data-s="${sc}">
    <div class="pc-bar" aria-hidden="true"></div>
    <header class="pc-head"><div class="pc-art">${printerArt(p)}</div>
      <div class="pc-title"><h2>${esc(p.name)}</h2><p>${esc(p.settings?.model || t(drv?.label || p.driver))}${s.nozzleDiameter ? ` · ${fnum(s.nozzleDiameter, s.nozzleDiameter * 10 % 1 ? 2 : 1)} mm` : ''}</p></div>
      <div class="pc-hr">
        ${lampHTML(v)}
        ${pwr ? `<button class="ibtn ${p.power === 'on' ? 'pwr-on' : 'pwr-off'}" data-bact="power" data-id="${p.id}" data-on="${p.power === 'on' ? 0 : 1}" title="${p.power === 'on' ? t('Steckdose ausschalten') : p.power === 'off' ? t('Steckdose einschalten') : t('Steckdose (Zustand unbekannt)')}" aria-label="${t('Strom')}">${BI.power}</button>` : ''}
        <button class="ibtn" data-act="editPrinter" data-id="${p.id}" title="${t('Einstellungen')}" aria-label="${esc(t('{n} einstellen', { n: p.name }))}">${ICON.gear}</button>
      </div></header>
    <div class="pbadges">${badges.join('')}</div>
    <div class="sect">${t('STATUS')}</div>
    <div class="pbody"><div class="status"><div class="pic">${pic}</div><div style="min-width:0"><div class="st-line"><i class="led ${sc}"></i>${esc(label)}</div>${info}</div></div>${fault}${nextRow}</div>
    ${temps}
    ${ctrls}
    ${filamentSectionHTML(p)}
  </article>`;
}

/**
 * Filament-Bereich: AMS/ACE-Einheiten bzw. Werkzeuge.
 * Mit Filamentverwaltung: zugeordnete Spulen; Plätze ohne Spule zeigen, was der Drucker meldet.
 * Ohne Filamentverwaltung: nur die Belegung, wie der Drucker sie meldet.
 */
function filamentSectionHTML(p) {
  const managed = on('filament');
  const s = p.status || {};
  const fp = managed ? (S.fil?.printers || []).find((x) => x.id === p.id) : null;
  const slots = managed ? fp?.slots || [] : s.filament || [];
  if (!slots.length || (!managed && !slots.some((x) => x.material))) return '';
  const activeSlot = fp?.activeSlot ?? s.activeSlot;
  const units = s.filamentUnits || [];
  const hums = managed ? humFor(p) : units.filter((u) => u.humidityPct != null).map((u) => ({ unit: u.name, pct: u.humidityPct, level: humLevelOf(u.humidityPct) }));
  const groups = {};
  for (const sl of slots) (groups[sl.unit || 'Spulen'] ||= []).push(sl);
  const tile = (sl) => {
    const sp = managed && sl.spoolId ? fil().spools.find((x) => x.id === sl.spoolId) : null;
    const color = sp?.color || sl.color;
    const sub = sl.brand && sl.brand !== sl.material ? sl.brand : sl.vendor || '';
    const amount = sp ? `${Math.round(sp.remaining)} g` : sl.remainPct != null ? `${sl.remainPct} %` : sl.material ? sub || t('vom Drucker') : t('leer');
    const cls = `fs ${activeSlot === sl.key ? 'act' : ''} ${sl.mismatch ? 'bad' : ''} ${sp?.low ? 'low' : ''} ${sl.unmatched ? 'new' : ''}`;
    const title = `${t(sl.label)}${sp ? ` – ${sp.nr} ${t(sp.colorName || '')}` : sl.material ? ` – ${sl.material}${sub ? ` ${sub}` : ''}${sl.unmatched ? ` · ${t('noch keine Spule angelegt')}` : ''}` : ''}`;
    const inner = `<span class="dot ${color ? '' : 'nocolor'}" style="${color ? `background:${esc(color)}` : ''}"></span>
      <b>${esc(sp?.material || sl.material || '–')}</b><small>${esc(amount)}</small><small>${esc(t(sl.label).replace(/^.*· /, '#'))}</small>`;
    return managed
      ? `<button class="${cls}" data-fact="pickSpool" data-printer="${p.id}" data-key="${esc(sl.key)}" title="${esc(title)}">${inner}</button>`
      : `<div class="${cls} ro" title="${esc(title)}">${inner}</div>`;
  };
  const unmatched = slots.filter((x) => x.unmatched);
  const prompt = managed && unmatched.length
    ? `<div class="newspool"><span>${BI.spool}</span><div><b>${unmatched.length === 1 ? t('Neue Spule erkannt') : t('{n} neue Spulen erkannt', { n: unmatched.length })}</b>
        <small>${esc(unmatched.map((x) => `${t(x.label)}: ${x.material}`).join(' · '))}</small></div>
        <button class="b b-sm b-go" data-fact="newSpools" data-printer="${p.id}">${t('Anlegen')}</button><button class="x" data-fact="ignoreSlots" data-printer="${p.id}" title="${esc(t('Nicht als Spule verwalten'))}">${t('Ignorieren')}</button></div>`
    : '';
  return `<div class="sect">${t('FILAMENT')}<span class="r">${managed ? `<button class="x" data-view="slots" style="font-size:12.5px">${t('Belegung')}</button>` : ''}</span></div><div class="pbody">${prompt}<div class="fil-units">
    ${Object.entries(groups).map(([name, list]) => {
      const u = units.find((x) => x.name === name);
      const h = hums.find((x) => x.unit === name);
      const lvl = h?.level || '';
      const humTxt = h ? `<span class="hum ${lvl}" title="${esc(`${lvl === 'alarm' ? t('Filament trocknen') : lvl === 'warn' ? t('Trockenmittel prüfen') : t('Luftfeuchte')}${h.ext ? ` · ${t('externer Sensor')}` : ''}`)}">${DROP12()} ${fnum(h.pct, 0)} %</span>` : u?.humidity != null ? t('Feuchte-Stufe {n}', { n: u.humidity }) : '';
      const temp = u?.temp ?? h?.temp;
      const meta = [humTxt, temp != null ? `${Math.round(temp)} °C` : ''].filter(Boolean).join(' · ');
      return `<div class="fu"><div class="fu-h">${esc(t(name))}<span>${meta}</span></div><div class="fu-slots">${list.map(tile).join('')}</div></div>`;
    }).join('')}
    ${hums.filter((h) => !groups[h.unit]).map((h) => `<div class="fu-ext"><span class="hum ${h.level}">${DROP12()} ${esc(t(h.unit))}: ${fnum(h.pct, 0)} %</span></div>`).join('')}</div></div>`;
}

/** HMS-Meldungen (Bambu) mit Klartext, Wiki-Link und „als Wartung eintragen“. */
async function hmsDialog(p) {
  const d = openDialog(`<div class="dlg"><h2>${esc(p.name)} · ${t('Meldungen')}</h2><div data-hms><p class="meta">${t('Lade …')}</p></div>
    <div class="dlg-actions"><button class="b" data-close>${t('Schließen')}</button></div></div>`, { wide: true });
  let list = [];
  try { list = await api(`printers/${p.id}/hms`); } catch (err) { $('[data-hms]', d).innerHTML = `<p class="form-error">${esc(err.message)}</p>`; return; }
  $('[data-hms]', d).innerHTML = list.length ? `<div class="list">${list.map((h, i) => `<div class="row hms-row">
      <div class="c-main"><b class="code">${esc(h.code)}</b><div>${h.text ? esc(h.text) : `<span class="meta">${t('Kein Klartext verfügbar – Details im Bambu-Wiki.')}</span>`}</div></div>
      <div class="acts"><a class="b b-sm" href="${esc(h.url)}" target="_blank" rel="noopener">${ICON.open}${t('Bambu-Wiki')}</a>
        ${on('maintenance') ? `<button class="b b-sm" data-hms-task="${i}">${ICON.wrench}${t('Als Wartung eintragen')}</button>` : ''}</div></div>`).join('')}</div>
      <p class="meta" style="margin:10px 0 0">${t('Meldungen verschwinden, sobald der Drucker sie nicht mehr meldet – meist nach dem Bestätigen am Drucker oder in Bambu Handy.')}</p>`
    : `<p>${t('Keine Meldungen.')}</p>`;
  d.addEventListener('click', (e) => {
    const b = e.target.closest('[data-hms-task]');
    if (!b) return;
    const h = list[Number(b.dataset.hmsTask)];
    d.close();
    taskDialog(null, { printerId: p.id, title: (h.text || `HMS ${h.code}`).slice(0, 80), note: `HMS ${h.code}` });
  });
}

// ================================================================ Ansicht

function vBoard() {
  if (!S.printers.length) {
    return `<div class="page-head"><h1>${NAV_ICON.printer}${t('Drucker#pl')}</h1></div>
      <div class="list"><div class="empty"><h3>${t('Noch kein Drucker angelegt')}</h3>
      <p>${t('Lege deinen ersten Drucker an – oder spiele Demo-Daten ein, um alles mit simulierten Druckern auszuprobieren.')}</p>
      <div class="btns" style="justify-content:center"><button class="b b-go" data-act="editPrinter">${ICON.plus}${t('Drucker hinzufügen')}</button>${on('demo') ? `<button class="b" data-view="system">${t('Demo-Daten ansehen')}</button>` : ''}</div></div></div>`;
  }
  const q = S.boardSearch.trim().toLowerCase();
  const list = S.printers.filter((p) => {
    if (q && !`${p.name} ${p.settings?.model || ''}`.toLowerCase().includes(q)) return false;
    const m = pView(p).mode;
    if (S.boardFilter === 'aktiv') return m === 'active' && p.status?.state !== 'paused';
    if (S.boardFilter === 'frei') return m === 'free';
    if (S.boardFilter === 'achtung') return ['clear', 'error', 'offline'].includes(m) || p.status?.state === 'paused';
    return true;
  });
  const chips = [['alle', 'Alle'], ['aktiv', 'Druckt'], ['frei', 'Frei'], ['achtung', 'Achtung']]
    .map(([k, l]) => `<button class="chip" data-bact="filter" data-k="${k}" aria-pressed="${S.boardFilter === k}">${t(l)}</button>`).join('');
  return `<div class="page-head"><h1>${NAV_ICON.printer}${t('Drucker#pl')}</h1>
      <div class="tools"><input class="search" type="search" placeholder="${esc(t('Drucker suchen …'))}" value="${esc(S.boardSearch)}" data-bact-input="search" aria-label="${esc(t('Drucker suchen'))}"><div class="chips">${chips}</div>
      <button class="b b-sm b-go" data-act="editPrinter">${ICON.plus}${t('Drucker')}</button></div>
      <div id="headsum" style="width:100%">${headSummary()}</div></div>
    <div class="grid" id="board">${list.map(cardHTML).join('') || `<div class="list"><div class="empty">${t('Kein Drucker passt zum Filter.')}</div></div>`}</div>`;
}

function updateTile(id) {
  const el = $(`.pc[data-id="${CSS.escape(id)}"]`);
  const p = printerById(id);
  if (!el || !p) return;
  // Offene Auswahlfelder nicht unter dem Finger austauschen
  if (el.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return;
  holdScroll(() => {
    // Nur Geändertes austauschen statt die ganze Karte: Bilder und Höhe bleiben stehen
    const tpl = document.createElement('template');
    tpl.innerHTML = cardHTML(p);
    morphNode(el, tpl.content.firstElementChild);
    attachCameras();
    const hs = $('#headsum');
    if (hs) morph(hs, headSummary());
  });
}

VIEW_FN.board = vBoard;

// ================================================================ Aktionen

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-bact]');
  if (!el || el.disabled) return;
  const { bact, id } = el.dataset;
  const p = id ? printerById(id) : null;
  if (bact === 'filter') {
    S.boardFilter = el.dataset.k;
    return render();
  }
  if (bact === 'hms') return hmsDialog(p);
  if (bact === 'light') {
    el.disabled = true;
    await run(() => api(`printers/${id}/command`, { method: 'POST', body: { cmd: 'light', on: el.dataset.on === '1' } }));
    return;
  }
  if (bact === 'power') {
    const turnOn = el.dataset.on === '1';
    if (!turnOn && !(await confirmBox(t('Drucker ausschalten'), t('Steckdose von „{p}“ über Home Assistant ausschalten?', { p: p.name }), t('Ausschalten'), 'b-fault'))) return;
    el.disabled = true;
    await run(() => api(`printers/${id}/power`, { method: 'POST', body: { on: turnOn } }), turnOn ? t('Wird eingeschaltet …') : t('Ausgeschaltet'));
    return reload('printers');
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target.closest('[data-bact-change="speed"]');
  if (!el) return;
  await run(() => api(`printers/${el.dataset.id}/command`, { method: 'POST', body: { cmd: 'speed', level: Number(el.value) } }), t('Geschwindigkeit geändert'));
  el.blur();
});

let searchTimer;
document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-bact-input="search"]');
  if (!el) return;
  S.boardSearch = el.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const pos = el.selectionStart;
    render();
    const ni = $('[data-bact-input="search"]');
    if (ni) {
      ni.focus();
      ni.setSelectionRange(pos, pos);
    }
  }, 250);
});
