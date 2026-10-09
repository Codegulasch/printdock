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
const NAV_ALL = [
  { g: 'board', l: 'Drucker#pl', icon: 'printer', v: [['board', 'Drucker#pl']] },
  { g: 'queue', l: 'Warteschlange', icon: 'queue', v: [['queue', 'Warteschlange', 'queue']] },
  { g: 'orders', l: 'Aufträge', icon: 'orders', v: [['orders', 'Aufträge', 'orders']] },
  { g: 'files', l: 'Dateien', icon: 'files', v: [['files', 'Dateien', 'files']] },
  { g: 'fil', l: 'Filament', icon: 'spool', v: [['spools', 'Spulen', 'filament'], ['slots', 'Belegung', 'filament'], ['usage', 'Verbrauch', 'filament']] },
  { g: 'maint', l: 'Wartung', icon: 'wrench', v: [['maint', 'Wartungsplan', 'maintenance']] },
  { g: 'ana', l: 'Auswertung', icon: 'chart', v: [['stats', 'Statistik', 'stats'], ['history', 'Verlauf', 'history']] },
  { g: 'set', l: 'Einstellungen', icon: 'gear', sep: true, v: [['general', 'Allgemein'], ['printers', 'Drucker#pl'], ['ha', 'Home Assistant', 'homeassistant'], ['notify', 'Benachrichtigungen', 'notifications'], ['slicer', 'Slicer', 'slicer'], ['system', 'System']] },
];
const on = (m) => !m || S.app?.modules?.[m] !== false;
function navGroups() {
  return NAV_ALL.map((g) => ({ ...g, v: g.v.filter((v) => on(v[2])) })).filter((g) => g.v.length);
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
const fileById = (id) => S.files.find((f) => f.id === id);

const ICON = {
  play: '<svg class="ico" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg class="ico" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>',
  stop: '<svg class="ico" viewBox="0 0 24 24" fill="currentColor"><rect x="5.5" y="5.5" width="13" height="13" rx="1.5"/></svg>',
  cam: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8h3l2-3h8l2 3h3v11H3z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  gear: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9l2.1 2.1m10 10 2.1 2.1M4.9 19.1 7 17m10-10 2.1-2.1"/></svg>',
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
  files: async () => (S.files = await api('files')),
  maint: async () => (S.maint = await api('maintenance')),
  filament: async () => (S.fil = await api('filament')),
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
  };
}

function renderHead() {
  const b = badges();
  const groups = navGroups();
  const cur = viewGroup(S.view);
  $('#nav').innerHTML = groups.map((g) => {
    const n = g.v.map((v) => b[v[0]] || '').join('');
    return `${g.sep ? '<div class="sep"></div>' : ''}<button data-group="${g.g}" ${g.g === cur ? 'aria-current="page"' : ''}>${NAV_ICON[g.icon]}<span>${esc(t(g.l))}</span>${n}</button>`;
  }).join('');
  const grp = groups.find((g) => g.g === cur);
  $('#subtabs').innerHTML = grp && grp.v.length > 1 ? grp.v.map(([k, l]) => `<button role="tab" data-view="${k}" aria-selected="${S.view === k}">${esc(t(l))}${b[k] || ''}</button>`).join('') : '';
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
  $('#logoutBtn').title = t('Abmelden');
  $('#nav').setAttribute('aria-label', t('Hauptnavigation'));
  $('#menuBtn').setAttribute('aria-label', t('Menü öffnen'));
}

function setView(v) {
  S.view = v;
  $('#side').classList.remove('open');
  $('#scrim').classList.remove('on');
  history.replaceState(null, '', `#${v}`);
  render();
  window.scrollTo(0, 0);
}

// ================================================================ Kennzahlen-Leiste

function stripHTML() {
  const s = S.summary || {};
  const ps = S.printers;
  const by = (cls) => ps.filter((p) => pView(p).cls === cls).length;
  const cell = (n, label, cls = '', led = '') => `<div class="${cls}">${led ? `<i class="led ${n ? led : 'off'}"></i>` : ''}<b class="num">${n}</b><span>${esc(label)}</span></div>`;
  return `<div class="strip">
    ${cell(by('run'), t('drucken'), '', 'run')}
    ${cell(by('free'), t('frei'), '', 'free')}
    ${cell(by('wait'), t('warten'), by('wait') ? 'warn' : '', 'wait')}
    ${cell(by('fault'), t('Störungen'), by('fault') ? 'bad' : '', 'fault')}
    ${on('queue') ? cell(s.queued ?? 0, t('in Warteschlange')) : ''}
    ${on('orders') ? cell(s.ordersLate ?? 0, t('Aufträge überfällig'), s.ordersLate ? 'bad' : '') : ''}
    ${on('filament') ? cell(s.spoolsLow ?? 0, t('Spulen knapp'), s.spoolsLow ? 'warn' : '') : ''}
    ${on('maintenance') ? cell(s.maintDue ?? 0, t('Wartungen fällig'), s.maintDue ? 'warn' : '') : ''}
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

function vQueue() {
  const open = ['queued', 'sending', 'printing'];
  const list = S.queue.filter((q) => (S.qFilter === 'offen' ? open.includes(q.status) : S.qFilter === 'erledigt' ? !open.includes(q.status) : true));
  const openList = list.filter((q) => q.status === 'queued');
  const chips = [['offen', 'Offen'], ['erledigt', 'Erledigt'], ['alle', 'Alle']]
    .map(([k, l]) => `<button class="chip" data-act="qFilter" data-k="${k}" aria-pressed="${S.qFilter === k}">${t(l)}</button>`).join('');
  const rows = list.map((q) => {
    const [label, cls] = Q_STATUS[q.status] || [q.status, ''];
    const p = printerById(q.printerId);
    const idx = openList.indexOf(q);
    const printerCell = q.status === 'queued'
      ? `<select class="in" data-act="qPrinter" data-id="${q.id}" aria-label="${t('Drucker')}"><option value="">${t('Passender Drucker')}</option>${S.printers.map((x) => `<option value="${x.id}" ${x.id === q.printerId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`
      : esc(p?.name || '–');
    const acts = [];
    if (q.status === 'queued') {
      if (S.qFilter === 'offen') {
        acts.push(`<button class="x" data-act="qMove" data-id="${q.id}" data-dir="-1" title="${t('Nach oben')}" ${idx <= 0 ? 'disabled' : ''}>${ICON.up}</button>`);
        acts.push(`<button class="x" data-act="qMove" data-id="${q.id}" data-dir="1" title="${t('Nach unten')}" ${idx >= openList.length - 1 ? 'disabled' : ''}>${ICON.down}</button>`);
      }
      const anyReady = S.printers.some(printerReady);
      acts.push(`<button class="b b-sm b-go" data-act="qStart" data-id="${q.id}" ${q.file?.printable && anyReady ? '' : 'disabled'} title="${anyReady ? '' : esc(t('Kein Drucker ist frei'))}">${ICON.play}${t('Start')}</button>`);
    }
    if (q.status === 'failed' || q.status === 'cancelled') acts.push(`<button class="b b-sm" data-act="qRequeue" data-id="${q.id}">${t('Erneut einreihen')}</button>`);
    if (!['sending', 'printing'].includes(q.status)) acts.push(`<button class="x del" data-act="qDel" data-id="${q.id}" title="${t('Entfernen')}" aria-label="${t('Entfernen')}">${ICON.trash}</button>`);
    const warn = q.modelMatch === false ? ` <span class="pill pause" title="${esc(t('Datei wurde für ein anderes Druckermodell gesliced'))}">${t('anderes Modell?')}</span>` : '';
    return `<div class="row q-row ${['done', 'retried'].includes(q.status) ? 'dim' : ''}">
      <div class="c-main filecell">${thumbHTML(q.file)}<div style="min-width:0"><b>${esc(q.file?.name || t('Datei gelöscht'))}</b><span class="meta">${materialsHTML(q.file?.meta)}</span></div></div>
      <div><span class="lbl">${t('Auftrag')}</span>${q.order ? `<b>${esc(q.order.nr)}</b><div class="meta">${esc(q.order.title)}</div>` : '<span class="meta">–</span>'}</div>
      <div><span class="lbl">${t('Drucker')}</span>${printerCell}${warn}</div>
      <div><span class="lbl">${t('Dauer')}</span><span class="num">${fmtDur(q.file?.meta?.estimatedSec)}</span></div>
      <div><span class="lbl">${t('Status')}</span><span class="pill ${cls}">${t(label)}</span></div>
      <div class="acts">${acts.join('')}</div>
      ${q.error && q.status === 'queued' ? `<div class="err">${esc(t(q.error))} <button class="x" data-act="qRetry" data-id="${q.id}">${t('Nochmal versuchen')}</button></div>` : ''}
    </div>`;
  }).join('');
  return `${stripHTML()}<div class="bar-row"><h2>${t('Warteschlange')}</h2><div class="chips">${chips}</div>
      ${S.qFilter !== 'offen' ? `<button class="b b-sm" data-act="qClear">${t('Erledigte aufräumen')}</button>` : ''}
      <button class="b b-sm b-go" data-act="qAdd">${ICON.plus}${t('Datei einplanen')}</button></div>
    <div class="list">${list.length ? `<div class="row q-row head"><div>${t('Datei')}</div><div>${t('Auftrag')}</div><div>${t('Drucker')}</div><div>${t('Dauer')}</div><div>${t('Status')}</div><div></div></div>${rows}`
      : `<div class="empty"><h3>${S.qFilter === 'offen' ? t('Nichts in der Warteschlange') : t('Keine Einträge')}</h3><p>${t('Dateien aus der Bibliothek oder einem Auftrag einplanen – oder direkt aus dem Slicer senden.')}</p></div>`}</div>
    <p class="meta" style="margin-top:10px">${t('Ein Druck startet von allein, wenn beim Drucker „Auto-Start“ an ist und die Druckplatte als frei bestätigt wurde. Nicht zugewiesene Einträge gehen nur an Drucker, deren Modell zur Datei passt.')}</p>`;
}

function queueAddDialog({ fileId = null, printerId = null } = {}) {
  const printable = S.files.filter((f) => f.printable);
  if (!printable.length) {
    toast(t('Noch keine druckfertige Datei. Erst unter Dateien hochladen oder aus dem Slicer senden.'), true);
    return;
  }
  const d = openDialog(`<form class="dlg" method="dialog">
    <h2>${t('Datei einplanen')}</h2>
    <label>${t('Datei')}<select name="fileId">${printable.map((f) => `<option value="${f.id}" ${f.id === fileId ? 'selected' : ''}>${esc(f.name)}${f.meta?.printerModel ? ` (${esc(f.meta.printerModel)})` : ''}</option>`).join('')}</select></label>
    <div class="two">
      <label>${t('Drucker')}<select name="printerId"><option value="">${t('Passender Drucker (nach Modell)')}</option>${S.printers.map((p) => `<option value="${p.id}" ${p.id === printerId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label>${t('Anzahl Drucke')}<input name="count" type="number" min="1" max="200" value="1"></label>
    </div>
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
    const f = fileById(form.fileId.value);
    $('[data-bambu]', d).hidden = f?.kind !== '3mf';
    form.plate.innerHTML = (f?.meta?.plates?.length ? f.meta.plates : [1]).map((n) => `<option>${n}</option>`).join('');
  };
  form.fileId.addEventListener('change', sync);
  sync();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const f = fileById(form.fileId.value);
      await api('queue', {
        method: 'POST',
        body: {
          fileId: form.fileId.value, printerId: form.printerId.value || null, count: form.count.value, top: form.top.checked,
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

/**
 * Start-Dialog für einen Warteschlangen-Eintrag: Drucker wählen, Filament prüfen
 * und – Pflicht – bestätigen, dass die Druckplatte geräumt ist.
 */
async function startItem(itemId, printerId = null) {
  const q = S.queue.find((x) => x.id === itemId);
  if (!q) return;
  const ready = S.printers.filter(printerReady);
  if (!ready.length) return toast(t('Kein Drucker ist frei'), true);
  const pre = ready.find((p) => p.id === (printerId || q.printerId)) || ready[0];
  const mustConfirm = S.app?.plateCheck !== false;
  const d = openDialog(`<form class="dlg" method="dialog">
    <h2>${t('Druck starten')}</h2>
    <div class="cur-top">${thumbHTML(q.file)}<div style="min-width:0"><b>${esc(q.file?.name)}</b><div class="meta">${q.order ? `${esc(q.order.nr)} · ${esc(q.order.title)} · ` : ''}${fmtDur(q.file?.meta?.estimatedSec)}</div></div></div>
    <label>${t('Drucker')}<select name="printerId">${ready.map((p) => `<option value="${p.id}" ${p.id === pre.id ? 'selected' : ''}>${esc(p.name)}${p.settings?.model ? ` · ${esc(p.settings.model)}` : ''}</option>`).join('')}</select></label>
    <div data-fcheck></div>
    ${mustConfirm ? `<label class="check plate-check"><input type="checkbox" name="plate" required> <span>${ICON.plate}<b>${t('Druckplatte ist geräumt')}</b><br><span class="meta">${t('Altes Teil entnommen, Platte sauber und richtig eingelegt.')}</span></span></label>` : ''}
    <p class="form-error" hidden></p>
    <div class="dlg-actions"><button class="b" type="button" data-close>${t('Abbrechen')}</button><button class="b b-go" data-ok ${mustConfirm ? 'disabled' : ''}>${ICON.play}${t('Jetzt starten')}</button></div></form>`);
  const form = $('form', d);
  const okBtn = $('[data-ok]', d);
  let fmap = null;
  const loadCheck = async () => {
    const box = $('[data-fcheck]', d);
    box.innerHTML = '';
    fmap = null;
    if (typeof filamentMapHTML !== 'function') return;
    try {
      // Welches Filament aus dem Slice kommt aus welchem Platz? Vorschlag nach Farbe und Material
      fmap = await api(`filament/mapping?printerId=${encodeURIComponent(form.printerId.value)}&queueId=${encodeURIComponent(itemId)}`);
      box.innerHTML = filamentMapHTML(fmap);
    } catch { /* ohne Zuordnung */ }
  };
  $('[data-fcheck]', d).addEventListener('change', (e) => {
    const sel = e.target.closest('[data-fm]');
    if (sel && fmap) filamentMapUpdate($('[data-fcheck]', d), fmap, sel);
  });
  form.printerId.addEventListener('change', loadCheck);
  form.plate?.addEventListener('change', () => (okBtn.disabled = !form.plate.checked));
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
      okBtn.disabled = false;
      formError(d, err.message);
    }
  });
}

// ================================================================ Aufträge

const PRIO = { 1: ['eilig', 'bad'], 2: ['normal', ''], 3: ['niedrig', 'done'] };
const O_STATUS = { offen: '', geplant: 'pause', 'läuft': 'run', fertig: 'done', abgeschlossen: 'done' };

function vOrders() {
  const list = S.orders.filter((o) => (S.oFilter === 'aktiv' ? !o.closed && o.status !== 'fertig' : S.oFilter === 'fertig' ? o.closed || o.status === 'fertig' : true));
  const chips = [['aktiv', 'Aktiv'], ['fertig', 'Fertig'], ['alle', 'Alle']]
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
      <div class="c-main"><b>${esc(o.title)}</b><div class="meta">${esc(o.customer || '')}${o.customer ? ' · ' : ''}${posN === 1 ? t('1 Position') : t('{n} Positionen', { n: posN })}</div></div>
      <div><span class="lbl">${t('Termin')}</span><span class="vl ${dueCls}">${dfmt(o.due)}</span>${o.late ? `<div class="meta" style="color:var(--fault)">${t('überfällig')}</div>` : ''}</div>
      <div><span class="lbl">${t('Prio')}</span><span class="pill ${prioC}">${t(prioL)}</span></div>
      <div><span class="lbl">${t('Fortschritt')}</span><div class="sub" style="margin:0 0 3px"><span class="num">${t('{a} von {b}', { a: `<b>${o.done}</b>`, b: o.qty })}</span><span>${pct} %</span></div><div class="bar"><i style="width:${pct}%"></i></div></div>
      <div><span class="lbl">${t('Status')}</span><span class="pill ${O_STATUS[o.status] || ''}">${esc(t(o.status))}</span></div>
      <div><span class="lbl">${t('Restzeit')}</span><span class="num">${o.restSec ? fmtDur(o.restSec) : '–'}</span></div>
      <div class="acts">${canPrint && on('queue') ? `<button class="b b-sm b-go" data-act="oPrint" data-id="${o.id}" ${anyReady ? '' : 'disabled'} title="${anyReady ? esc(t('Nächsten Druck dieses Auftrags starten')) : esc(t('Kein Drucker ist frei'))}">${ICON.play}${t('Drucken')}</button>` : ''}${canPlan && on('queue') ? `<button class="b b-sm" data-act="oPlan" data-id="${o.id}">${t('Einplanen')}</button>` : ''}<button class="b b-sm" data-act="oEdit" data-id="${o.id}">${ICON.edit}${t('Öffnen')}</button></div>
    </div>`;
  }).join('');
  return `${stripHTML()}<div class="bar-row"><h2>${t('Aufträge')}</h2><div class="chips">${chips}</div><button class="b b-sm b-go" data-act="oEdit">${ICON.plus}${t('Neuer Auftrag')}</button></div>
    <div class="list">${list.length ? `<div class="row o-row head"><div>${t('Nr')}</div><div>${t('Bezeichnung')}</div><div>${t('Termin')}</div><div>${t('Prio')}</div><div>${t('Fortschritt')}</div><div>${t('Status')}</div><div>${t('Restzeit')}</div><div></div></div>${rows}`
      : `<div class="empty"><h3>${S.oFilter === 'aktiv' ? t('Keine offenen Aufträge') : t('Keine Aufträge')}</h3><p>${t('Ein Auftrag fasst Dateien und Stückzahlen zusammen – z. B. „20 Halter für die Werkstatt bis Freitag“.')}</p><button class="b b-go" data-act="oEdit">${ICON.plus}${t('Neuer Auftrag')}</button></div>`}</div>`;
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
  const fileOpts = (sel) => S.files.map((f) => `<option value="${f.id}" ${f.id === sel ? 'selected' : ''}>${esc(f.name)}${f.printable ? '' : ` (${t('nicht gesliced')})`}</option>`).join('');
  const posRow = (p = {}) => `<div class="pos" data-pos="${esc(p.id || '')}">
      <select class="in" name="pf" aria-label="${t('Datei')}">${fileOpts(p.fileId)}</select>
      <input class="in" name="pq" type="number" min="1" max="9999" value="${p.qty || 1}" aria-label="${t('Stückzahl')}">
      <button class="x del" type="button" data-rm title="${t('Position entfernen')}" aria-label="${t('Position entfernen')}">${ICON.trash}</button>
      ${p.id ? `<div class="posinfo">${t('{d} fertig · {p} eingeplant', { d: p.done, p: p.planned })}${p.running ? ` (${t('läuft')})` : ''} · ${t('{n} offen', { n: p.open })}${p.failed ? ` · ${t('{n} fehlgeschlagen', { n: p.failed })}` : ''}</div>` : ''}
    </div>`;
  const d = openDialog(`<form class="dlg" method="dialog">
    <h2>${o ? t('Auftrag {nr}', { nr: esc(o.nr) }) : t('Neuer Auftrag')}</h2>
    <label>${t('Bezeichnung')}<input name="title" required value="${esc(o?.title || '')}" placeholder="${esc(t('z. B. Halter für Werkstatt'))}"></label>
    <div class="two">
      <label>${t('Kunde / Zweck')}<input name="customer" value="${esc(o?.customer || '')}" placeholder="${t('optional')}"></label>
      <div class="two"><label>${t('Termin')}<input name="due" type="date" value="${esc(o?.due || '')}"></label>
      <label>${t('Priorität')}<select name="prio">${[1, 2, 3].map((n) => `<option value="${n}" ${(o?.prio || 2) === n ? 'selected' : ''}>${t(PRIO[n][0])}</option>`).join('')}</select></label></div>
    </div>
    <fieldset><legend>${t('Positionen: Datei und Stückzahl')}</legend>
      <div data-positions>${(o?.positions?.length ? o.positions : [{}]).map(posRow).join('')}</div>
      <button class="b b-sm" type="button" data-addpos style="align-self:flex-start">${ICON.plus}${t('Position')}</button>
      <p class="hint" style="margin:0">${t('Pro Stück wird ein Druck eingeplant. Passen mehrere Teile auf eine Platte, die Platte als eine Datei slicen und die Anzahl Platten eintragen.')}</p>
    </fieldset>
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
      title: form.title.value, customer: form.customer.value, due: form.due.value, prio: Number(form.prio.value), notes: form.notes.value,
      closed: form.closed?.checked || false,
      positions: $$('.pos', d).map((el) => ({ id: el.dataset.pos || null, fileId: $('[name=pf]', el).value, qty: Number($('[name=pq]', el).value) })),
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
      `<span>${fmtSize(f.size)}${f.source === 'slicer' ? ` · ${t('vom Slicer')}` : ''}</span>`,
    ].join('');
    return `<article class="card fcard">
      <div class="pic">${f.thumb ? `<img src="api/files/${esc(f.id)}/thumb" alt="" loading="lazy">` : `<span>${esc(f.ext.toUpperCase())}</span>`}</div>
      <div class="fb"><h3>${esc(f.name)}</h3>
        <div>${f.printable ? `<span class="pill run">${t('druckfertig')}</span>` : `<span class="pill">${t('Modell – erst slicen')}</span>`} <span class="meta">${materialsHTML(m)}</span></div>
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

function uploadFiles(fileList) {
  const filesArr = [...fileList];
  if (!filesArr.length) return;
  const drop = $('[data-drop]');
  let i = 0;
  const next = () => {
    if (i >= filesArr.length) {
      if (drop) drop.textContent = t('{n} Datei(en) hochgeladen.', { n: filesArr.length });
      reload('files');
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
  const orderNr = (id) => S.orders.find((o) => o.id === id)?.nr;
  const rows = S.history.map((h) => {
    const [l, c] = RES[h.result] || [h.result, ''];
    return `<div class="row h-row">
      <div class="num"><span class="lbl">${t('Ende')}</span>${tfmt(h.endedAt)}</div>
      <div><span class="lbl">${t('Drucker')}</span>${esc(h.printerName)}</div>
      <div class="c-main"><b>${esc(h.file || '–')}</b>${h.orderId && orderNr(h.orderId) ? `<div class="meta">${esc(orderNr(h.orderId))}</div>` : ''}${h.message && h.result !== 'finished' ? `<div class="meta">${esc(t(h.message))}</div>` : ''}</div>
      <div class="num"><span class="lbl">${t('Dauer')}</span>${fmtDur(h.durationSec)}</div>
      <div><span class="lbl">${t('Bei')}</span>${h.result !== 'finished' && h.progress != null ? `${Math.floor(h.progress)} %` : ''}</div>
      <div><span class="pill ${c}">${t(l)}</span></div></div>`;
  }).join('');
  return `<div class="bar-row"><h2>${t('Verlauf')}</h2><span class="meta">${t('{n} Drucke', { n: S.history.length })}</span>${S.history.length ? `<button class="b b-sm b-fault" data-act="hClear">${t('Verlauf leeren')}</button>` : ''}</div>
    <div class="list">${S.history.length ? `<div class="row h-row head"><div>${t('Ende')}</div><div>${t('Drucker')}</div><div>${t('Datei')}</div><div>${t('Dauer')}</div><div></div><div>${t('Ergebnis')}</div></div>${rows}` : `<div class="empty"><h3>${t('Noch kein Druck beendet')}</h3><p>${t('Jeder abgeschlossene Druck erscheint hier mit Dauer und Ergebnis.')}</p></div>`}</div>`;
}

// ================================================================ Einstellungen: Drucker

function vPrinters() {
  const cards = S.printers.map((p) => {
    const drv = S.drivers.find((x) => x.id === p.driver);
    const st = S.maint?.stats?.[p.id];
    const v = pView(p);
    return `<article class="card"><h3>${esc(p.name)}</h3>
      <div class="facts" style="margin-bottom:10px"><span>${t('Anbindung')} <b>${esc(t(drv?.label || p.driver))}</b></span><span>${t('Modell')} <b>${esc(p.settings?.model || '–')}</b></span>
      ${on('queue') ? `<span>${t('Auto-Start')} <b>${p.settings?.autoStart ? t('an') : t('aus')}</b></span>` : ''}<span>${t('Betrieb')} <b>${fnum(st?.hours, 1)} h</b></span>
      <span class="lampi ${v.cls}"><i class="led ${v.cls}"></i><b>${esc(v.lamp)}</b></span></div>
      <button class="b b-sm" data-act="editPrinter" data-id="${p.id}">${ICON.edit}${t('Einstellen')}</button></article>`;
  }).join('');
  return `<div class="bar-row"><h2>${t('Drucker#pl')}</h2><button class="b b-sm b-go" data-act="editPrinter">${ICON.plus}${t('Drucker hinzufügen')}</button></div>
    ${S.printers.length ? `<div class="cards">${cards}</div>` : `<div class="list"><div class="empty">${t('Noch kein Drucker angelegt.')}</div></div>`}`;
}

function printerDialog(p = null) {
  const models = [...new Set(S.files.map((f) => f.meta?.printerModel).filter(Boolean))];
  const d = openDialog(`<form class="dlg" method="dialog">
    <h2>${p ? t('{n} einstellen', { n: esc(p.name) }) : t('Drucker hinzufügen')}</h2>
    <label>${t('Name')}<input name="name" required value="${esc(p?.name || '')}" placeholder="${esc(t('z. B. Bambu X2D Werkstatt'))}" autocomplete="off"></label>
    <label>${t('Anbindung')}<select name="driver">${S.drivers.map((x) => `<option value="${x.id}" ${x.id === p?.driver ? 'selected' : ''}>${esc(t(x.label))}</option>`).join('')}</select></label>
    <p class="hint" data-hint></p>
    <div data-fields style="display:contents"></div>
    <fieldset><legend>${on('queue') || on('maintenance') ? t('Warteschlange und Wartung') : t('Weitere Angaben')}</legend>
      <label>${t('Druckermodell')}<input name="model" list="models" value="${esc(p?.settings?.model || '')}" placeholder="${esc(t('z. B. Snapmaker U1'))}"></label>
      <datalist id="models">${models.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
      <p class="hint" style="margin-top:-4px">${t('Damit nicht zugewiesene Drucke nur auf passenden Druckern landen. Steht so im Slicer (z. B. „Bambu Lab X2D“).')}</p>
      <label class="check" ${on('queue') ? '' : 'hidden'}><input type="checkbox" name="autoStart" ${p?.settings?.autoStart ? 'checked' : ''}> ${t('Auto-Start: nächsten Druck automatisch starten, sobald die Platte als frei bestätigt ist')}</label>
      <label ${on('maintenance') ? '' : 'hidden'}>${t('Betriebsstunden vor PrintDock')}<input name="hoursOffset" type="number" min="0" step="0.1" value="${esc(p?.settings?.hoursOffset || 0)}"></label>
      <label ${on('filament') ? '' : 'hidden'}>${t('Filament-Plätze')}<input name="slots" value="${esc(p?.settings?.slots || '')}" placeholder="${esc(t('z. B. ACE 1, ACE 2, ACE 3, ACE 4'))}"></label>
      <p class="hint" style="margin-top:-4px" ${on('filament') ? '' : 'hidden'}>${t('Nur nötig, wenn der Drucker seine Plätze nicht selbst meldet (Bambu-AMS meldet sie). Leer = ein Platz je Düse.')}</p>
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
      settings: { ...(p?.settings || {}), model: form.model.value, autoStart: form.autoStart.checked, hoursOffset: form.hoursOffset.value, slots: form.slots.value, powerEntity: form.powerEntity.value.trim(), autoOff: form.autoOff.checked },
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
    return `<article class="card"><h3>${esc(c.name)}</h3>
      <div class="meta">${esc(t(type?.label || c.type))}${c.enabled ? '' : ` · <b>${t('deaktiviert')}</b>`}${c.attachImage ? ` · ${t('mit Kamerabild')}` : ''}</div>
      <div class="facts" style="margin:8px 0">${c.events.map((e) => `<span class="pill">${esc(t(evLabel[e] || e))}</span>`).join(' ') || `<span>${t('keine Ereignisse gewählt')}</span>`}</div>
      ${r ? `<div class="meta" style="color:${r.ok ? 'var(--run)' : 'var(--fault)'}">${r.ok ? t('Zuletzt gesendet {t}', { t: tfmt(r.at) }) : t('Fehlgeschlagen: {e}', { e: esc(t(r.error)) })}</div>` : ''}
      <div class="btns"><button class="b b-sm" data-act="nTest" data-id="${c.id}">${t('Test senden')}</button><button class="b b-sm" data-act="nEdit" data-id="${c.id}">${ICON.edit}${t('Bearbeiten')}</button></div></article>`;
  }).join('');
  return `<div class="bar-row"><h2>${t('Benachrichtigungen')}</h2><button class="b b-sm b-go" data-act="nEdit">${ICON.plus}${t('Kanal hinzufügen')}</button></div>
    <p class="intro">${t('Meldungen bei Druckende, Störung, Pause (z. B. Filament leer) oder fälliger Wartung – auf Wunsch mit Kamerabild. Am schnellsten geht es mit der App ntfy.')}</p>
    ${S.channels.length ? `<div class="cards">${rows}</div>` : `<div class="list"><div class="empty">${t('Noch kein Kanal eingerichtet.')}</div></div>`}`;
}

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
    <p class="meta">${t('Die Adresse muss die IP des Rechners sein, auf dem PrintDock läuft (als Add-on: die IP von Home Assistant) mit Port 3080 – nicht die Adresse aus der Browserzeile von Home Assistant.')}
      ${t('Bambu Studio spricht kein OctoPrint: dort die Platte als .gcode.3mf exportieren und unter Dateien hochladen.')}</p>
    <h3 class="shead" style="margin-top:26px">${t('Dateien im Slicer öffnen')}</h3><section>
      <p class="intro">${t('„Öffnen in …“ bei einer Datei startet den Slicer auf diesem Rechner und lädt die Datei aus PrintDock. Weitere Slicer lassen sich mit ihrem Link-Schema ergänzen; {url} steht für die Download-Adresse.')}</p>
      <div class="list" data-slicers>${st.slicers.map((s, i) => `<div class="row" style="grid-template-columns:minmax(140px,1fr) 2fr auto"><input class="in" data-sn="${i}" value="${esc(s.name)}" aria-label="${t('Name')}"><input class="in" data-su="${i}" value="${esc(s.url)}" aria-label="${t('Link-Schema')}"><button class="x del" data-act="slRemove" data-i="${i}" aria-label="${t('Entfernen')}">${ICON.trash}</button></div>`).join('')}</div>
      <div class="btns"><button class="b b-sm" data-act="slAdd">${ICON.plus}${t('Slicer ergänzen')}</button><button class="b b-sm b-done" data-act="slSave">${t('Speichern')}</button></div>
      <p class="meta">${t('Manche Slicer öffnen nur Dateien von bestimmten Webseiten. Klappt das nicht, „Herunterladen“ wählen und die Datei im Slicer öffnen.')}</p>
    </section>`;
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
  if (!viewsAvailable().includes(S.view)) S.view = 'board';
  renderHead();
  const app = $('#app');
  // Eingaben in Einstellungen nicht durch Live-Updates überschreiben
  if (['slicer', 'general', 'ha'].includes(S.view) && app.contains(document.activeElement) && document.activeElement.matches('input,select,textarea')) return;
  app.innerHTML = (VIEW_FN[S.view] || VIEW_FN.board)();
  attachCameras();
  if (S.view === 'files') bindFileView();
}

function tick() {
  const d = new Date();
  $('#clock').textContent = `${d.toLocaleDateString(LOC, { weekday: 'short', day: '2-digit', month: '2-digit' })} ${hm(d)}`;
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
      await run(() => api(`printers/${id}/plate-clear`, { method: 'POST' }), t('Platte frei bestätigt'));
      return reload('summary', 'queue');
    case 'qStart': return startItem(id, el.dataset.printer || null);
    case 'qAdd': return queueAddDialog({ fileId: el.dataset.file, printerId: el.dataset.printer });
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
  const el = e.target.closest('[data-act="qPrinter"]');
  if (!el) return;
  await run(() => api(`queue/${el.dataset.id}`, { method: 'PUT', body: { printerId: el.value || null } }));
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
      if (strip) strip.outerHTML = stripHTML();
    }
    if (stateChanged) {
      renderHead();
      reload('summary', 'queue');
    }
  });
  es.addEventListener('printers', () => reload('printers', 'summary'));
  es.addEventListener('production', () => reload('summary', 'queue', 'orders', 'maint'));
  es.addEventListener('files', () => reload('files'));
  es.addEventListener('channels', () => reload('channels'));
  es.addEventListener('settings', () => reload('settings'));
  es.addEventListener('filament', () => reload('filament', 'summary'));
  es.addEventListener('power', () => reload('printers'));
  es.addEventListener('ha', () => reload('ha'));
  es.addEventListener('app', () => reload('app'));
  es.addEventListener('history', (e) => {
    const h = JSON.parse(e.data);
    if (!h) return reload('history', 'maint', 'summary', 'filament', 'files', 'printers');
    const msg = { finished: 'Druck fertig', cancelled: 'Druck abgebrochen', error: 'Druck fehlgeschlagen' }[h.result] || h.result;
    toast(`${h.printerName}: ${t(msg)}`, h.result === 'error');
    S.statsData = null;
    reload('history', 'maint', 'summary', 'filament');
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
  if (viewsAvailable().includes(v) && v !== S.view) setView(v);
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
