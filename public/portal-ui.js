/* PrintDock – Druckportal steuern: Anfragen und Angebote, Wartungsmodus, Materialien, Preise, Mailtexte, Einstellungen.
   PrintDock spricht dafür mit der Schnittstelle des Portals (API-Schlüssel, nur von hier nach draußen).
   Der Admin des Portals im Browser bleibt als Notzugang von unterwegs bestehen. */

NAV_ICON.inbox = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 13l2.5-8h13L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M3 13h5l1.5 2.5h5L16 13h5"/></svg>';

const ptOn = () => Boolean(S.portal?.enabled && S.portal?.url);
{
  const i = NAV_ALL.findIndex((g) => g.g === 'orders');
  NAV_ALL.splice(i + 1, 0, { g: 'portal', l: 'Druckportal', icon: 'inbox', v: [
    ['pinbox', 'Anfragen', null, null, ptOn],
    ['pwartung', 'Wartungsmodus', null, null, ptOn],
    ['pmat', 'Materialien', null, 'Portal einrichten', ptOn],
    ['pprice', 'Preise', null, 'Portal einrichten', ptOn],
    ['pmail', 'Mailtexte', null, 'Portal einrichten', ptOn],
    ['pset', 'Portal-Einstellungen', null, 'Portal einrichten', ptOn],
  ] });
}

Object.assign(S, { pInbox: null, pFilter: 'offen', pOrderId: null, pOrder: null, pDraft: {}, pConfig: null, pcDraft: {}, pWartung: null, pwDraft: {}, pMailKey: 'angebot', pBusy: {} });

loaders.pInbox = async () => {
  if (!ptOn() || S.app?.me?.role === 'operator') return;
  S.pInbox = await api('portal/inbox');
};

// Menü: Zahl der neuen Anfragen
{
  const base = badges;
  badges = function () {
    const b = base();
    const n = S.pInbox?.counts?.neu ?? S.portal?.counts?.neu ?? 0;
    if (n) b.pinbox = `<span class="badge">${n}</span>`;
    return b;
  };
}

const PT_STATUS = {
  angefragt: ['Neu', 'neu'], angebot: ['Angebot', 'angebot'], bestaetigt: ['Bestätigt', 'ok'], im_druck: ['Im Druck', 'run'],
  versendet: ['Versendet', 'run'], abgeschlossen: ['Abgeschlossen', 'done'], storniert: ['Storniert', 'storno'],
};
const ptPill = (s) => { const [l, c] = PT_STATUS[s] || [s, '']; return `<span class="pill pt-st ${c}">${esc(t(l))}</span>`; };
const PT_FILTER = [
  ['offen', 'Offen', (o) => ['angefragt', 'angebot', 'bestaetigt'].includes(o.status)],
  ['angefragt', 'Neu', (o) => o.status === 'angefragt'],
  ['angebot', 'Angebot', (o) => o.status === 'angebot'],
  ['bestaetigt', 'Bestätigt', (o) => o.status === 'bestaetigt'],
  ['arbeit', 'In Arbeit', (o) => ['im_druck', 'versendet'].includes(o.status)],
  ['ende', 'Erledigt', (o) => ['abgeschlossen', 'storniert'].includes(o.status)],
  ['alle', 'Alle', () => true],
];
const ptMoney = (n) => (n === null || n === undefined || n === '' ? '–' : money(n));
const ptAdmin = () => `${String(S.portal?.url || '').replace(/\/+$/, '')}/admin/`;

/** Daten einmalig nachladen, während die Ansicht schon steht */
function ptEnsure(key, fn) {
  if (S.pBusy[key]) return;
  S.pBusy[key] = true;
  fn().catch((err) => { S.pBusy[`${key}Err`] = err.message; }).finally(() => { S.pBusy[key] = false; render(); });
}
const ptLoading = (title) => `<div class="bar-row"><h2>${esc(title)}</h2></div><div class="empty">${t('Lade …')}</div>`;
const ptErrBox = (key, title) => `<div class="bar-row"><h2>${esc(title)}</h2></div><div class="empty"><h3>${t('Druckportal nicht erreichbar')}</h3><p>${esc(S.pBusy[`${key}Err`])}</p><button class="b b-sm" data-pt-retry="${key}">${t('Nochmal versuchen')}</button></div>`;

function ptHead(title, extra = '') {
  const shop = S.pInbox?.shop || S.portal?.state?.shop || '';
  return `<div class="bar-row pt-head"><h2>${esc(title)}${shop ? `<small>${esc(shop)}</small>` : ''}</h2>${extra}<a class="b b-sm" href="${esc(ptAdmin())}" target="_blank" rel="noopener" title="${esc(t('Admin des Portals im Browser öffnen'))}">${t('Portal-Admin')} ↗</a></div>`;
}

// ================================================================ Anfragen

function vPInbox() {
  if (S.pOrderId) return vPOrder();
  if (!S.pInbox) {
    if (S.pBusy.inboxErr) return ptErrBox('inbox', t('Anfragen'));
    ptEnsure('inbox', async () => { S.pBusy.inboxErr = null; S.pInbox = await api('portal/inbox?refresh=1'); });
    return ptLoading(t('Anfragen'));
  }
  const all = S.pInbox.orders || [];
  const f = PT_FILTER.find((x) => x[0] === S.pFilter) || PT_FILTER[0];
  const list = all.filter(f[2]);
  const chips = PT_FILTER.map(([k, l, fn]) => { const n = all.filter(fn).length; return `<button class="chip" data-pt-filter="${k}" aria-pressed="${S.pFilter === k}">${esc(t(l))}${k !== 'alle' && n ? ` <b>${n}</b>` : ''}</button>`; }).join('');
  const c = S.pInbox.counts || {};
  const rows = list.map((o) => {
    const pcs = (o.items || []).reduce((a, it) => a + (Number(it.qty) || 1), 0);
    const mats = [...new Set((o.items || []).map((it) => it.material).filter(Boolean))].join(', ');
    const price = o.offer?.price != null ? `<b class="vl">${money(o.offer.price)}</b><div class="meta">${t('Angebot')}</div>` : `<span class="num">${money(o.estimate?.min)} – ${money(o.estimate?.max)}</span><div class="meta">${t('Schätzung')}</div>`;
    return `<div class="row pt-row ${['abgeschlossen', 'storniert'].includes(o.status) ? 'dim' : ''}" data-pt-open="${o.id}" tabindex="0" role="button">
      <div><span class="lbl">${t('Nr')}</span><b class="vl">${esc(o.number)}</b><div class="meta">${tfmt(o.created_at)}</div></div>
      <div class="c-main"><b>${esc(o.customer?.name || '–')}</b><div class="meta">${esc([o.customer?.company, o.customer?.email].filter(Boolean).join(' · '))}</div></div>
      <div><span class="lbl">${t('Teile')}</span>${t('{n} Stück', { n: pcs })}<div class="meta">${esc(mats)}</div></div>
      <div><span class="lbl">${t('Preis')}</span>${price}</div>
      <div><span class="lbl">${t('Status')}</span>${ptPill(o.status)}</div>
      <div class="pt-flags">${o.paid_at ? `<span class="pt-flag ok" title="${esc(t('bezahlt'))}">€ ✓</span>` : ''}${o.pd ? `<span class="pt-flag" title="${esc(t('In PrintDock übernommen'))}">${esc(o.pd.number || 'PD')}</span>` : ''}${o.note ? `<span class="pt-flag" title="${esc(o.note)}">✉</span>` : ''}</div>
    </div>`;
  }).join('');
  const summary = `<div class="strip pt-strip">
      <div class="${c.neu ? 'warn' : ''}"><b class="num">${c.neu || 0}</b><span>${t('neue Anfragen')}</span></div>
      <div><b class="num">${c.angebot || 0}</b><span>${t('Angebote offen')}</span></div>
      <div class="${c.bereit ? 'warn' : ''}"><b class="num">${c.bereit || 0}</b><span>${t('bestätigt, noch nicht übernommen')}</span></div>
      <div><b class="num">${all.length}</b><span>${t('insgesamt')}</span></div>
    </div>`;
  return `${ptHead(t('Anfragen'), `<button class="b b-sm" data-pt-act="refresh">${t('Aktualisieren')}</button>`)}${summary}
    <div class="chips pt-chips">${chips}</div>
    <div class="list">${list.length ? `<div class="row pt-row head"><div>${t('Nr')}</div><div>${t('Kunde')}</div><div>${t('Teile')}</div><div>${t('Preis')}</div><div>${t('Status')}</div><div></div></div>${rows}`
      : `<div class="empty"><h3>${t('Keine Anfragen')}</h3><p>${S.pFilter === 'offen' ? t('Gerade ist nichts offen. Neue Anfragen meldet PrintDock über deine Benachrichtigungen.') : t('In dieser Auswahl gibt es nichts.')}</p></div>`}</div>
    <p class="meta pt-foot">${t('Stand: {t}', { t: tfmt(S.pInbox.at) })}</p>`;
}

async function ptOpen(id) {
  S.pOrderId = Number(id);
  S.pOrder = null;
  S.pDraft = {};
  S.pBusy.orderErr = null;
  render();
  window.scrollTo(0, 0);
  ptEnsure('order', async () => { S.pOrder = await api(`portal/orders/${id}`); });
  if (!S.pConfig) ptEnsure('config', async () => { S.pConfig = await api('portal/config'); }); // Farben für die Vorschau
}

// ---------------------------------------------------------------- Einzelne Anfrage

const ptDraftVal = (k, server) => (S.pDraft[k] !== undefined ? S.pDraft[k] : server ?? '');
const ptNum = (v) => (v === null || v === undefined || v === '' ? '' : String(v).replace('.', ','));

function vPOrder() {
  const o = S.pOrder;
  if (!o || o.id !== S.pOrderId) {
    if (S.pBusy.orderErr) return `<div class="bar-row"><button class="b b-sm" data-pt-act="back">← ${t('Anfragen')}</button></div><div class="empty"><h3>${t('Anfrage konnte nicht geladen werden')}</h3><p>${esc(S.pBusy.orderErr)}</p></div>`;
    return `<div class="bar-row"><button class="b b-sm" data-pt-act="back">← ${t('Anfragen')}</button></div><div class="empty">${t('Lade …')}</div>`;
  }
  const cu = o.customer || {};
  const items = o.items || [];
  const pr = o.price;
  const status = ptDraftVal('status', o.status);
  const head = `<div class="bar-row pt-ohead">
      <button class="b b-sm" data-pt-act="back">← ${t('Anfragen')}</button>
      <h2>${esc(o.number)} ${ptPill(o.status)}</h2>
      <div class="pt-oacts">
        ${o.status_url ? `<a class="b b-sm" href="${esc(o.status_url)}" target="_blank" rel="noopener">${t('Statusseite')} ↗</a>` : ''}
        ${o.pd ? `<button class="b b-sm" data-act="oEdit" data-id="${esc(o.pd.id)}" title="${esc(t('PrintDock-Auftrag öffnen'))}">${ICON.edit}${esc(o.pd.number || t('PrintDock-Auftrag'))}</button>` : `<button class="b b-sm b-go" data-pt-act="import" title="${esc(t('Modelle in die Bibliothek, Auftrag mit Positionen und Statuslink anlegen'))}">${ICON.plus}${t('In PrintDock übernehmen')}</button>`}
        <button class="b b-sm ${o.paid_at ? 'pt-paid' : ''}" data-pt-act="paid" title="${esc(o.paid_at ? t('Bezahlt am {d} – klicken zum Zurücksetzen', { d: tfmt(o.paid_at) }) : t('Als bezahlt markieren'))}">${o.paid_at ? `✓ ${t('bezahlt')}` : `€ ${t('bezahlt?')}`}</button>
        <button class="x del" data-pt-act="delete" title="${esc(t('Anfrage samt Dateien löschen'))}" aria-label="${esc(t('Löschen'))}">${ICON.trash}</button>
      </div>
    </div>`;

  const customer = `<div class="card pt-card">
      <h3>${esc(cu.name || '–')}${cu.company ? ` <span class="meta">· ${esc(cu.company)}</span>` : ''}</h3>
      <div class="facts">
        ${cu.email ? `<span><a href="mailto:${esc(cu.email)}">${esc(cu.email)}</a></span>` : ''}
        ${cu.phone ? `<span><a href="tel:${esc(cu.phone)}">${esc(cu.phone)}</a></span>` : ''}
        <span>${t('Eingang')} <b>${tfmt(o.created_at)}</b></span>
        <span>${t('Schätzung')} <b>${money(o.estimate?.min)} – ${money(o.estimate?.max)}</b> + ${money(o.estimate?.shipping)} ${t('Versand')}</span>
      </div>
      ${o.note ? `<div class="pt-note"><span class="meta">${t('Nachricht vom Kunden')}</span><p>${esc(o.note)}</p></div>` : ''}
    </div>`;

  const itemCards = items.map((it) => `<div class="card pt-item">
      <div class="pt-view" data-ptmesh="${it.id}" data-name="${esc(it.filename)}" data-color="${esc(ptItemColor(it))}"><canvas aria-label="${esc(t('3D-Vorschau von {f}', { f: it.filename }))}"></canvas>${PT_MESH.has(String(it.id)) ? '' : `<span class="pt-vhint ${PT_MESH_ERR.has(String(it.id)) ? 'bad' : ''}">${esc(PT_MESH_ERR.get(String(it.id)) || t('Lade 3D-Vorschau …'))}</span>`}</div>
      <div class="pt-ibody">
        <b class="pt-fname">${esc(it.filename)}</b>
        <div class="facts">
          <span><b>${Number(it.qty) || 1} ×</b></span>
          <span>${esc(it.material || '')}${(it.colors || []).length ? ` · ${esc(it.colors.join(', '))}` : ''}</span>
          <span>${(it.size_mm || []).map((v) => fnum(v, 0)).join(' × ')} mm</span>
          <span>${fnum(it.volume_cm3, 1)} cm³</span>
          <span>≈ ${fnum(it.weight_g, 0)} g</span>
          <span>≈ ${fmtDur((Number(it.hours) || 0) * 3600)}</span>
          <span>${t('Schätzung')} ${money(it.est_price)}</span>
        </div>
        <div class="btns"><a class="b b-sm" href="api/portal/items/${it.id}/file?name=${encodeURIComponent(it.filename)}" download>${t('Herunterladen')}</a><button class="b b-sm" data-pt-view-reset="${it.id}">${t('Ansicht zurücksetzen')}</button></div>
      </div>
    </div>`).join('');

  const log = (o.log || []).slice().reverse().map((l) => `<li class="${l.public ? '' : 'intern'}"><span class="meta">${tfmt(l.at)} · ${esc({ kunde: t('Kunde'), admin: t('Admin'), printdock: 'PrintDock', system: t('System') }[l.actor] || l.actor || '')}${l.public ? '' : ` · ${t('intern')}`}</span>${l.status ? ` ${ptPill(l.status)}` : ''}${l.note ? `<div>${esc(l.note)}</div>` : ''}</li>`).join('');

  const statusOpts = Object.keys(PT_STATUS).map((s) => `<option value="${s}" ${s === status ? 'selected' : ''}>${esc(t(PT_STATUS[s][0]))}</option>`).join('');
  const needPrice = status === 'angebot' && ptDraftVal('offer_price', o.offer?.price) === '';
  const notify = S.pDraft.notify !== undefined ? S.pDraft.notify : true;
  const edit = `<div class="sbox pt-edit">
      <h3 class="shead">${t('Bearbeiten')}</h3>
      <label class="pt-f"><span>${t('Status')}</span><select class="in" data-pf="status">${statusOpts}</select></label>
      <div class="pt-two">
        <label class="pt-f"><span>${t('Angebotspreis')}</span><input class="in num" data-pf="offer_price" inputmode="decimal" value="${esc(ptNum(ptDraftVal('offer_price', o.offer?.price)))}" placeholder="${esc(pr ? ptNum(pr.price) : '')}"></label>
        <label class="pt-f"><span>${t('Versand')}</span><input class="in num" data-pf="offer_shipping" inputmode="decimal" value="${esc(ptNum(ptDraftVal('offer_shipping', o.offer?.shipping)))}" placeholder="${esc(ptNum(o.estimate?.shipping))}"></label>
      </div>
      ${needPrice ? `<p class="pt-warn">${t('Für ein Angebot brauchst du einen Preis.')}</p>` : ''}
      <label class="pt-f"><span>${t('Hinweis zum Angebot')} <em>${t('steht im Angebot')}</em></span><textarea class="in" rows="2" data-pf="offer_note">${esc(ptDraftVal('offer_note', o.offer?.note))}</textarea></label>
      <label class="pt-f"><span>${t('Nachricht an den Kunden')} <em>${t('erscheint im Verlauf und in der Mail')}</em></span><textarea class="in" rows="3" data-pf="message" placeholder="${esc(t('optional'))}">${esc(ptDraftVal('message', ''))}</textarea></label>
      <label class="lrow pt-tg"><div class="lt"><b>${t('Kunde per Mail informieren')}</b><span>${t('nur bei Statuswechsel, mit der Vorlage aus „Mailtexte“')}</span></div><div class="lc"><span class="tgl"><input type="checkbox" data-pf="notify" ${notify ? 'checked' : ''}><span class="sw"></span></span></div></label>
      <label class="pt-f"><span>${t('Sendungsnummer')}</span><input class="in" data-pf="tracking" value="${esc(ptDraftVal('tracking', o.tracking))}"></label>
      <label class="pt-f"><span>${t('Interne Notiz')} <em>${t('sieht nur ihr')}</em></span><textarea class="in" rows="2" data-pf="admin_note">${esc(ptDraftVal('admin_note', o.admin_note))}</textarea></label>
      <div class="st-foot"><button class="b b-go" data-pt-act="save" ${needPrice ? 'disabled' : ''}>${t('Speichern')}</button>${Object.keys(S.pDraft).length ? `<button class="b b-sm" data-pt-act="discard">${t('Verwerfen')}</button>` : ''}</div>
    </div>`;

  const price = pr ? `<div class="sbox pt-price">
      <h3 class="shead">${t('Preisvorschlag')}</h3>
      <div class="pt-big"><b class="num">${money(pr.price)}</b><span class="meta">${t('ohne Versand')}</span></div>
      <div class="pt-break">
        <span>${t('Material')}</span><b class="num">${money(pr.material)}</b>
        <span>${t('Strom')}</span><b class="num">${money(pr.energy)}</b>
        <span>${t('Maschinenzeit')}</span><b class="num">${money(pr.machine)}</b>
        <span>${t('Aufschlag')} ${pr.rates?.markup ? `${fnum(pr.rates.markup, 0)} %` : ''}</span><b class="num">${money(pr.markup)}</b>
        ${pr.baseFee ? `<span>${t('Grundgebühr (Portal)')}</span><b class="num">${money(pr.baseFee)}</b>` : ''}
        ${pr.colorFee ? `<span>${t('Zusatzfarben (Portal)')}</span><b class="num">${money(pr.colorFee)}</b>` : ''}
        ${pr.minApplied ? `<span>${t('angehoben auf Mindestauftragswert')}</span><b class="num">${money(pr.minPrice)}</b>` : ''}
      </div>
      ${!pr.rates?.machineRate ? `<p class="pt-warn">${t('Maschinenstunde ist in PrintDock 0 € – unter Einstellungen → Drucker & Filament → Kosten eintragen, sonst fehlt die Druckzeit im Preis.')}</p>` : ''}
      <p class="meta">${t('Aus {g} g und {h} h Druckzeit (Werte des Portals) mit deinen Kostensätzen (Einstellungen → Drucker & Filament → Kosten).', { g: fnum(pr.grams, 0), h: fnum(pr.hours, 1) })}${pr.portal ? ` ${t('Portal-Schätzung: {a} – {b}.', { a: money(pr.portal.min), b: money(pr.portal.max) })}` : ''}</p>
      <button class="b b-sm" data-pt-act="usePrice">${t('Als Angebot übernehmen')}</button>
    </div>` : '';

  return `${head}<div class="pt-detail">
      <div class="pt-main">${customer}<h3 class="shead">${items.length === 1 ? t('Modell') : t('{n} Modelle', { n: items.length })}</h3><div class="pt-items">${itemCards}</div>
        <h3 class="shead">${t('Verlauf')}</h3><ul class="pt-log">${log || `<li class="meta">${t('Noch keine Einträge')}</li>`}</ul></div>
      <div class="pt-side">${edit}${price}</div>
    </div>`;
}

/** Farbe für die Vorschau: erste gewählte Farbe aus der Materialliste, sonst Akzent */
function ptItemColor(it) {
  const mats = S.pConfig?.materials || [];
  const m = mats.find((x) => x.id === it.material_id) || mats.find((x) => x.name === it.material);
  const cn = (it.colors || [])[0];
  const c = m?.colors?.find((x) => x.name === cn)?.hex;
  return /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#2F7D45';
}

function ptCollectDraft() {
  const b = {};
  for (const [k, v] of Object.entries(S.pDraft)) b[k] = v;
  if (b.notify === undefined) b.notify = true;
  return b;
}

// ---------------------------------------------------------------- 3D-Vorschau (Canvas, ohne Bibliothek)

const PT_MESH = new Map(); // Positions-ID → { tris, normals, n, cx, cy, cz, r, view }
const PT_MESH_ERR = new Map(); // Positions-ID → Fehlermeldung

// Live-Updates zeichnen die Seite neu: Zeichenflächen der Vorschau dabei nicht anfassen
{
  const base = morphNode;
  morphNode = function (na, nb) {
    if (na.nodeType === 1 && nb.nodeType === 1 && na.tagName === 'CANVAS' && nb.tagName === 'CANVAS' && na._pt) return;
    return base(na, nb);
  };
}

async function ptLoadMesh(id, name) {
  if (PT_MESH.has(id)) return PT_MESH.get(id);
  const res = await fetch(`api/portal/items/${id}/mesh?name=${encodeURIComponent(name || '')}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  const tris = new Float32Array(await res.arrayBuffer());
  const n = Math.floor(tris.length / 9);
  let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let i = 0; i < n * 9; i += 3) {
    const x = tris[i], y = tris[i + 1], z = tris[i + 2];
    if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; if (z < mnz) mnz = z; if (z > mxz) mxz = z;
  }
  const normals = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    const o = i * 9;
    const ux = tris[o + 3] - tris[o], uy = tris[o + 4] - tris[o + 1], uz = tris[o + 5] - tris[o + 2];
    const vx = tris[o + 6] - tris[o], vy = tris[o + 7] - tris[o + 1], vz = tris[o + 8] - tris[o + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    normals[i * 3] = nx / l; normals[i * 3 + 1] = ny / l; normals[i * 3 + 2] = nz / l;
  }
  const m = {
    tris, normals, n, cx: (mnx + mxx) / 2, cy: (mny + mxy) / 2, cz: (mnz + mxz) / 2,
    r: Math.max(1, Math.hypot(mxx - mnx, mxy - mny, mxz - mnz) / 2), view: { az: -0.65, el: 0.5, zoom: 1 },
  };
  PT_MESH.set(id, m);
  return m;
}

function ptHexRgb(hex) {
  const v = parseInt(String(hex).slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Zeichnen mit Tiefenpuffer (Software-Rasterung): auch große, flache Dreiecke werden korrekt verdeckt */
function ptDraw(cv, m, color, fast = false) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  const q = fast ? 0.5 : 1;
  const W = Math.max(1, Math.round(w * dpr * q)), H = Math.max(1, Math.round(h * dpr * q));
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const px = img.data;
  const zb = new Float32Array(W * H).fill(Infinity);
  const { az, el, zoom } = m.view;
  const ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(el), se = Math.sin(el);
  const s = (Math.min(W, H) * 0.42 * zoom) / m.r;
  const ox = W / 2, oy = H / 2;
  let [r, g, b] = ptHexRgb(color);
  // sehr dunkle Farben (Schwarz) aufhellen, sonst verschwindet die Form
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (lum < 90) { const k = (90 - lum) / 160; r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; }
  // sehr helle Farben (Weiß, Natur) etwas abdunkeln, damit Schattierung sichtbar bleibt
  if (lum > 215) { const k = 0.82; r *= k; g *= k; b *= k; }
  // Licht von links oben vorne (Kameraraum), dazu etwas Grundhelligkeit
  const L = [-0.45, -0.75, 0.5]; const ll = Math.hypot(...L); L[0] /= ll; L[1] /= ll; L[2] /= ll;
  const X = [0, 0, 0], Y = [0, 0, 0], Z = [0, 0, 0];
  for (let i = 0; i < m.n; i += 1) {
    const o = i * 9;
    for (let v = 0; v < 3; v += 1) {
      const x = m.tris[o + v * 3] - m.cx, y = m.tris[o + v * 3 + 1] - m.cy, z = m.tris[o + v * 3 + 2] - m.cz;
      const x1 = x * ca - y * sa, y1 = x * sa + y * ca;
      X[v] = ox + x1 * s; Y[v] = oy - (y1 * se + z * ce) * s; Z[v] = y1 * ce - z * se;
    }
    const area = (X[1] - X[0]) * (Y[2] - Y[0]) - (X[2] - X[0]) * (Y[1] - Y[0]);
    if (Math.abs(area) < 1e-6) continue;
    const minx = Math.max(0, Math.floor(Math.min(X[0], X[1], X[2]))), maxx = Math.min(W - 1, Math.ceil(Math.max(X[0], X[1], X[2])));
    const miny = Math.max(0, Math.floor(Math.min(Y[0], Y[1], Y[2]))), maxy = Math.min(H - 1, Math.ceil(Math.max(Y[0], Y[1], Y[2])));
    if (minx > maxx || miny > maxy) continue;
    const nx = m.normals[i * 3], ny = m.normals[i * 3 + 1], nz = m.normals[i * 3 + 2];
    const n1x = nx * ca - ny * sa, n1y = nx * sa + ny * ca;
    const n2y = n1y * ce - nz * se, n2z = n1y * se + nz * ce;
    const lit = 0.32 + 0.68 * Math.abs(n1x * L[0] + n2y * L[1] + n2z * L[2]);
    const cr = r * lit, cg = g * lit, cb = b * lit;
    const inv = 1 / area;
    for (let yy = miny; yy <= maxy; yy += 1) {
      const sy = yy + 0.5;
      for (let xx = minx; xx <= maxx; xx += 1) {
        const sx = xx + 0.5;
        const w0 = ((X[1] - sx) * (Y[2] - sy) - (X[2] - sx) * (Y[1] - sy)) * inv;
        const w1 = ((X[2] - sx) * (Y[0] - sy) - (X[0] - sx) * (Y[2] - sy)) * inv;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const d = w0 * Z[0] + w1 * Z[1] + w2 * Z[2];
        const k = yy * W + xx;
        if (d >= zb[k]) continue;
        zb[k] = d;
        const p4 = k * 4;
        px[p4] = cr; px[p4 + 1] = cg; px[p4 + 2] = cb; px[p4 + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

function ptBindViewers() {
  for (const box of $$('[data-ptmesh]')) {
    const cv = $('canvas', box);
    if (!cv || cv._pt) continue;
    cv._pt = true;
    const id = box.dataset.ptmesh;
    if (PT_MESH_ERR.has(id)) continue;
    ptLoadMesh(id, box.dataset.name).then((m) => {
      $('.pt-vhint', box)?.remove();
      const draw = (fast) => ptDraw(cv, m, cv.closest('[data-ptmesh]')?.dataset.color || '#2F7D45', fast);
      draw(false);
      let drag = null;
      let full = null;
      const later = () => { clearTimeout(full); full = setTimeout(() => draw(false), 120); };
      cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); });
      cv.addEventListener('pointermove', (e) => {
        if (!drag) return;
        m.view.az += (e.clientX - drag.x) * 0.012;
        m.view.el = Math.max(-1.45, Math.min(1.45, m.view.el + (e.clientY - drag.y) * 0.012));
        drag = { x: e.clientX, y: e.clientY };
        draw(true);
      });
      const end = () => { if (drag) { drag = null; later(); } };
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointercancel', end);
      cv.addEventListener('wheel', (e) => { e.preventDefault(); m.view.zoom = Math.max(0.4, Math.min(5, m.view.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12))); draw(true); later(); }, { passive: false });
      cv.addEventListener('dblclick', () => { m.view = { az: -0.65, el: 0.5, zoom: 1 }; draw(false); });
      cv._ptDraw = draw;
    }).catch((err) => {
      PT_MESH_ERR.set(id, err.message);
      const h = $('.pt-vhint', box);
      if (h) { h.textContent = err.message; h.classList.add('bad'); }
    });
  }
}

// Ansicht neu zeichnen, wenn sich die Größe ändert
window.addEventListener('resize', () => { for (const cv of $$('[data-ptmesh] canvas')) cv._ptDraw?.(false); });

// ================================================================ Wartungsmodus

const PT_COLORS = ['#3F5BD8', '#16A34A', '#D9531E', '#7C3AED', '#0E7490', '#BE185D'];

function vPWartung() {
  if (!S.pWartung) {
    if (S.pBusy.wartungErr) return ptErrBox('wartung', t('Wartungsmodus'));
    ptEnsure('wartung', async () => { S.pBusy.wartungErr = null; S.pWartung = await api('portal/wartung'); });
    return ptLoading(t('Wartungsmodus'));
  }
  const z = S.pWartung.ziele || {};
  const host = (() => { try { return new URL(S.portal.url).host; } catch { return ''; } })();
  const cards = Object.entries(z).map(([k, w], i) => {
    const name = w.name || k;
    const dom = w.domain || (k === 'portal' ? host : '');
    const col = /^#[0-9a-f]{6}$/i.test(w.farbe || '') ? w.farbe : PT_COLORS[i % PT_COLORS.length];
    const txt = S.pwDraft[k] !== undefined ? S.pwDraft[k] : w.text || '';
    return `<div class="card pt-wcard ${w.an ? 'an' : ''} ${w.ok ? '' : 'off'}" style="--pt-c:${col}">
      <div class="pt-wtop"><div><h3>${esc(name)}</h3><span class="meta">${esc(dom)}</span></div>
        <label class="tgl pt-big-tgl" title="${esc(w.an ? t('Wartung ausschalten') : t('Wartung einschalten'))}"><input type="checkbox" data-pw-tgl="${k}" ${w.an ? 'checked' : ''} ${w.ok ? '' : 'disabled'}><span class="sw"></span></label></div>
      <p class="pt-wstate">${w.an ? `● ${t('In Wartung')}` : `○ ${t('Online')}`}</p>
      ${w.ok ? `<label class="pt-f"><span>${t('Hinweis für Besucher')} <em>${t('optional')}</em></span><textarea class="in" rows="2" maxlength="600" data-pw-text="${k}" placeholder="${esc(t('z. B. Gegen 18 Uhr sind wir zurück.'))}">${esc(txt)}</textarea></label>
        <div class="btns"><button class="b b-sm" data-pw-save="${k}" ${S.pwDraft[k] === undefined ? 'disabled' : ''}>${t('Hinweis speichern')}</button></div>` : `<p class="pt-warn">${t('Diese Seite kann das Portal gerade nicht schalten – Einrichtung im Portal-Admin prüfen.')}</p>`}
    </div>`;
  }).join('');
  return `${ptHead(t('Wartungsmodus'), `<button class="b b-sm" data-pw-all="0">${t('Alles wieder online')}</button><button class="b b-sm b-fault pt-red" data-pw-all="1">${t('Alles in Wartung')}</button>`)}
    <div class="pt-wgrid">${cards}</div>
    <p class="meta pt-foot">${t('Druckportal in Wartung: Anfrage, Upload und Generator sind gesperrt; Statusseiten, Werkstatt live und PrintDock laufen weiter. Auf den Hauptseiten bleiben Impressum und Datenschutz erreichbar.')}</p>`;
}

// ================================================================ Einstellungen des Portals (Materialien, Preise, Mailtexte, Allgemein)

function ptNeedConfig(title) {
  if (S.pConfig) return null;
  if (S.pBusy.configErr) return ptErrBox('config', title);
  ptEnsure('config', async () => { S.pBusy.configErr = null; S.pConfig = await api('portal/config'); });
  return ptLoading(title);
}
const pcVal = (k) => (S.pcDraft[k] !== undefined ? S.pcDraft[k] : S.pConfig?.config?.[k]);
const pcDirty = () => Object.keys(S.pcDraft).length > 0;
const pcSaveBar = () => `<div class="pt-savebar ${pcDirty() ? 'on' : ''}"><span>${pcDirty() ? t('Ungespeicherte Änderungen') : t('Alles gespeichert')}</span><button class="b b-sm" data-pc-act="discard" ${pcDirty() ? '' : 'disabled'}>${t('Verwerfen')}</button><button class="b b-sm b-go" data-pc-act="save" ${pcDirty() ? '' : 'disabled'}>${t('Speichern')}</button></div>`;

function pcRow(key, label, hint, kind = 'text', opts = {}) {
  const v = pcVal(key);
  let ctl;
  if (kind === 'bool') ctl = `<span class="tgl"><input type="checkbox" data-pc="${key}" data-pck="bool" ${v ? 'checked' : ''}><span class="sw"></span></span>`;
  else if (kind === 'area') ctl = `<textarea class="in" rows="${opts.rows || 2}" data-pc="${key}" style="width:100%">${esc(v ?? '')}</textarea>`;
  else if (kind === 'num') ctl = `<span class="pt-unit"><input class="in num" data-pc="${key}" data-pck="num" inputmode="decimal" value="${esc(ptNum(opts.scale ? (v === '' || v == null ? '' : Math.round(Number(v) * opts.scale * 1000) / 1000) : v))}" ${opts.scale ? `data-pcs="${opts.scale}"` : ''} style="width:7rem">${opts.unit ? `<span>${esc(opts.unit)}</span>` : ''}</span>`;
  else ctl = `<input class="in" data-pc="${key}" value="${esc(v ?? '')}" placeholder="${esc(opts.ph || '')}" style="min-width:${opts.w || '16rem'}">`;
  return `<div class="lrow"><div class="lt"><b>${label}</b>${hint ? `<span>${hint}</span>` : ''}</div><div class="lc ${kind === 'area' ? 'pt-wide' : ''}">${ctl}</div></div>`;
}

// ---------------------------------------------------------------- Materialien

function vPMat() {
  const wait = ptNeedConfig(t('Materialien'));
  if (wait) return wait;
  const mats = S.pConfig.materials || [];
  const rows = mats.map((m) => `<div class="row pt-mrow ${m.active ? '' : 'dim'}" data-id="m${m.id}">
      <div class="c-main"><b>${esc(m.name)}</b>${m.note ? `<div class="meta">${esc(m.note)}</div>` : ''}</div>
      <div><span class="lbl">${t('Farben')}</span><span class="pt-dots">${(m.colors || []).map((c) => `<i style="background:${esc(c.hex)}" title="${esc(c.name)}"></i>`).join('') || '–'}</span>${m.multicolor ? `<div class="meta">${t('mehrfarbig möglich')}</div>` : ''}</div>
      <div><span class="lbl">${t('Preis')}</span><span class="num">${fnum(m.price_per_g, 3)} €/g</span><div class="meta">${t('Dichte {d} g/cm³', { d: fnum(m.density, 2) })}</div></div>
      <div><span class="lbl">${t('Im Portal')}</span><label class="tgl" title="${esc(t('Im Portal anbieten'))}"><input type="checkbox" data-pm-active="${m.id}" ${m.active ? 'checked' : ''}><span class="sw"></span></label></div>
      <div class="acts"><button class="b b-sm" data-pm-edit="${m.id}">${ICON.edit}${t('Bearbeiten')}</button><button class="x del" data-pm-del="${m.id}" title="${esc(t('Löschen'))}" aria-label="${esc(t('Löschen'))}">${ICON.trash}</button></div>
    </div>`).join('');
  return `${ptHead(t('Materialien'), `<button class="b b-sm b-go" data-pm-edit="0">${ICON.plus}${t('Neues Material')}</button>`)}
    <div class="list">${mats.length ? `<div class="row pt-mrow head"><div>${t('Material')}</div><div>${t('Farben')}</div><div>${t('Preis')}</div><div>${t('Im Portal')}</div><div></div></div>${rows}` : `<div class="empty"><h3>${t('Noch keine Materialien')}</h3></div>`}</div>
    <p class="meta pt-foot">${t('Ausgeschaltete Materialien sieht der Kunde nicht. Bestehende Aufträge behalten ihren Materialnamen, auch wenn du ein Material löschst.')}</p>`;
}

function ptMatDialog(m) {
  const colorRow = (c = {}) => `<div class="pt-crow"><input type="color" value="${esc(c.hex || '#888888')}" aria-label="${t('Farbe')}"><input class="in" value="${esc(c.name || '')}" placeholder="${esc(t('Name, z. B. Signalrot'))}"><button class="x del" type="button" data-crm aria-label="${esc(t('Entfernen'))}">${ICON.trash}</button></div>`;
  const d = openDialog(`<form class="dlg" method="dialog">
    <h2>${m ? t('Material bearbeiten') : t('Neues Material')}</h2>
    <label>${t('Name')}<input name="name" required value="${esc(m?.name || '')}" placeholder="PETG"></label>
    <div class="two">
      <label>${t('Dichte (g/cm³)')}<input name="density" inputmode="decimal" value="${esc(ptNum(m?.density ?? 1.24))}"></label>
      <label>${t('Preis (€ je g)')}<input name="price_per_g" inputmode="decimal" value="${esc(ptNum(m?.price_per_g ?? 0.06))}"></label>
    </div>
    <label>${t('Hinweis für Kunden')}<input name="note" value="${esc(m?.note || '')}" placeholder="${esc(t('z. B. zäh und hitzebeständig'))}"></label>
    <div class="two">
      <label>${t('Reihenfolge')}<input name="sort" type="number" value="${esc(m?.sort ?? 0)}"></label>
      <label class="check"><input type="checkbox" name="multicolor" ${m?.multicolor ? 'checked' : ''}> ${t('mehrfarbig möglich')}</label>
    </div>
    <label class="check"><input type="checkbox" name="active" ${!m || m.active ? 'checked' : ''}> ${t('im Portal anbieten')}</label>
    <div><b>${t('Farben')}</b><div class="pt-colors">${(m?.colors || []).map(colorRow).join('')}</div><button class="b b-sm" type="button" data-cadd>${ICON.plus}${t('Farbe')}</button></div>
    <p class="form-error" hidden></p>
    <div class="dlg-actions"><button class="b" type="button" data-close>${t('Abbrechen')}</button><button class="b b-go">${t('Speichern')}</button></div></form>`, { wide: true });
  d.addEventListener('click', (e) => {
    if (e.target.closest('[data-cadd]')) $('.pt-colors', d).insertAdjacentHTML('beforeend', colorRow());
    const rm = e.target.closest('[data-crm]');
    if (rm) rm.closest('.pt-crow').remove();
  });
  $('form', d).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = {
      id: m?.id || 0, name: f.name.value, density: f.density.value, price_per_g: f.price_per_g.value, note: f.note.value,
      sort: Number(f.sort.value) || 0, multicolor: f.multicolor.checked, active: f.active.checked,
      colors: $$('.pt-crow', d).map((r) => ({ hex: $('input[type=color]', r).value, name: $('.in', r).value })).filter((c) => c.name.trim()),
      name_en: m?.name_en || '', note_en: m?.note_en || '',
    };
    try {
      const r = await api('portal/materials', { method: 'POST', body });
      S.pConfig.materials = r.materials;
      toast(r.message || t('Gespeichert'));
      d.close();
      render();
    } catch (err) {
      formError(d, err.message);
    }
  });
}

// ---------------------------------------------------------------- Preise

function vPPrice() {
  const wait = ptNeedConfig(t('Preise'));
  if (wait) return wait;
  const disc = pcVal('discounts') || [];
  const drows = disc.map((r, i) => `<div class="pt-drow"><span>${t('ab')}</span><input class="in num" data-pcd="${i}:from" value="${esc(r.from)}" inputmode="numeric" style="width:5rem"><span>${t('Stück')}</span><input class="in num" data-pcd="${i}:pct" value="${esc(ptNum(r.pct))}" inputmode="decimal" style="width:5rem"><span>% ${t('Rabatt')}</span><button class="x del" data-pcd-rm="${i}" aria-label="${esc(t('Entfernen'))}">${ICON.trash}</button></div>`).join('');
  return `${ptHead(t('Preise'))}${pcSaveBar()}
    <p class="meta pt-intro">${t('So rechnet das Portal: Gewicht = Volumen × Dichte × Materialanteil · Druckzeit = Gewicht ÷ Durchsatz · Stückpreis = Gewicht × €/g + Druckzeit × Maschinenstunde + Zusatzfarben × Aufschlag. Auftrag = Summe (mit Mengenrabatt) + Grundgebühr, mindestens Mindestauftragswert. Der Kunde sieht ± Spanne.')}</p>
    <h3 class="shead">${t('Grundlagen')}</h3><div class="sbox">
      ${pcRow('base_fee', t('Grundgebühr je Auftrag'), '', 'num', { unit: '€' })}
      ${pcRow('min_price', t('Mindestauftragswert'), t('ohne Versand'), 'num', { unit: '€' })}
      ${pcRow('machine_rate', t('Maschinenstunde'), '', 'num', { unit: '€/h' })}
      ${pcRow('throughput', t('Durchsatz'), t('für die Zeitschätzung'), 'num', { unit: 'g/h' })}
      ${pcRow('fill_factor', t('Materialanteil'), t('Wände und Füllung im Verhältnis zum Volumen'), 'num', { unit: '%', scale: 100 })}
      ${pcRow('color_surcharge', t('Aufschlag je Zusatzfarbe'), t('je Stück'), 'num', { unit: '€' })}
      ${pcRow('spread_pct', t('Spanne der Schätzung'), t('± Prozent, die der Kunde sieht'), 'num', { unit: '%' })}
    </div>
    <h3 class="shead">${t('Mengenrabatt')}</h3><div class="sbox pt-pad">${drows || `<p class="meta">${t('Kein Mengenrabatt.')}</p>`}<button class="b b-sm" data-pcd-add>${ICON.plus}${t('Staffel')}</button></div>
    <h3 class="shead">${t('Versand')}</h3><div class="sbox">
      ${pcRow('shipping', t('Versandkosten'), '', 'num', { unit: '€' })}
      ${pcRow('free_shipping_from', t('Versandkostenfrei ab'), t('0 = nie'), 'num', { unit: '€' })}
    </div>
    <h3 class="shead">${t('Hinweis unter dem Preis')}</h3><div class="sbox">${pcRow('price_note_de', t('Text'), '', 'area', { rows: 3 })}</div>`;
}

// ---------------------------------------------------------------- Mailtexte

const PT_PH = ['name', 'nummer', 'link', 'schaetzung', 'preis', 'versand', 'gesamt', 'nachricht', 'sendung', 'shop'];
function vPMail() {
  const wait = ptNeedConfig(t('Mailtexte'));
  if (wait) return wait;
  const keys = S.pConfig.mail_keys || {};
  if (!keys[S.pMailKey]) S.pMailKey = Object.keys(keys)[0];
  const tpl = (pcVal('mail_templates') || {})[S.pMailKey]?.de || { subject: '', body: '' };
  const tabs = Object.entries(keys).map(([k, l]) => `<button class="chip" data-pmail="${k}" aria-pressed="${k === S.pMailKey}">${esc(t(l))}</button>`).join('');
  return `${ptHead(t('Mailtexte'), `<button class="b b-sm" data-pc-act="mailreset">${t('Alle auf Standard')}</button>`)}${pcSaveBar()}
    <div class="chips pt-chips">${tabs}</div>
    <div class="sbox pt-pad pt-mail">
      <label class="pt-f"><span>${t('Betreff')} <em>${t('leer = keine Mail bei diesem Status')}</em></span><input class="in" data-pct="subject" value="${esc(tpl.subject)}"></label>
      <label class="pt-f"><span>${t('Text')}</span><textarea class="in pt-mono" rows="14" data-pct="body">${esc(tpl.body)}</textarea></label>
      <p class="meta">${t('Platzhalter')}: ${PT_PH.map((p) => `<code data-pt-ph="${p}" title="${esc(t('Einfügen'))}">{${p}}</code>`).join(' ')}</p>
    </div>`;
}

// ---------------------------------------------------------------- Portal-Einstellungen

function vPSet() {
  const wait = ptNeedConfig(t('Portal-Einstellungen'));
  if (wait) return wait;
  const P = S.portal || {};
  const fm = pcVal('formats') || [];
  const pdTgl = (attr, on, label, hint) => `<div class="lrow"><div class="lt"><b>${label}</b><span>${hint}</span></div><div class="lc"><span class="tgl"><input type="checkbox" ${attr} ${on ? 'checked' : ''}><span class="sw"></span></span></div></div>`;
  return `${ptHead(t('Portal-Einstellungen'))}${pcSaveBar()}
    <h3 class="shead">${t('PrintDock und Portal')}</h3><div class="sbox">
      ${pdTgl('data-ptp="autoImport"', P.autoImport !== false, t('Bestätigte Aufträge automatisch übernehmen'), t('Sonst übernimmst du sie in der Anfrage per Knopf.'))}
      ${pdTgl('data-ptp="notifyNew"', P.notifyNew !== false, t('Bei neuen Anfragen benachrichtigen'), t('Über deine Kanäle unter Einstellungen → Benachrichtigungen (Ereignis „Neue Anfrage im Druckportal“).'))}
      <div class="lrow"><div class="lt"><b>${t('Verbindung')}</b><span>${esc(P.url || '')} · ${P.state?.ok ? t('verbunden') : esc(P.state?.error || t('nicht geprüft'))}</span></div><div class="lc"><button class="b b-sm" data-view="remote">${t('Ändern …')}</button></div></div>
    </div>
    <h3 class="shead">${t('Allgemein')}</h3><div class="sbox">
      ${pcRow('shop_name', t('Shop-Name'), '')}
      ${pcRow('tagline_de', t('Untertitel unter dem Logo'), '')}
      ${pcRow('site_url', t('Hauptseite'), '', 'text', { ph: 'https://example.com' })}
      ${pcRow('base_url', t('Öffentliche Adresse des Portals'), t('für Links in Mails, leer = automatisch'), 'text', { ph: 'https://druck.example.com' })}
      ${pcRow('order_prefix', t('Nummern-Präfix'), '', 'text', { w: '6rem' })}
    </div>
    <h3 class="shead">${t('Bauraum & Dateien')}</h3><div class="sbox">
      <div class="lrow"><div class="lt"><b>${t('Bauraum')}</b><span>${t('größtes Teil in einem Stück (mm)')}</span></div><div class="lc pt-xyz">${['build_x', 'build_y', 'build_z'].map((k) => `<input class="in num" data-pc="${k}" data-pck="num" value="${esc(pcVal(k))}" style="width:5rem" aria-label="${k}">`).join('×')}</div></div>
      <div class="lrow"><div class="lt"><b>${t('Dateiformate')}</b></div><div class="lc">${['stl', '3mf'].map((f) => `<label class="pt-chk"><input type="checkbox" data-pcfmt="${f}" ${fm.includes(f) ? 'checked' : ''}> ${f.toUpperCase()}</label>`).join(' ')}</div></div>
      ${pcRow('max_file_mb', t('Größe je Datei'), '', 'num', { unit: 'MB' })}
      ${pcRow('max_files', t('Dateien je Anfrage'), '', 'num')}
      ${pcRow('max_qty', t('Stückzahl je Position'), '', 'num')}
      ${pcRow('max_colors', t('Farben je Teil'), '', 'num')}
    </div>
    <h3 class="shead">${t('E-Mail')}</h3><div class="sbox">
      ${pcRow('mail_enabled', t('Mails wirklich versenden'), t('aus = nur ins Protokoll des Portals schreiben'), 'bool')}
      ${pcRow('mail_from', t('Absender'), '')}
      ${pcRow('mail_from_name', t('Absendername'), '')}
      ${pcRow('mail_shop', t('Eure Adresse'), t('bekommt neue Anfragen und Testmails'))}
      <div class="lrow"><div class="lt"><b>${t('Testmail')}</b><span>${t('an eure Adresse')}</span></div><div class="lc"><button class="b b-sm" data-pc-act="testmail">${t('Senden')}</button></div></div>
    </div>
    <h3 class="shead">${t('Rechtliches')}</h3><div class="sbox">
      ${pcRow('impressum_url', t('Impressum'), t('leer = Seite der Hauptseite'))}
      ${pcRow('privacy_url', t('Datenschutz'), t('leer = Seite der Hauptseite'))}
      ${pcRow('agb_url', t('AGB'), '')}
    </div>
    <h3 class="shead">${t('Extras')}</h3><div class="sbox">
      ${pcRow('schichtsalat_url', t('Spiel auf der Statusseite'), t('auf der Statusseite als Wartezeit-Spiel, leer = aus'))}
      ${pcRow('werkstatt_origins', t('Werkstatt live darf angezeigt werden auf'), t('Adressen, mit Leerzeichen getrennt'))}
      ${pcRow('rate_limit_hour', t('Anfragen je IP und Stunde'), t('0 = unbegrenzt'), 'num')}
    </div>
    <p class="meta pt-foot">${t('Passwort und API-Schlüssel des Portals lassen sich nur im Portal-Admin ändern.')}</p>`;
}

Object.assign(VIEW_FN, { pinbox: vPInbox, pwartung: vPWartung, pmat: vPMat, pprice: vPPrice, pmail: vPMail, pset: vPSet });

// Nach dem Zeichnen: 3D-Vorschauen anbinden
{
  const base = render;
  render = function () {
    base();
    if (S.view === 'pinbox' && S.pOrderId) ptBindViewers();
  };
}

// ================================================================ Bedienung

async function ptRefreshOrder(r) {
  if (r?.order) S.pOrder = r.order;
  S.pInbox = await api('portal/inbox').catch(() => S.pInbox);
  render();
}

document.addEventListener('click', async (e) => {
  const el = e.target;
  const open = el.closest('[data-pt-open]');
  if (open && !el.closest('a,button')) return ptOpen(open.dataset.ptOpen);
  const f = el.closest('[data-pt-filter]');
  if (f) { S.pFilter = f.dataset.ptFilter; return render(); }
  const retry = el.closest('[data-pt-retry]');
  if (retry) { S.pBusy[`${retry.dataset.ptRetry}Err`] = null; if (retry.dataset.ptRetry === 'inbox') S.pInbox = null; return render(); }
  const reset = el.closest('[data-pt-view-reset]');
  if (reset) {
    const m = PT_MESH.get(reset.dataset.ptViewReset);
    if (m) { m.view = { az: -0.65, el: 0.5, zoom: 1 }; $(`[data-ptmesh="${reset.dataset.ptViewReset}"] canvas`)?._ptDraw?.(false); }
    return;
  }
  const ph = el.closest('[data-pt-ph]');
  if (ph) {
    const ta = $('[data-pct="body"]');
    if (!ta) return;
    const s = ta.selectionStart ?? ta.value.length;
    ta.value = `${ta.value.slice(0, s)}{${ph.dataset.ptPh}}${ta.value.slice(ta.selectionEnd ?? s)}`;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return ta.focus();
  }

  const act = el.closest('[data-pt-act]')?.dataset.ptAct;
  if (act) {
    const o = S.pOrder;
    if (act === 'back') { S.pOrderId = null; S.pOrder = null; S.pDraft = {}; return render(); }
    if (act === 'refresh') { const r = await run(() => api('portal/inbox?refresh=1'), t('Aktualisiert')); if (r) { S.pInbox = r; render(); } return; }
    if (act === 'discard') { S.pDraft = {}; return render(); }
    if (act === 'usePrice' && o?.price) {
      S.pDraft.offer_price = ptNum(o.price.price);
      if (S.pDraft.offer_shipping === undefined && o.offer?.shipping == null) S.pDraft.offer_shipping = ptNum(o.price.shipping);
      if (o.status === 'angefragt') S.pDraft.status = 'angebot';
      return render();
    }
    if (act === 'save' && o) {
      const r = await run(() => api(`portal/orders/${o.id}/update`, { method: 'POST', body: ptCollectDraft() }));
      if (r) { toast(r.message || t('Gespeichert')); S.pDraft = {}; await ptRefreshOrder(r); }
      return;
    }
    if (act === 'paid' && o) {
      const r = await run(() => api(`portal/orders/${o.id}/paid`, { method: 'POST', body: { paid: !o.paid_at } }));
      if (r) { toast(r.message); await ptRefreshOrder(r); }
      return;
    }
    if (act === 'import' && o) {
      const r = await run(() => api(`portal/orders/${o.id}/import`, { method: 'POST' }), t('In PrintDock übernommen'));
      if (r) { S.pOrder = r; reload('orders', 'files', 'summary'); await ptRefreshOrder(); }
      return;
    }
    if (act === 'delete' && o) {
      if (!(await confirmBox(t('Anfrage {nr} löschen?', { nr: o.number }), t('Die Anfrage und alle hochgeladenen Dateien werden im Portal endgültig gelöscht. Ein PrintDock-Auftrag bleibt bestehen.'), t('Löschen'), 'b-fault'))) return;
      const r = await run(() => api(`portal/orders/${o.id}`, { method: 'DELETE' }));
      if (r) { toast(r.message); S.pOrderId = null; S.pOrder = null; S.pDraft = {}; await ptRefreshOrder(); }
    }
    return;
  }

  // Wartung
  const all = el.closest('[data-pw-all]');
  if (all) {
    const an = all.dataset.pwAll === '1';
    if (an && !(await confirmBox(t('Alles in Wartung?'), t('Alle Seiten und das Druckportal zeigen dann die Wartungsseite.'), t('Alles in Wartung'), 'b-fault'))) return;
    const r = await run(() => api('portal/wartung/alle', { method: 'PUT', body: { an } }), an ? t('Alles in Wartung') : t('Alles wieder online'));
    if (r) { S.pWartung = r; render(); }
    return;
  }
  const ws = el.closest('[data-pw-save]');
  if (ws) {
    const k = ws.dataset.pwSave;
    const w = S.pWartung?.ziele?.[k] || {};
    const r = await run(() => api(`portal/wartung/${k}`, { method: 'PUT', body: { an: Boolean(w.an), text: S.pwDraft[k] ?? '' } }), t('Hinweis gespeichert'));
    if (r) { S.pWartung = r; delete S.pwDraft[k]; render(); }
    return;
  }

  // Materialien
  const me = el.closest('[data-pm-edit]');
  if (me) return ptMatDialog(Number(me.dataset.pmEdit) ? (S.pConfig.materials || []).find((m) => m.id === Number(me.dataset.pmEdit)) : null);
  const md = el.closest('[data-pm-del]');
  if (md) {
    const m = (S.pConfig.materials || []).find((x) => x.id === Number(md.dataset.pmDel));
    if (!m || !(await confirmBox(t('„{n}“ löschen?', { n: m.name }), t('Das Material verschwindet aus dem Portal. Bestehende Aufträge behalten ihren Materialnamen. Nur ausschalten geht auch.'), t('Löschen'), 'b-fault'))) return;
    const r = await run(() => api(`portal/materials/${m.id}`, { method: 'DELETE' }));
    if (r) { S.pConfig.materials = r.materials; toast(r.message); render(); }
    return;
  }

  // Mailtexte
  const mk = el.closest('[data-pmail]');
  if (mk) { S.pMailKey = mk.dataset.pmail; return render(); }

  // Preise: Rabattstaffeln
  if (el.closest('[data-pcd-add]')) {
    const d = (pcVal('discounts') || []).map((x) => ({ ...x }));
    const last = d[d.length - 1];
    d.push({ from: last ? last.from * 2 : 5, pct: last ? last.pct + 5 : 5 });
    S.pcDraft.discounts = d;
    return render();
  }
  const dr = el.closest('[data-pcd-rm]');
  if (dr) {
    const d = (pcVal('discounts') || []).map((x) => ({ ...x }));
    d.splice(Number(dr.dataset.pcdRm), 1);
    S.pcDraft.discounts = d;
    return render();
  }

  const pca = el.closest('[data-pc-act]')?.dataset.pcAct;
  if (pca === 'discard') { S.pcDraft = {}; return render(); }
  if (pca === 'save') {
    const body = { ...S.pcDraft };
    const r = await run(() => api('portal/config', { method: 'PUT', body }), t('Gespeichert'));
    if (r) { S.pConfig = r; S.pcDraft = {}; render(); }
    return;
  }
  if (pca === 'testmail') {
    const r = await run(() => api('portal/testmail', { method: 'POST' }));
    if (r) toast(r.message);
    return;
  }
  if (pca === 'mailreset') {
    if (!(await confirmBox(t('Alle Mailtexte zurücksetzen?'), t('Alle Vorlagen bekommen wieder den Standardtext.'), t('Zurücksetzen'), 'b-fault'))) return;
    const r = await run(() => api('portal/config', { method: 'PUT', body: { mail_templates: null } }), t('Zurückgesetzt'));
    if (r) { S.pConfig = r; delete S.pcDraft.mail_templates; render(); }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const open = e.target.closest?.('[data-pt-open]');
  if (open && e.target === open) ptOpen(open.dataset.ptOpen);
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.matches('[data-pf]')) {
    S.pDraft[el.dataset.pf] = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.pf === 'status') render();
    else ptDirtyHint();
    return;
  }
  if (el.matches('[data-pw-text]')) {
    S.pwDraft[el.dataset.pwText] = el.value;
    const b = $(`[data-pw-save="${el.dataset.pwText}"]`);
    if (b) b.disabled = false;
    return;
  }
  if (el.matches('[data-pc]')) {
    const k = el.dataset.pc;
    let v = el.dataset.pck === 'bool' ? el.checked : el.value;
    if (el.dataset.pcs && v !== '') v = String(Number(String(v).replace(',', '.')) / Number(el.dataset.pcs));
    S.pcDraft[k] = v;
    ptSaveBarHint();
    return;
  }
  if (el.matches('[data-pcd]')) {
    const [i, f] = el.dataset.pcd.split(':');
    const d = (pcVal('discounts') || []).map((x) => ({ ...x }));
    if (d[i]) d[i][f] = el.value;
    S.pcDraft.discounts = d;
    ptSaveBarHint();
    return;
  }
  if (el.matches('[data-pcfmt]')) {
    S.pcDraft.formats = $$('[data-pcfmt]').filter((x) => x.checked).map((x) => x.dataset.pcfmt);
    ptSaveBarHint();
    return;
  }
  if (el.matches('[data-pct]')) {
    const all = JSON.parse(JSON.stringify(pcVal('mail_templates') || {}));
    all[S.pMailKey] = all[S.pMailKey] || {};
    all[S.pMailKey].de = { ...(all[S.pMailKey].de || { subject: '', body: '' }), [el.dataset.pct]: el.value };
    S.pcDraft.mail_templates = all;
    ptSaveBarHint();
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.matches('[data-pf][type=checkbox], select[data-pf]')) return; // schon über „input“
  const tg = el.closest('[data-pw-tgl]');
  if (tg) {
    const k = tg.dataset.pwTgl;
    const body = { an: tg.checked };
    if (S.pwDraft[k] !== undefined) body.text = S.pwDraft[k];
    const name = S.pWartung?.ziele?.[k]?.name || k;
    const r = await run(() => api(`portal/wartung/${k}`, { method: 'PUT', body }), tg.checked ? t('{n} in Wartung', { n: name }) : t('{n} wieder online', { n: name }));
    if (r) { S.pWartung = r; delete S.pwDraft[k]; }
    else tg.checked = !tg.checked;
    return render();
  }
  const pa = el.closest('[data-pm-active]');
  if (pa) {
    const m = (S.pConfig.materials || []).find((x) => x.id === Number(pa.dataset.pmActive));
    if (!m) return;
    const r = await run(() => api('portal/materials', { method: 'POST', body: { ...m, active: pa.checked } }), pa.checked ? t('Im Portal sichtbar') : t('Im Portal ausgeblendet'));
    if (r) S.pConfig.materials = r.materials;
    return render();
  }
  const pp = el.closest('[data-ptp]');
  if (pp) {
    const r = await run(() => api('portal', { method: 'PUT', body: { [pp.dataset.ptp]: pp.checked } }), t('Gespeichert'));
    if (r) S.portal = r;
    return render();
  }
});

/** Speichern-Leiste und Knöpfe aktualisieren, ohne die Eingabe zu stören */
function ptSaveBarHint() {
  const bar = $('.pt-savebar');
  if (!bar) return;
  const tpl = document.createElement('template');
  tpl.innerHTML = pcSaveBar();
  bar.replaceWith(tpl.content.firstElementChild);
}
function ptDirtyHint() {
  const foot = $('.pt-edit .st-foot');
  if (foot && !$('[data-pt-act="discard"]', foot)) foot.insertAdjacentHTML('beforeend', `<button class="b b-sm" data-pt-act="discard">${t('Verwerfen')}</button>`);
}

/** Live: Server meldet Änderungen am Portal (neue Anfragen, Übernahme) */
function onPortalLive() {
  reload('portal', 'pInbox');
}
