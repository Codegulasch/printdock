'use strict';
/* PrintDock – Oberfläche: Navigation, Hilfen, Warteschlange, Aufträge, Dateien,
   Wartung, Verlauf und Einstellungen. Weitere Bereiche in board.js, filament-ui.js,
   stats-ui.js, ha-ui.js und setup-ui.js. */

// ================================================================ Sprache

let LANG = 'de';
let LOC = 'de-DE';
const t = (key, vars) => PD_I18N.translate(LANG, key, vars);
function setLang(l) {
  LANG = l === 'en' ? 'en' : 'de';
  LOC = LANG === 'en' ? 'en-GB' : 'de-DE';
  document.documentElement.lang = LANG;
}

// ================================================================ Navigation

const NAV_ICON = {
  printer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2"/><rect x="6" y="14" width="12" height="7" rx="1"/></svg>',
  queue: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h11M4 12h11M4 18h7"/><path d="M18 14v6m-3-3 3 3 3-3"/></svg>',
  orders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v3h6V3M9 11h6M9 15h4"/></svg>',
  files: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  spool: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v6M12 15v6"/></svg>',
  wrench: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14.5 6.5a4 4 0 0 0 5 5L12 19l-3 1 1-3 7.5-7.5m-3-3L17 3l4 4-3.5 3.5"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/></svg>',
};

/** Seitenleiste; m = nötiges Modul. Bereiche mit mehreren Seiten zeigen oben Reiter. */
// sec = Überschrift in der Seitenleiste; in den Einstellungen gruppiert das 4. Feld die Reiter.
const NAV_ALL = [
  { g: 'board', l: 'Drucker#pl', icon: 'printer', sec: 'Produktion', v: [['board', 'Drucker#pl']] },
  { g: 'queue', l: 'Warteschlange', icon: 'queue', v: [['queue', 'Warteschlange', 'queue']] },
  { g: 'orders', l: 'Aufträge', icon: 'orders', v: [['orders', 'Aufträge', 'orders']] },
  { g: 'files', l: 'Dateien', icon: 'files', v: [['files', 'Dateien', 'files']] },
  { g: 'fil', l: 'Filament', icon: 'spool', sec: 'Material', v: [['spools', 'Spulen', 'filament'], ['slots', 'Belegung', 'filament'], ['hum', 'Feuchte & Trocknen', 'filament'], ['usage', 'Verbrauch', 'filament']] },
  { g: 'maint', l: 'Wartung', icon: 'wrench', sec: 'Werkstatt', v: [['maint', 'Wartungsplan', 'maintenance']] },
  { g: 'ana', l: 'Auswertung', icon: 'chart', v: [['stats', 'Statistik', 'stats'], ['history', 'Verlauf', 'history']] },
  // Einstellungen: eigene Navigation in der Seite (wie eine Einstellungs-App), daher ohne Reiter oben
  { g: 'set', l: 'Einstellungen', icon: 'gear', sep: true, inline: true, v: [
    ['general', 'Allgemein'], ['workshop', 'Drucker & Filament'], ['station', 'PrintDock Station', 'filament'],
    ['notify', 'Benachrichtigungen', 'notifications'], ['ha', 'Home Assistant', 'homeassistant'], ['slicer', 'Slicer', 'slicer'], ['system', 'System'],
  ] },
];
const on = (m) => !m || S.app?.modules?.[m] !== false;
/** Menü-Einstellung: auf diesem Gerät gespeichert oder für alle (Einstellungen → Allgemein → Menü) */
function navCfg() {
  try {
    const local = JSON.parse(localStorage.getItem('pd-nav') || 'null');
    if (local) return local;
  } catch {}
  return S.app?.nav || {};
}
function navGroups() {
  const cfg = navCfg();
  const hidden = new Set(cfg.hidden || []);
  let list = NAV_ALL.map((g) => ({ ...g, v: g.v.filter((v) => on(v[2]) && (!v[4] || v[4]())) })).filter((g) => g.v.length && (g.g === 'set' || !hidden.has(g.g)));
  if (cfg.order?.length) {
    // eigene Reihenfolge: Bereichsüberschriften entfallen, Einstellungen bleiben unten
    const pos = (g) => { const i = cfg.order.indexOf(g.g); return i < 0 ? 900 + NAV_ALL.indexOf(NAV_ALL.find((x) => x.g === g.g)) : i; };
    const set = list.filter((g) => g.g === 'set');
    list = list.filter((g) => g.g !== 'set').sort((a, b) => pos(a) - pos(b)).map((g) => ({ ...g, sec: undefined })).concat(set);
  }
  // Bediener: keine Einstellungen
  if (S.app?.me?.role === 'operator') list = list.filter((g) => g.g !== 'set');
  return list;
}
/** Startseite: eingestellt, sonst der erste Menüpunkt */
function homeView() {
  const avail = viewsAvailable();
  const h = navCfg().home;
  if (h && avail.includes(h)) return h;
  return navGroups()[0]?.v[0][0] || 'board';
}
const viewsAvailable = () => navGroups().flatMap((g) => g.v.map((v) => v[0]));

const S = {
  view: location.hash.slice(1) || 'board',
  app: null, drivers: [], printers: [], summary: null, queue: [], orders: [], files: [], maint: null,
  history: [], channels: [], notifyTypes: { events: [], channels: [] }, settings: null,
  qFilter: 'offen', oFilter: 'aktiv', fFilter: 'alle', live: false,
  cameraOpen: new Set(),
};

// ================================================================ Hilfen

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
function fmtTimer(sec) {
  sec = Math.max(0, Math.round(sec));
  return `${Math.floor(sec / 3600)}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`;
}
function fmtDur(sec) {
  if (sec == null || Number.isNaN(sec)) return '–';
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${pad(m % 60)} min`;
}
const fnum = (n, d = 1) => Number(n || 0).toLocaleString(LOC, { minimumFractionDigits: d, maximumFractionDigits: d });
const money = (n) => Number(n || 0).toLocaleString(LOC, { style: 'currency', currency: 'EUR' });
function dfmt(iso) {
  if (!iso) return '–';
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(LOC, { day: '2-digit', month: '2-digit', year: '2-digit' });
}
const tfmt = (iso) => (iso ? new Date(iso).toLocaleString(LOC, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtSize = (b) => (b > 1e6 ? `${fnum(b / 1e6, 1)} MB` : `${Math.max(1, Math.round(b / 1e3))} kB`);
const printerById = (id) => S.printers.find((p) => p.id === id);

// ---------------- Bereiche (Printfarm, Räume): Auswahl gilt für Drucker-Seite, „Heute“ und die Kennzahlen oben
const areas = () => S.app?.areas || [];
const areaName = (id) => areas().find((a) => a.id === id)?.name || '';
S.area = (() => {
  try {
    return localStorage.getItem('pd-area') || '';
  } catch {
    return '';
  }
})();
/** gewählter Bereich (gelöschte zählen nicht) */
const curArea = () => (S.area && (S.area === '-' || areas().some((a) => a.id === S.area)) ? S.area : '');
/** Drucker im gewählten Bereich? ('-' = ohne Bereich) */
const inAreaP = (p) => {
  const a = curArea();
  if (!a) return true;
  const pa = areas().some((x) => x.id === p?.settings?.area) ? p.settings.area : '';
  return a === '-' ? !pa : pa === a;
};
/** Auswahl „Drucker“: passender Drucker, Bereiche, einzelne Drucker. Wert „area:<id>“ = passender Drucker im Bereich */
function targetOptionsHTML(printerId, areaId, anyLabel = 'Passender Drucker') {
  const sel = printerId || (areaId ? `area:${areaId}` : '');
  const opt = (v, l) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`;
  return opt('', t(anyLabel))
    + (areas().length ? `<optgroup label="${esc(t('Bereich – passender Drucker darin'))}">${areas().map((a) => opt(`area:${a.id}`, `${t('Bereich')}: ${a.name}`)).join('')}</optgroup><optgroup label="${esc(t('Drucker'))}">` : '')
    + S.printers.map((x) => opt(x.id, `${x.name}${areas().length && areaName(x.settings?.area) ? ` · ${areaName(x.settings.area)}` : ''}`)).join('')
    + (areas().length ? '</optgroup>' : '');
}
/** Wert der Auswahl → { printerId, areaId } */
const targetValue = (v) => (String(v || '').startsWith('area:') ? { printerId: null, areaId: v.slice(5) } : { printerId: v || null, areaId: null });

/** Umschalter oben (nur, wenn Bereiche angelegt sind) */
function areaSwitchHTML() {
  if (!areas().length) return '';
  const a = curArea();
  const chip = (id, label) => `<button class="chip" data-area="${esc(id)}" aria-pressed="${a === id}">${esc(label)}</button>`;
  const none = S.printers.some((p) => !areas().some((x) => x.id === p.settings?.area));
  return `<div class="area-switch"><span class="meta">${t('Bereich')}</span>${chip('', t('Alle'))}${areas().map((x) => chip(x.id, x.name)).join('')}${none ? chip('-', t('Ohne Bereich')) : ''}<button class="chip" data-areas-edit title="${esc(t('Bereiche anlegen und Drucker zuordnen'))}">⚙ ${t('Bereiche …')}</button></div>`;
}
// Bereich direkt in der Druckerliste ändern
document.addEventListener('change', async (e) => {
  const sel = e.target.closest('[data-parea]');
  if (!sel) return;
  const r = await run(() => api(`printers/${sel.dataset.parea}/area`, { method: 'PUT', body: { area: sel.value } }), t('Bereich gespeichert'));
  if (r) reload('printers');
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-area]');
  if (!b) return;
  S.area = b.dataset.area;
  try {
    localStorage.setItem('pd-area', S.area);
  } catch {
    /* privat */
  }
  render();
});
const fileById = (id) => S.files.find((f) => f.id === id);

const ICON = {
  play: '<svg class="ico" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg class="ico" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>',
  stop: '<svg class="ico" viewBox="0 0 24 24" fill="currentColor"><rect x="5.5" y="5.5" width="13" height="13" rx="1.5"/></svg>',
  cam: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8h3l2-3h8l2 3h3v11H3z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  gear: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/></svg>',
  check: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M4 12.5 9.5 18 20 6.5"/></svg>',
  plus: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M12 5v14M5 12h14"/></svg>',
  up: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m6 15 6-6 6 6"/></svg>',
  down: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m6 9 6 6 6-6"/></svg>',
  trash: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13"/></svg>',
  edit: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  wrench: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 6.5a4 4 0 0 0 5 5L12 19l-3 1 1-3 7.5-7.5m-3-3L17 3l4 4-3.5 3.5"/></svg>',
  upload: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 16V4m-5 5 5-5 5 5M4 20h16"/></svg>',
  open: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 4h6v6m0-6-9 9M18 14v6H4V6h6"/></svg>',
  plate: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 16h18l-2 4H5z"/><path d="M8 12h8v4H8z"/></svg>',
};

class AuthError extends Error {}

async function api(path, opts = {}) {
  const res = await fetch(`api/${path}`, {
    method: opts.method || 'GET',
    headers: opts.raw ? opts.headers : { 'Content-Type': 'application/json' },
    body: opts.raw ? opts.body : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== 'login') {
    if (typeof showLogin === 'function') showLogin();
    throw new AuthError(t('Bitte anmelden'));
  }
  if (!res.ok) throw new Error(data.error ? t(data.error) : t('Anfrage fehlgeschlagen ({s})', { s: res.status }));
  return data;
}

function toast(text, bad = false) {
  const el = document.createElement('div');
  el.className = `toast${bad ? ' bad' : ''}`;
  el.setAttribute('role', bad ? 'alert' : 'status');
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), bad ? 6000 : 3000);
}

/** Aktion mit Fehlermeldung als Toast. */
async function run(fn, okText) {
  try {
    const r = await fn();
    if (okText) toast(okText);
    return r;
  } catch (err) {
    if (!(err instanceof AuthError)) toast(err.message, true);
    return undefined;
  }
}

// ---------------------------------------------------------------- Tooltip (Diagramme)
const tipEl = document.createElement('div');
tipEl.className = 'tip';
tipEl.hidden = true;
document.addEventListener('DOMContentLoaded', () => document.body.append(tipEl));
document.addEventListener('pointermove', (e) => {
  const el = e.target.closest?.('[data-tip]');
  if (!el) { tipEl.hidden = true; return; }
  tipEl.innerHTML = el.dataset.tip;
  tipEl.hidden = false;
  const r = tipEl.getBoundingClientRect();
  let x = e.clientX + 14;
  let y = e.clientY - r.height - 10;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
  if (y < 8) y = e.clientY + 16;
  tipEl.style.transform = `translate(${x}px,${y}px)`;
});

// ================================================================ Dialoge

function openDialog(html, { wide = false, cls = '' } = {}) {
  const d = document.createElement('dialog');
  d.className = `${wide ? 'wide' : ''} ${cls}`;
  d.innerHTML = html;
  $('#dialogs').append(d);
  d.addEventListener('close', () => setTimeout(() => d.remove(), 50));
  d.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) d.close();
  });
  d.showModal();
  return d;
}

function confirmBox(title, text, okLabel = t('OK'), okCls = 'b-done', extraHtml = '') {
  return new Promise((resolve) => {
    const d = openDialog(`<form class="dlg" method="dialog">
      <h2>${esc(title)}</h2><p style="margin:0">${esc(text)}</p>${extraHtml}
      <div class="dlg-actions"><button class="b" value="no">${t('Abbrechen')}</button><button class="b ${okCls}" value="yes" autofocus>${esc(okLabel)}</button></div></form>`);
    d.addEventListener('close', () => resolve(d.returnValue === 'yes'));
  });
}

function formError(d, msg) {
  const el = $('.form-error', d);
  el.textContent = msg;
  el.hidden = !msg;
}

/** Formularfeld aus Treiber-/Kanal-Feldbeschreibung. */
function fieldHtml(f, value) {
  if (f.type === 'haNotify') {
    // Ziele aus Home Assistant (Companion-Apps, Meldungsglocke); ohne Verbindung von Hand eintragen
    const list = S.haNotify || [];
    if (list.length) {
      const cur = value || list.find((x) => x.id.startsWith('notify.mobile_app_'))?.id || list[0].id;
      return `<label>${esc(t(f.label))}<select name="cfg_${esc(f.key)}">${list.map((o) => `<option value="${esc(o.id)}" ${o.id === cur ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}${cur && !list.some((o) => o.id === cur) ? `<option value="${esc(cur)}" selected>${esc(cur)}</option>` : ''}</select></label>`;
    }
    return `<label>${esc(t(f.label))}<input name="cfg_${esc(f.key)}" required value="${esc(value ?? '')}" placeholder="notify.mobile_app_mein_handy" autocomplete="off">
      <span class="meta">${S.haNotify === null ? t('Ziele werden aus Home Assistant geladen …') : t('Keine Verbindung zu Home Assistant – Ziel von Hand eintragen oder unter Einstellungen → Home Assistant verbinden.')}</span></label>`;
  }
  if (f.type === 'select') {
    const cur = value ?? f.default;
    return `<label>${esc(t(f.label))}<select name="cfg_${esc(f.key)}">${f.options.map((o) => `<option value="${esc(o.value)}" ${o.value === cur ? 'selected' : ''}>${esc(t(o.label))}</option>`).join('')}</select></label>`;
  }
  const type = f.type === 'number' ? 'number' : f.secret ? 'password' : 'text';
  return `<label>${esc(t(f.label))}<input name="cfg_${esc(f.key)}" type="${type}" ${f.required ? 'required' : ''} value="${esc(value ?? '')}" placeholder="${esc(f.default ?? '')}" autocomplete="off"></label>`;
}
const readFields = (form) => Object.fromEntries($$('[name^="cfg_"]', form).map((el) => [el.name.slice(4), el.value]));

// ================================================================ Daten laden

// Mit welcher Version wurde diese Seite geladen? (index.html hängt ?v=<Version> an)
const UI_VERSION = (() => { try { return new URL(document.currentScript.src).searchParams.get('v'); } catch { return null; } })();

const loaders = {
  app: async () => {
    S.app = await api('app');
    // Nach einem Update: Server ist neuer als die Seite → einmal neu laden
    if (UI_VERSION && S.app.version && S.app.version !== UI_VERSION) {
      let tried = null;
      try { tried = sessionStorage.getItem('pd-reload'); sessionStorage.setItem('pd-reload', S.app.version); } catch {}
      if (tried !== S.app.version) return location.reload();
    }
    applyAppearance();
  },
  printers: async () => (S.printers = await api('printers')),
  summary: async () => (S.summary = await api('summary')),
  queue: async () => (S.queue = await api('queue')),
  orders: async () => (S.orders = await api('orders')),
  files: async () => { [S.files, S.parts] = await Promise.all([api('files'), api('parts')]); },
  maint: async () => (S.maint = await api('maintenance')),
  filament: async () => {
    S.fil = await api('filament');
    // Neues Gerät will sich koppeln → Hinweis, egal auf welcher Seite man gerade ist
    const seen = (S.pairSeen ||= new Set());
    for (const p of S.fil?.stations?.pairing || []) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      if (!['station', 'workshop'].includes(S.view)) toast(t('Neues Gerät möchte sich koppeln (Code {c}) – Einstellungen → PrintDock Station', { c: p.code }));
    }
    return S.fil;
  },
  history: async () => (S.history = await api('history?limit=300')),
  channels: async () => (S.channels = await api('notifications')),
  settings: async () => (S.settings = await api('settings')),
  ha: async () => (S.ha = await api('ha')),
};

const pendingLoads = new Set();
let loadTimer;
function reload(...keys) {
  keys.forEach((k) => pendingLoads.add(k));
  clearTimeout(loadTimer);
  loadTimer = setTimeout(async () => {
    const ks = [...pendingLoads];
    pendingLoads.clear();
    await Promise.all(ks.map((k) => loaders[k]?.().catch(() => {})));
    render();
  }, 150);
}

// ================================================================ Darstellung: Theme, Akzent, Sprache

function themeGet() {
  try { return localStorage.getItem('pd-theme') || 'auto'; } catch { return 'auto'; }
}
function isDark() {
  const th = themeGet();
  return th === 'dark' || (th === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
}
function applyTheme() {
  const th = themeGet();
  if (th === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = th;
}
function langPref() {
  try { return localStorage.getItem('pd-lang'); } catch { return null; }
}
function applyAppearance() {
  const a = S.app || {};
  document.documentElement.dataset.accent = a.accent || 'cobalt';
  document.documentElement.dataset.density = a.density || 'standard';
  setLang(langPref() || a.lang || 'de');
  applyTheme();
}

// ================================================================ Kopfzeile

function viewGroup(v) {
  const groups = navGroups();
  return (groups.find((g) => g.v.some((x) => x[0] === v)) || groups[0]).g;
}

function badges() {
  const s = S.summary || {};
  const faults = S.printers.filter((p) => p.status?.state === 'error').length;
  return {
    board: faults ? `<span class="badge">${faults}</span>` : '',
    queue: s.queueErrors ? `<span class="badge">${s.queueErrors}</span>` : '',
    orders: s.ordersLate ? `<span class="badge">${s.ordersLate}</span>` : '',
    maint: s.maintDue ? `<span class="badge warn">${s.maintDue}</span>` : '',
    spools: s.spoolsLow ? `<span class="badge warn">${s.spoolsLow}</span>` : '',
    system: S.app?.update ? `<span class="badge info" title="${esc(t('Update verfügbar'))}">↑</span>` : '',
  };
}

const GH_ICON = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';

/** Unten links: Version, Update-Hinweis, Codegulasch und GitHub */
function creditHTML() {
  const v = S.app?.version;
  const off = typeof MODULE_INFO !== 'undefined' ? MODULE_INFO.filter(([k]) => S.app?.modules?.[k] === false && k !== 'demo').length : 0;
  return `${off ? `<button class="side-disc" data-view="general" data-anchor-to="discover">✨ ${t('{n} weitere Funktionen entdecken', { n: off })}</button>` : ''}<div class="r"><b>PrintDock${v ? ` ${esc(v)}` : ''}</b><a class="beta" href="https://github.com/Codegulasch/printdock/issues/new/choose" target="_blank" rel="noopener" title="${esc(t('Öffentliche Beta – Fehler oder Wünsche melden'))}">Beta</a>${S.app?.update ? `<button class="upd" data-view="system" title="${esc(t('Update verfügbar'))}">${t('neu: {v}', { v: esc(S.app.update) })}</button>` : ''}<a class="gh" href="https://github.com/Codegulasch/printdock" target="_blank" rel="noopener" title="GitHub" aria-label="GitHub">${GH_ICON}</a></div>`;
}

function renderHead() {
  const b = badges();
  const cr = $('#credit');
  if (cr) { const h = creditHTML(); if (cr._h !== h) { cr.innerHTML = h; cr._h = h; } }
  const groups = navGroups();
  const cur = viewGroup(S.view);
  $('#nav').innerHTML = groups.map((g) => {
    const n = g.v.map((v) => b[v[0]] || '').join('');
    return `${g.sep ? '<div class="sep"></div>' : ''}${g.sec ? `<div class="nav-sec">${esc(t(g.sec))}</div>` : ''}<button data-group="${g.g}" ${g.g === cur ? 'aria-current="page"' : ''}>${NAV_ICON[g.icon]}<span>${esc(t(g.l))}</span>${n}</button>`;
  }).join('');
  const grp = groups.find((g) => g.g === cur);
  let lastSec = null;
  $('#subtabs').innerHTML = grp && grp.v.length > 1 && !grp.inline ? grp.v.map(([k, l, , sec]) => {
    const head = sec && sec !== lastSec ? `<span class="tab-sec">${esc(t(sec))}</span>` : '';
    lastSec = sec;
    return `${head}<button role="tab" data-view="${k}" aria-selected="${S.view === k}">${esc(t(l))}${b[k] || ''}</button>`;
  }).join('') : '';
  const m = $('#mode');
  m.className = `mode${S.live ? ' live' : ''}`;
  m.querySelector('span').textContent = S.live ? t('Live verbunden') : t('Keine Verbindung zum Server');
  const dark = isDark();
  $('#themeBtn').textContent = dark ? '☀' : '☾';
  $('#themeBtn').title = dark ? t('Hell anzeigen') : t('Dunkel anzeigen');
  $('#themeBtn').setAttribute('aria-label', $('#themeBtn').title);
  $('#langBtn').textContent = LANG === 'de' ? 'EN' : 'DE';
  $('#langBtn').title = LANG === 'de' ? 'English' : 'Deutsch';
  $('#logoutBtn').hidden = !S.app?.auth?.enabled;
  $('#logoutBtn').title = S.app?.me?.name ? t('Abmelden ({u})', { u: S.app.me.name }) : t('Abmelden');
  $('#nav').setAttribute('aria-label', t('Hauptnavigation'));
  $('#menuBtn').setAttribute('aria-label', t('Menü öffnen'));
}

/** Alte bzw. zusammengelegte Einstellungsseiten → Abschnitt auf „Drucker & Filament“ */
const VIEW_ALIAS = { printers: ['workshop', 'ws-printers'], filset: ['workshop', 'ws-fil'], humset: ['workshop', 'ws-hum'] };

function setView(v) {
  let anchor = null;
  if (VIEW_ALIAS[v]) [v, anchor] = VIEW_ALIAS[v];
  S.view = v;
  $('#side').classList.remove('open');
  $('#scrim').classList.remove('on');
  history.replaceState(null, '', `#${v}`);
  render();
  window.scrollTo(0, 0);
  if (anchor) requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ block: 'start' }));
  // Reiterleiste (Handy): gewählten Reiter sichtbar machen
  const tab = $('#subtabs [aria-selected="true"]');
  if (tab) tab.parentElement.scrollLeft = Math.max(0, tab.offsetLeft - 16);
}

// ================================================================ Kennzahlen-Leiste

function stripHTML() {
  const s = S.summary || {};
  const ps = S.printers.filter(inAreaP);
  const by = (cls) => ps.filter((p) => pView(p).cls === cls).length;
  const cell = (n, label, cls = '', led = '') => `<div class="${cls}">${led ? `<i class="led ${n ? led : 'off'}"></i>` : ''}<b class="num">${n}</b><span>${esc(label)}</span></div>`;
  return `${areaSwitchHTML()}<div class="strip">
    ${cell(by('run'), t('drucken'), '', 'run')}
    ${cell(by('free'), t('frei'), '', 'free')}
    ${cell(by('wait'), t('warten'), by('wait') ? 'warn' : '', 'wait')}
    ${cell(by('fault'), t('Störungen'), by('fault') ? 'bad' : '', 'fault')}
    ${on('queue') ? cell(curArea() ? S.queue.filter((q) => q.status === 'queued' && (q.printerId ? inAreaP(printerById(q.printerId)) : !q.areaId || q.areaId === curArea())).length : s.queued ?? 0, t('in Warteschlange')) : ''}
    ${on('orders') ? cell(s.ordersLate ?? 0, t('Aufträge überfällig'), s.ordersLate ? 'bad' : '') : ''}
    ${on('filament') ? cell(s.spoolsLow ?? 0, t('Spulen knapp'), s.spoolsLow ? 'warn' : '') : ''}
    ${on('maintenance') ? (() => {
      const n = curArea() ? (S.maint?.tasks || []).filter((x) => x.state === 'due' && inAreaP(printerById(x.printerId))).length : s.maintDue ?? 0;
      return cell(n, t('Wartungen fällig'), n ? 'warn' : '');
    })() : ''}
  </div>`;
}

// ================================================================ Druckerstatus

const STATE_LABEL = { offline: 'Nicht erreichbar', idle: 'Frei', preparing: 'Bereitet vor', printing: 'Druckt', paused: 'Pausiert', finished: 'Fertig', cancelled: 'Abgebrochen', error: 'Störung' };

/**
 * Ampel je Drucker: free (grün, leuchtet), run (blau, läuft), wait (gelb, blinkt),
 * fault (rot, blinkt), off (grau).
 */
function pView(p) {
  const s = p.status || { state: 'offline', nozzles: [] };
  const plateClear = S.summary?.plate?.[p.id];
  const ready = ['idle', 'finished', 'cancelled'].includes(s.state);
  const sending = S.queue.some((q) => q.printerId === p.id && q.status === 'sending');
  if (!s.online) return { cls: 'off', lamp: t('Offline'), mode: 'offline' };
  if (s.state === 'error') return { cls: 'fault', lamp: t('Störung'), mode: 'error' };
  if (s.state === 'paused') return { cls: 'wait', lamp: t('Pausiert'), mode: 'active' };
  if (s.state === 'printing' || s.state === 'preparing') return { cls: 'run', lamp: t(STATE_LABEL[s.state]), mode: 'active' };
  if (sending) return { cls: 'run', lamp: t('Überträgt'), mode: 'active' };
  if (ready && plateClear === false) return { cls: 'wait', lamp: t('Platte räumen'), mode: 'clear' };
  return { cls: 'free', lamp: t('Frei'), mode: 'free' };
}

function thumbHTML(file, cls = 'thumb') {
  if (file?.thumb) return `<img class="${cls}" src="api/files/${esc(file.id)}/thumb" alt="" loading="lazy">`;
  return `<span class="${cls} ph">${esc(file?.kind === 'model' ? 'STL' : file?.kind === '3mf' ? '3MF' : 'G')}</span>`;
}

// ---------------------------------------------------------------- Kamera
const camEls = new Map();

// Livebild: zuerst MJPEG-Stream. Kommt darüber nichts an (z. B. durch den Home-Assistant-Ingress,
// der Streams puffert), auf Einzelbilder umschalten – die gehen durch jeden Proxy.
function startStream(box, id) {
  const img = $('img', box);
  const note = $('.cam-note', box);
  stopStream(box);
  box._stopped = false;
  note.textContent = t('Verbinde mit Kamera …');
  box.classList.remove('live');
  img.src = `api/printers/${encodeURIComponent(id)}/camera.mjpg`;
  const t0 = Date.now();
  box._w = setInterval(() => {
    if (box._stopped) return clearInterval(box._w);
    if (img.naturalWidth > 0) {
      box.classList.add('live');
      return clearInterval(box._w);
    }
    if (Date.now() - t0 > 5000) {
      clearInterval(box._w);
      startPolling(box, id);
    }
  }, 300);
}
function startPolling(box, id) {
  const img = $('img', box);
  const note = $('.cam-note', box);
  img.removeAttribute('src'); // Stream beenden
  let fails = 0;
  let lastUrl = null;
  const next = async () => {
    if (box._stopped) return;
    const t1 = Date.now();
    try {
      const r = await fetch(`api/printers/${encodeURIComponent(id)}/camera.jpg?t=${t1}`, { cache: 'no-store' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      const url = URL.createObjectURL(await r.blob());
      if (box._stopped) return URL.revokeObjectURL(url);
      img.src = url;
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastUrl = url;
      box.classList.add('live');
      fails = 0;
    } catch (err) {
      fails += 1;
      if (fails >= 3) {
        box.classList.remove('live');
        note.textContent = t('Kein Kamerabild: {e}', { e: t(err.message === 'Failed to fetch' ? 'Server nicht erreichbar' : err.message) });
      }
    }
    // etwa ein Bild pro Sekunde; bei Fehlern langsamer
    box._p = setTimeout(next, Math.max(250, (fails ? 4000 : 1000) - (Date.now() - t1)));
  };
  next();
}
function stopStream(box) {
  box._stopped = true;
  clearInterval(box._w);
  clearTimeout(box._p);
  $('img', box).removeAttribute('src');
}
function attachCameras() {
  for (const [id, el] of camEls) {
    if (!S.cameraOpen.has(id) || S.view !== 'board') {
      stopStream(el);
      camEls.delete(id);
    }
  }
  $$('[data-cam-slot]').forEach((slot) => {
    const id = slot.closest('[data-id]').dataset.id;
    let el = camEls.get(id);
    if (!el) {
      el = document.createElement('button');
      el.type = 'button';
      el.className = 'cam';
      el.dataset.act = 'camBig';
      el.dataset.id = id;
      el.setAttribute('aria-label', t('Kamera groß anzeigen'));
      el.innerHTML = `<img alt="${esc(t('Kamerabild'))}"><div class="cam-note"></div>`;
      camEls.set(id, el);
      startStream(el, id);
    }
    slot.replaceWith(el);
  });
}
function cameraDialog(p) {
  const name = `${p.name.replace(/[^\wäöüÄÖÜß -]+/g, '')}_${todayISO()}_${hm(new Date()).replace(':', '-')}.jpg`;
  const d = openDialog(`<div class="dlg"><div class="bar-row" style="margin:0"><h2>${esc(p.name)}</h2>
      <a class="b b-sm" href="api/printers/${esc(p.id)}/camera.jpg" download="${esc(name)}">${t('Bild speichern')}</a><button class="b b-sm" data-close>${t('Schließen')}</button></div>
      <div class="cam" style="cursor:default;margin:0"><img alt="${esc(t('Kamerabild'))} ${esc(p.name)}"><div class="cam-note"></div></div></div>`, { cls: 'cam-dlg' });
  const box = $('.cam', d);
  startStream(box, p.id);
  d.addEventListener('close', () => stopStream(box));
}

// ================================================================ Warteschlange

const Q_STATUS = {
  queued: ['wartet', ''], sending: ['überträgt', 'run'], printing: ['druckt', 'run'], done: ['fertig', 'done'],
  failed: ['fehlgeschlagen', 'bad'], cancelled: ['abgebrochen', 'pause'], retried: ['neu eingereiht', 'done'],
};

function printerReady(p) {
  const s = p?.status;
  return s?.online && ['idle', 'finished', 'cancelled'].includes(s.state) && !S.queue.some((q) => q.printerId === p.id && ['sending', 'printing'].includes(q.status));
}

function materialsHTML(meta) {
  const m = meta?.materials || [];
  if (!m.length) return '';
  return m.slice(0, 6).map((x) => `<span title="${esc(x.type || '')}"><span class="swatch" style="background:${esc(x.color || 'transparent')}"></span>${esc(x.type || '')}</span>`).join(' ');
}

// Druckart: Seriendruck automatisch / manuell, Einzeldruck
const PMODES = ['auto', 'manual', 'single'];
const PMODE_LABEL = { auto: 'Seriendruck (automatisch)', manual: 'Seriendruck (manuell)', single: 'Einzeldruck' };
const PMODE_SHORT = { auto: 'Serie · auto', manual: 'Serie · manuell', single: 'Einzeldruck' };
const PMODE_HINT = {
  auto: 'Nach „Platte frei“ startet der nächste Druck von selbst.',
  manual: 'Alle Drucke stehen in der Warteschlange, jeder Start per Knopf.',
  single: 'Immer nur ein Druck, von Hand gestartet – danach kommt nichts nach.',
};
const pmodeOf = (m) => (PMODES.includes(m) ? m : S.app?.printMode || 'auto');

/** Auswahl im Dialog: drei Kacheln mit kurzer Erklärung */
function pmodePickHTML(name, value) {
  const v = pmodeOf(value);
  return `<fieldset class="pmode"><legend>${t('Druckart')}</legend><div class="pmode-opts">${PMODES.map((m) => `<label class="pmode-opt">
      <input type="radio" name="${name}" value="${m}" ${m === v ? 'checked' : ''}><span><b>${t(PMODE_LABEL[m])}</b><small>${t(PMODE_HINT[m])}</small></span></label>`).join('')}</div></fieldset>`;
}

/** Kleine Auswahl in Listenzeilen */
function pmodeSelectHTML(attrs, value) {
  const v = pmodeOf(value);
  return `<select class="in pmode-sel ${v}" ${attrs} aria-label="${t('Druckart')}" title="${esc(t(PMODE_HINT[v]))}">${PMODES.map((m) => `<option value="${m}" ${m === v ? 'selected' : ''}>${t(PMODE_SHORT[m])}</option>`).join('')}</select>`;
}

const pmodeTag = (m) => `<span class="pmode-tag ${pmodeOf(m)}" title="${esc(t(PMODE_HINT[pmodeOf(m)]))}">${t(PMODE_SHORT[pmodeOf(m)])}</span>`;

/** Statuszelle eines Eintrags: Zustand plus, bei wartenden, was als Nächstes passiert */
function qStatusHTML(q) {
  const [label, cls] = Q_STATUS[q.status] || [q.status, ''];
  if (q.status !== 'queued') return `<span class="pill ${cls}">${t(label)}</span>`;
  const m = pmodeOf(q.mode);
  if (q.error) return `<span class="pill bad">${t('Start fehlgeschlagen')}</span>`;
  if (q.afterDry) return `<span class="pill">${t('trocknet erst')}</span>`;
  if (m !== 'auto') return `<span class="pill pause">${t('Start von Hand')}</span>`;
  if (q.waitReason) return `<span class="pill">${t('wartet')}</span><div class="meta wait-reason" title="${esc(t('Warum der Eintrag noch nicht automatisch startet'))}">⏳ ${esc(t(q.waitReason))}</div>`;
  const p = printerById(q.printerId);
  const busy = p && (S.queue.some((x) => x.printerId === p.id && ['printing', 'sending'].includes(x.status)) || ['printing', 'preparing', 'paused'].includes(p.status?.state));
  if (busy) return `<span class="pill">${t('wartet')}</span><div class="meta">${t('bis {p} fertig ist', { p: esc(p.name) })}${S.summary?.external?.[p.id] ? ` · ${t('druckt gerade etwas von außerhalb')}` : ''}</div>`;
  if (p && S.summary?.plate?.[p.id] === false) return `<span class="pill">${t('wartet')}</span><div class="meta">${t('auf „Platte frei“ bei {p}', { p: esc(p.name) })}</div>`;
  return `<span class="pill run">${t('startet automatisch')}</span>`;
}

function vQueue() {
  const open = ['queued', 'sending', 'printing'];
  const list = S.queue.filter((q) => (S.qFilter === 'offen' ? open.includes(q.status) : S.qFilter === 'erledigt' ? !open.includes(q.status) : true));
  const openList = list.filter((q) => q.status === 'queued');
  const chips = [['offen', 'Offen'], ['erledigt', 'Erledigt'], ['alle', 'Alle']]
    .map(([k, l]) => `<button class="chip" data-act="qFilter" data-k="${k}" aria-pressed="${S.qFilter === k}">${t(l)}</button>`).join('');
  const anyReady = S.printers.some(printerReady);
  const rowHTML = (q) => {
    const p = printerById(q.printerId);
    const idx = openList.indexOf(q);
    const printerCell = q.status === 'queued'
      ? `<select class="in" data-act="qPrinter" data-id="${q.id}" aria-label="${t('Drucker')}">${targetOptionsHTML(q.printerId, q.areaId)}</select>`
      : `<b>${esc(p?.name || '–')}</b>`;
    const modeCell = q.status === 'queued' ? pmodeSelectHTML(`data-qmode="${q.id}"`, q.mode) : pmodeTag(q.mode);
    const acts = [];
    if (q.status === 'queued') {
      if (S.qFilter === 'offen') {
        acts.push(`<button class="x" data-act="qMove" data-id="${q.id}" data-dir="-1" title="${t('Nach oben')}" ${idx <= 0 ? 'disabled' : ''}>${ICON.up}</button>`);
        acts.push(`<button class="x" data-act="qMove" data-id="${q.id}" data-dir="1" title="${t('Nach unten')}" ${idx >= openList.length - 1 ? 'disabled' : ''}>${ICON.down}</button>`);
      }
      acts.push(`<button class="b b-sm b-go" data-act="qStart" data-id="${q.id}" ${q.file?.printable && anyReady ? '' : 'disabled'} title="${anyReady ? '' : esc(t('Kein Drucker ist frei'))}">${ICON.play}${t('Start')}</button>`);
    }
    if (q.status === 'failed' || q.status === 'cancelled') acts.push(`<button class="b b-sm" data-act="qRequeue" data-id="${q.id}">${t('Erneut einreihen')}</button>`);
    if (['printing', 'sending'].includes(q.status)) acts.push(q.stale
      ? `<button class="b b-sm b-done" data-qresolve="finished" data-id="${q.id}">${ICON.check}${t('War fertig')}</button><button class="b b-sm" data-qresolve="cancelled" data-id="${q.id}">${t('Abgebrochen')}</button>`
      : `<button class="x" data-qresolve="ask" data-id="${q.id}" title="${esc(t('Eintrag hängt? Druck ist am Drucker längst beendet'))}">${t('Hängt?')}</button>`);
    if (!['sending', 'printing'].includes(q.status)) acts.push(`<button class="x del" data-act="qDel" data-id="${q.id}" title="${t('Entfernen')}" aria-label="${t('Entfernen')}">${ICON.trash}</button>`);
    const warn = (q.modelMatch === false ? ` <span class="pill bad" title="${esc(t('Datei wurde für ein anderes Druckerprofil geslict – so startet sie nicht'))}">${t('anderes Profil')}</span>` : '')
      + (q.stale ? `<div class="meta res-warn">⚠ ${t('Der Drucker ist längst bereit – das Druckende wurde verpasst. Bitte sagen, wie der Druck ausging.')}</div>` : '')
      + (typeof reserveWarnHTML === 'function' ? reserveWarnHTML(q) : '')
      + (q.afterDry && q.status === 'queued' ? `<div class="meta hc-wait">💧 ${t('wird zuerst getrocknet ({n}) – startet danach automatisch', { n: esc(q.afterDry.name || '') })} <button class="x" data-qdry-cancel="${q.id}">${t('Nicht automatisch starten')}</button></div>` : '');
    return `<div class="row q-row ${['done', 'retried'].includes(q.status) ? 'dim' : ''} ${['printing', 'sending'].includes(q.status) ? 'q-live' : ''}">
      <div class="c-main filecell">${thumbHTML(q.file)}<div style="min-width:0"><b>${esc(q.part?.name || q.file?.name || t('Datei gelöscht'))}</b><span class="meta">${q.part ? `${t('Teil')} · ${q.printerId || q.status !== 'queued' ? esc(q.file?.name || '') : t('Variante je Drucker')} · ` : ''}${materialsHTML(q.file?.meta)}</span></div></div>
      <div><span class="lbl">${t('Auftrag')}</span>${q.order ? `<b>${esc(q.order.nr)}</b><div class="meta">${esc(q.order.title)}</div>` : '<span class="meta">–</span>'}</div>
      <div><span class="lbl">${t('Drucker')}</span>${printerCell}${warn}</div>
      <div><span class="lbl">${t('Druckart')}</span>${modeCell}</div>
      <div><span class="lbl">${t('Dauer')}</span><span class="num">${fmtDur(q.file?.meta?.estimatedSec)}</span></div>
      <div><span class="lbl">${t('Status')}</span>${qStatusHTML(q)}</div>
      <div class="acts">${acts.join('')}</div>
      ${q.error && q.status === 'queued' ? `<div class="err">${esc(t(q.error))} <button class="x" data-act="qRetry" data-id="${q.id}">${t('Nochmal versuchen')}</button></div>` : ''}
    </div>`;
  };
  // Gruppen: was gerade läuft, was als Nächstes kommt
  const live = list.filter((q) => ['printing', 'sending'].includes(q.status));
  const rest = list.filter((q) => !['printing', 'sending'].includes(q.status));
  const group = (title, n, extra = '') => `<div class="q-group"><b>${esc(title)}</b><span class="meta">${n}</span>${extra}</div>`;
  const head = `<div class="row q-row head"><div>${t('Teil / Datei')}</div><div>${t('Auftrag')}</div><div>${t('Drucker')}</div><div>${t('Druckart')}</div><div>${t('Dauer')}</div><div>${t('Status')}</div><div></div></div>`;
  let body;
  if (S.qFilter === 'offen' && list.length) {
    const nAuto = openList.filter((q) => pmodeOf(q.mode) === 'auto').length;
    const counts = [nAuto ? t('{n} automatisch', { n: nAuto }) : '', openList.length - nAuto ? t('{n} von Hand', { n: openList.length - nAuto }) : ''].filter(Boolean).join(' · ');
    body = head
      + (live.length ? group(t('Läuft gerade'), live.length) + live.map(rowHTML).join('') : '')
      + (rest.length ? group(t('Wartet'), counts) + rest.map(rowHTML).join('') : '');
  } else body = head + list.map(rowHTML).join('');
  return `${stripHTML()}<div class="bar-row"><h2>${t('Warteschlange')}</h2><div class="chips">${chips}</div>
      ${S.qFilter !== 'offen' ? `<button class="b b-sm" data-act="qClear">${t('Erledigte aufräumen')}</button>` : ''}
      <button class="b b-sm b-go" data-act="qAdd">${ICON.plus}${t('Einplanen')}</button></div>
    <div class="list">${list.length ? body
      : `<div class="empty"><h3>${S.qFilter === 'offen' ? t('Nichts in der Warteschlange') : t('Keine Einträge')}</h3><p>${t('Dateien aus der Bibliothek oder einem Auftrag einplanen – oder direkt aus dem Slicer senden.')}</p></div>`}</div>
    <p class="meta" style="margin-top:10px">${t('Die Druckart steht an jedem Eintrag: „Serie · auto“ startet von selbst, sobald ein passender Drucker frei und die Platte als geräumt bestätigt ist. „Serie · manuell“ und „Einzeldruck“ starten nur per Knopf. Einträge ohne festen Drucker bekommt der Drucker, zu dessen Profil die Datei geslict ist und in dem das passende Filament liegt.')}</p>`;
}

/** Auswahl „was drucken“: Teile (Variante je Drucker) und einzelne Dateien. Wert part:<id> oder file:<id> */
function itemOptionsHTML({ partId = null, fileId = null, printable = true } = {}) {
  const ps = (S.parts || []).filter((p) => p.variants.length && (!printable || p.printable));
  const fs = S.files.filter((f) => !printable || f.printable);
  const sel = partId ? `part:${partId}` : fileId ? `file:${fileId}` : ps[0] ? `part:${ps[0].id}` : fs[0] ? `file:${fs[0].id}` : '';
  const cov = (p) => p.cover.filter((c) => c.fileId).map((c) => c.name).join(', ');
  return `${ps.length ? `<optgroup label="${esc(t('Teile (passende Variante je Drucker)'))}">${ps.map((p) => `<option value="part:${p.id}" ${sel === `part:${p.id}` ? 'selected' : ''}>${esc(p.name)}${cov(p) ? ` – ${esc(cov(p))}` : ''}</option>`).join('')}</optgroup>` : ''}
    ${fs.length ? `<optgroup label="${esc(t('Einzelne Datei'))}">${fs.map((f) => `<option value="file:${f.id}" ${sel === `file:${f.id}` ? 'selected' : ''}>${esc(f.name)}${f.meta?.printerModel ? ` (${esc(f.meta.printerModel)})` : ''}${f.printable ? '' : ` (${t('nicht gesliced')})`}</option>`).join('')}</optgroup>` : ''}`;
}
/** part:<id>/file:<id> → { partId, fileId, file } (file = erste druckfertige Variante bzw. die Datei) */
function itemValue(v) {
  const [k, id] = String(v || '').split(':');
  if (k === 'part') {
    const p = (S.parts || []).find((x) => x.id === id);
    const fid = p?.variants.find((x) => x.printable)?.id || p?.variants[0]?.id || null;
    return { partId: id, fileId: fid, file: fileById(fid) };
  }
  return { partId: null, fileId: id, file: fileById(id) };
}

function queueAddDialog({ fileId = null, printerId = null, partId = null } = {}) {
  const printable = S.files.filter((f) => f.printable);
  if (!printable.length) {
    toast(t('Noch keine druckfertige Datei. Erst unter Dateien hochladen oder aus dem Slicer senden.'), true);
    return;
  }
  const d = openDialog(`<form class="dlg" method="dialog">
    <h2>${t('Einplanen')}</h2>
    <label>${t('Teil oder Datei')}<select name="fileId">${itemOptionsHTML({ partId, fileId })}</select></label>
    <div class="two">
      <label>${t('Drucker')}<select name="printerId">${targetOptionsHTML(printerId, null, 'Passender Drucker (nach Modell)')}</select></label>
      <label data-count>${t('Anzahl Drucke')}<input name="count" type="number" min="1" max="200" value="1"></label>
    </div>
    ${pmodePickHTML('mode', null)}
    <fieldset data-bambu hidden><legend>Bambu Lab</legend>
      <div class="two"><label>${t('Platte')}<select name="plate"></select></label>
      <label>${t('AMS-Zuordnung')}<input name="amsMapping" placeholder="${esc(t('automatisch, z. B. 0,1'))}"></label></div>
      <label class="check"><input type="checkbox" name="useAms" checked> ${t('AMS verwenden')}</label>
      <p class="hint" style="margin:0">${t('Druckstart bei Bambu ist noch experimentell. LAN- bzw. Entwicklermodus muss aktiv sein.')}</p>
    </fieldset>
    <label class="check"><input type="checkbox" name="top"> ${t('Ganz oben einreihen')}</label>
    <p class="form-error" hidden></p>
    <div class="dlg-actions"><button class="b" type="button" data-close>${t('Abbrechen')}</button><button class="b b-go">${t('Einplanen')}</button></div></form>`);
  const form = $('form', d);
  const sync = () => {
    const f = itemValue(form.fileId.value).file;
    $('[data-bambu]', d).hidden = f?.kind !== '3mf';
    form.plate.innerHTML = (f?.meta?.plates?.length ? f.meta.plates : [1]).map((n) => `<option>${n}</option>`).join('');
  };
  form.fileId.addEventListener('change', sync);
  sync();
  const syncMode = () => {
    $('[data-count]', d).hidden = form.mode.value === 'single';
  };
  $$('[name=mode]', d).forEach((r) => r.addEventListener('change', syncMode));
  syncMode();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const it = itemValue(form.fileId.value);
      const f = it.file;
      await api('queue', {
        method: 'POST',
        body: {
          fileId: it.fileId, partId: it.partId, ...targetValue(form.printerId.value), count: form.mode.value === 'single' ? 1 : form.count.value, top: form.top.checked, mode: form.mode.value,
          options: f?.kind === '3mf' ? { plate: form.plate.value, useAms: form.useAms.checked, amsMapping: form.amsMapping.value } : {},
        },
      });
      d.close();
      toast(t('Eingeplant'));
      reload('queue', 'summary');
    } catch (err) {
      formError(d, err.message);
    }
  });
}

/** Passt die geslicte Datei zum Profil des Druckers? true/false, null = unbekannt (wie lib/production.js) */
function profileFits(file, p) {
  const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const a = norm(file?.meta?.printerModel);
  const b = norm(p?.settings?.model || p?.status?.model);
  if (!a || !b) return null;
  return a.includes(b) || b.includes(a);
}

/**
 * Start-Dialog für einen Warteschlangen-Eintrag: Drucker wählen, Filament prüfen
 * und – Pflicht – bestätigen, dass die Druckplatte geräumt ist.
 */
async function startItem(itemId, printerId = null) {
  const q = S.queue.find((x) => x.id === itemId);
  if (!q) return;
  const ready = S.printers.filter(printerReady);
  if (!ready.length) return toast(t('Kein Drucker ist frei'), true);
  const fits = (p) => profileFits(q.file, p);
  const pre = ready.find((p) => p.id === (printerId || q.printerId) && fits(p) !== false) || ready.find((p) => fits(p) === true) || ready.find((p) => fits(p) !== false) || ready[0];
  const mustConfirm = S.app?.plateCheck !== false;
  const d = openDialog(`<form class="dlg" method="dialog">
    <h2>${t('Druck starten')}</h2>
    <div class="cur-top">${thumbHTML(q.file)}<div style="min-width:0"><b>${esc(q.file?.name)}</b><div class="meta">${q.order ? `${esc(q.order.nr)} · ${esc(q.order.title)} · ` : ''}${fmtDur(q.file?.meta?.estimatedSec)}</div></div></div>
    <label>${t('Drucker')}<select name="printerId">${ready.map((p) => `<option value="${p.id}" ${p.id === pre.id ? 'selected' : ''} ${fits(p) === false ? 'disabled' : ''}>${esc(p.name)}${p.settings?.model ? ` · ${esc(p.settings.model)}` : ''}${fits(p) === false ? ` – ${esc(t('anderes Profil'))}` : ''}</option>`).join('')}</select></label>
    ${q.file?.meta?.printerModel ? `<p class="meta" style="margin:-4px 0 0">${t('Geslict für {m}', { m: esc(q.file.meta.printerModel) })}</p>` : ''}
    <div data-fcheck></div>
    <div data-hcheck></div>
    ${mustConfirm ? `<label class="check plate-check"><input type="checkbox" name="plate" required> <span>${ICON.plate}<b>${t('Druckplatte ist geräumt')}</b><br><span class="meta">${t('Altes Teil entnommen, Platte sauber und richtig eingelegt.')}</span></span></label>` : ''}
    <p class="form-error" hidden></p>
    <div class="dlg-actions"><button class="b" type="button" data-close>${t('Abbrechen')}</button><button class="b b-go" data-ok ${mustConfirm ? 'disabled' : ''}>${ICON.play}${t('Jetzt starten')}</button></div></form>`);
  const form = $('form', d);
  const okBtn = $('[data-ok]', d);
  let fmap = null;
  let hc = null;
  const okState = () => (okBtn.disabled = (mustConfirm && !form.plate.checked) || Boolean(hc && !hc.ok && !form.humAnyway?.checked));
  // Feuchte-Check: zu feuchtes Filament → trotzdem / erst trocknen / anderer Drucker
  const loadHum = async () => {
    const box = $('[data-hcheck]', d);
    hc = null;
    if (typeof humCheckBoxHTML !== 'function' || !on('filament')) return;
    try {
      const sm = fmap?.mappable && fmap.filaments.length ? `&slotMap=${encodeURIComponent(fmap.suggested.join(','))}` : '';
      hc = await api(`queue/${itemId}/humcheck?printerId=${encodeURIComponent(form.printerId.value)}${sm}`);
      box.innerHTML = humCheckBoxHTML(hc, { otherPrinters: ready.length - 1 });
    } catch {
      box.innerHTML = '';
    }
    okState();
  };
  $('[data-hcheck]', d).addEventListener('change', okState);
  $('[data-hcheck]', d).addEventListener('click', async (e) => {
    if (!e.target.closest('[data-hc-dry]') || !hc?.dryer) return;
    if (mustConfirm && !form.plate.checked) return formError(d, t('Bitte bestätigen, dass die Druckplatte geräumt ist'));
    const pid = form.printerId.value;
    try {
      await api(`queue/${itemId}/dry-start`, { method: 'POST', body: { printerId: pid, key: hc.dryer.key, plateConfirmed: mustConfirm ? form.plate.checked : true, slotMap: fmap?.mappable && fmap.filaments.length ? fmap.suggested : undefined } });
      d.close();
      toast(t('Trocknen gestartet – der Druck startet danach automatisch auf {p}', { p: printerById(pid)?.name }));
      reload('queue', 'filament', 'summary');
    } catch (err) {
      formError(d, err.message);
    }
  });
  const loadCheck = async () => {
    const box = $('[data-fcheck]', d);
    box.innerHTML = '';
    fmap = null;
    if (typeof filamentMapHTML !== 'function') return;
    try {
      // Welches Filament aus dem Slice kommt aus welchem Platz? Vorschlag nach Farbe und Material
      fmap = await api(`filament/mapping?printerId=${encodeURIComponent(form.printerId.value)}&queueId=${encodeURIComponent(itemId)}`);
      box.innerHTML = filamentMapHTML(fmap) + (typeof reserveStartHTML === 'function' ? reserveStartHTML(fmap) : '');
    } catch { /* ohne Zuordnung */ }
    loadHum();
  };
  $('[data-fcheck]', d).addEventListener('change', (e) => {
    const sel = e.target.closest('[data-fm]');
    if (sel && fmap) {
      filamentMapUpdate($('[data-fcheck]', d), fmap, sel);
      loadHum();
    }
  });
  form.printerId.addEventListener('change', loadCheck);
  form.plate?.addEventListener('change', okState);
  loadCheck();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pid = form.printerId.value;
    const p = printerById(pid);
    okBtn.disabled = true;
    try {
      toast(t('Wird an {p} übertragen …', { p: p?.name }));
      await api(`queue/${itemId}/start`, { method: 'POST', body: { printerId: pid, plateConfirmed: mustConfirm ? form.plate.checked : true, slotMap: fmap?.mappable && fmap.filaments.length ? fmap.suggested : undefined } });
      d.close();
      toast(t('Druck auf {p} gestartet', { p: p?.name }));
      reload('queue', 'summary', 'orders');
    } catch (err) {
      okState();
      formError(d, err.message);
    }
  });
}

// ================================================================ Aufträge

const PRIO = { 1: ['eilig', 'bad'], 2: ['normal', ''], 3: ['niedrig', 'done'] };
const O_STATUS = { offen: '', geplant: 'pause', 'läuft': 'run', nachbearbeitung: 'pause', fertig: 'done', abgeschlossen: 'done' };

function vOrders() {
  const list = S.orders.filter((o) => (S.oFilter === 'archiv' ? o.archived : o.archived ? false : S.oFilter === 'aktiv' ? !o.closed && o.status !== 'fertig' : S.oFilter === 'fertig' ? o.closed || o.status === 'fertig' : true));
  const chips = [['aktiv', 'Aktiv'], ['fertig', 'Fertig'], ['archiv', 'Archiv'], ['alle', 'Alle']]
    .map(([k, l]) => `<button class="chip" data-act="oFilter" data-k="${k}" aria-pressed="${S.oFilter === k}">${t(l)}</button>`).join('');
  const today = todayISO();
  const anyReady = S.printers.some(printerReady);
  const rows = list.map((o) => {
    const pct = o.qty ? Math.round((o.done / o.qty) * 100) : 0;
    const days = o.due ? Math.round((Date.parse(o.due) - Date.parse(today)) / 864e5) : null;
    const dueCls = o.late ? 'bad' : days != null && days <= 1 && o.status !== 'fertig' ? 'warn' : '';
    const canPlan = !o.closed && o.positions.some((p) => p.open > 0);
    const waiting = S.queue.filter((q) => q.orderId === o.id && q.status === 'queued');
    const canPrint = !o.closed && (waiting.length || canPlan);
    const [prioL, prioC] = PRIO[o.prio] || PRIO[2];
    const posN = o.positions.length;
    return `<div class="row o-row ${o.closed ? 'dim' : ''}">
      <div><span class="lbl">${t('Nr')}</span><b class="vl" style="white-space:nowrap">${esc(o.nr)}</b></div>
      <div class="c-main"><b>${esc(o.title)}</b>${o.closed ? '' : `<div class="o-mode">${pmodeSelectHTML(`data-omode="${o.id}"`, o.mode)}</div>`}<div class="meta">${o.areaId && areaName(o.areaId) ? `${esc(areaName(o.areaId))} · ` : ''}${esc(o.customer || '')}${o.customer ? ' · ' : ''}${posN === 1 ? t('1 Position') : t('{n} Positionen', { n: posN })}${o.costs?.estimate?.total ? ` · ${costPill(o.costs.estimate)}` : ''}${o.costs?.actual?.entries?.some((x) => x.photo) ? ' · 📷' : ''}</div></div>
      <div><span class="lbl">${t('Termin')}</span><span class="vl ${dueCls}">${dfmt(o.due)}</span>${o.late ? `<div class="meta" style="color:var(--fault)">${t('überfällig')}</div>` : ''}</div>
      <div><span class="lbl">${t('Prio')}</span><span class="pill ${prioC}">${t(prioL)}</span></div>
      <div><span class="lbl">${t('Fortschritt')}</span><div class="sub" style="margin:0 0 3px"><span class="num">${t('{a} von {b}', { a: `<b>${o.done}</b>`, b: o.qty })}</span><span>${pct} %</span></div><div class="bar"><i style="width:${pct}%"></i></div></div>
      <div><span class="lbl">${t('Status')}</span><span class="pill ${O_STATUS[o.status] || ''}">${esc(t(o.status))}</span></div>
      <div><span class="lbl">${t('Restzeit')}</span><span class="num">${o.restSec ? fmtDur(o.restSec) : '–'}</span></div>
      <div class="acts">${canPrint && on('queue') ? `<button class="b b-sm b-go" data-act="oPrint" data-id="${o.id}" ${anyReady ? '' : 'disabled'} title="${anyReady ? esc(t('Nächsten Druck dieses Auftrags starten')) : esc(t('Kein Drucker ist frei'))}">${ICON.play}${t('Drucken')}</button>` : ''}${canPlan && on('queue') ? `<button class="b b-sm" data-act="oPlan" data-id="${o.id}">${t('Einplanen')}</button>` : ''}<button class="b b-sm" data-act="oEdit" data-id="${o.id}">${ICON.edit}${t('Öffnen')}</button>${o.archived ? `<button class="b b-sm" data-oarch="0" data-id="${o.id}">${t('Zurückholen')}</button>` : o.closed || o.status === 'fertig' ? `<button class="x" data-oarch="1" data-id="${o.id}" title="${esc(t('Archivieren'))}" aria-label="${esc(t('Archivieren'))}">🗄</button>` : ''}</div>
    </div>`;
  }).join('');
  return `${stripHTML()}<div class="bar-row"><h2>${t('Aufträge')}</h2><div class="chips">${chips}</div><button class="b b-sm b-go" data-act="oEdit">${ICON.plus}${t('Neuer Auftrag')}</button></div>
    <div class="list">${list.length ? `<div class="row o-row head"><div>${t('Nr')}</div><div>${t('Bezeichnung')}</div><div>${t('Termin')}</div><div>${t('Prio')}</div><div>${t('Fortschritt')}</div><div>${t('Status')}</div><div>${t('Restzeit')}</div><div></div></div>${rows}`
      : `<div class="empty"><h3>${S.oFilter === 'aktiv' ? t('Keine offenen Aufträge') : S.oFilter === 'archiv' ? t('Archiv ist leer') : t('Keine Aufträge')}</h3><p>${t('Ein Auftrag fasst Dateien und Stückzahlen zusammen – z. B. „20 Halter für die Werkstatt bis Freitag“.')}</p><button class="b b-go" data-act="oEdit">${ICON.plus}${t('Neuer Auftrag')}</button></div>`}</div>`;
}

/** „Drucken“ beim Auftrag: offene Stücke einplanen und den ersten Druck starten. */
async function printOrder(id) {
  let waiting = S.queue.filter((q) => q.orderId === id && q.status === 'queued');
  if (!waiting.length) {
    const r = await run(() => api(`orders/${id}/plan`, { method: 'POST', body: {} }));
    if (!r) return;
    await loaders.queue();
    waiting = S.queue.filter((q) => q.orderId === id && q.status === 'queued');
  }
  if (!waiting.length) return toast(t('Für diesen Auftrag ist nichts mehr offen'), true);
  return startItem(waiting[0].id);
}

function orderDialog(o = null) {
  if (!S.files.length) {
    toast(t('Erst Dateien hochladen, dann einen Auftrag anlegen.'), true);
    return;
  }
  const fileOpts = (sel, part) => itemOptionsHTML({ partId: part || null, fileId: part ? null : sel, printable: false });
  const posRow = (p = {}) => `<div class="pos" data-pos="${esc(p.id || '')}">
      <select class="in" name="pf" aria-label="${t('Teil oder Datei')}">${fileOpts(p.fileId, p.partId)}</select>
      <input class="in" name="pq" type="number" min="1" max="9999" value="${p.qty || 1}" aria-label="${t('Stückzahl')}" title="${esc(t('Stückzahl'))}">
      <span class="pp"><input class="in" name="ppl" type="number" min="1" max="500" value="${p.perPlate || 1}" aria-label="${t('Stück je Druck')}" title="${esc(t('Stück je Druck (Teile auf einer Platte)'))}"><span class="meta">${t('je Druck')}</span></span>
      <button class="x del" type="button" data-rm title="${t('Position entfernen')}" aria-label="${t('Position entfernen')}">${ICON.trash}</button>
      ${p.id ? `<div class="posinfo">${p.perPlate > 1 ? `${t('{n} Drucke à {k} Stück', { n: p.prints, k: p.perPlate })} · ` : ''}${t('{d} fertig · {p} eingeplant', { d: p.done, p: p.planned })}${p.running ? ` (${t('läuft')})` : ''} · ${t('{n} offen', { n: p.open })}${p.failed ? ` · ${t('{n} fehlgeschlagen', { n: p.failed })}` : ''}</div>` : ''}
    </div>`;
  const d = openDialog(`<form class="dlg" method="dialog">
    <h2>${o ? t('Auftrag {nr}', { nr: esc(o.nr) }) : t('Neuer Auftrag')}</h2>
    <label>${t('Bezeichnung')}<input name="title" required value="${esc(o?.title || '')}" placeholder="${esc(t('z. B. Halter für Werkstatt'))}"></label>
    <div class="two">
      <label>${t('Kunde / Zweck')}<input name="customer" value="${esc(o?.customer || '')}" placeholder="${t('optional')}"></label>
      <div class="two"><label>${t('Termin')}<input name="due" type="date" value="${esc(o?.due || '')}"></label>
      <label>${t('Priorität')}<select name="prio">${[1, 2, 3].map((n) => `<option value="${n}" ${(o?.prio || 2) === n ? 'selected' : ''}>${t(PRIO[n][0])}</option>`).join('')}</select></label></div>
    </div>
    ${pmodePickHTML('mode', o?.mode)}
    ${areas().length ? `<label>${t('Bereich')}<select name="areaId"><option value="">${t('Alle Drucker')}</option>${areas().map((a) => `<option value="${esc(a.id)}" ${o?.areaId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
    <p class="hint" style="margin-top:-4px">${t('Drucke dieses Auftrags ohne festen Drucker gehen nur an passende Drucker in diesem Bereich.')}</p>` : ''}
    <fieldset><legend>${t('Positionen: Datei und Stückzahl')}</legend>
      <div data-positions>${(o?.positions?.length ? o.positions : [{}]).map(posRow).join('')}</div>
      <button class="b b-sm" type="button" data-addpos style="align-self:flex-start">${ICON.plus}${t('Position')}</button>
      <p class="hint" style="margin:0">${t('„je Druck“: wie viele Teile auf einer Platte liegen (Platte als eine Datei slicen). Bei 20 Stück und 4 je Druck plant PrintDock 5 Drucke.')}</p>
    </fieldset>
    ${o && typeof orderPostHTML === 'function' ? orderPostHTML(o) : ''}
    ${o ? orderCostsHTML(o) : ''}
    ${o ? orderShareHTML(o) : ''}
    <label>${t('Notizen')}<textarea name="notes" rows="3">${esc(o?.notes || '')}</textarea></label>
    ${o ? `<label class="check"><input type="checkbox" name="closed" ${o.closed ? 'checked' : ''}> ${t('Auftrag abgeschlossen (wartende Drucke werden entfernt)')}</label>` : ''}
    <p class="form-error" hidden></p>
    <div class="dlg-actions">
      ${o ? `<button class="b b-fault left" type="button" data-del>${t('Löschen')}</button>` : ''}
      <button class="b" type="button" data-close>${t('Abbrechen')}</button>
      <button class="b b-done" value="save">${t('Speichern')}</button>
      ${on('queue') ? `<button class="b b-go" value="plan" data-plan>${t('Speichern und einplanen')}</button>` : ''}
    </div></form>`, { wide: true });
  const form = $('form', d);
  $('[data-addpos]', d).addEventListener('click', () => $('[data-positions]', d).insertAdjacentHTML('beforeend', posRow()));
  $('[data-positions]', d).addEventListener('click', (e) => {
    if (e.target.closest('[data-rm]') && $$('.pos', d).length > 1) e.target.closest('.pos').remove();
  });
  $('[data-del]', d)?.addEventListener('click', async () => {
    if (!(await confirmBox(t('Auftrag löschen'), t('Auftrag {nr} löschen? Wartende Drucke werden entfernt, der Verlauf bleibt.', { nr: o.nr }), t('Löschen'), 'b-fault'))) return;
    await run(() => api(`orders/${o.id}`, { method: 'DELETE' }), t('Auftrag gelöscht'));
    d.close();
    reload('orders', 'queue', 'summary');
  });
  let mode = 'save';
  $$('button[value]', d).forEach((b) => b.addEventListener('click', () => (mode = b.value)));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      title: form.title.value, customer: form.customer.value, due: form.due.value, prio: Number(form.prio.value), notes: form.notes.value, mode: form.mode.value, ...(form.areaId ? { areaId: form.areaId.value || null } : {}),
      closed: form.closed?.checked || false,
      positions: $$('.pos', d).map((el) => ({ id: el.dataset.pos || null, ...(({ fileId, partId }) => ({ fileId, partId }))(itemValue($('[name=pf]', el).value)), qty: Number($('[name=pq]', el).value), perPlate: Number($('[name=ppl]', el).value) || 1 })),
    };
    try {
      const saved = await api(o ? `orders/${o.id}` : 'orders', { method: o ? 'PUT' : 'POST', body });
      if (mode === 'plan' && !saved.closed) {
        const r = await api(`orders/${saved.id}/plan`, { method: 'POST', body: {} }).catch((err) => ({ error: err.message }));
        toast(r.error ? `${t('Gespeichert.')} ${r.error}` : t('Gespeichert, {n} Druck(e) eingeplant', { n: r.planned }), Boolean(r.error && !/bereits|already/.test(r.error)));
      } else toast(t('Auftrag gespeichert'));
      d.close();
      reload('orders', 'queue', 'summary');
    } catch (err) {
      formError(d, err.message);
    }
  });
}

// ================================================================ Dateien

function vFiles() {
  const list = S.files.filter((f) => (S.fFilter === 'druck' ? f.printable : S.fFilter === 'modell' ? !f.printable : true));
  const chips = [['alle', 'Alle'], ['druck', 'Druckfertig'], ['modell', 'Modelle']]
    .map(([k, l]) => `<button class="chip" data-act="fFilter" data-k="${k}" aria-pressed="${S.fFilter === k}">${t(l)}</button>`).join('');
  const cards = list.map((f) => {
    const m = f.meta || {};
    const facts = [
      m.estimatedSec ? `<span>${t('Druckzeit')} <b>${fmtDur(m.estimatedSec)}</b></span>` : '',
      m.filamentG ? `<span>${t('Filament')} <b>${fnum(m.filamentG, 0)} g</b></span>` : m.filamentM ? `<span>${t('Filament')} <b>${fnum(m.filamentM, 1)} m</b></span>` : '',
      m.printerModel ? `<span>${t('für')} <b>${esc(m.printerModel)}</b></span>` : '',
      m.layerHeight ? `<span>${t('Schicht')} <b>${fnum(m.layerHeight, 2)} mm</b></span>` : '',
      m.slicer ? `<span>${esc(m.slicer)}</span>` : '',
      `<span>${fmtSize(f.size)}${f.source === 'slicer' ? ` · ${t('vom Slicer')}` : f.source === 'printer' ? ` · ${t('vom Drucker übernommen')}` : ''}</span>`,
    ].join('');
    return `<article class="card fcard">
      <div class="pic">${f.thumb ? `<img src="api/files/${esc(f.id)}/thumb" alt="" loading="lazy">` : `<span>${esc(f.ext.toUpperCase())}</span>`}</div>
      <div class="fb"><h3>${esc(f.name)}</h3>
        <div>${f.printable ? `<span class="pill run">${t('druckfertig')}</span>` : `<span class="pill">${t('Modell – erst slicen')}</span>`}${f.partId && typeof partById === 'function' && partById(f.partId) ? ` <button class="pill" data-view="parts" title="${esc(t('Teil'))}">${t('Teil')}: ${esc(partById(f.partId).name)}</button>` : ''} <span class="meta">${materialsHTML(m)}</span></div>
        <div class="facts">${facts}</div>
        <div class="btns">
          ${f.printable && on('queue') ? `<button class="b b-sm b-go" data-act="qAdd" data-file="${f.id}">${ICON.plus}${t('Einplanen')}</button>` : ''}
          <span class="menu"><button class="b b-sm" data-act="slicerMenu" data-id="${f.id}" aria-haspopup="true">${ICON.open}${t('Öffnen in …')}</button></span>
          <button class="x del" data-act="fDel" data-id="${f.id}" title="${t('Löschen')}" aria-label="${esc(t('{f} löschen', { f: f.name }))}">${ICON.trash}</button>
        </div></div></article>`;
  }).join('');
  return `<div class="bar-row"><h2>${t('Dateien')}</h2><div class="chips">${chips}</div>
      <label class="b b-sm b-go" style="cursor:pointer">${ICON.upload}${t('Hochladen')}<input type="file" multiple hidden data-upload accept=".gcode,.3mf,.stl,.step,.stp,.obj"></label></div>
    <div class="drop" data-drop>${t('Dateien hierher ziehen: G-code, 3MF (gesliced oder Modell), STL, STEP, OBJ. Druckzeit, Filament und Vorschaubild werden automatisch erkannt.')}</div>
    ${list.length ? `<div class="cards">${cards}</div>` : `<div class="list"><div class="empty"><h3>${t('Keine Dateien')}</h3><p>${t('Hochladen oder im Slicer „An Drucker senden“ nutzen (Einstellungen → Slicer).')}</p></div></div>`}`;
}

function uploadFiles(fileList, { partId = null } = {}) {
  const filesArr = [...fileList];
  if (!filesArr.length) return;
  const drop = $('[data-drop]');
  const done = [];
  let i = 0;
  const next = () => {
    if (i >= filesArr.length) {
      if (drop) drop.textContent = t('{n} Datei(en) hochgeladen.', { n: filesArr.length });
      // gleich fragen: welches Teil, welche Drucker, einplanen?
      if (done.length && typeof uploadAssignDialog === 'function') uploadAssignDialog(done, partId);
      else reload('files');
      return;
    }
    const f = filesArr[i++];
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'api/files');
    xhr.setRequestHeader('X-Filename', encodeURIComponent(f.name));
    xhr.upload.onprogress = (e) => {
      if (drop && e.lengthComputable) drop.textContent = t('Lade {f} hoch … {p} %', { f: f.name, p: Math.round((e.loaded / e.total) * 100) });
    };
    xhr.onload = () => {
      if (xhr.status >= 300) {
        let msg = 'Upload fehlgeschlagen';
        try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
        toast(`${f.name}: ${t(msg)}`, true);
      } else {
        try { done.push(JSON.parse(xhr.responseText)); } catch {}
      }
      next();
    };
    xhr.onerror = () => {
      toast(`${f.name}: ${t('Verbindung abgebrochen')}`, true);
      next();
    };
    xhr.send(f);
  };
  next();
}

function bindFileView() {
  const drop = $('[data-drop]');
  if (!drop) return;
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => uploadFiles(e.dataTransfer.files));
  $('[data-upload]').addEventListener('change', (e) => uploadFiles(e.target.files));
}

async function slicerMenu(btn, fileId) {
  $$('.menu-list').forEach((m) => m.remove());
  const f = fileById(fileId);
  let key = '';
  if (S.app?.auth?.enabled) {
    const r = await api('app/key').catch(() => null);
    if (r) key = `?k=${r.apiKey}`;
  }
  const dl = `${S.app?.directUrl || S.ha?.directUrl || location.origin}/api/files/${encodeURIComponent(f.id)}/dl/${encodeURIComponent(f.name)}${key}`;
  const items = on('slicer') ? (S.settings?.slicers || []).map((s) => `<a href="${esc(s.url.replace('{url}', encodeURIComponent(dl)))}">${esc(s.name)}</a>`).join('') : '';
  btn.parentElement.insertAdjacentHTML('beforeend', `<div class="menu-list" role="menu">${items}<a href="${esc(dl)}" download>${t('Herunterladen')}</a></div>`);
  setTimeout(() => document.addEventListener('click', () => $$('.menu-list').forEach((m) => m.remove()), { once: true }), 0);
}

// ================================================================ Wartung

function vMaint() {
  const m = S.maint;
  if (!m) return `<div class="empty">${t('Lade …')}</div>`;
  const cards = S.printers.map((p) => {
    const st = m.stats[p.id] || {};
    const tasks = m.tasks.filter((x) => x.printerId === p.id);
    const rows = tasks.map((x) => {
      const pct = Math.min(100, Math.round(x.ratio * 100));
      const cls = x.state === 'due' ? 'bad' : x.state === 'soon' ? 'warn' : '';
      const unitShort = { h: 'h', prints: t('Drucke'), days: t('Tage') }[x.unit];
      const rest = `${fnum(x.remaining, x.unit === 'h' ? 1 : 0)} ${unitShort}`;
      const stateTxt = x.state === 'due' ? `<span class="vl bad">${t('fällig')}</span>` : x.state === 'soon' ? `<span class="vl warn">${t('bald: noch {r}', { r: rest })}</span>` : `<span class="meta">${t('noch {r}', { r: rest })}</span>`;
      return `<div class="task"><div class="t"><b>${esc(t(x.title))}</b><span class="meta">${t('alle {n} {u}', { n: fnum(x.every, x.every % 1 ? 1 : 0), u: esc(t(x.unitLabel)) })}${x.note ? ` · ${esc(t(x.note))}` : ''}</span></div>
        <div><div class="bar ${cls}"><i style="width:${pct}%"></i></div><div class="sub" style="margin-top:3px">${stateTxt}</div></div>
        <div class="acts" style="display:flex;gap:6px;justify-content:flex-end"><button class="b b-sm ${x.state === 'due' ? 'b-done' : ''}" data-act="mDone" data-id="${x.id}">${ICON.check}${t('Erledigt')}</button><button class="x" data-act="mEdit" data-id="${x.id}" title="${t('Bearbeiten')}" aria-label="${t('Bearbeiten')}">${ICON.edit}</button></div></div>`;
    }).join('');
    return `<article class="card mcard"><div class="mhead"><h3>${esc(p.name)}</h3>
        <span>${t('Betrieb')} <b class="num">${fnum(st.hours, 1)} h</b></span><span>${t('Drucke')} <b class="num">${st.prints ?? 0}</b></span><span>${t('Erfolgsquote')} <b class="num">${st.successRate != null ? `${st.successRate} %` : '–'}</b></span></div>
      ${rows || `<div class="empty" style="padding:20px"><p style="margin:0 0 4px">${t('Noch keine Wartungsaufgaben.')}</p><button class="b b-sm b-go" data-act="mTemplates" data-id="${p.id}">${t('Vorschläge übernehmen')}</button><p class="meta" style="margin-top:8px">${t('Allgemeine Richtwerte – bitte mit der Anleitung deines Druckers abgleichen und anpassen.')}</p></div>`}
    </article>`;
  }).join('');
  const log = m.log.slice(0, 12).map((l) => `<div class="row h-row" style="grid-template-columns:130px minmax(120px,1fr) minmax(200px,2fr) 100px"><div class="num">${tfmt(l.at)}</div><div>${esc(l.printerName || '')}</div><div><b>${esc(t(l.title))}</b>${l.note ? `<div class="meta">${esc(l.note)}</div>` : ''}</div><div class="num meta">${fnum(l.hours, 1)} h</div></div>`).join('');
  return `${stripHTML()}<div class="bar-row"><h2>${t('Wartungsplan')}</h2><button class="b b-sm b-go" data-act="mEdit">${ICON.plus}${t('Aufgabe hinzufügen')}</button></div>
    ${S.printers.length ? `<div style="display:grid;gap:14px">${cards}</div>` : `<div class="list"><div class="empty">${t('Erst einen Drucker anlegen.')}</div></div>`}
    <div class="sec" style="margin-top:22px"><h3>${t('Zuletzt erledigt')}</h3><div class="list">${log || `<div class="empty" style="padding:18px">${t('Noch nichts erledigt.')}</div>`}</div></div>
    <p class="meta">${t('Betriebsstunden und Drucke werden aus dem Verlauf gezählt. Stunden vor PrintDock lassen sich beim Drucker unter „Betriebsstunden bisher“ eintragen.')}</p>`;
}

function taskDialog(x = null, pre = {}) {
  const m = S.maint;
  const d = openDialog(`<form class="dlg" method="dialog"><h2>${x ? t('Wartungsaufgabe bearbeiten') : t('Wartungsaufgabe')}</h2>
    <label>${t('Drucker')}<select name="printerId" ${x ? 'disabled' : ''}>${S.printers.map((p) => `<option value="${p.id}" ${p.id === (x?.printerId || pre.printerId) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
    <label>${t('Bezeichnung')}<input name="title" required value="${esc(x ? t(x.title) : pre.title || '')}" list="mtpl" placeholder="${esc(t('z. B. Düse reinigen'))}"></label>
    <datalist id="mtpl">${m.templates.map((y) => `<option value="${esc(t(y.title))}">`).join('')}</datalist>
    <div class="two"><label>${t('Alle')}<input name="every" type="number" min="1" step="any" required value="${esc(x?.every ?? '')}"></label>
      <label>${t('Einheit')}<select name="unit">${Object.entries(m.units).map(([k, l]) => `<option value="${k}" ${k === (x?.unit || 'h') ? 'selected' : ''}>${esc(t(l))}</option>`).join('')}</select></label></div>
    <label>${t('Hinweis')}<input name="note" value="${esc(x?.note ? t(x.note) : pre.note || '')}" placeholder="${esc(t('optional, z. B. welches Fett'))}"></label>
    <p class="form-error" hidden></p>
    <div class="dlg-actions">${x ? `<button class="b b-fault left" type="button" data-del>${t('Löschen')}</button>` : ''}<button class="b" type="button" data-close>${t('Abbrechen')}</button><button class="b b-done">${t('Speichern')}</button></div></form>`);
  const form = $('form', d);
  form.title.addEventListener('change', () => {
    const tpl = m.templates.find((y) => t(y.title) === form.title.value);
    if (tpl && !form.every.value) {
      form.every.value = tpl.every;
      form.unit.value = tpl.unit;
      form.note.value = t(tpl.note);
    }
  });
  $('[data-del]', d)?.addEventListener('click', async () => {
    await run(() => api(`maintenance/tasks/${x.id}`, { method: 'DELETE' }), t('Aufgabe gelöscht'));
    d.close();
    reload('maint', 'summary');
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const body = { printerId: form.printerId.value, title: form.title.value, every: form.every.value, unit: form.unit.value, note: form.note.value };
      await api(x ? `maintenance/tasks/${x.id}` : 'maintenance/tasks', { method: x ? 'PUT' : 'POST', body });
      d.close();
      toast(t('Gespeichert'));
      reload('maint', 'summary');
    } catch (err) {
      formError(d, err.message);
    }
  });
}

function taskDoneDialog(x) {
  const d = openDialog(`<form class="dlg" method="dialog"><h2>${esc(t(x.title))}</h2>
    <p style="margin:0">${t('Als erledigt eintragen. Der Zähler beginnt neu.')}</p>
    <label>${t('Notiz')}<input name="note" placeholder="${esc(t('optional, z. B. Düse 0,4 getauscht'))}"></label>
    <div class="dlg-actions"><button class="b" type="button" data-close>${t('Abbrechen')}</button><button class="b b-done">${ICON.check}${t('Erledigt')}</button></div></form>`);
  $('form', d).addEventListener('submit', async (e) => {
    e.preventDefault();
    await run(() => api(`maintenance/tasks/${x.id}/done`, { method: 'POST', body: { note: $('form', d).note.value } }), t('Eingetragen'));
    d.close();
    reload('maint', 'summary');
  });
}

// ================================================================ Verlauf

function vHistory() {
  const RES = { finished: ['erfolgreich', 'run'], cancelled: ['abgebrochen', 'pause'], error: ['fehlgeschlagen', 'bad'] };
  const label = (h) => (h.markedFailed ? ['Fehldruck', 'bad'] : RES[h.result] || [h.result, '']);
  const orderNr = (id) => S.orders.find((o) => o.id === id)?.nr;
  const rows = S.history.map((h) => {
    const [l, c] = label(h);
    return `<div class="row h-row">
      <div class="num"><span class="lbl">${t('Ende')}</span>${tfmt(h.endedAt)}</div>
      <div><span class="lbl">${t('Drucker')}</span>${esc(h.printerName)}</div>
      <div class="c-main h-file">${h.photo ? `<a class="h-photo" href="api/history/${esc(h.id)}/photo" target="_blank" rel="noopener" title="${esc(t('Foto des fertigen Teils'))}"><img src="api/history/${esc(h.id)}/photo" alt="" loading="lazy"></a>` : ''}<div style="min-width:0"><b>${esc(h.file || '–')}</b>${h.orderId && orderNr(h.orderId) ? `<div class="meta">${esc(orderNr(h.orderId))}</div>` : ''}${h.message && h.result !== 'finished' && !h.markedFailed ? `<div class="meta">${esc(t(h.message))}</div>` : ''}${typeof failInfoHTML === 'function' ? failInfoHTML(h) : ''}
        ${h.costs ? `<div class="meta">${costPill(h.costs)}${h.costs.grams ? ` · ${fnum(h.costs.grams, 0)} g` : ''}${h.costs.kwh ? ` · ${fnum(h.costs.kwh, 2)} kWh${h.costs.kwhMeasured ? '' : ` (${t('geschätzt')})`}` : ''}${h.result === 'finished' && on('queue') && typeof failActionsHTML === 'function' ? ` · ${failActionsHTML(h)}` : ''}</div>` : ''}
        ${typeof failActionsHTML === 'function' && on('queue') && h.result !== 'finished' ? `<div class="h-acts">${failActionsHTML(h)}</div>` : ''}</div></div>
      <div class="num"><span class="lbl">${t('Dauer')}</span>${fmtDur(h.durationSec)}</div>
      <div><span class="lbl">${t('Bei')}</span>${h.result !== 'finished' && !h.markedFailed && h.progress != null ? `${Math.floor(h.progress)} %` : ''}</div>
      <div><span class="pill ${c}">${t(l)}</span></div></div>`;
  }).join('');
  return `<div class="bar-row"><h2>${t('Verlauf')}</h2><span class="meta">${t('{n} Drucke', { n: S.history.length })}</span>${S.history.length ? `<button class="b b-sm b-fault" data-act="hClear">${t('Verlauf leeren')}</button>` : ''}</div>
    <div class="list">${S.history.length ? `<div class="row h-row head"><div>${t('Ende')}</div><div>${t('Drucker')}</div><div>${t('Datei')}</div><div>${t('Dauer')}</div><div></div><div>${t('Ergebnis')}</div></div>${rows}` : `<div class="empty"><h3>${t('Noch kein Druck beendet')}</h3><p>${t('Jeder abgeschlossene Druck erscheint hier mit Dauer und Ergebnis.')}</p></div>`}</div>`;
}

// ================================================================ Einstellungen: Drucker

function vPrinters() {
  const rows = S.printers.map((p) => {
    const drv = S.drivers.find((x) => x.id === p.driver);
    const st = S.maint?.stats?.[p.id];
    const v = pView(p);
    return `<div class="prow" data-act="editPrinter" data-id="${p.id}" role="button" tabindex="0" title="${esc(t('Einstellen'))}">
      <span class="lampi ${v.cls}"><i class="led ${v.cls}"></i></span>
      <b class="pr-name">${esc(p.name)}</b>
      <span class="meta">${esc(p.settings?.model || t(drv?.label || p.driver))}</span>
      <span class="meta">${esc(v.lamp)}</span>
      <span class="meta num">${on('maintenance') ? `${fnum(st?.hours, 1)} h` : ''}</span>
      <span class="meta">${on('homeassistant') && p.settings?.powerEntity ? t('Steckdose') : ''}</span>
      <span class="pr-area">${areas().length ? `<select class="in" data-parea="${p.id}" aria-label="${esc(t('Bereich von {n}', { n: p.name }))}"><option value="">${t('Ohne Bereich')}</option>${areas().map((a) => `<option value="${esc(a.id)}" ${p.settings?.area === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>` : ''}</span>
      <span class="pr-edit">${ICON.edit}</span></div>`;
  }).join('');
  return `<div class="page-head"><h1>${NAV_ICON.gear}${t('Drucker#pl')}</h1><span class="grow"></span><button class="b b-sm b-go" data-act="editPrinter">${ICON.plus}${t('Drucker hinzufügen')}</button></div>
    ${printerListHTML(rows)}`;
}
function printerListHTML(rows) {
  return S.printers.length ? `<div class="sbox plist">${rows}</div>` : `<div class="list"><div class="empty">${t('Noch kein Drucker angelegt.')}</div></div>`;
}

function printerDialog(p = null) {
  const models = [...new Set(S.files.map((f) => f.meta?.printerModel).filter(Boolean))];
  const d = openDialog(`<form class="dlg" method="dialog">
    <h2>${p ? t('{n} einstellen', { n: esc(p.name) }) : t('Drucker hinzufügen')}</h2>
    <label>${t('Name')}<input name="name" required value="${esc(p?.name || '')}" placeholder="${esc(t('z. B. Bambu X2D Werkstatt'))}" autocomplete="off"></label>
    ${areas().length ? `<label>${t('Bereich')}<select name="area"><option value="">${t('Ohne Bereich')}</option>${areas().map((a) => `<option value="${esc(a.id)}" ${p?.settings?.area === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>` : ''}
    <label>${t('Anbindung')}<select name="driver">${S.drivers.map((x) => `<option value="${x.id}" ${x.id === p?.driver ? 'selected' : ''}>${esc(t(x.label))}</option>`).join('')}</select></label>
    <p class="hint" data-hint></p>
    <div data-fields style="display:contents"></div>
    <fieldset><legend>${on('queue') || on('maintenance') ? t('Warteschlange und Wartung') : t('Weitere Angaben')}</legend>
      <label>${t('Druckermodell')}<input name="model" list="models" value="${esc(p?.settings?.model || '')}" placeholder="${esc(t('z. B. Snapmaker U1'))}"></label>
      <datalist id="models">${models.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
      <p class="hint" style="margin-top:-4px">${t('Damit nicht zugewiesene Drucke nur auf passenden Druckern landen. Steht so im Slicer (z. B. „Bambu Lab X2D“).')}</p>
      <label ${on('maintenance') ? '' : 'hidden'}>${t('Betriebsstunden vor PrintDock')}<input name="hoursOffset" type="number" min="0" step="0.1" value="${esc(p?.settings?.hoursOffset || 0)}"></label>
      <label ${on('filament') ? '' : 'hidden'}>${t('Filament-Plätze')}<input name="slots" value="${esc(p?.settings?.slots || '')}" placeholder="${esc(t('z. B. ACE 1, ACE 2, ACE 3, ACE 4'))}"></label>
      <p class="hint" style="margin-top:-4px" ${on('filament') ? '' : 'hidden'}>${t('Nur nötig, wenn der Drucker seine Plätze nicht selbst meldet (Bambu-AMS meldet sie). Leer = ein Platz je Düse.')}</p>
    </fieldset>
    <fieldset ${on('queue') ? '' : 'hidden'}><legend>${t('Startzeiten für automatische Drucke')}</legend>
      <p class="hint" style="margin:0">${t('Ob ein Druck von selbst startet, steht jetzt am Auftrag bzw. Eintrag (Druckart). Hier lässt sich das für diesen Drucker zeitlich begrenzen.')}</p>
      <label class="check"><input type="checkbox" name="winOn" ${p?.settings?.winOn ? 'checked' : ''}> ${t('Nur zu bestimmten Zeiten automatisch starten')}</label>
      <div class="two"><label>${t('von')}<input name="winFrom" type="time" value="${esc(p?.settings?.winFrom || '07:00')}"></label><label>${t('bis')}<input name="winTo" type="time" value="${esc(p?.settings?.winTo || '22:00')}"></label></div>
      <label>${t('Außerhalb nur Drucke bis (Stunden, 0 = keine)')}<input name="winOutsideMaxH" type="number" min="0" max="48" step="0.5" value="${esc(p?.settings?.winOutsideMaxH ?? 0)}"></label>
      <label ${on('homeassistant') ? '' : 'hidden'}>${t('Lange Drucke bei günstigem Strom (Entität aus Home Assistant)')}<input name="cheapEntity" value="${esc(p?.settings?.cheapEntity || '')}" placeholder="binary_sensor.pv_ueberschuss / sensor.strompreis" autocomplete="off"></label>
      <div class="two" ${on('homeassistant') ? '' : 'hidden'}><label>${t('günstig, wenn')}<select name="cheapMode">${[['on', 'an'], ['below', 'unter'], ['above', 'über']].map(([k, l]) => `<option value="${k}" ${(p?.settings?.cheapMode || 'on') === k ? 'selected' : ''}>${t(l)}</option>`).join('')}</select></label><label>${t('Wert')}<input name="cheapValue" type="number" step="any" value="${esc(p?.settings?.cheapValue ?? 0)}"></label></div>
      <label ${on('homeassistant') ? '' : 'hidden'}>${t('gilt für Drucke ab (Stunden)')}<input name="cheapMinH" type="number" min="0" max="48" step="0.5" value="${esc(p?.settings?.cheapMinH ?? 0)}"></label>
      <p class="hint" style="margin-top:-4px">${t('Gilt nur für automatische Starts – „Start“ von Hand geht immer. Beispiele: Strompreis-Sensor „unter 0,25“, Einspeisung „über 1500“, PV-Überschuss-Schalter „an“.')}</p>
    </fieldset>
    <fieldset ${on('homeassistant') ? '' : 'hidden'}><legend>${t('Strom über Home Assistant')}</legend>
      <label>${t('Steckdose (Entität)')}<div data-power-pick>${entityPickerHTML('powerEntity', p?.settings?.powerEntity)}</div></label>
      <label class="check"><input type="checkbox" name="autoOff" ${p?.settings?.autoOff ? 'checked' : ''}> ${t('Nach dem Druck automatisch ausschalten, sobald die Düse abgekühlt ist')}</label>
      <p class="hint" style="margin-top:-4px">${t('Verbindung einrichten unter Einstellungen → Home Assistant. Leer lassen, wenn der Drucker nicht geschaltet werden soll.')}</p>
    </fieldset>
    <p class="form-error" hidden></p>
    ${p ? `<p class="hint" style="margin:0">${t('Zeigt etwas nicht richtig an (Filament, Lüfter, Licht)? Diagnose-Daten herunterladen und mitschicken – sie enthalten, was der Drucker meldet, aber keine Zugangsdaten.')} <a href="api/printers/${esc(p.id)}/diagnostics" download>${t('Diagnose-Daten')}</a></p>` : ''}
    <div class="dlg-actions">${p ? `<button class="b b-fault left" type="button" data-del>${t('Entfernen')}</button>` : ''}<button class="b" type="button" data-close>${t('Abbrechen')}</button><button class="b b-done">${t('Speichern')}</button></div></form>`);
  const form = $('form', d);
  const renderFields = (values = {}) => {
    const drv = S.drivers.find((x) => x.id === form.driver.value);
    $('[data-hint]', d).textContent = t(drv?.hint || '');
    $('[data-fields]', d).innerHTML = (drv?.fields || []).map((f) => fieldHtml(f, values[f.key])).join('');
  };
  renderFields(p?.config);
  form.driver.addEventListener('change', () => renderFields());
  // Steckdosen-Auswahl: Entitäten aus Home Assistant nachladen
  if (on('homeassistant') && S.haEntities === null && !S.haEntLoading) {
    S.haEntLoading = true;
    loadHaEntities().then(() => {
      S.haEntLoading = false;
      const box = $('[data-power-pick]', d);
      if (box && d.open) box.innerHTML = entityPickerHTML('powerEntity', form.powerEntity.value);
    });
  }
  $('[data-del]', d)?.addEventListener('click', async () => {
    if (!(await confirmBox(t('Drucker entfernen'), t('„{n}“ aus PrintDock entfernen? Verlauf und Dateien bleiben erhalten.', { n: p.name }), t('Entfernen'), 'b-fault'))) return;
    await run(() => api(`printers/${p.id}`, { method: 'DELETE' }), t('Drucker entfernt'));
    d.close();
    reload('printers', 'summary', 'queue', 'maint');
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      name: form.name.value, driver: form.driver.value, config: readFields(form),
      settings: { ...(p?.settings || {}), model: form.model.value, area: form.area ? form.area.value : p?.settings?.area || '', hoursOffset: form.hoursOffset.value, slots: form.slots.value, powerEntity: form.powerEntity.value.trim(), autoOff: form.autoOff.checked,
        winOn: form.winOn.checked, winFrom: form.winFrom.value, winTo: form.winTo.value, winOutsideMaxH: form.winOutsideMaxH.value,
        cheapEntity: form.cheapEntity.value.trim(), cheapMode: form.cheapMode.value, cheapValue: form.cheapValue.value, cheapMinH: form.cheapMinH.value },
    };
    try {
      await api(p ? `printers/${p.id}` : 'printers', { method: p ? 'PUT' : 'POST', body });
      d.close();
      toast(p ? t('Gespeichert') : t('Drucker hinzugefügt'));
      reload('printers', 'summary', 'maint');
    } catch (err) {
      formError(d, err.message);
    }
  });
}

// ================================================================ Einstellungen: Benachrichtigungen

function vNotify() {
  const evLabel = Object.fromEntries(S.notifyTypes.events.map((e) => [e.id, e.label]));
  const rows = S.channels.map((c) => {
    const type = S.notifyTypes.channels.find((x) => x.id === c.type);
    const r = c.lastResult;
    const status = r ? `<span class="${r.ok ? 'vl ok' : 'vl bad'}" title="${esc(r.ok ? '' : t(r.error || ''))}">${r.ok ? t('zuletzt {t}', { t: tfmt(r.at) }) : t('Fehler')}</span>` : `<span class="meta">${t('noch nichts gesendet')}</span>`;
    return `<div class="nrow ${c.enabled ? '' : 'off'}">
      <div class="lt"><b>${esc(c.name)}</b><span>${esc(t(type?.label || c.type))} · ${c.events.map((e) => esc(t(evLabel[e] || e))).join(', ') || t('keine Ereignisse gewählt')}</span></div>
      <div class="nstat">${status}</div>
      <label class="nimg" title="${esc(type?.image ? t('Kamerabild mitschicken') : t('Dieser Dienst kann keine Bilder'))}">${ICON.cam || ''}<span class="tgl"><input type="checkbox" data-n-set="attachImage" data-id="${c.id}" ${c.attachImage && type?.image ? 'checked' : ''} ${type?.image ? '' : 'disabled'}><span class="sw"></span></span></label>
      <label class="nimg" title="${esc(t('Kanal aktiv'))}"><span class="tgl"><input type="checkbox" data-n-set="enabled" data-id="${c.id}" ${c.enabled ? 'checked' : ''}><span class="sw"></span></span></label>
      <div class="nbtn"><button class="b b-sm" data-act="nTest" data-id="${c.id}">${t('Test')}</button><button class="b b-sm" data-act="nEdit" data-id="${c.id}" aria-label="${esc(t('Bearbeiten'))}">${ICON.edit}</button></div></div>`;
  }).join('');
  return `<div class="page-head"><h1>${NAV_ICON.gear}${t('Benachrichtigungen')}</h1><span class="grow"></span><button class="b b-sm b-go" data-act="nEdit">${ICON.plus}${t('Kanal hinzufügen')}</button></div>
    <p class="meta" style="margin:-6px 0 12px">${t('Meldungen bei Druckende, Störung, Pause (z. B. Filament leer) oder fälliger Wartung – je Kanal mit oder ohne Kamerabild vom Moment des Ereignisses.')}</p>
    ${S.channels.length ? `<div class="sbox nlist"><div class="nrow nhead"><span>${t('Kanal')}</span><span>${t('Status')}</span><span>${t('Bild')}</span><span>${t('Aktiv')}</span><span></span></div>${rows}</div>` : `<div class="list"><div class="empty">${t('Noch kein Kanal eingerichtet.')}</div></div>`}`;
}

document.addEventListener('change', async (e) => {
  const el = e.target.closest?.('[data-n-set]');
  if (!el) return;
  await run(() => api(`notifications/${el.dataset.id}/set`, { method: 'POST', body: { [el.dataset.nSet]: el.checked } }), el.dataset.nSet === 'attachImage' ? (el.checked ? t('Kamerabild wird mitgeschickt') : t('Ohne Kamerabild')) : null);
  reload('channels');
});

function channelDialog(c = null) {
  const T = S.notifyTypes;
  const d = openDialog(`<form class="dlg" method="dialog"><h2>${c ? t('{n} bearbeiten', { n: esc(c.name) }) : t('Kanal hinzufügen')}</h2>
    <label>${t('Dienst')}<select name="type">${T.channels.map((x) => `<option value="${x.id}" ${x.id === c?.type ? 'selected' : ''}>${esc(t(x.label))}</option>`).join('')}</select></label>
    <p class="hint" data-hint></p>
    <label>${t('Name')}<input name="name" value="${esc(c?.name || '')}" placeholder="${esc(t('z. B. Mein Handy'))}"></label>
    <div data-fields style="display:contents"></div>
    <fieldset><legend>${t('Melden bei')}</legend>${T.events.map((e) => `<label class="check"><input type="checkbox" name="ev" value="${e.id}" ${(c ? c.events.includes(e.id) : e.defaultOn) ? 'checked' : ''}> ${esc(t(e.label))}</label>`).join('')}</fieldset>
    <label class="check" data-img><input type="checkbox" name="attachImage" ${c ? (c.attachImage ? 'checked' : '') : 'checked'}> ${t('Kamerabild anhängen')}</label>
    <label class="check"><input type="checkbox" name="enabled" ${c ? (c.enabled ? 'checked' : '') : 'checked'}> ${t('Kanal aktiv')}</label>
    <p class="form-error" hidden></p>
    <div class="dlg-actions">${c ? `<button class="b b-fault left" type="button" data-del>${t('Entfernen')}</button>` : ''}<button class="b" type="button" data-close>${t('Abbrechen')}</button><button class="b b-done">${t('Speichern')}</button></div></form>`);
  const form = $('form', d);
  const renderFields = (values = {}) => {
    const x = T.channels.find((y) => y.id === form.type.value);
    $('[data-hint]', d).textContent = t(x?.hint || '');
    $('[data-fields]', d).innerHTML = (x?.fields || []).map((f) => fieldHtml(f, values[f.key])).join('');
    $('[data-img]', d).hidden = !x?.image;
  };
  renderFields(c?.config);
  form.type.addEventListener('change', () => renderFields());
  // Home-Assistant-Ziele einmal laden, dann die Felder neu zeichnen
  if (S.haNotify === undefined) {
    S.haNotify = null;
    api('ha/notify-services').then((l) => (S.haNotify = l)).catch(() => (S.haNotify = [])).finally(() => {
      if (d.open && form.type.value === 'homeassistant') renderFields({ ...(c?.config || {}), ...readFields(form) });
    });
  }
  $('[data-del]', d)?.addEventListener('click', async () => {
    await run(() => api(`notifications/${c.id}`, { method: 'DELETE' }), t('Kanal entfernt'));
    d.close();
    reload('channels');
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      type: form.type.value, name: form.name.value, enabled: form.enabled.checked, attachImage: form.attachImage.checked,
      events: $$('input[name=ev]:checked', d).map((x) => x.value), config: readFields(form),
    };
    try {
      await api(c ? `notifications/${c.id}` : 'notifications', { method: c ? 'PUT' : 'POST', body });
      d.close();
      toast(t('Gespeichert'));
      reload('channels');
    } catch (err) {
      formError(d, err.message);
    }
  });
}

// ================================================================ Einstellungen: Slicer

function vSlicer() {
  const st = S.settings;
  if (!st) return `<div class="empty">${t('Lade …')}</div>`;
  const base = `${S.app?.directUrl || S.ha?.directUrl || location.origin}/slicer`;
  const urlRow = (label, url) => `<div>${esc(label)}</div><span class="code">${esc(url)}</span><button class="b b-sm" data-act="copy" data-text="${esc(url)}">${t('Kopieren')}</button>`;
  const targets = [[base, t('Nur in die Bibliothek')], ...(on('queue') ? [[`${base}/queue`, t('In die Warteschlange (passender Drucker)')], ...S.printers.map((p) => [`${base}/${p.id}`, t('Warteschlange {p}', { p: p.name })])] : [])];
  return `<div class="page-head"><h1>${NAV_ICON.gear}${t('Slicer')}</h1></div>
    <h3 class="shead">${t('Aus dem Slicer an PrintDock senden')}</h3>
    <p class="meta" style="margin:-4px 0 10px">${t('OrcaSlicer, Snapmaker Orca, PrusaSlicer, Anycubic Slicer Next: Drucker-Einstellungen → „Physischer Drucker“ / „Druck-Host“. PrintDock antwortet wie OctoPrint bzw. Klipper.')}</p>
    <div class="sbox">
      ${urlRowS(t('Host-Typ'), t('OctoPrint – im Orca „Octo/Klipper“'), '')}
      ${urlRowS(t('Hostname, IP oder URL'), t('Bestimmt, wohin der Druck geht – eine Adresse je „physischem Drucker“ im Slicer.'), `<select class="in" data-slurl style="max-width:100%">${targets.map(([u, l]) => `<option value="${esc(u)}">${esc(l)}</option>`).join('')}</select>
        <span class="code" data-slshow>${esc(targets[0][0])}</span><button class="b b-sm" data-act="copy" data-text="${esc(targets[0][0])}" data-slcopy>${t('Kopieren')}</button>`)}
      ${urlRowS(t('API-Schlüssel / Passwort'), '', `<span class="code">${esc(st.slicerKey)}</span><button class="b b-sm" data-act="copy" data-text="${esc(st.slicerKey)}">${t('Kopieren')}</button><button class="b b-sm" data-act="newKey">${t('Neu erzeugen')}</button>`)}
    </div>
    <p class="meta">${t('Die Adresse muss die IP des Rechners sein, auf dem PrintDock läuft (als Add-on: die IP von Home Assistant) mit Port 3080 – nicht die Adresse aus der Browserzeile von Home Assistant.')}</p>
    ${inboxHTML(st.inbox)}
    <h3 class="shead" style="margin-top:26px">${t('Dateien im Slicer öffnen')}</h3><section>
      <p class="intro">${t('„Öffnen in …“ bei einer Datei startet den Slicer auf diesem Rechner und lädt die Datei aus PrintDock. Weitere Slicer lassen sich mit ihrem Link-Schema ergänzen; {url} steht für die Download-Adresse.')}</p>
      <div class="list" data-slicers>${st.slicers.map((s, i) => `<div class="row" style="grid-template-columns:minmax(140px,1fr) 2fr auto"><input class="in" data-sn="${i}" value="${esc(s.name)}" aria-label="${t('Name')}"><input class="in" data-su="${i}" value="${esc(s.url)}" aria-label="${t('Link-Schema')}"><button class="x del" data-act="slRemove" data-i="${i}" aria-label="${t('Entfernen')}">${ICON.trash}</button></div>`).join('')}</div>
      <div class="btns"><button class="b b-sm" data-act="slAdd">${ICON.plus}${t('Slicer ergänzen')}</button><button class="b b-sm b-done" data-act="slSave">${t('Speichern')}</button></div>
      <p class="meta">${t('Manche Slicer öffnen nur Dateien von bestimmten Webseiten. Klappt das nicht, „Herunterladen“ wählen und die Datei im Slicer öffnen.')}</p>
    </section>`;
}

/** Eingangsordner – der Weg für Bambu Studio (kann Bambu-Drucker nicht über OctoPrint ansprechen) */
function inboxHTML(ib) {
  if (!ib) return '';
  const share = ib.share ? `${ib.share}` : ib.dir;
  const shareQ = ib.share ? `${ib.share}\\warteschlange` : ib.queueDir;
  return `<h3 class="shead" style="margin-top:26px">${t('Bambu Studio: Eingangsordner')}</h3>
    <p class="meta" style="margin:-4px 0 10px">${t('Bambu Studio schickt an Bambu-Drucker nur über die Bambu-Cloud bzw. den eigenen LAN-Weg, nicht an PrintDock. Darum: Platte slicen, dann „Geslicte Platte exportieren“ (Strg+G) und die Datei in diesen Ordner speichern – PrintDock übernimmt sie nach wenigen Sekunden.')}</p>
    <div class="sbox">
      ${urlRowS(t('In die Bibliothek'), '', `<span class="code">${esc(share)}</span><button class="b b-sm" data-act="copy" data-text="${esc(share)}">${t('Kopieren')}</button>`)}
      ${on('queue') ? urlRowS(t('In die Warteschlange'), t('passender Drucker'), `<span class="code">${esc(shareQ)}</span><button class="b b-sm" data-act="copy" data-text="${esc(shareQ)}">${t('Kopieren')}</button>`) : ''}
      ${ib.recent?.length ? urlRowS(t('Zuletzt übernommen'), '', `<span class="meta">${ib.recent.map((r) => `${esc(r.name)}${r.queued ? ' → ' + t('Warteschlange') : ''}`).join(' · ')}</span>`) : ''}
      ${ib.error ? urlRowS(t('Fehler'), '', `<span class="warn-txt">${esc(ib.error)}</span>`) : ''}
    </div>
    <p class="meta">${ib.share ? t('Die Freigabe „share“ gibt es mit dem Samba-Add-on von Home Assistant (Einstellungen → Add-ons → Samba share). Im Explorer \\\\homeassistant\\share öffnen; den Ordner printdock legt PrintDock selbst an.') : t('Den Ordner kannst du im Netzwerk freigeben oder mit dem Ordner abgleichen, in den Bambu Studio exportiert.')}</p>`;
}

const urlRowS = (label, hint, control) => `<div class="srow"><div class="sl"><b>${label}</b>${hint ? `<span>${hint}</span>` : ''}</div><div class="sc">${control}</div></div>`;
document.addEventListener('change', (e) => {
  const sel = e.target.closest?.('[data-slurl]');
  if (!sel) return;
  $('[data-slshow]').textContent = sel.value;
  $('[data-slcopy]').dataset.text = sel.value;
});

function readSlicerRows() {
  return $$('[data-sn]').map((el) => ({ name: el.value, url: $(`[data-su="${el.dataset.sn}"]`).value }));
}

// ================================================================ Darstellung

const VIEW_FN = { queue: vQueue, orders: vOrders, files: vFiles, maint: vMaint, history: vHistory, printers: vPrinters, notify: vNotify, slicer: vSlicer };

function render() {
  if (VIEW_ALIAS[S.view]) S.view = VIEW_ALIAS[S.view][0];
  if (!viewsAvailable().includes(S.view)) S.view = homeView();
  renderHead();
  const app = $('#app');
  // Eingaben in Einstellungen nicht durch Live-Updates überschreiben
  if (['slicer', 'general', 'ha'].includes(S.view) && app.contains(document.activeElement) && document.activeElement.matches('input,select,textarea')) return;
  const html = (VIEW_FN[S.view] || VIEW_FN.board)();
  // Gleiche Ansicht: nur Geändertes austauschen. So bleiben Bilder, Kamera, Scrollposition und
  // offene Auswahllisten stehen (vorher sprang die Druckeransicht bei Live-Updates teils nach oben).
  if (render.last === S.view && S.view !== 'files' && S.view !== 'parts') holdScroll(() => morph(app, html));
  else app.innerHTML = html;
  render.last = S.view;
  alignSetNav();
  attachCameras();
  if (S.view === 'files' || S.view === 'parts') bindFileView();
}

/** Einstellungen: das Seitenmenü beginnt auf Höhe des ersten Kastens rechts (nicht auf Höhe der Überschrift) */
function alignSetNav() {
  const nav = $('.set-nav');
  if (!nav) return;
  const wrap = nav.parentElement;
  const box = $('.set-main .sbox', wrap);
  if (!box || getComputedStyle(wrap).gridTemplateColumns.split(' ').length < 2) { nav.style.marginTop = ''; return; }
  const off = Math.max(0, Math.round(box.getBoundingClientRect().top - wrap.getBoundingClientRect().top));
  nav.style.marginTop = `${off}px`;
}
window.addEventListener('resize', () => alignSetNav());

/** Live-Updates dürfen die Ansicht nicht verschieben: Scrollposition merken und wiederherstellen,
    die Seitenhöhe kurz halten, bis nachladende Bilder wieder ihre Größe haben (sonst kürzt der
    Browser die Seite und die Ansicht springt nach oben – vor allem in der Home-Assistant-App). */
function holdScroll(fn) {
  const se = document.scrollingElement || document.documentElement;
  const app = $('#app');
  const y = se.scrollTop;
  if (y > 0 && app) {
    app.style.minHeight = `${app.offsetHeight}px`;
    clearTimeout(holdScroll.t);
    holdScroll.t = setTimeout(() => { app.style.minHeight = ''; }, 2500);
  }
  fn();
  if (y > 0 && Math.abs(se.scrollTop - y) > 2 && Date.now() - (holdScroll.user || 0) > 400) se.scrollTop = y;
}
// Eigenes Scrollen des Nutzers nicht zurückdrehen
for (const ev of ['wheel', 'touchmove', 'keydown']) window.addEventListener(ev, () => { holdScroll.user = Date.now(); }, { passive: true });

/** DOM schonend aktualisieren: gleiche Knoten bleiben erhalten, nur Abweichungen werden ersetzt. */
function morph(target, html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  morphChildren(target, tpl.content);
}
function morphChildren(a, b) {
  const next = [...b.childNodes];
  next.forEach((nb, i) => {
    const na = a.childNodes[i];
    if (!na) a.appendChild(nb);
    else morphNode(na, nb);
  });
  while (a.childNodes.length > next.length) a.lastChild.remove();
}
function morphNode(na, nb) {
  // Kamera: das Live-Bild bleibt, der Platzhalter in der neuen Fassung wird ignoriert
  if (nb.nodeType === 1 && nb.hasAttribute('data-cam-slot') && na.nodeType === 1 && na.classList.contains('cam')) return;
  if (na.nodeType !== nb.nodeType || na.nodeName !== nb.nodeName || (na.nodeType === 1 && (na.dataset.id || '') !== (nb.dataset.id || '') && na.matches('article,[data-id]'))) {
    na.replaceWith(nb);
    return;
  }
  if (na.nodeType === 3 || na.nodeType === 8) {
    if (na.nodeValue !== nb.nodeValue) na.nodeValue = nb.nodeValue;
    return;
  }
  if (na.nodeType !== 1) return;
  if (na.isEqualNode(nb)) return;
  for (const { name } of [...na.attributes]) if (!nb.hasAttribute(name)) na.removeAttribute(name);
  for (const { name, value } of [...nb.attributes]) if (na.getAttribute(name) !== value) na.setAttribute(name, value);
  const focused = na === document.activeElement;
  if (na.tagName === 'INPUT') {
    if (!focused) {
      if (na.type === 'checkbox' || na.type === 'radio') na.checked = nb.hasAttribute('checked');
      else if (na.value !== (nb.getAttribute('value') ?? '')) na.value = nb.getAttribute('value') ?? '';
    }
    return;
  }
  if (na.tagName === 'TEXTAREA') {
    if (!focused) na.value = nb.textContent;
    return;
  }
  if (na.tagName === 'SELECT') {
    morphChildren(na, nb);
    if (!focused) {
      const sel = [...nb.options].findIndex((o) => o.hasAttribute('selected'));
      na.selectedIndex = sel >= 0 ? sel : 0;
    }
    return;
  }
  morphChildren(na, nb);
}

function tick() {
  $$('[data-end]').forEach((el) => (el.textContent = fmtTimer((Number(el.dataset.end) - Date.now()) / 1000)));
}

// ================================================================ Klicks

document.addEventListener('click', async (e) => {
  const g = e.target.closest('[data-group]');
  if (g) return setView(navGroups().find((x) => x.g === g.dataset.group).v[0][0]);
  const tab = e.target.closest('[data-view]');
  if (tab) return setView(tab.dataset.view);
  if (e.target.closest('#themeBtn')) {
    try { localStorage.setItem('pd-theme', isDark() ? 'light' : 'dark'); } catch {}
    applyTheme();
    return renderHead();
  }
  if (e.target.closest('#langBtn')) {
    try { localStorage.setItem('pd-lang', LANG === 'de' ? 'en' : 'de'); } catch {}
    applyAppearance();
    return render();
  }
  if (e.target.closest('#logoutBtn')) {
    await api('logout', { method: 'POST' }).catch(() => {});
    return location.reload();
  }
  if (e.target.closest('[data-parea]')) return; // Bereich in der Druckerliste
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const { act, id } = el.dataset;
  const p = id ? printerById(id) : null;

  switch (act) {
    case 'editPrinter': return printerDialog(p);
    case 'cam':
      S.cameraOpen.has(id) ? S.cameraOpen.delete(id) : S.cameraOpen.add(id);
      return updateTile(id);
    case 'camBig': return cameraDialog(p);
    case 'cmd': {
      const cmd = el.dataset.cmd;
      if (cmd === 'cancel' && !(await confirmBox(t('Druck abbrechen'), t('Druck auf {p} wirklich abbrechen? Das lässt sich nicht rückgängig machen.', { p: p.name }), t('Abbrechen bestätigen'), 'b-fault'))) return;
      el.disabled = true;
      await run(() => api(`printers/${id}/command`, { method: 'POST', body: { cmd } }), { pause: t('Pause gesendet'), resume: t('Weiter gesendet'), cancel: t('Abbruch gesendet') }[cmd]);
      return;
    }
    case 'plateClear':
      if (!(await confirmBox(t('Druckplatte geräumt?'), t('Teil von „{p}“ entnommen und Platte wieder eingelegt? Danach kann der nächste Druck starten.', { p: p.name }), t('Ja, Platte ist frei'), 'b-done'))) return;
      if (!(await run(() => api(`printers/${id}/plate-clear`, { method: 'POST' })))) return;
      await Promise.all([loaders.summary(), loaders.queue()]).catch(() => {});
      {
        // Sagen, ob jetzt etwas startet – und wenn nicht, warum
        const si = S.summary?.startInfo?.[id];
        toast(!si ? t('Platte frei bestätigt') : si.ok ? `${t('Platte frei bestätigt')} – ${t(si.text)}` : `${t('Platte frei – startet nicht:')} ${t(si.text)}`, Boolean(si && !si.ok && si.kind !== 'empty' && si.kind !== 'manual'));
      }
      return render();
    case 'qStart': return startItem(id, el.dataset.printer || null);
    case 'qAdd': return queueAddDialog({ fileId: el.dataset.file, printerId: el.dataset.printer, partId: el.dataset.part });
    case 'qFilter': S.qFilter = el.dataset.k; return render();
    case 'qMove': {
      const open = S.queue.filter((q) => q.status === 'queued');
      const i = open.findIndex((q) => q.id === id);
      const j = i + Number(el.dataset.dir);
      if (j < 0 || j >= open.length) return;
      [open[i], open[j]] = [open[j], open[i]];
      await run(() => api('queue/reorder', { method: 'POST', body: { ids: open.map((q) => q.id) } }));
      return reload('queue', 'summary');
    }
    case 'qDel':
      await run(() => api(`queue/${id}`, { method: 'DELETE' }), t('Entfernt'));
      return reload('queue', 'summary', 'orders');
    case 'qRequeue':
      await run(() => api(`queue/${id}/requeue`, { method: 'POST' }), t('Neu eingereiht'));
      return reload('queue', 'summary', 'orders');
    case 'qRetry':
      await run(() => api(`queue/${id}`, { method: 'PUT', body: {} }));
      return reload('queue', 'summary');
    case 'qClear':
      await run(() => api('queue/clear-finished', { method: 'POST' }), t('Aufgeräumt'));
      return reload('queue');
    case 'oFilter': S.oFilter = el.dataset.k; return render();
    case 'oEdit': return orderDialog(S.orders.find((o) => o.id === id));
    case 'oPrint': return printOrder(id);
    case 'oPlan': {
      const r = await run(() => api(`orders/${id}/plan`, { method: 'POST', body: {} }));
      if (r) toast(t('{n} Druck(e) eingeplant', { n: r.planned }));
      return reload('orders', 'queue', 'summary');
    }
    case 'fFilter': S.fFilter = el.dataset.k; return render();
    case 'fDel': {
      const f = fileById(id);
      if (!(await confirmBox(t('Datei löschen'), t('„{f}“ endgültig löschen?', { f: f.name }), t('Löschen'), 'b-fault'))) return;
      await run(() => api(`files/${id}`, { method: 'DELETE' }), t('Datei gelöscht'));
      return reload('files');
    }
    case 'slicerMenu': e.stopPropagation(); return slicerMenu(el, id);
    case 'mTemplates': {
      const r = await run(() => api('maintenance/templates', { method: 'POST', body: { printerId: id } }));
      if (r) toast(t('{n} Aufgaben übernommen – bitte Intervalle prüfen', { n: r.added }));
      return reload('maint', 'summary');
    }
    case 'mEdit': return taskDialog(S.maint.tasks.find((x) => x.id === id));
    case 'mDone': return taskDoneDialog(S.maint.tasks.find((x) => x.id === id));
    case 'hClear':
      if (!(await confirmBox(t('Verlauf leeren'), t('Gesamten Verlauf löschen? Betriebsstunden für die Wartung werden dann neu gezählt.'), t('Löschen'), 'b-fault'))) return;
      await run(() => api('history', { method: 'DELETE' }), t('Verlauf geleert'));
      return reload('history', 'maint');
    case 'nEdit': return channelDialog(S.channels.find((c) => c.id === id));
    case 'nTest':
      el.disabled = true;
      el.textContent = t('Wird gesendet …');
      await run(() => api(`notifications/${id}/test`, { method: 'POST' }), t('Testnachricht gesendet'));
      return reload('channels');
    case 'copy':
      try { await navigator.clipboard.writeText(el.dataset.text); toast(t('Kopiert')); } catch { toast(t('Kopieren nicht möglich – bitte markieren und kopieren'), true); }
      return;
    case 'newKey':
      if (!(await confirmBox(t('Neuen API-Key erzeugen'), t('Der alte Schlüssel funktioniert danach nicht mehr. In allen Slicern neu eintragen.'), t('Neu erzeugen')))) return;
      S.settings = await run(() => api('settings', { method: 'PUT', body: { newSlicerKey: true } }), t('Neuer Schlüssel erzeugt'));
      return render();
    case 'slAdd':
      S.settings.slicers = [...readSlicerRows(), { name: '', url: 'meinslicer://open?file={url}' }];
      return render();
    case 'slRemove':
      S.settings.slicers = readSlicerRows().filter((_, i) => i !== Number(el.dataset.i));
      return render();
    case 'slSave': {
      const r = await run(() => api('settings', { method: 'PUT', body: { slicers: readSlicerRows() } }), t('Gespeichert'));
      if (r) S.settings = r;
      return render();
    }
    default:
  }
});

document.addEventListener('change', async (e) => {
  const qm = e.target.closest('[data-qmode]');
  if (qm) {
    await run(() => api(`queue/${qm.dataset.qmode}`, { method: 'PUT', body: { mode: qm.value } }), t('Druckart: {m}', { m: t(PMODE_LABEL[qm.value]) }));
    return reload('queue', 'summary');
  }
  const om = e.target.closest('[data-omode]');
  if (om) {
    const o = S.orders.find((x) => x.id === om.dataset.omode);
    if (o) await run(() => api(`orders/${o.id}/mode`, { method: 'POST', body: { mode: om.value } }), t('Druckart: {m}', { m: t(PMODE_LABEL[om.value]) }));
    return reload('orders', 'queue', 'summary');
  }
  const el = e.target.closest('[data-act="qPrinter"]');
  if (!el) return;
  await run(() => api(`queue/${el.dataset.id}`, { method: 'PUT', body: targetValue(el.value) }));
  reload('queue', 'summary');
});

// ================================================================ Live-Verbindung

let es = null;
function connect() {
  es?.close();
  es = new EventSource('api/events');
  es.onopen = () => {
    S.live = true;
    reload(...Object.keys(loaders));
  };
  es.onerror = () => {
    S.live = false;
    renderHead();
  };
  es.addEventListener('status', (e) => {
    const { id, status } = JSON.parse(e.data);
    const p = printerById(id);
    if (!p) return;
    const changed = JSON.stringify(p.status) !== JSON.stringify(status);
    const stateChanged = p.status?.state !== status.state;
    p.status = status;
    if (!changed) return;
    if (S.view === 'board') {
      updateTile(id);
      const strip = $('.strip');
      if (strip) {
        const tpl = document.createElement('template');
        tpl.innerHTML = stripHTML();
        holdScroll(() => morphNode(strip, tpl.content.querySelector('.strip')));
      }
    }
    if (stateChanged) {
      renderHead();
      reload('summary', 'queue');
    }
  });
  es.addEventListener('printers', () => reload('printers', 'summary'));
  es.addEventListener('production', () => reload('summary', 'queue', 'orders', 'maint', 'reserve'));
  es.addEventListener('files', () => reload('files'));
  es.addEventListener('reslice', () => reload('reslice'));
  es.addEventListener('channels', () => reload('channels'));
  es.addEventListener('settings', () => reload('settings'));
  es.addEventListener('filament', () => reload('filament', 'summary', 'reserve'));
  es.addEventListener('power', () => reload('printers'));
  es.addEventListener('ha', () => reload('ha', 'emergency'));
  es.addEventListener('app', () => reload('app'));
  es.addEventListener('remote', () => reload('remote'));
  es.addEventListener('portal', () => typeof onPortalLive === 'function' && onPortalLive());
  es.addEventListener('portalEvent', (e) => typeof onPortalEvent === 'function' && onPortalEvent(JSON.parse(e.data)));
  es.addEventListener('storage', () => reload('storage', 'autobackup'));
  es.addEventListener('firstLayer', () => reload('printers'));
  es.addEventListener('station', (e) => typeof onStationLive === 'function' && onStationLive(JSON.parse(e.data)));
  es.addEventListener('stationTag', (e) => typeof onStationTag === 'function' && onStationTag(JSON.parse(e.data)));
  es.addEventListener('history', (e) => {
    const h = JSON.parse(e.data);
    if (!h) return reload('history', 'maint', 'summary', 'filament', 'files', 'printers', 'labels', 'orders', 'reserve');
    const msg = { finished: 'Druck fertig', cancelled: 'Druck abgebrochen', error: 'Druck fehlgeschlagen' }[h.result] || h.result;
    toast(`${h.printerName}: ${t(msg)}`, h.result === 'error');
    S.statsData = null;
    reload('history', 'maint', 'summary', 'filament', 'labels', 'orders', 'reserve');
  });
}

document.addEventListener('click', (e) => {
  if (e.target.closest('#menuBtn')) {
    $('#side').classList.add('open');
    $('#scrim').classList.add('on');
  } else if (e.target.closest('#scrim')) {
    $('#side').classList.remove('open');
    $('#scrim').classList.remove('on');
  }
});

window.addEventListener('hashchange', () => {
  const v = location.hash.slice(1);
  if ((viewsAvailable().includes(v) || VIEW_ALIAS[v]) && v !== S.view) setView(v);
});

/** Start: Einstellungen holen → ggf. Einrichtung oder Anmeldung → Daten laden. */
async function boot() {
  applyTheme();
  try {
    await loaders.app();
  } catch {
    setTimeout(boot, 3000);
    return;
  }
  tick();
  if (S.viewFromHome) {
    S.viewFromHome = false;
    S.view = homeView();
  }
  if (!S.app.setupDone && typeof showSetup === 'function') return showSetup();
  if (!S.app.loggedIn && typeof showLogin === 'function') return showLogin();
  try {
    const [drivers, notifyTypes] = await Promise.all([api('drivers'), api('notification-types')]);
    S.drivers = drivers;
    S.notifyTypes = notifyTypes;
  } catch {
    return;
  }
  await Promise.all(Object.values(loaders).map((l) => l().catch(() => {})));
  render();
  connect();
}

setInterval(tick, 1000);
document.addEventListener('DOMContentLoaded', boot);
