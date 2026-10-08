'use strict';
/* PrintDock – Statistik: Kennzahlen, Drucke und Druckstunden im Zeitverlauf,
   Vergleich der Drucker, Material, häufigste Dateien. Ergänzt app.js. */

S.statsDays = 30;
S.statsData = null;
S.statsLoading = false;

async function loadStats() {
  if (S.statsLoading) return;
  S.statsLoading = true;
  try {
    S.statsData = await api(`stats?days=${S.statsDays}`);
  } catch {
    S.statsData = null;
  }
  S.statsLoading = false;
  if (S.view === 'stats') render();
}

const shortDate = (key) => new Date(`${key}T12:00:00`).toLocaleDateString(LOC, { day: '2-digit', month: '2-digit' });

/** Kennzahl-Kachel */
function kpi(value, label, sub = '', cls = '') {
  return `<div class="kpi ${cls}"><b class="num">${value}</b><span>${esc(label)}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
}

/** Säulen je Zeitabschnitt; segs = [{ key, label, color }]. Gestapelt, Lücke 2px, Hover-Tooltip. */
function columnChart(series, segs, { unit = '', fmt = (v) => fnum(v, 0), height = 180 } = {}) {
  const totals = series.map((b) => segs.reduce((a, s) => a + (b[s.key] || 0), 0));
  const max = Math.max(1, ...totals);
  const nice = niceMax(max);
  const step = Math.max(1, Math.ceil(series.length / 8));
  const cols = series.map((b, i) => {
    const total = totals[i];
    const label = b.bucketLabel || shortDate(b.key);
    const tip = `<b>${esc(label)}</b>${segs.map((s) => `<div><i style="background:${s.color}"></i>${esc(s.label)}: <b>${fmt(b[s.key] || 0)}${unit}</b></div>`).join('')}`;
    const parts = segs.filter((s) => b[s.key] > 0).map((s) => `<i style="height:${(b[s.key] / nice) * 100}%;background:${s.color}"></i>`).join('');
    return `<div class="cc-col" data-tip="${esc(tip)}" aria-label="${esc(`${label}: ${fmt(total)}${unit}`)}"><div class="cc-stack">${parts}</div>${i % step === 0 ? `<span class="cc-x">${esc(label)}</span>` : ''}</div>`;
  }).join('');
  return `<div class="cc" style="--h:${height}px">
    <div class="cc-y"><span>${fmt(nice)}${unit}</span><span>${Number.isInteger(nice / 2) ? fmt(nice / 2) : fnum(nice / 2, 1)}${unit}</span><span>0</span></div>
    <div class="cc-plot"><div class="cc-grid"><i></i><i></i><i></i></div><div class="cc-cols">${cols}</div></div></div>`;
}

function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function legend(segs) {
  return `<div class="legend">${segs.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('')}</div>`;
}

/** Waagrechte Balken mit Beschriftung direkt daneben. */
function hbars(rows, { value, label, right, swatch }) {
  const max = Math.max(1, ...rows.map(value));
  return `<div class="hb">${rows.map((r) => `<div class="hb-row" data-tip="${esc(`<b>${esc(label(r))}</b><div>${right(r)}</div>`)}">
    <div class="hb-l">${swatch ? `<span class="swatch" style="background:${esc(swatch(r) || 'transparent')}"></span>` : ''}${esc(label(r))}</div>
    <div class="hb-bar"><i style="width:${Math.max(value(r) > 0 ? 1.5 : 0, (value(r) / max) * 100)}%"></i></div>
    <div class="hb-v num">${right(r)}</div></div>`).join('')}</div>`;
}

function vStats() {
  const ranges = [[7, '7 Tage'], [30, '30 Tage'], [90, '90 Tage'], [365, '12 Monate'], [0, 'Gesamt']];
  const chips = ranges.map(([d, l]) => `<button class="chip" data-sact="range" data-d="${d}" aria-pressed="${S.statsDays === d}">${t(l)}</button>`).join('');
  const head = `<div class="bar-row"><h2>${t('Statistik')}</h2><div class="chips">${chips}</div></div>`;
  const d = S.statsData;
  if (!d || d.days !== S.statsDays) {
    loadStats();
    return `${head}<div class="list"><div class="empty">${t('Lade …')}</div></div>`;
  }
  const T = d.totals;
  if (!T.prints) {
    return `${head}<div class="list"><div class="empty"><h3>${t('Noch keine Daten in diesem Zeitraum')}</h3><p>${t('Sobald Drucke beendet sind, erscheinen hier Auswertungen zu Zeit, Material und Erfolgsquote.')}</p></div></div>`;
  }
  const css = getComputedStyle(document.documentElement);
  const col = (v) => css.getPropertyValue(v).trim();
  const segs = [
    { key: 'ok', label: t('erfolgreich'), color: col('--st-free') },
    { key: 'cancelled', label: t('abgebrochen'), color: col('--st-wait') },
    { key: 'failed', label: t('fehlgeschlagen'), color: col('--st-fault') },
  ];
  const series = d.series.map((b) => ({ ...b, bucketLabel: d.bucketDays > 1 ? t('Woche ab {d}', { d: shortDate(b.key) }) : shortDate(b.key) }));
  const fail = T.failed + T.cancelled;
  const kpis = `<div class="kpis">
    ${kpi(T.prints, t('Drucke'), t('{a} erfolgreich · {b} abgebrochen/fehlgeschlagen', { a: T.ok, b: fail }))}
    ${kpi(T.successRate != null ? `${T.successRate} %` : '–', t('Erfolgsquote'), '', T.successRate != null && T.successRate < 80 ? 'warn' : '')}
    ${kpi(`${fnum(T.hours, 0)} h`, t('Druckzeit'), T.avgHours != null ? t('Ø {h} h je Druck', { h: fnum(T.avgHours, 1) }) : '')}
    ${on('filament') ? kpi(`${fnum(T.grams / 1000, 2)} kg`, t('Filament'), T.cost ? t('{c} Materialkosten', { c: money(T.cost) }) : '') : ''}
  </div>`;
  const printers = d.byPrinter.filter((p) => p.prints);
  return `${head}${kpis}
    <section class="sec chart-card"><div class="cc-head"><h3>${d.bucketDays > 1 ? t('Drucke je Woche') : t('Drucke je Tag')}</h3>${legend(segs)}</div>
      ${columnChart(series, segs)}</section>
    <section class="sec chart-card"><div class="cc-head"><h3>${d.bucketDays > 1 ? t('Druckstunden je Woche') : t('Druckstunden je Tag')}</h3></div>
      ${columnChart(series, [{ key: 'hours', label: t('Druckstunden'), color: col('--accent') }], { unit: ' h', fmt: (v) => fnum(v, v < 10 ? 1 : 0), height: 140 })}</section>
    <div class="stats-2">
      <section class="sec chart-card"><div class="cc-head"><h3>${t('Drucker im Vergleich')}</h3><span class="meta">${t('nach Druckstunden')}</span></div>
        ${printers.length ? hbars(printers, {
          value: (p) => p.hours, label: (p) => p.name,
          right: (p) => `<b>${fnum(p.hours, 1)} h</b> · ${t('{n} Drucke', { n: p.prints })} · ${p.successRate} % ${t('ok')} · ${t('{u} % ausgelastet', { u: p.utilization })}`,
        }) : `<p class="meta">${t('Keine Drucke')}</p>`}</section>
      ${on('filament') && d.byMaterial.length ? `<section class="sec chart-card"><div class="cc-head"><h3>${t('Material')}</h3><span class="meta">${t('Verbrauch in Gramm')}</span></div>
        ${hbars(d.byMaterial, {
          value: (m) => m.grams, label: (m) => m.material, swatch: (m) => m.color,
          right: (m) => `<b>${fnum(m.grams, 0)} g</b>${m.cost ? ` · ${money(m.cost)}` : ''}`,
        })}</section>` : ''}
    </div>
    <div class="stats-2">
      <section class="sec chart-card"><div class="cc-head"><h3>${t('Häufigste Dateien')}</h3></div>
        <div class="list flat">${d.topFiles.map((f) => `<div class="row" style="grid-template-columns:1fr auto auto"><b style="overflow-wrap:anywhere">${esc(f.file)}</b><span class="meta num">${t('{n} Drucke', { n: f.prints })}</span><span class="meta num">${fnum(f.hours, 1)} h</span></div>`).join('')}</div></section>
      <section class="sec chart-card"><div class="cc-head"><h3>${t('Häufigste Fehler')}</h3></div>
        ${d.failReasons.length ? `<div class="list flat">${d.failReasons.map((r) => `<div class="row" style="grid-template-columns:1fr auto"><span>${esc(t(r.message))}</span><b class="num">${r.n}×</b></div>`).join('')}</div>` : `<p class="meta">${t('Keine fehlgeschlagenen Drucke – sehr gut.')}</p>`}</section>
    </div>`;
}

VIEW_FN.stats = vStats;

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-sact]');
  if (!el) return;
  if (el.dataset.sact === 'range') {
    S.statsDays = Number(el.dataset.d);
    render();
  }
});
