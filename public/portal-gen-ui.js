/* PrintDock – Druckportal: Generator (Teile nach Maß) und Rechtliches (AGB, Widerrufsbelehrung).
   Generator: eigene OpenSCAD-Dateien hochladen, Teile ein-/ausblenden, sortieren, Texte ändern, im Portal testen.
   Rechtliches: Angaben für die eingebauten AGB, eigene Fassung der Texte. Beides braucht Druckportal 1.6. */

{
  const g = NAV_ALL.find((x) => x.g === 'portal');
  const i = g.v.findIndex((v) => v[0] === 'pset');
  g.v.splice(i, 0, ['pgen', 'Generator', null, 'Portal einrichten', ptOn], ['plegal', 'Rechtliches', null, 'Portal einrichten', ptOn]);
}
Object.assign(S, { pGen: null, pgBusy: false });

// ---------------------------------------------------------------- Customizer-Kommentare lesen (wie der Generator im Portal)
function genParams(src) {
  const out = [];
  let group = 'Allgemein';
  let desc = '';
  for (const raw of String(src || '').split('\n')) {
    const l = raw.trim();
    const g = l.match(/^\/\*\s*\[(.+?)\]\s*\*\/$/);
    if (g) {
      group = g[1];
      desc = '';
      if (group.toLowerCase() === 'hidden') break;
      continue;
    }
    const m = l.match(/^([A-Za-z_]\w*)\s*=\s*([^;]+);\s*(?:\/\/\s*\[(.+)\])?/);
    if (m) {
      const [, name, val, spec] = m;
      if (spec) {
        const isStr = /^".*"$/.test(val.trim());
        const kind = spec.includes(':') && !isStr ? 'range' : 'select';
        out.push({ name, group, label: desc || name, value: val.trim().replace(/^"|"$/g, ''), spec, kind });
      }
      desc = '';
      continue;
    }
    const c = l.match(/^\/\/\s*(.+)$/);
    desc = c ? c[1] : '';
  }
  return out;
}
/** Name aus der ersten Kommentarzeile („// Shop · Kabelclip“) */
const genGuessName = (src, file) => {
  const first = String(src || '').split('\n').find((l) => l.trim().startsWith('//'));
  const n = first ? first.replace(/^\s*\/\/\s*/, '').split('·').pop().trim() : '';
  return n && n.length < 60 ? n : String(file || '').replace(/\.scad$/i, '').replace(/[-_]+/g, ' ');
};
const genParamsHTML = (ps) => (ps.length
  ? `<ul class="pg-params">${ps.map((p) => `<li><b>${esc(p.label)}</b><span class="meta">${esc(p.group)} · ${esc(p.name)} = ${esc(p.value)} · ${p.kind === 'range' ? `${t('Regler')} [${esc(p.spec)}]` : `${t('Auswahl')}: ${esc(p.spec)}`}</span></li>`).join('')}</ul>`
  : `<p class="pt-warn">${t('Keine Regler gefunden. Beispiel: breite = 10; // [6:1:30]')}</p>`);

// ---------------------------------------------------------------- Generator

function vPGen() {
  const title = t('Generator');
  if (!S.pGen) {
    if (S.pBusy.genErr) return ptErrBox('gen', title);
    ptEnsure('gen', async () => { S.pBusy.genErr = null; S.pGen = await api('portal/generator'); });
    return ptLoading(title);
  }
  const list = S.pGen.teile || [];
  const rows = list.map((p, i) => `<div class="row pg-row ${p.aktiv ? '' : 'dim'}">
      <div class="pg-ord"><button class="x" data-pg-move="${i}:-1" ${i ? '' : 'disabled'} title="${esc(t('Nach oben'))}" aria-label="${esc(t('Nach oben'))}">${ICON.up}</button><button class="x" data-pg-move="${i}:1" ${i < list.length - 1 ? '' : 'disabled'} title="${esc(t('Nach unten'))}" aria-label="${esc(t('Nach unten'))}">${ICON.down}</button></div>
      <div class="c-main"><b>${esc(p.name)}</b><div class="meta">${esc(p.kurz || '')}</div></div>
      <div><span class="lbl">${t('Material')}</span>${esc(p.material || '–')}<div class="meta">${p.quelle === 'eigen' ? t('eigene Datei') : t('mitgeliefert')}</div></div>
      <div><span class="lbl">${t('Im Portal')}</span><label class="tgl" title="${esc(t('Im Generator anzeigen'))}"><input type="checkbox" data-pg-active="${esc(p.id)}" ${p.aktiv ? 'checked' : ''}><span class="sw"></span></label></div>
      <div class="acts"><a class="b b-sm" href="${esc(p.vorschau)}" target="_blank" rel="noopener">${t('Testen')} ↗</a><button class="b b-sm" data-pg-edit="${esc(p.id)}">${ICON.edit}${t('Bearbeiten')}</button>${p.quelle === 'eigen' ? `<button class="x del" data-pg-del="${esc(p.id)}" title="${esc(t('Löschen'))}" aria-label="${esc(t('Löschen'))}">${ICON.trash}</button>` : '<span class="x-gap"></span>'}</div>
    </div>`).join('');
  const shown = list.filter((p) => p.aktiv).length;
  return `${ptHead(title, `<label class="b b-sm b-go">${ICON.plus}${t('Teil hochladen …')}<input type="file" accept=".scad,text/plain" hidden data-pg-upload></label><a class="b b-sm" href="${esc(S.pGen.page || '#')}" target="_blank" rel="noopener">${t('Generator öffnen')} ↗</a>`)}
    <div class="strip pt-strip"><div><b class="num">${list.length}</b><span>${t('Teile')}</span></div><div class="${shown ? '' : 'warn'}"><b class="num">${shown}</b><span>${t('im Portal sichtbar')}</span></div><div><b class="num">${list.filter((p) => p.quelle === 'eigen').length}</b><span>${t('eigene Dateien')}</span></div></div>
    <div class="list">${list.length ? rows : `<div class="empty"><h3>${t('Noch keine Teile')}</h3></div>`}</div>
    <p class="meta pt-foot">${t('Eigene Teile sind OpenSCAD-Dateien mit Customizer-Kommentaren: /* [Gruppe] */ für Abschnitte, eine Kommentarzeile über der Variable als Beschriftung, „breite = 10; // [6:1:30]“ für Regler, „form = "Rund"; // [Rund, Eckig]“ für Auswahl. Alles ab /* [Hidden] */ ist kein Regler mehr. „Testen“ öffnet den Generator auch für ausgeblendete Teile. Mitgelieferte Teile lassen sich nur ausblenden; eine hochgeladene Fassung ersetzt sie.')}</p>`;
}

/** Bearbeiten-Dialog: Texte, Material, sichtbar, neue Datei; zeigt die erkannten Regler */
function genDialog(p, src = null, fileName = '') {
  const mats = S.pGen?.materials || [];
  const isNew = !p;
  const params = src != null ? genParams(src) : null;
  const d = openDialog(`<form class="dlg" method="dialog">
    <h2>${isNew ? t('Neues Teil') : t('Teil bearbeiten')}</h2>
    <label>${t('Name')}<input name="name" required maxlength="80" value="${esc(p?.name || genGuessName(src, fileName))}"></label>
    <label>${t('Kurzbeschreibung')}<input name="kurz" maxlength="300" value="${esc(p?.kurz || '')}" placeholder="${esc(t('Ein Satz für die Teileauswahl im Generator'))}"></label>
    <div class="two">
      <label>${t('Empfohlenes Material')}<select name="material"><option value="">–</option>${[...new Set([...mats, p?.material].filter(Boolean))].map((m) => `<option ${m === p?.material ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" name="aktiv" ${!p || p.aktiv ? 'checked' : ''}> ${t('im Generator anzeigen')}</label>
    </div>
    <div><b>${t('OpenSCAD-Datei')}</b> <span class="meta" data-pg-fname>${esc(fileName || (p ? (p.quelle === 'eigen' ? t('eigene Datei') : t('mitgeliefert')) : ''))}</span>
      <button type="button" class="b b-sm" style="margin-left:0.5rem" data-pg-pick>${t('Andere Datei …')}</button><input type="file" accept=".scad,text/plain" hidden data-pg-file>
      <div data-pg-params>${params ? genParamsHTML(params) : `<p class="meta">${t('Lade Regler …')}</p>`}</div></div>
    ${!isNew && p.quelle === 'mit' ? `<p class="meta">${t('Eine neue Datei ersetzt das mitgelieferte Teil durch deine Fassung; löschst du sie später, ist das Original wieder da.')}</p>` : ''}
    <p class="form-error" hidden></p>
    <div class="dlg-actions"><button class="b" type="button" data-close>${t('Abbrechen')}</button><button class="b b-go">${t('Speichern')}</button></div></form>`, { wide: true });
  let newSrc = src;
  if (!isNew && src == null) {
    api(`portal/generator/${encodeURIComponent(p.id)}/scad`).then((r) => { const box = $('[data-pg-params]', d); if (box && newSrc == null) box.innerHTML = genParamsHTML(genParams(r.scad)); }).catch((err) => { const box = $('[data-pg-params]', d); if (box) box.innerHTML = `<p class="pt-warn">${esc(err.message)}</p>`; });
  }
  $('[data-pg-pick]', d).addEventListener('click', () => $('[data-pg-file]', d).click());
  $('[data-pg-file]', d).addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    newSrc = await f.text();
    $('[data-pg-fname]', d).textContent = f.name;
    $('[data-pg-params]', d).innerHTML = genParamsHTML(genParams(newSrc));
    if (!$('form', d).name.value) $('form', d).name.value = genGuessName(newSrc, f.name);
  });
  $('form', d).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const meta = { name: f.name.value, kurz: f.kurz.value, material: f.material.value, aktiv: f.aktiv.checked };
    try {
      let r;
      if (newSrc != null) {
        r = await api('portal/generator/upload', { method: 'POST', body: { id: p?.id || '', scad: newSrc, ...meta } });
      } else {
        r = await api('portal/generator', { method: 'PUT', body: { teile: (S.pGen.teile || []).map((x) => (x.id === p.id ? { id: x.id, ...meta } : { id: x.id })) } });
      }
      S.pGen = r;
      toast(r.message || t('Gespeichert'));
      d.close();
      render();
    } catch (err) {
      formError(d, err.message);
    }
  });
}

async function genSaveOrder(teile, okText) {
  const r = await run(() => api('portal/generator', { method: 'PUT', body: { teile } }), okText);
  if (r) { S.pGen = r; render(); }
}

document.addEventListener('change', async (e) => {
  const up = e.target.closest('[data-pg-upload]');
  if (up && up.files?.[0]) {
    const f = up.files[0];
    up.value = '';
    if (f.size > 300 * 1024) return toast(t('Die Datei ist zu groß (höchstens 300 KB).'), true);
    return genDialog(null, await f.text(), f.name);
  }
  const ac = e.target.closest('[data-pg-active]');
  if (ac) {
    const id = ac.dataset.pgActive;
    return genSaveOrder((S.pGen?.teile || []).map((x) => (x.id === id ? { id: x.id, aktiv: ac.checked } : { id: x.id })), ac.checked ? t('Im Generator sichtbar') : t('Im Generator ausgeblendet'));
  }
});

document.addEventListener('click', async (e) => {
  const mv = e.target.closest('[data-pg-move]');
  if (mv) {
    const [i, dir] = mv.dataset.pgMove.split(':').map(Number);
    const list = [...(S.pGen?.teile || [])];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    S.pGen.teile = list;
    render();
    return genSaveOrder(list.map((x) => ({ id: x.id })));
  }
  const ed = e.target.closest('[data-pg-edit]');
  if (ed) return genDialog((S.pGen?.teile || []).find((x) => x.id === ed.dataset.pgEdit));
  const del = e.target.closest('[data-pg-del]');
  if (del) {
    const p = (S.pGen?.teile || []).find((x) => x.id === del.dataset.pgDel);
    if (!p || !(await confirmBox(t('„{n}“ löschen?', { n: p.name }), t('Die eigene OpenSCAD-Datei wird im Portal gelöscht.'), t('Löschen'), 'b-fault'))) return;
    const r = await run(() => api(`portal/generator/${encodeURIComponent(p.id)}`, { method: 'DELETE' }));
    if (r) { S.pGen = r; toast(r.message); render(); }
    return;
  }
  const rt = e.target.closest('[data-pt-retry="gen"]');
  if (rt) { S.pBusy.genErr = null; render(); }
});

// ---------------------------------------------------------------- Rechtliches

const PL_ZAHL = [['ueberweisung', 'Überweisung (Vorkasse)'], ['paypal', 'PayPal'], ['bar', 'Barzahlung bei Abholung']];
const PL_LIEFER = [['versand', 'Versand'], ['abholung', 'Abholung']];

function vPLegal() {
  const wait = ptNeedConfig(t('Rechtliches'));
  if (wait) return wait;
  const L = S.pConfig.legal;
  if (!L) {
    return `${ptHead(t('Rechtliches'))}<div class="empty"><h3>${t('Braucht Druckportal 1.6')}</h3><p>${t('Diese Version des Portals hat noch keine eingebauten AGB. Bitte das Druckportal aktualisieren.')}</p></div>`;
  }
  const multi = (key, opts) => `<div class="lc">${opts.map(([k, l]) => `<label class="pt-chk"><input type="checkbox" data-plm="${key}" value="${k}" ${(pcVal(key) || []).includes(k) ? 'checked' : ''}> ${esc(t(l))}</label>`).join(' ')}</div>`;
  const own = (key) => String(pcVal(key) || '').trim() !== '';
  const txt = (key, vorlage, label) => `<div class="sbox pt-pad">
      <div class="pl-txthead"><b>${label}</b><span class="meta">${own(key) ? t('eigene Fassung') : t('Vorlage aus deinen Angaben')}</span><span class="grow"></span>
        ${own(key) ? `<button class="b b-sm" data-pl-reset="${key}">${t('Zurück zur Vorlage')}</button>` : `<button class="b b-sm" data-pl-edit="${key}">${t('Text anpassen')}</button>`}</div>
      ${own(key) ? `<textarea class="in pt-mono" rows="18" data-pc="${key}" style="width:100%">${esc(pcVal(key))}</textarea>` : `<details><summary>${t('Vorlage ansehen')}</summary><pre class="pl-pre">${esc(vorlage)}</pre></details>`}
    </div>`;
  const fehlt = L.fehlt || [];
  return `${ptHead(t('Rechtliches'), `<a class="b b-sm" href="${esc(L.seiten.agb)}" target="_blank" rel="noopener">${t('AGB ansehen')} ↗</a><a class="b b-sm" href="${esc(L.seiten.widerruf)}" target="_blank" rel="noopener">${t('Widerruf ansehen')} ↗</a>`)}${pcSaveBar()}
    ${pcVal('agb_on') && fehlt.length ? `<p class="pt-warn pl-warn">${t('Für die AGB fehlt noch: {f}', { f: esc(fehlt.map((x) => t(x)).join(', ')) })}</p>` : ''}
    <h3 class="shead">${t('AGB im Portal')}</h3><div class="sbox">
      ${pcRow('agb_on', t('Eingebaute AGB verwenden'), t('Kunden bestätigen AGB und Widerrufshinweis per Häkchen, bevor sie ein Angebot annehmen, und bekommen beides mit der Auftragsbestätigung per Mail.'), 'bool')}
      ${pcRow('agb_url', t('Stattdessen eigener AGB-Link'), t('leer = eingebaute AGB'))}
      ${pcRow('agb_stand', t('Stand'), '', 'text', { w: '10rem' })}
    </div>
    <h3 class="shead">${t('Anbieter')}</h3><div class="sbox">
      ${pcRow('anbieter_name', t('Name oder Firma'), '')}
      ${pcRow('anbieter_strasse', t('Straße und Hausnummer'), '')}
      ${pcRow('anbieter_ort', t('PLZ und Ort'), '')}
      ${pcRow('anbieter_telefon', t('Telefon'), t('freiwillig'))}
      <div class="lrow"><div class="lt"><b>${t('E-Mail')}</b><span>${t('aus Portal-Einstellungen → E-Mail')}</span></div><div class="lc"><span class="code">${esc(pcVal('mail_shop') || '–')}</span></div></div>
    </div>
    <h3 class="shead">${t('Geschäft')}</h3><div class="sbox">
      ${pcRow('kleinunternehmer', t('Kleinunternehmer (§ 19 UStG)'), t('an = keine Umsatzsteuer, mit Hinweis in AGB und Auftragsbestätigung'), 'bool')}
      <div class="lrow"><div class="lt"><b>${t('Kunden')}</b></div><div class="lc"><div class="seg">${[['beide', 'Privatkunden und Firmen'], ['privat', 'nur Privatkunden']].map(([k, l]) => `<button type="button" data-pl-kunden="${k}" aria-pressed="${pcVal('kunden') === k}">${esc(t(l))}</button>`).join('')}</div></div></div>
      <div class="lrow"><div class="lt"><b>${t('Zahlung')}</b></div>${multi('zahlarten', PL_ZAHL)}</div>
      <div class="lrow"><div class="lt"><b>${t('Lieferung')}</b></div>${multi('lieferarten', PL_LIEFER)}</div>
      ${pcRow('lieferlaender', t('Versand in'), t('z. B. Deutschland oder Deutschland und Österreich'))}
      ${pcRow('angebot_tage', t('Angebot gilt'), '', 'num', { unit: t('Tage') })}
    </div>
    <h3 class="shead">${t('Texte')}</h3>
    ${txt('agb_text', L.agb_vorlage, t('AGB'))}
    ${txt('widerruf_text', L.widerruf_vorlage, t('Widerrufsbelehrung'))}
    <p class="meta pt-foot">${t('Format: Leerzeile = neuer Absatz, „## “ am Zeilenanfang = Überschrift, „- “ = Aufzählung, [formular] = Muster-Widerrufsformular. Die Vorlagen sind sorgfältig formuliert, ersetzen aber keine Rechtsberatung – lass sie vor dem Einsatz prüfen.')}</p>`;
}

document.addEventListener('click', (e) => {
  const k = e.target.closest('[data-pl-kunden]');
  if (k) { S.pcDraft.kunden = k.dataset.plKunden; return render(); }
  const edt = e.target.closest('[data-pl-edit]');
  if (edt) {
    const key = edt.dataset.plEdit;
    S.pcDraft[key] = key === 'agb_text' ? S.pConfig.legal.agb_vorlage : S.pConfig.legal.widerruf_vorlage;
    return render();
  }
  const rs = e.target.closest('[data-pl-reset]');
  if (rs) { S.pcDraft[rs.dataset.plReset] = ''; return render(); }
});
document.addEventListener('change', (e) => {
  const m = e.target.closest('[data-plm]');
  if (!m) return;
  const key = m.dataset.plm;
  const cur = new Set(pcVal(key) || []);
  if (m.checked) cur.add(m.value); else cur.delete(m.value);
  S.pcDraft[key] = [...cur];
  ptSaveBarHint();
});

Object.assign(VIEW_FN, { pgen: vPGen, plegal: vPLegal });
