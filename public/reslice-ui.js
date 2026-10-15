'use strict';
/* PrintDock – Umslicen: fehlende Varianten eines Teils mit OrcaSlicer auf dem PC erzeugen.
   Einstellungen → Umslicen (Helfer koppeln, gelernte Profile, letzte Aufträge), „Für … slicen“ bei den Teilen
   und ein Vorschlag auf „Heute“, wenn ein freier Drucker keine Variante hat. */

const RS_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h11M4 12h8M4 17h6"/><path d="M20 11a5 5 0 0 0-8.5-3.5M14 17a5 5 0 0 0 6-5"/><path d="m11.5 4.5 0 3h3M20.5 19.5v-3h-3"/></svg>';
const RS_RELEASES = 'https://github.com/Codegulasch/printdock/releases/latest/download/';

// Einstellungen: eigener Punkt vor „System“ (nur mit eingeschaltetem Modul)
{
  const g = NAV_ALL.find((x) => x.g === 'set');
  const i = g.v.findIndex((v) => v[0] === 'system');
  g.v.splice(i, 0, ['reslice', 'Umslicen', 'reslice']);
  const j = SET_NAV.findIndex((v) => v[0] === 'system');
  SET_NAV.splice(j, 0, ['reslice', 'Umslicen', RS_ICON, 'OrcaSlicer-Helfer, gelernte Profile']);
}

loaders.reslice = async () => {
  const before = S.rs;
  try {
    S.rs = on('reslice') && on('files') ? await api('reslice') : null;
    S.rsErr = on('reslice') && !on('files') ? 'Umslicen braucht die Funktion „Dateien“' : null;
  } catch (err) {
    S.rsErr = err.message;
    throw err;
  }
  // fertig / fehlgeschlagen: kurz Bescheid geben
  if (before?.jobs && S.rs?.jobs) {
    for (const j of S.rs.jobs) {
      const old = before.jobs.find((x) => x.id === j.id);
      if (!old || old.status === j.status) continue;
      if (j.status === 'done') toast(t('„{p}“ für {pr} ist geslict – die Variante ist da', { p: j.partName, pr: j.printerName }));
      if (j.status === 'failed') toast(t('Umslicen fehlgeschlagen: {p} für {pr}', { p: j.partName, pr: j.printerName }), true);
    }
  }
  return S.rs;
};

// Modul gerade eingeschaltet (oder aus): Daten nachladen – sonst bliebe die Seite bei „Lade …“ stehen
{
  const appLoader = loaders.app;
  loaders.app = async () => {
    const r = await appLoader();
    if (on('reslice') && on('files') ? !S.rs : S.rs) reload('reslice');
    return r;
  };
}

const rsOpenJob = (partId, printerId) => (S.rs?.jobs || []).find((j) => j.partId === partId && j.printerId === printerId && ['queued', 'running', 'failed'].includes(j.status));
const rsOnline = () => Boolean(S.rs?.helper?.online);

/** Abdeckung eines Teils je Drucker (Teile-Ansicht): fehlt die Variante → „slicen“ */
function rsCoverHTML(p, c) {
  if (c.fileId || !on('reslice') || !S.rs) return null;
  const j = rsOpenJob(p.id, c.printerId);
  if (j?.status === 'queued' || j?.status === 'running') {
    return `<span class="pt-cov rs-busy" title="${esc(j.status === 'running' ? t('Wird gerade geslict') : rsOnline() ? t('Wartet auf den Helfer') : t('Wartet – der Helfer auf dem PC ist nicht verbunden'))}">⟳ ${esc(c.name)}</span>`;
  }
  if (j?.status === 'failed') return `<button class="pt-cov rs-bad" data-rs="job" data-id="${esc(j.id)}" title="${esc(j.error || '')}">⚠ ${esc(c.name)}</button>`;
  return `<button class="pt-cov rs-go" data-rs="open" data-part="${esc(p.id)}" data-printer="${esc(c.printerId)}" title="${esc(t('Variante für {p} mit OrcaSlicer erzeugen', { p: c.name }))}">⟳ ${esc(c.name)} <small>${t('slicen')}</small></button>`;
}

// ---------------------------------------------------------------- Dialog „Für <Drucker> slicen“

async function resliceDialog(partId, printerId) {
  let P;
  try {
    P = await api(`reslice/plan?part=${encodeURIComponent(partId)}&printer=${encodeURIComponent(printerId)}`);
  } catch (err) {
    return toast(err.message, true);
  }
  if (!P.sources.length) {
    return confirmBox(t('Für {p} slicen', { p: P.printer.name }), t('Zu „{part}“ gibt es keine Datei mit Modell. Bitte die Projekt-3MF (oder STL/STEP) hochladen und dem Teil zuordnen – geslicte G-code-Dateien enthalten kein Modell mehr.', { part: P.part.name }), t('OK'));
  }
  const slots = (printerById(printerId)?.status?.filament || []).filter((s) => s.material);
  const prof = P.profile;
  const profLine = prof
    ? t('Profil: gelernt aus „{f}“ ({d}){a}', { f: esc(prof.fileName), d: dfmt(prof.at), a: prof.app ? ` · ${esc(prof.app)}` : '' })
    : t('Noch kein Profil für {p} gelernt – es werden Orcas Standardprofile genommen. Tipp: einmal eine 3MF für diesen Drucker hochladen.', { p: esc(P.printer.name) });
  const helper = P.helper?.online ? `<span class="pill run">${t('Helfer verbunden')}</span> <span class="meta">${esc(P.helper.name || '')}</span>` : `<span class="pill pause">${t('Helfer nicht verbunden')}</span> <span class="meta">${t('Der Auftrag wartet, bis der Helfer auf dem PC läuft.')}</span>`;
  const srcOpt = (s) => `<option value="${esc(s.id)}">${esc(s.name)}${s.printerModel ? ` (${esc(s.printerModel)})` : ''}${s.kind === '3mf' && !s.printable ? ` · ${t('Projekt')}` : ''}</option>`;
  const matOpts = (sel) => P.materials.map((m) => `<option value="${esc(m)}" ${m === sel ? 'selected' : ''}>${esc(m)}${P.learnedMaterials.includes(m) ? ' ✓' : ''}</option>`).join('');
  const filRows = (s) => {
    const used = s.filaments.map((f, i) => ({ ...f, i })).filter((f) => f.used);
    const rows = (used.length ? used : s.filaments.map((f, i) => ({ ...f, i }))).map((f) => {
      const type = String(f.type || 'PLA').toUpperCase();
      const slot = slots.find((x) => x.color && f.color && x.color.toLowerCase() === f.color.toLowerCase()) || slots.find((x) => String(x.material).toUpperCase() === type);
      return `<div class="rs-fil"><span class="dot ${f.color ? '' : 'nocolor'}" style="${f.color ? `background:${esc(f.color)}` : ''}"></span><span>${t('Farbe {n}', { n: f.i + 1 })}</span>
        <select class="in" name="mat${f.i}">${matOpts(P.materials.includes(type) ? type : 'PLA')}</select>
        <span class="meta">${slot ? t('im Drucker: {s}', { s: `${esc(t(slot.label))} · ${esc(slot.material)}` }) : ''}</span></div>`;
    }).join('');
    const warn = slots.length && used.length > slots.length ? `<p class="meta" style="color:var(--warn)">${t('Das Teil nutzt {n} Farben, der Drucker meldet {m} Plätze.', { n: used.length, m: slots.length })}</p>` : '';
    return `${rows}${warn}`;
  };
  const d = openDialog(`<form class="dlg" method="dialog" style="max-width:620px"><h2>${t('„{p}“ für {pr} slicen', { p: esc(P.part.name), pr: esc(P.printer.name) })}</h2>
    <p class="meta" style="margin:0">${profLine}</p>
    <div>${helper}</div>
    ${P.sources.length > 1 ? `<label>${t('Quelle')}<select name="src">${P.sources.map(srcOpt).join('')}</select></label>` : `<p class="meta" style="margin:0">${t('Quelle: {f}', { f: esc(P.sources[0].name) })}</p>`}
    <div data-plate></div>
    <div><b>${t('Filament')}</b><p class="meta" style="margin:2px 0 6px">${t('Welches Material je Farbe? ✓ = Profil vom Drucker gelernt. Welche Spule/Slot es wird, entscheidet sich wie gewohnt beim Start.')}</p><div data-fils></div></div>
    <p class="meta">${t('Übernommen werden aus der Quelle: Schichthöhe, Wände, Füllung, Stützen, Brim, Naht. Alles andere kommt vom Profil des Zieldruckers. Ergebnis: {k} als neue Variante für {p}.', { k: P.printer.output === '3mf' ? '.gcode.3mf' : '.gcode', p: esc(P.printer.name) })}</p>
    <p class="form-error" hidden></p>
    <div class="dlg-actions"><button class="b" type="button" data-close>${t('Abbrechen')}</button><button class="b b-go">${RS_ICON.replace('<svg ', '<svg class="ico" ')}${t('Slicen')}</button></div></form>`);
  const form = $('form', d);
  const cur = () => P.sources.find((s) => s.id === (form.src?.value || P.sources[0].id));
  const draw = () => {
    const s = cur();
    $('[data-fils]', d).innerHTML = filRows(s);
    $('[data-plate]', d).innerHTML = s.plates.length > 1 ? `<label>${t('Platte')}<select name="plate">${s.plates.map((n) => `<option value="${n}">${t('Platte {n}', { n })}</option>`).join('')}</select></label>` : '';
  };
  draw();
  form.src?.addEventListener('change', draw);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const s = cur();
    const materials = s.filaments.map((f, i) => form[`mat${i}`]?.value || String(f.type || 'PLA').toUpperCase());
    try {
      await api('reslice/jobs', { method: 'POST', body: { partId, printerId, sourceFileId: s.id, plate: Number(form.plate?.value || 1), materials } });
      d.close();
      toast(rsOnline() ? t('An den Helfer übergeben – wird geslict') : t('Auftrag angelegt – wird geslict, sobald der Helfer läuft'));
      reload('reslice');
    } catch (err) {
      formError(d, err.message);
    }
  });
}

/** Fehlgeschlagener Auftrag: Grund, Protokoll, nochmal */
function resliceJobDialog(id) {
  const j = (S.rs?.jobs || []).find((x) => x.id === id);
  if (!j) return;
  const d = openDialog(`<form class="dlg" method="dialog" style="max-width:640px"><h2>${t('Umslicen: {p} für {pr}', { p: esc(j.partName), pr: esc(j.printerName) })}</h2>
    <p><b>${esc(t(j.error || 'Slicen fehlgeschlagen'))}</b></p>
    ${j.hint && j.hint !== j.error ? `<p class="meta">${esc(t(j.hint))}</p>` : ''}
    <p class="meta">${t('Quelle: {f}', { f: esc(j.sourceName || '?') })}${j.attempt ? ` · ${t('zuletzt mit: {a}', { a: esc(rsAttemptLabel(j.attempt)) })}` : ''} · ${tfmt(j.doneAt)}</p>
    ${j.log ? `<details><summary>${t('Ausgabe von OrcaSlicer')}</summary><pre class="rs-log">${esc(j.log)}</pre></details>` : ''}
    <div class="dlg-actions"><button class="b left del" type="button" data-rsdel>${ICON.trash}${t('Entfernen')}</button><button class="b" type="button" data-close>${t('Schließen')}</button><button class="b b-go" type="button" data-rsretry>${t('Nochmal versuchen')}</button></div></form>`);
  $('[data-rsretry]', d).addEventListener('click', async () => {
    await run(() => api(`reslice/jobs/${id}/retry`, { method: 'POST' }), t('Wird nochmal geslict'));
    d.close();
    reload('reslice');
  });
  $('[data-rsdel]', d).addEventListener('click', async () => {
    await run(() => api(`reslice/jobs/${id}`, { method: 'DELETE' }));
    d.close();
    reload('reslice');
  });
}

const rsAttemptLabel = (a) => ({ learned: t('gelerntes Profil'), 'orca-machine': t('gelerntes Profil mit Orca-Drucker'), orca: t('Orca-Standardprofile') })[a] || a;

// ---------------------------------------------------------------- Heute: freier Drucker ohne Variante

function resliceSuggestions() {
  if (!on('reslice') || !on('queue') || !S.rs) return [];
  const out = [];
  const seen = new Set();
  for (const q of S.queue || []) {
    if (!q.partId || q.status !== 'queued' || q.printerId) continue;
    const part = partById(q.partId);
    if (!part) continue;
    for (const c of part.cover) {
      const p = printerById(c.printerId);
      const key = `${part.id}:${c.printerId}`;
      if (c.fileId || seen.has(key) || !p || p.status?.state !== 'idle' || !inAreaP(p)) continue;
      if (rsOpenJob(part.id, c.printerId) || (S.rs.dismissed || []).includes(key)) continue;
      if (!part.variants.some((v) => v.source !== 'reslice')) continue;
      seen.add(key);
      out.push({ part, p });
    }
  }
  return out.slice(0, 4);
}

function resliceTodoHTML() {
  return resliceSuggestions().map(({ part, p }) => todo('info td-wide', '⟳', t('{p} ist frei – für „{part}“ gibt es keine Variante', { p: esc(p.name), part: esc(part.name) }),
    t('Mit OrcaSlicer eine Variante erzeugen, dann druckt {p} mit', { p: esc(p.name) }),
    `<button class="b b-sm b-go" data-rs="open" data-part="${esc(part.id)}" data-printer="${esc(p.id)}">${t('Slicen …')}</button><button class="b b-sm" data-rs="dismiss" data-part="${esc(part.id)}" data-printer="${esc(p.id)}">${t('Nicht')}</button>`)).join('');
}

// ---------------------------------------------------------------- Einstellungen → Umslicen

function vReslice() {
  const R = S.rs;
  if (!R) {
    if (!S.rsErr && !S.rsLoading) {
      S.rsLoading = true;
      loaders.reslice().catch(() => {}).finally(() => { S.rsLoading = false; render(); });
    }
    return `<div class="page-head"><h1>${t('Umslicen')}</h1></div><div class="empty">${S.rsErr ? `${esc(t(S.rsErr))} <button class="b b-sm" data-rs="reload">${t('Nochmal versuchen')}</button>` : t('Lade …')}</div>`;
  }
  const h = R.helper;
  const addr = S.app?.directUrl || location.origin;
  const status = h
    ? `${h.online ? `<span class="pill run">${t('verbunden')}</span>` : `<span class="pill pause">${t('nicht verbunden')}</span>`} <span class="meta">${esc(h.name || '')}${h.os ? ` · ${esc(h.os)}` : ''}${h.online ? '' : ` · ${t('zuletzt {d}', { d: tfmt(h.lastSeen) })}`}</span>`
    : `<span class="pill pause">${t('noch nie verbunden')}</span>`;
  const orca = h?.orca ? `${esc(h.orca.version ? `OrcaSlicer ${h.orca.version}` : 'OrcaSlicer')} <span class="meta">${esc(h.orca.path || '')}${h.orca.profiles ? ` · ${t('{n} Profile', { n: h.orca.profiles })}` : ` · ${t('keine Systemprofile gefunden')}`}</span>` : '–';
  const known = (model) => {
    if (!h?.models?.length || !model) return '';
    const m = normModel(model);
    return h.models.some((x) => normModel(x).includes(m) || m.includes(normModel(x))) ? `<span class="pill run" title="${esc(t('Orca kennt diesen Drucker'))}">Orca ✓</span>` : `<span class="pill pause" title="${esc(t('Orca kennt dieses Druckermodell nicht – nur mit gelerntem Profil'))}">Orca ?</span>`;
  };
  const dl = [['Windows', 'printdock-slicer-win-x64.exe'], ['macOS (Apple)', 'printdock-slicer-macos-arm64'], ['macOS (Intel)', 'printdock-slicer-macos-x64'], ['Linux', 'printdock-slicer-linux-x64']];
  const code = R.token ? `<span class="code">${esc(R.token)}</span><button class="b b-sm" data-act="copy" data-text="${esc(R.token)}">${t('Kopieren')}</button><button class="b b-sm" data-rs="token">${t('Neu erzeugen')}</button>` : '–';
  const profiles = R.profiles.map((p) => `<div class="lrow"><div class="lt"><b>${esc(p.printerName)} ${known(p.model || p.printerModel)}</b><span>${p.learned
    ? `${t('aus „{f}“', { f: esc(p.fileName) })} · ${dfmt(p.at)}${p.app ? ` · ${esc(p.app)}` : ''}${p.layerHeight ? ` · ${fnum(p.layerHeight, 2)} mm` : ''}${p.nozzle ? ` · ${t('Düse {n}', { n: fnum(p.nozzle, 1) })}` : ''}${p.materials?.length ? ` · ${esc(p.materials.join(', '))}` : ''}`
    : t('Noch nichts gelernt – Orca-Standardprofil. Eine 3MF für diesen Drucker hochladen.')}</span></div>
    <div class="lc">${p.learned ? `<button class="b b-sm" data-rs="forget" data-printer="${esc(p.printerId)}">${t('Vergessen')}</button>` : ''}</div></div>`).join('');
  const st = { queued: [t('wartet'), 'pause'], running: [t('wird geslict'), 'run'], done: [t('fertig'), 'done'], failed: [t('Fehler'), 'bad'], cancelled: [t('abgebrochen'), 'done'] };
  const jobs = R.jobs.slice(0, 15).map((j) => `<div class="lrow"><div class="lt"><b>${esc(j.partName)} → ${esc(j.printerName)} <i class="pill ${st[j.status]?.[1] || ''}">${st[j.status]?.[0] || j.status}</i></b>
      <span>${tfmt(j.createdAt)}${j.sourceName ? ` · ${t('aus {f}', { f: esc(j.sourceName) })}` : ''}${j.status === 'done' && j.attempt ? ` · ${esc(rsAttemptLabel(j.attempt))}` : ''}${j.status === 'failed' ? ` · ${esc(t(j.error || ''))}` : ''}</span></div>
      <div class="lc">${j.status === 'failed' ? `<button class="b b-sm" data-rs="job" data-id="${esc(j.id)}">${t('Details …')}</button>` : ''}${['queued', 'running'].includes(j.status) ? `<button class="b b-sm" data-rs="cancel" data-id="${esc(j.id)}">${t('Abbrechen')}</button>` : `<button class="x del" data-rs="cancel" data-id="${esc(j.id)}" title="${esc(t('Entfernen'))}">${ICON.trash}</button>`}</div></div>`).join('');

  return `<div class="page-head"><h1>${t('Umslicen')}</h1></div>
    <p class="meta" style="margin-top:-6px">${t('Fehlt einem Teil die Variante für einen Drucker, slict der Helfer auf deinem PC sie mit OrcaSlicer – mit den Einstellungen, die PrintDock aus deinen Uploads für diesen Drucker gelernt hat. Ergebnis: eine neue Variante, die Warteschlange und Aufträge gleich nutzen.')}</p>
    ${setSection('rs-helper', t('Helfer auf dem PC'), `<div class="sbox">
      ${lrow(t('Status'), '', status)}
      ${h ? lrow(t('Slicer'), '', `<span>${orca}</span>`) : ''}
    </div>
    <div class="sbox rs-steps">
      ${lrow(`1 · ${t('OrcaSlicer installieren')}`, t('Kostenlos, für Windows, macOS und Linux. Einmal starten, damit die Druckerprofile eingerichtet sind.'), `<a class="b b-sm" href="https://github.com/SoftFever/OrcaSlicer/releases/latest" target="_blank" rel="noopener">${t('Herunterladen')}</a>`)}
      ${lrow(`2 · ${t('Helfer herunterladen')}`, t('Ein kleines Programm ohne Installation. macOS/Linux: einmal ausführbar machen (chmod +x) – macOS beim ersten Start mit Rechtsklick → Öffnen. Mit Node.js geht auch das Skript.'), `<div class="rs-dl">${dl.map(([l, f]) => `<a class="b b-sm" href="${RS_RELEASES}${f}" target="_blank" rel="noopener">${esc(l)}</a>`).join('')}<a class="b b-sm" href="api/reslice/helper.js" download>Node.js</a></div>`)}
      ${lrow(`3 · ${t('Starten und koppeln')}`, t('Der Helfer fragt beim ersten Start nach Adresse und Kopplungscode und merkt sich beides. Er muss laufen, solange geslict werden soll – Aufträge warten so lange.'), '')}
      ${lrow(t('Adresse'), t('Als Home-Assistant-Add-on die IP von Home Assistant mit Port 3080 – nicht die Adresse aus der Browserzeile.'), `<span class="code">${esc(addr)}</span><button class="b b-sm" data-act="copy" data-text="${esc(addr)}">${t('Kopieren')}</button>`)}
      ${lrow(t('Kopplungscode'), t('Neu erzeugen trennt alle verbundenen Helfer.'), code)}
    </div>`)}
    ${setSection('rs-profiles', t('Gelernte Profile'), `<p class="meta" style="margin-top:-4px">${t('Lädst du eine 3MF hoch, die zu einem Drucker gehört, merkt sich PrintDock deren Einstellungen – Drucker, Druckprofil und je Material das Filament. Die neueste Datei zählt, Materialien sammeln sich.')}</p><div class="sbox">${profiles || `<div class="lrow"><div class="lt"><span>${t('Noch keine Drucker.')}</span></div></div>`}</div>`)}
    ${setSection('rs-jobs', t('Letzte Aufträge'), `<div class="sbox">${jobs || `<div class="lrow"><div class="lt"><span>${t('Noch nichts geslict. Bei den Teilen auf „slicen“ an einem fehlenden Drucker klicken.')}</span></div></div>`}</div>`)}`;
}
VIEW_FN.reslice = () => settingsShell('reslice', vReslice());

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-rs]');
  if (!b) return;
  const act = b.dataset.rs;
  if (act === 'reload') { S.rsErr = null; return render(); }
  if (act === 'open') return resliceDialog(b.dataset.part, b.dataset.printer);
  if (act === 'job') return resliceJobDialog(b.dataset.id);
  if (act === 'dismiss') {
    await run(() => api('reslice/dismiss', { method: 'POST', body: { partId: b.dataset.part, printerId: b.dataset.printer } }));
    return reload('reslice');
  }
  if (act === 'cancel') {
    await run(() => api(`reslice/jobs/${b.dataset.id}`, { method: 'DELETE' }));
    return reload('reslice');
  }
  if (act === 'forget') {
    const p = printerById(b.dataset.printer);
    if (!(await confirmBox(t('Profil vergessen'), t('Gelerntes Profil für {p} vergessen? Bis zur nächsten 3MF für diesen Drucker nimmt der Helfer Orcas Standardprofil.', { p: esc(p?.name || '') }), t('Vergessen'), 'b-fault'))) return;
    const r = await run(() => api(`reslice/profiles/${b.dataset.printer}`, { method: 'DELETE' }));
    if (r) S.rs = r;
    return render();
  }
  if (act === 'token') {
    if (!(await confirmBox(t('Neuer Kopplungscode'), t('Verbundene Helfer werden getrennt und müssen mit dem neuen Code gestartet werden (Helfer mit --reset starten).'), t('Neu erzeugen'), 'b-fault'))) return;
    const r = await run(() => api('reslice/token', { method: 'POST' }));
    if (r) S.rs = r;
    return render();
  }
});
