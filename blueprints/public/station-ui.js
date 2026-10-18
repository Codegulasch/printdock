/* PrintDock – Station live: was auf der PrintDock Station liegt (Tag-Daten, Gewicht, Restmenge),
   Wiegen direkt über die Station und Inventur aller Spulen. */

// Menü: Filament → Station (nur, wenn eine Station mit NFC oder Waage gekoppelt ist)
{
  const g = NAV_ALL.find((x) => x.g === 'fil');
  const i = g.v.findIndex((v) => v[0] === 'slots');
  g.v.splice(i + 1, 0, ['stlive', 'Station', 'filament', undefined, () => !S.fil || stationsLive().length > 0]);
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

/** Großer „Teller“ der Waage: leer (gestrichelt), unbekannter Tag (Akzent) oder Spule mit Restmengen-Ring */
function stPlateHTML(x, sp, unknown) {
  const R = 92;
  const C = 2 * Math.PI * R;
  const tare = sp?.tare || 0;
  const pct = sp && sp.netWeight ? Math.max(0, Math.min(100, Math.round((sp.remaining / sp.netWeight) * 100))) : 0;
  const ring = sp
    ? `<circle cx="110" cy="110" r="${R + 12}" fill="none" stroke="var(--line)" stroke-width="1"/><circle cx="110" cy="110" r="${R - 12}" fill="none" stroke="var(--line)" stroke-width="1"/><circle cx="110" cy="110" r="${R}" fill="none" stroke="var(--panel2)" stroke-width="22"/><circle cx="110" cy="110" r="${R}" fill="none" stroke="${esc(sp.color || '#888')}" stroke-width="22" stroke-dasharray="${(C * pct) / 100} ${C}" transform="rotate(-90 110 110)"/>`
    : `<circle cx="110" cy="110" r="${R + 6}" fill="none" stroke="${unknown ? 'var(--accent)' : 'var(--line)'}" stroke-width="2" stroke-dasharray="6 6"/>`;
  const g = x.weight ? `${fnum(x.weight.g, 0)} g` : '–';
  const center = sp && tare
    ? `<b class="num" data-stnet="${x.id}" data-tare="${tare}">${x.weight ? `${fnum(Math.max(0, x.weight.g - tare), 0)} g` : `${fnum(sp.remaining, 0)} g`}</b><small>${t('Rest')} · ${pct} %</small>`
    : `<b class="num" data-stg="${x.id}">${g}</b><small>${sp ? t('brutto') : unknown ? t('brutto') : x.weight && x.weight.g >= 30 ? t('brutto') : t('leer')}</small>`;
  const below = sp
    ? `<div class="stp-kv"><div><span>${t('brutto')}</span><b class="num" data-stg="${x.id}">${g}</b></div><div><span>${t('Leerspule')}</span><b class="num">${tare ? `${fnum(tare, 0)} g` : '?'}</b></div><div><span>${t('Waage')}</span><b data-ststable="${x.id}">${x.weight?.stable ? t('ruhig') : x.weight ? t('schwankt …') : t('kein Wert')}</b></div></div>`
    : unknown
      ? `<div class="stp-tag"><span class="code">${esc(x.tag.uid)}</span><small>${esc(stTagFmt(x.tag))}${x.tag.capacity ? ` · ${x.tag.capacity} B` : ''}</small></div>`
      : `<div class="stp-kv one"><span class="stable ${x.weight?.stable ? 'ok' : ''}" data-ststable="${x.id}">${x.weight?.stable ? t('ruhig') : x.weight ? t('schwankt …') : t('kein Wert')}</span><button class="b b-sm" data-fact="stTare" data-id="${x.id}" title="${esc(t('Waage auf 0 setzen (nichts auflegen)'))}">${t('Tara')}</button></div>`;
  return `<div class="stp"><div class="stp-ring"><svg viewBox="0 0 220 220" aria-hidden="true">${ring}</svg><div class="stp-c">${center}</div></div>${x.caps?.scale !== false ? below : ''}</div>`;
}

const stTagFmt = (tag) => (tag.blank || tag.format === 'blank' ? t('leerer Tag') : t(TAG_FORMATS[tag.format]?.[0] || (tag.format === 'unknown' ? 'unbekanntes Format' : tag.format) || 'unbekanntes Format'));

/** Kopfzeile je Station: Name, Verbindung, Module, Ort, Firmware, Zahnrad */
function stHeadHTML(x) {
  const F = fil();
  const c = x.caps || {};
  const chip = (on, label) => `<span class="st-chip ${on ? 'on' : ''}"><i></i>${label}</span>`;
  const chips = x.online ? [chip(c.nfc !== false, 'NFC'), chip(c.scale !== false, t('Waage')), c.display ? chip(true, t('Display')) : '', c.humidity ? chip(true, x.env ? `${t('Feuchte')} ${fnum(x.env.h, 0)} %` : t('Feuchte')) : ''].join('') : '';
  const pr = x.role === 'printer' && x.printerId ? F.printers.find((p) => p.id === x.printerId) : null;
  const where = pr ? t('am Drucker {p}', { p: esc(pr.name) }) : t('Lager / Werkbank');
  return `<div class="st-head"><h3>${esc(x.name)}</h3><span class="pill ${x.online ? 'run' : ''}">${x.online ? t('verbunden') : t('getrennt')}</span><div class="st-chips">${chips}</div>
    <span class="st-hsp"></span><span class="meta">${[where, x.fw ? `Firmware ${esc(x.fw)}` : '', x.online && x.ip ? esc(x.ip) : ''].filter(Boolean).join(' · ')}</span>
    <button class="ibtn" data-fact="stEdit" data-id="${x.id}" title="${esc(t('Einstellungen'))}" aria-label="${esc(t('{n} einstellen', { n: x.name }))}">${ICON.gear}</button></div>`;
}

/** Freie Fächer, in die eine Spule gleich gelegt werden kann */
function freeSlotsFor(sp) {
  const out = [];
  for (const p of fil().printers) for (const sl of p.slots || []) {
    if (sl.spoolId) continue;
    out.push(`<button class="b b-sm" data-fact="assign" data-printer="${esc(p.id)}" data-key="${esc(sl.key)}" data-spool="${esc(sp.id)}">${esc(p.name)} · ${esc(t(sl.label))}</button>`);
  }
  return out;
}

/** Spulen ohne Tag, die vom Gewicht her passen (für unbekannte Tags) */
function stSuggestions(x) {
  const g = x.weight?.g;
  if (!(g >= 30)) return [];
  return fil().spools.filter((s) => !s.archived && !s.rfid)
    .map((s) => ({ s, d: Math.abs(s.remaining + (s.tare || 250) - g) }))
    .filter((o) => o.d <= (o.s.tare ? 60 : 150)).sort((a, b) => a.d - b.d).slice(0, 3).map((o) => o.s);
}

function stSideHTML(x, sp, unknown) {
  const F = fil();
  if (sp) {
    const la = x.lastApply && x.lastApply.spoolId === sp.id ? x.lastApply : null;
    const r = S.res?.spools?.[sp.id];
    const armed = F.armed?.spoolId === sp.id ? F.armed : null;
    const slots = freeSlotsFor(sp);
    const kv = [
      [t('Rest'), `${fnum(sp.remaining, 0)} g`, t('von {g} g', { g: fnum(sp.netWeight, 0) })],
      [t('Zuletzt gewogen'), sp.weighedAt ? (Date.now() - Date.parse(sp.weighedAt) < 120000 ? t('eben') : t('vor {d}', { d: agoDays(sp.weighedAt) })) : t('noch nie'), ''],
      [t('Platz'), sp.slot ? spoolPlace(sp) : esc(sp.location || t('Lager')), ''],
      [t('Reserviert'), r ? `${fnum(r.reserved, 0)} g` : '–', r ? t('{n} Drucke', { n: r.jobs }) : ''],
    ].map(([k, v, m]) => `<div><span>${k}</span><b class="num">${v}</b>${m ? `<small>${m}</small>` : ''}</div>`).join('');
    const diff = la ? Math.round(la.after - la.before) : 0;
    return `<div class="st-sp">${spoolRing(sp.color, sp.netWeight ? Math.round((sp.remaining / sp.netWeight) * 100) : 0, 56)}<div><h4>${esc(sp.nr)} · ${esc(sp.material)}${sp.colorName ? ` ${esc(t(sp.colorName))}` : ''}</h4>
        <div class="meta">${[esc(sp.brand || ''), sp.diameter ? `${fnum(sp.diameter, 2)} mm` : '', x.tag ? `${t('Tag')}: ${esc(stTagFmt(x.tag))}` : ''].filter(Boolean).join(' · ')}</div></div></div>
      <div class="st-kv">${kv}</div>
      ${la ? `<div class="st-note"><b>${t('Gewicht übernommen')}</b> – ${t('Rest {a} g, vorher {b} g', { a: fnum(la.after, 0), b: fnum(la.before, 0) })}${diff ? ` (${diff > 0 ? '+' : ''}${fnum(diff, 0)} g)` : ''} <button class="lnk" data-stl="undo" data-st="${x.id}">${t('rückgängig')}</button></div>`
        : x.autoWeigh === false && x.weight ? `<div class="st-note"><button class="b b-sm b-go" data-stl="weigh" data-st="${x.id}" data-sp="${sp.id}">${t('Gewicht übernehmen')}</button> <span class="meta">${t('Automatisches Buchen ist für diese Station aus.')}</span></div>` : ''}
      <div class="st-where">
        <div class="st-opt"><b>${t('Ins Lager')}</b><span class="meta">${sp.slot ? t('Liegt in {p} – herausnehmen und einlagern.', { p: spoolPlace(sp) }) : t('Lagerort angeben, z. B. Regal oder Trockenbox.')}</span>
          <div class="st-row2"><input class="in" data-stloc="${sp.id}" list="st-locs" value="${esc(sp.location || '')}" placeholder="${esc(t('Lagerort'))}"><button class="b b-sm b-go" data-stl="store" data-sp="${sp.id}">${t('Einlagern')}</button></div>
          <datalist id="st-locs">${[...new Set(F.spools.map((s) => s.location).filter(Boolean))].map((l) => `<option value="${esc(l)}">`).join('')}</datalist></div>
        ${F.printers.length ? `<div class="st-opt"><b>${t('Einlegen in …')}</b><span class="meta">${armed ? t('Wartet aufs Einlegen – das nächste Fach, das eine frische Spule meldet, bekommt sie (bis {t}).', { t: new Date(armed.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }) : t('Fach direkt wählen:')}</span>
          <div class="btns">${slots.slice(0, 6).join('')}<button class="b b-sm" data-fact="load" data-id="${sp.id}">${t('Platz wählen …')}</button>${armed ? `<button class="b b-sm" data-fact="disarm">${t('Nicht einlegen')}</button>` : `<button class="b b-sm" data-stl="arm" data-st="${x.id}" data-sp="${sp.id}" title="${esc(t('Spule einlegen – PrintDock erkennt das Fach'))}">${t('Nächstes Fach')}</button>`}</div></div>` : ''}
      </div>
      <div class="btns"><button class="b b-sm" data-fact="sheet" data-id="${sp.id}">${t('Spule öffnen')}</button>${x.caps?.nfc !== false ? `<button class="b b-sm" data-fact="tagWrite" data-id="${sp.id}">${t('Tag beschreiben')}</button>` : ''}<button class="b b-sm" data-fact="labels" data-id="${sp.id}">${t('Etikett')}</button></div>`;
  }
  if (unknown) {
    const d = x.tag.data;
    const sugg = stSuggestions(x);
    const opts = F.spools.filter((s) => !s.archived).sort((a, b) => Boolean(a.rfid) - Boolean(b.rfid)).map((s) => `<option value="${s.id}">${esc(s.nr)} ${esc(s.material)} ${esc(t(s.colorName || ''))}${s.rfid ? ' (RFID)' : ''}</option>`).join('');
    return `<h4 class="st-big">${d ? t('Neue Spule auf dem Tag: {m}', { m: esc([d.brand, d.material].filter(Boolean).join(' ')) }) : x.tag.blank ? t('Leerer Tag – was ist das für eine Spule?') : t('Unbekannter Tag – was ist das für eine Spule?')}</h4>
      <div class="st-choice">
        <div class="st-opt pri"><b>${t('Neue Spule anlegen')}</b><span class="meta">${d ? t('Material, Farbe und Gewicht kommen vom Tag.') : t('Material, Farbe und Hersteller eintragen – der Tag gehört danach zu dieser Spule.')}</span><button class="b b-sm b-go" data-fact="${d ? 'tagCreate' : 'tagNew'}">${t('Anlegen …')}</button></div>
        <div class="st-opt"><b>${t('Vorhandene Spule')}</b><span class="meta">${t('Spule auswählen – der Tag wird ihr zugeordnet.')}</span><div class="st-row2"><select class="in" data-tagspool>${opts}</select><button class="b b-sm" data-fact="tagAssign">${t('Zuordnen')}</button></div></div>
        <div class="st-opt"><b>${t('Keine Spule')}</b><span class="meta">${t('Fremder Tag, z. B. eine Karte – einfach ignorieren.')}</span><button class="b b-sm" data-fact="tagDismiss">${t('Ignorieren')}</button></div>
      </div>
      ${sugg.length ? `<div class="meta">${t('Passt vom Gewicht:')} ${sugg.map((s) => `<button class="lnk" data-stl="sugg" data-sp="${s.id}"><b>${esc(s.nr)}</b> ${esc(s.material)} ${esc(t(s.colorName || ''))} (${fnum(s.remaining, 0)} g)</button>`).join(' · ')}</div>` : ''}`;
  }
  if (x.caps?.nfc === false) return `<h4 class="st-big">${t('Spule zum Wiegen auflegen')}</h4><p class="meta">${t('Diese Station hat keinen NFC-Leser (oder er antwortet nicht). Wiegen geht trotzdem: Spule unter Filament → Spulen wählen und „Wiegen“ – das Gewicht kommt live von hier.')}</p>`;
  const step = (n, h, txt) => `<div class="st-step"><span>${n}</span><b>${h}</b>${txt}</div>`;
  return `<h4 class="st-big">${t('Spule auflegen')}</h4>
    <div class="st-steps">${step(1, t('Auflegen'), t('Spule mit Tag auf die Waage – PrintDock erkennt sie und bucht die Restmenge nach Gewicht.'))}${step(2, t('Neuer Tag?'), t('Leere oder fremde Tags hier einer Spule zuordnen oder eine neue Spule anlegen.'))}${step(3, t('Einlegen'), t('Fach direkt wählen – oder einlegen: das nächste Fach, das eine frische Spule meldet, bekommt sie.'))}</div>
    <p class="meta">${t('Ohne Tag: Spule unter Filament → Spulen wählen und „Wiegen“ – das Gewicht kommt live von hier.')}</p>`;
}

/** Verlaufseintrag übersetzbar aus Art und Werten (ältere Einträge: Text vom Server) */
function stLogText(e) {
  const m = [e.m, e.c ? t(e.c) : ''].filter(Boolean).join(' ');
  switch (e.nr ? e.kind : '') {
    case 'weigh': return t('{nr} {m} gewogen – {g} g Rest', { nr: e.nr, m, g: fnum(e.g, 0) });
    case 'tare': return t('{nr} {m}: Leerspule {g} g gelernt', { nr: e.nr, m, g: fnum(e.g, 0) });
    case 'placed': return t('{nr} eingelegt: {w}', { nr: e.nr, w: e.w });
    case 'tag': return t('Tag {u} der Spule {nr} zugeordnet', { nr: e.nr, u: e.u });
    case 'write': return t('Tag für {nr} beschrieben', { nr: e.nr });
    case 'undo': return t('{nr}: Wiegen zurückgenommen – wieder {g} g', { nr: e.nr, g: fnum(e.g, 0) });
    default: return e.text;
  }
}

function stLogHTML(x) {
  if (!x.log?.length) return '';
  const today = todayISO();
  const when = (iso) => (iso.slice(0, 10) === today ? new Date(iso).toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' }) : tfmt(iso));
  return `<div class="st-log"><h4>${t('Zuletzt an der Station')}</h4>${x.log.slice(0, 6).map((e) => `<div class="st-lr"><span class="meta num">${when(e.at)}</span><i style="background:${esc(e.color || 'var(--muted)')}"></i><span>${esc(stLogText(e))}${e.diff ? ` <span class="${e.diff < 0 ? 'meta' : 'ok-txt'}">${e.diff > 0 ? '+' : ''}${fnum(e.diff, 0)} g</span>` : ''}</span></div>`).join('')}</div>`;
}

function vStationLive() {
  const F = fil();
  const list = stationsLive();
  const shownPending = (p) => p && list.some((x) => x.online && x.id === p.stationId && x.tag?.uid === p.tag);
  const shownArmed = (a) => a && list.some((x) => x.online && x.spool?.id === a.spoolId);
  const cards = list.map((x) => {
    const sp = x.spool;
    const unknown = !sp && x.tag && x.caps?.nfc !== false;
    let body;
    if (!x.online) body = `<div class="st-off meta">${x.lastSeen ? t('Getrennt – zuletzt {t}', { t: tfmt(x.lastSeen) }) : t('noch nie verbunden')}</div>`;
    else if (stationBare(x)) body = `<div class="st-off meta">${t('Noch keine Module erkannt – NFC-Leser (PN532) und Waage (HX711) anschließen und die Station neu starten. Bis dahin ist sie verbunden, kann aber noch nichts lesen oder wiegen.')}</div>`;
    else body = `<div class="st-body">${stPlateHTML(x, sp, unknown)}<div class="st-side">${stSideHTML(x, sp, unknown)}</div></div>`;
    return `<section class="st-card ${x.online ? '' : 'off'}">${stHeadHTML(x)}${body}${stLogHTML(x)}</section>`;
  }).join('');
  return `${stripHTML()}<div class="bar-row"><h2>${t('Station')}</h2>${scaleStations().length ? `<button class="b b-sm ${S.inv ? 'b-fault' : ''}" data-stl="${S.inv ? 'invEnd' : 'invStart'}">${S.inv ? t('Inventur beenden') : t('Inventur starten')}</button>` : ''}</div>
    ${shownPending(F.pendingTag) ? '' : pendingTagHTML(F)}${shownArmed(F.armed) ? '' : armedHTML(F)}
    ${S.inv ? inventoryHTML() : ''}
    <div class="st-list">${cards || `<div class="empty">${t('Keine Station gekoppelt.')}</div>`}</div>`;
}

/** Kleine Stationskarte für „Heute“ und die Spulen-Seite: was liegt gerade auf? */
function stationMiniHTML() {
  const list = stationsLive().filter((x) => x.online && !stationBare(x));
  if (!list.length) return '';
  return list.map((x) => {
    const sp = x.spool;
    const txt = sp ? `${esc(sp.nr)} ${esc(sp.material)}${sp.colorName ? ` ${esc(t(sp.colorName))}` : ''} · ${fnum(sp.remaining, 0)} g`
      : x.tag ? t('unbekannter Tag liegt auf') : x.weight && x.weight.g >= 30 ? `${fnum(x.weight.g, 0)} g ${t('ohne Tag')}` : t('frei');
    return `<button class="st-mini" data-view="stlive">${sp ? spoolRing(sp.color, sp.netWeight ? Math.round((sp.remaining / sp.netWeight) * 100) : 0, 32) : `<span class="st-mini-ic">${BI.spool || ''}</span>`}<span><b>${esc(x.name)}</b><small>${txt}</small></span><span class="meta">${t('Öffnen')} →</span></button>`;
  }).join('');
}

/** Hinweis von überall: etwas wurde auf eine Station gelegt */
function onStationTag(d) {
  if (S.view === 'stlive' || !d) return;
  const text = d.unknown ? t('{s}: {k} aufgelegt', { s: d.name, k: d.blank ? t('leerer Tag') : t('unbekannter Tag') })
    : t('{s}: {nr} {m} · {g} g', { s: d.name, nr: d.nr, m: [d.material, t(d.colorName || '')].filter(Boolean).join(' '), g: fnum(d.remaining, 0) });
  const el = document.createElement('div');
  el.className = 'toast act';
  el.setAttribute('role', 'status');
  el.innerHTML = `${d.color ? `<span class="swatch" style="background:${esc(d.color)}"></span>` : ''}<span>${esc(text)}</span><button class="b b-sm">${t('Ansehen')}</button>`;
  el.querySelector('button').addEventListener('click', () => { el.remove(); setView('stlive'); });
  for (const old of document.querySelectorAll('.toast.act')) old.remove();
  document.body.append(el);
  setTimeout(() => el.remove(), 8000);
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
  if (act === 'undo') {
    const r = await run(() => api(`stations/${b.dataset.st}/undo`, { method: 'POST' }), t('Zurückgenommen'));
    if (r) reload('filament', 'summary');
    return;
  }
  if (act === 'store') {
    const loc = $(`[data-stloc="${b.dataset.sp}"]`)?.value ?? undefined;
    const r = await run(() => api(`spools/${b.dataset.sp}/store`, { method: 'POST', body: { location: loc } }), t('Eingelagert'));
    if (r) reload('filament', 'summary');
    return;
  }
  if (act === 'arm') {
    const r = await run(() => api(`stations/${b.dataset.st}/arm`, { method: 'POST', body: { spoolId: b.dataset.sp } }), t('Jetzt einlegen – PrintDock erkennt das Fach'));
    if (r) reload('filament');
    return;
  }
  if (act === 'sugg') {
    const r = await run(() => api('rfid/assign', { method: 'POST', body: { spoolId: b.dataset.sp } }), t('Tag zugeordnet'));
    if (r) reload('filament');
    return;
  }
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
