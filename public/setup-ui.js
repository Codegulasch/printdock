'use strict';
/* PrintDock – Einrichtungsassistent, Anmeldung und Einstellungen → Allgemein
   (Sprache, Darstellung, Module, Zugriff). Ergänzt app.js. */

const MODULE_INFO = [
  ['queue', 'Warteschlange', 'Drucke einreihen, Reihenfolge festlegen, Auto-Start nach „Platte frei“.', ['files']],
  ['orders', 'Aufträge', 'Stückzahlen und Termine bündeln – z. B. Kundenaufträge oder Serien.', ['queue', 'files']],
  ['files', 'Dateien', 'Bibliothek für G-code, 3MF und Modelle mit Vorschaubild.'],
  ['filament', 'Filamentverwaltung', 'Spulen, Restmengen, AMS/ACE-Belegung und automatische Abbuchung.'],
  ['maintenance', 'Wartungsplaner', 'Aufgaben nach Betriebsstunden, Drucken oder Tagen.'],
  ['history', 'Verlauf', 'Liste aller beendeten Drucke.'],
  ['stats', 'Statistik', 'Auswertungen zu Drucken, Zeit, Material und Kosten.'],
  ['camera', 'Kamera', 'Livebild der Druckerkameras auf den Karten.'],
  ['notifications', 'Benachrichtigungen', 'Meldungen per ntfy, Telegram, Discord, Gotify oder Webhook.'],
  ['homeassistant', 'Home Assistant', 'Drucker über Steckdosen schalten und PrintDock in Home Assistant anzeigen.'],
  ['slicer', 'Slicer-Anbindung', 'Aus OrcaSlicer & Co. direkt an PrintDock senden.'],
  ['demo', 'Demo-Daten', 'Simulierte Drucker zum Ausprobieren.'],
];
const ACCENTS = [['cobalt', 'Kobalt'], ['violet', 'Violett'], ['petrol', 'Petrol'], ['orange', 'Orange'], ['magenta', 'Magenta'], ['graphite', 'Graphit']];

/** Abhängigkeiten: Aufträge brauchen Warteschlange und Dateien, Warteschlange braucht Dateien. */
function fixModules(m, changed) {
  const deps = Object.fromEntries(MODULE_INFO.map((x) => [x[0], x[3] || []]));
  if (m[changed]) for (const d of deps[changed]) m[d] = true;
  else for (const [k, ds] of Object.entries(deps)) if (ds.includes(changed)) m[k] = false;
  return m;
}

function moduleGrid(mods, attr) {
  return `<div class="mods">${MODULE_INFO.map(([k, l, d, deps]) => `<label class="mod ${mods[k] ? 'on' : ''}">
    <input type="checkbox" ${attr}="${k}" ${mods[k] ? 'checked' : ''}>
    <span class="sw" aria-hidden="true"></span>
    <span class="mt"><b>${esc(t(l))}</b><span>${esc(t(d))}</span>${deps ? `<small>${esc(t('braucht: {d}', { d: deps.map((x) => t(MODULE_INFO.find((y) => y[0] === x)[1])).join(', ') }))}</small>` : ''}</span></label>`).join('')}</div>`;
}

function accentPicker(cur, attr) {
  return `<div class="accents">${ACCENTS.map(([k, l]) => `<button type="button" class="acc-sw" ${attr}="${k}" data-a="${k}" aria-pressed="${cur === k}" title="${esc(t(l))}"><i></i><span>${esc(t(l))}</span></button>`).join('')}</div>`;
}

function themePicker(cur, attr) {
  return `<div class="chips">${[['auto', 'Automatisch'], ['light', 'Hell'], ['dark', 'Dunkel']].map(([k, l]) => `<button type="button" class="chip" ${attr}="${k}" aria-pressed="${cur === k}">${t(l)}</button>`).join('')}</div>`;
}

// ================================================================ Overlay

function overlay(html) {
  let o = $('#overlay');
  if (!o) {
    o = document.createElement('div');
    o.id = 'overlay';
    o.className = 'overlay';
    document.body.append(o);
  }
  o.innerHTML = html;
  document.body.classList.add('has-overlay');
  return o;
}
function closeOverlay() {
  $('#overlay')?.remove();
  document.body.classList.remove('has-overlay');
}

const BRAND = '<svg viewBox="0 0 40 40" aria-hidden="true" class="brand-ico"><rect x="2" y="2" width="36" height="36" rx="9" fill="var(--accent)"/><rect x="9" y="29" width="22" height="3" rx="1.5" fill="#fff" opacity=".7"/><rect x="12" y="23" width="16" height="4.5" rx="1" fill="#fff"/><rect x="13.5" y="17.5" width="13" height="4.5" rx="1" fill="#fff" opacity=".85"/><rect x="15" y="12" width="10" height="4.5" rx="1" fill="#fff" opacity=".7"/><path d="M17.5 5h5l-1.2 5h-2.6z" fill="#fff"/></svg>';

// ================================================================ Anmeldung

function showLogin() {
  if ($('#overlay [data-login]')) return;
  es?.close();
  const o = overlay(`<form class="ov-card login" data-login>
    <div class="ov-brand">${BRAND}<b>PrintDock</b></div>
    <h2>${t('Anmelden')}</h2>
    <label>${t('Benutzer')}<input name="user" autocomplete="username" value="${esc(S.app?.auth?.user || '')}" required></label>
    <label>${t('Passwort')}<input name="password" type="password" autocomplete="current-password" required autofocus></label>
    <p class="form-error" hidden></p>
    <button class="b b-go">${t('Anmelden')}</button>
    <button type="button" class="x" data-lang-toggle style="align-self:center">${LANG === 'de' ? 'English' : 'Deutsch'}</button>
  </form>`);
  const form = $('form', o);
  $('[data-lang-toggle]', o).addEventListener('click', () => {
    try { localStorage.setItem('pd-lang', LANG === 'de' ? 'en' : 'de'); } catch {}
    applyAppearance();
    o.remove();
    showLogin();
  });
  form.password.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('login', { method: 'POST', body: { user: form.user.value, password: form.password.value } });
      closeOverlay();
      boot();
    } catch (err) {
      formError(form, err.message);
    }
  });
}

// ================================================================ Einrichtungsassistent

const W = { step: 0 };

function showSetup() {
  const a = S.app;
  Object.assign(W, {
    step: 0, lang: LANG, theme: themeGet(), accent: a.accent || 'cobalt', modules: { ...a.modules }, plateCheck: a.plateCheck !== false,
    authOn: a.auth?.enabled || false, user: a.auth?.user || 'admin', pw: '', start: 'demo',
  });
  renderSetup();
}

function renderSetup() {
  const steps = ['Willkommen', 'Funktionen', 'Zugriff', 'Los geht’s'];
  const nav = `<ol class="wz-steps">${steps.map((s, i) => `<li class="${i === W.step ? 'cur' : i < W.step ? 'done' : ''}"><span>${i + 1}</span>${esc(t(s))}</li>`).join('')}</ol>`;
  let body = '';
  if (W.step === 0) {
    body = `<h2>${t('Willkommen bei PrintDock')}</h2>
      <p class="intro">${t('Ein paar Fragen, dann ist alles eingerichtet. Jede Einstellung lässt sich später unter Einstellungen → Allgemein ändern.')}</p>
      <div class="wz-field"><b>${t('Sprache')}</b><div class="chips">${[['de', 'Deutsch'], ['en', 'English']].map(([k, l]) => `<button type="button" class="chip" data-w="lang" data-v="${k}" aria-pressed="${W.lang === k}">${l}</button>`).join('')}</div></div>
      <div class="wz-field"><b>${t('Erscheinungsbild')}</b>${themePicker(W.theme, 'data-w-theme')}</div>
      <div class="wz-field"><b>${t('Akzentfarbe')}</b>${accentPicker(W.accent, 'data-w-accent')}</div>
      ${statusLegendHTML()}
      <p class="meta" style="margin-top:14px">${t('Umzug oder Neuinstallation?')} <label class="linkish">${t('Sicherung einspielen')}<input type="file" accept=".zip,application/zip" hidden data-restore></label> – ${t('Drucker, Einstellungen und Daten sind dann sofort wieder da.')}</p>`;
  } else if (W.step === 1) {
    body = `<h2>${t('Welche Funktionen brauchst du?')}</h2>
      <p class="intro">${t('Was du nicht brauchst, schaltest du ab – es verschwindet dann aus Menü und Druckerkarten. Die Druckerübersicht ist immer dabei.')}</p>
      ${moduleGrid(W.modules, 'data-w-mod')}`;
  } else if (W.step === 2) {
    body = `<h2>${t('Sicherheit und Zugriff')}</h2>
      <label class="mod ${W.plateCheck ? 'on' : ''}"><input type="checkbox" data-w-plate ${W.plateCheck ? 'checked' : ''}><span class="sw"></span>
        <span class="mt"><b>${t('Vor jedem Start nach der Druckplatte fragen')}</b><span>${t('Ein Druck aus Warteschlange oder Auftrag startet erst, wenn bestätigt ist, dass die Platte geräumt ist.')}</span></span></label>
      ${S.app.addon ? `<p class="intro" style="margin-top:14px">${t('Als Home-Assistant-Add-on schützt Home Assistant den Zugang. Ein eigener Login ist nur nötig, wenn PrintDock zusätzlich direkt über den Port erreichbar ist.')}</p>` : ''}
      <label class="mod ${W.authOn ? 'on' : ''}" style="margin-top:10px"><input type="checkbox" data-w-auth ${W.authOn ? 'checked' : ''}><span class="sw"></span>
        <span class="mt"><b>${t('Login-Schutz')}</b><span>${t('Pflicht, wenn PrintDock von außen erreichbar ist (Cloudflare Tunnel, Portfreigabe). Im eigenen Netz optional.')}</span></span></label>
      <div class="two" ${W.authOn ? '' : 'hidden'} data-w-authbox style="margin-top:10px">
        <label>${t('Benutzer')}<input data-w-user value="${esc(W.user)}" autocomplete="username"></label>
        <label>${t('Passwort')}<input data-w-pw type="password" value="${esc(W.pw)}" autocomplete="new-password" placeholder="${esc(t('mindestens 6 Zeichen'))}"></label>
      </div>
      <div class="card" style="margin-top:16px"><b>${t('Von unterwegs zugreifen')}</b>
        <p class="meta" style="margin:4px 0 0">${t('Am einfachsten über Tailscale (privates VPN, nichts öffentlich) oder einen Cloudflare Tunnel (eigene Adresse mit HTTPS). Anleitungen stehen in der Dokumentation unter „Fernzugriff“.')}</p></div>`;
  } else {
    const opt = (k, title, text) => `<label class="mod ${W.start === k ? 'on' : ''}"><input type="radio" name="wstart" data-w-start="${k}" ${W.start === k ? 'checked' : ''}><span class="sw radio"></span><span class="mt"><b>${title}</b><span>${text}</span></span></label>`;
    body = `<h2>${t('Womit möchtest du starten?')}</h2>
      <div class="mods one">
        ${W.modules.demo ? opt('demo', t('Demo-Daten einspielen'), t('5 simulierte Drucker mit Aufträgen, Spulen und Verlauf – zum Kennenlernen. Lässt sich mit einem Klick wieder entfernen.')) : ''}
        ${opt('printer', t('Ersten Drucker anlegen'), t('Bambu Lab (LAN), Klipper/Moonraker (Snapmaker U1, Anycubic mit Rinkhals, Voron …) oder OctoPrint.'))}
        ${opt('none', t('Leer starten'), t('Direkt zur Übersicht.'))}
      </div>`;
  }
  const last = W.step === 3;
  overlay(`<div class="ov-card wizard">
    <div class="ov-brand">${BRAND}<b>PrintDock</b><span class="meta">${t('Einrichtung')}</span></div>
    ${nav}<div class="wz-body">${body}</div>
    <p class="form-error" hidden></p>
    <div class="dlg-actions">${W.step ? `<button class="b left" data-w="back">${t('Zurück')}</button>` : '<span class="left"></span>'}
      ${W.step === 0 ? `<button class="b" data-w="skip">${t('Mit Standardwerten starten')}</button>` : ''}
      <button class="b b-go" data-w="${last ? 'finish' : 'next'}">${last ? t('Einrichtung abschließen') : t('Weiter')}</button></div>
  </div>`);
}

/** Bedeutung der Statusfarben – auch im Assistenten sichtbar. */
function statusLegendHTML() {
  const it = (cls, l, d) => `<div><span class="lamp ${cls}"><i class="led ${cls}"></i>${esc(t(l))}</span><span class="meta">${esc(t(d))}</span></div>`;
  return `<div class="wz-field"><b>${t('Statusanzeige der Drucker')}</b><div class="st-legend">
    ${it('free', 'Frei', 'leuchtet grün')}${it('run', 'Druckt', 'blaues Lauflicht')}${it('wait', 'Wartet', 'blinkt gelb – Pause, Platte räumen')}${it('fault', 'Störung', 'blinkt rot')}</div></div>`;
}

async function finishSetup() {
  const body = { lang: W.lang, accent: W.accent, plateCheck: W.plateCheck, modules: W.modules, setupDone: true };
  if (W.authOn) {
    if (!W.pw || W.pw.length < 6) {
      W.step = 2;
      renderSetup();
      return formError($('#overlay'), t('Das Passwort braucht mindestens 6 Zeichen'));
    }
    body.auth = { enabled: true, user: W.user, password: W.pw };
  }
  try {
    try { localStorage.setItem('pd-theme', W.theme); localStorage.removeItem('pd-lang'); } catch {}
    await api('app', { method: 'PUT', body });
    if (W.authOn) await api('login', { method: 'POST', body: { user: W.user, password: W.pw } });
  } catch (err) {
    return formError($('#overlay'), err.message);
  }
  closeOverlay();
  await boot();
  if (W.start === 'demo') {
    await loadDemo();
    setView('board');
  } else if (W.start === 'printer') {
    setView('board');
    printerDialog(null);
  }
}

document.addEventListener('click', async (e) => {
  const ov = e.target.closest('#overlay .wizard');
  if (!ov) return;
  const w = e.target.closest('[data-w]')?.dataset.w;
  const th = e.target.closest('[data-w-theme]')?.dataset.wTheme;
  const ac = e.target.closest('[data-w-accent]')?.dataset.wAccent;
  if (th) {
    W.theme = th;
    try { localStorage.setItem('pd-theme', th); } catch {}
    applyTheme();
    return renderSetup();
  }
  if (ac) {
    W.accent = ac;
    document.documentElement.dataset.accent = ac;
    return renderSetup();
  }
  if (!w) return;
  if (w === 'lang') {
    W.lang = e.target.closest('[data-v]').dataset.v;
    setLang(W.lang);
    return renderSetup();
  }
  if (w === 'next') { W.step = Math.min(3, W.step + 1); return renderSetup(); }
  if (w === 'back') { W.step = Math.max(0, W.step - 1); return renderSetup(); }
  if (w === 'skip') { W.start = 'none'; return finishSetup(); }
  if (w === 'finish') return finishSetup();
});

document.addEventListener('change', (e) => {
  if (!e.target.closest('#overlay .wizard')) return;
  const el = e.target;
  if (el.dataset.wMod) {
    W.modules[el.dataset.wMod] = el.checked;
    fixModules(W.modules, el.dataset.wMod);
    return renderSetup();
  }
  if (el.matches('[data-w-plate]')) { W.plateCheck = el.checked; return renderSetup(); }
  if (el.matches('[data-w-auth]')) { W.authOn = el.checked; return renderSetup(); }
  if (el.dataset.wStart) { W.start = el.dataset.wStart; return renderSetup(); }
});
document.addEventListener('input', (e) => {
  if (e.target.matches('[data-w-user]')) W.user = e.target.value;
  if (e.target.matches('[data-w-pw]')) W.pw = e.target.value;
});

// ================================================================ Einstellungen → Allgemein

/** Eine Einstellungszeile: links Bezeichnung + Erklärung, rechts das Bedienelement. */
const srow = (label, hint, control) => `<div class="srow"><div class="sl"><b>${label}</b>${hint ? `<span>${hint}</span>` : ''}</div><div class="sc">${control}</div></div>`;

function vGeneral() {
  const a = S.app;
  if (!a) return `<div class="empty">${t('Lade …')}</div>`;
  return `<div class="page-head"><h1>${NAV_ICON.gear}${t('Allgemein')}</h1></div>
    <div class="sbox">
      ${srow(t('Sprache'), t('Oberfläche, Benachrichtigungen und Home Assistant'), `<div class="chips">${[['de', 'Deutsch'], ['en', 'English']].map(([k, l]) => `<button class="chip" data-gact="lang" data-v="${k}" aria-pressed="${a.lang === k}">${l}</button>`).join('')}</div>`)}
      ${srow(t('Erscheinungsbild'), '', themePicker(themeGet(), 'data-g-theme'))}
      ${srow(t('Größe'), t('Schrift und Abstände der ganzen Oberfläche'), `<div class="chips">${[['compact', 'Kompakt'], ['standard', 'Standard'], ['large', 'Groß']].map(([k, l]) => `<button class="chip" data-gact="density" data-v="${k}" aria-pressed="${(a.density || 'standard') === k}">${t(l)}</button>`).join('')}</div>`)}
      ${srow(t('Akzentfarbe'), t('Statusfarben bleiben immer gleich'), accentPicker(a.accent, 'data-g-accent'))}
      ${srow(t('Druckplatte'), t('Vor jedem Start aus Warteschlange oder Auftrag fragen, ob die Platte geräumt ist'), `<label class="tgl"><input type="checkbox" data-g-plate ${a.plateCheck ? 'checked' : ''}><span class="sw"></span></label>`)}
    </div>
    <h3 class="shead">${t('Funktionen')}</h3>
    <p class="meta" style="margin:-4px 0 10px">${t('Abgeschaltete Bereiche verschwinden aus Menü und Druckerkarten; ihre Daten bleiben erhalten.')}</p>
    ${moduleGrid(a.modules, 'data-g-mod')}`;
}

function vSystem() {
  const a = S.app;
  if (!a) return `<div class="empty">${t('Lade …')}</div>`;
  const demoLoaded = S.printers.some((p) => p.demo);
  const U = S.upd || {};
  const L = U.result || U.last || null;
  const modeTxt = { addon: t('Home-Assistant-Add-on'), docker: t('Docker'), node: t('Node.js') }[U.mode] || '';
  const newer = L?.newer && L.latest;
  return `<div class="page-head"><h1>${NAV_ICON.gear}${t('System')}</h1></div>
    <h3 class="shead">${t('Updates')}</h3>
    <div class="sbox">
      ${srow(t('Version'), modeTxt, `<b>PrintDock ${esc(a.version)}</b>${newer ? ` <span class="vl warn">${t('{v} verfügbar', { v: esc(String(L.latest).replace(/^v/, '')) })}</span>` : L ? ` <span class="vl ok">${t('aktuell')}</span>` : ''}`)}
      ${srow(t('Nach Updates suchen'), L?.at ? t('Zuletzt geprüft: {d}', { d: new Date(L.at).toLocaleString() }) : t('PrintDock sieht außerdem einmal am Tag nach.'), `<button class="b b-sm" data-gact="updCheck">${t('Jetzt prüfen')}</button>${newer && U.mode !== 'docker' ? `<button class="b b-sm b-go" data-gact="updInstall">${t('Auf {v} aktualisieren', { v: esc(String(L.latest).replace(/^v/, '')) })}</button>` : ''}`)}
      ${newer && L.notes ? `<div class="srow"><div class="sl"><b>${t('Neu in dieser Version')}</b></div><div class="sc"><pre class="notes">${esc(L.notes)}</pre></div></div>` : ''}
      ${newer && U.mode === 'docker' ? srow(t('Docker'), t('Im Container das Image aktualisieren:'), '<span class="code">docker compose pull &amp;&amp; docker compose up -d</span>') : ''}
      <details class="adv srow-adv"><summary>${t('Update-Quelle')}</summary>
        ${srow(t('GitHub-Repository'), t('Besitzer/Name'), `<input class="in" id="uRepo" value="${esc(U.repo || '')}" style="max-width:22rem">`)}
        ${srow(t('Zugangstoken'), t('Nur für private Repositories: GitHub → Settings → Developer settings → Fine-grained token, Zugriff nur auf dieses Repository, Berechtigung „Contents: Read-only“.'), `<input class="in" id="uToken" type="password" value="${esc(U.token || '')}" autocomplete="off" style="max-width:22rem"><button class="b b-sm b-done" data-gact="updSave">${t('Speichern')}</button>`)}
      </details>
    </div>
    <h3 class="shead">${t('Datensicherung')}</h3>
    <div class="sbox">
      ${srow(t('Sicherung herunterladen'), t('Eine Datei mit allem: Einstellungen, Drucker, Warteschlange, Aufträge, Spulen, Wartung, Verlauf und Druckdateien.'), `<a class="b b-sm b-done" href="api/backup" download>${t('Herunterladen')}</a>`)}
      ${srow(t('Sicherung einspielen'), t('Ersetzt den aktuellen Stand – z. B. nach einem Umzug oder auf einer neuen Home-Assistant-Installation.'), `<label class="b b-sm">${t('Datei wählen …')}<input type="file" accept=".zip,application/zip" hidden data-restore></label>`)}
      ${srow(t('Datenordner'), a.addon ? t('Als Add-on steckt PrintDock außerdem in jeder Home-Assistant-Sicherung.') : '', `<span class="code">${esc(a.dataDir || '')}</span>`)}
    </div>
    <h3 class="shead">${t('Zugriff')}</h3>
    <div class="sbox">
      ${srow(t('Adresse im Heimnetz'), t('Für Slicer, Handy und Downloads'), `<span class="code">${esc(a.directUrl || location.origin)}</span> <button class="b b-sm" data-act="copy" data-text="${esc(a.directUrl || location.origin)}">${t('Kopieren')}</button>`)}
      ${srow(t('Login-Schutz'), t('Pflicht, wenn PrintDock von außen erreichbar ist (Cloudflare Tunnel, Portfreigabe).'), `<label class="tgl"><input type="checkbox" data-g-auth ${a.auth.enabled ? 'checked' : ''}><span class="sw"></span></label>`)}
      ${a.auth.enabled || S.authEdit ? srow(t('Benutzer und Passwort'), '', `<div class="two"><input class="in" id="gUser" value="${esc(a.auth.user)}" autocomplete="username" aria-label="${esc(t('Benutzer'))}">
          <input class="in" id="gPw" type="password" autocomplete="new-password" placeholder="${esc(a.auth.enabled ? t('Neues Passwort') : t('Passwort (mindestens 6 Zeichen)'))}"></div>
          <div class="btns" style="margin-top:8px"><button class="b b-sm b-done" data-gact="saveAuth">${t('Zugang speichern')}</button></div>`) : ''}
      ${srow(t('API-Key'), t('Für Kamerabilder in Home Assistant und Download-Links, wenn der Login-Schutz an ist.'), `<div class="btns" style="margin:0"><button class="b b-sm" data-gact="showKey">${t('Anzeigen')}</button><button class="b b-sm" data-gact="newKey">${t('Neu erzeugen')}</button></div><p class="code" data-key hidden></p>`)}
      ${srow(t('Fernzugriff'), t('Tailscale oder Cloudflare Tunnel – Vorlagen in docker-compose.yml, Anleitung in docs/remote-access.md.'), '')}
    </div>
    <h3 class="shead">${t('Einrichtung')}</h3>
    <div class="sbox">
      ${srow(t('Einrichtungsassistent'), t('Erneut durchlaufen, z. B. um Funktionen neu auszuwählen.'), `<button class="b b-sm" data-gact="wizard">${t('Assistent starten')}</button>`)}
      ${on('demo') ? srow(t('Demo-Daten'), t('5 simulierte Drucker mit Dateien, Spulen, Aufträgen und Verlauf – zum Ausprobieren. Eigene Daten bleiben unberührt.'), demoLoaded
        ? `<button class="b b-sm b-fault" data-hact="demoRemove">${t('Demo-Daten entfernen')}</button>`
        : `<button class="b b-sm" data-hact="demoLoad">${t('Demo-Daten einspielen')}</button>`) : ''}
    </div>`;
}

VIEW_FN.system = vSystem;
// Update-Einstellungen laden, wenn die System-Seite offen ist
const _renderSys = render;
// eslint-disable-next-line no-global-assign
render = function renderWithUpdate() {
  _renderSys();
  if (S.view === 'system' && !S.upd && !S.updLoading) {
    S.updLoading = true;
    api('update').then((u) => { S.upd = u; S.updLoading = false; if (S.view === 'system') _renderSys(); }).catch(() => (S.updLoading = false));
  }
};
VIEW_FN.general = vGeneral;

async function saveApp(body, okText = t('Gespeichert')) {
  const r = await run(() => api('app', { method: 'PUT', body }), okText);
  if (r) {
    S.app = r;
    applyAppearance();
    render();
  }
  return r;
}

document.addEventListener('click', async (e) => {
  const th = e.target.closest('[data-g-theme]')?.dataset.gTheme;
  if (th) {
    try { localStorage.setItem('pd-theme', th); } catch {}
    applyTheme();
    return render();
  }
  const ac = e.target.closest('[data-g-accent]')?.dataset.gAccent;
  if (ac) return saveApp({ accent: ac });
  const el = e.target.closest('[data-gact]');
  if (!el) return;
  const act = el.dataset.gact;
  if (act === 'density') return saveApp({ density: el.dataset.v });
  if (act === 'updSave') {
    S.upd = await run(() => api('update', { method: 'PUT', body: { repo: $('#uRepo').value, token: $('#uToken').value } }), t('Gespeichert'));
    return render();
  }
  if (act === 'updCheck') {
    el.disabled = true;
    const r = await run(() => api('update/check', { method: 'POST' }));
    if (r) S.upd = { ...r, result: r };
    return render();
  }
  if (act === 'updInstall') {
    const v = String(S.upd?.result?.latest || S.upd?.last?.latest || '').replace(/^v/, '');
    if (!(await confirmBox(t('Update installieren'), S.upd?.mode === 'addon' ? t('PrintDock {v} wird geladen und von Home Assistant neu gebaut. Das dauert einige Minuten (auf dem Raspberry Pi bis zu 10). Deine Daten bleiben erhalten.', { v }) : t('PrintDock {v} wird geladen und installiert, danach startet PrintDock neu. Deine Daten bleiben erhalten.', { v }), t('Aktualisieren')))) return;
    overlay(`<div class="wizard" style="max-width:480px"><h2>${t('Update auf {v} …', { v: esc(v) })}</h2><p class="intro" data-rs>${t('Wird heruntergeladen …')}</p></div>`);
    const msg = (txt) => { const x = document.querySelector('#overlay [data-rs]'); if (x) x.textContent = txt; };
    let r;
    try {
      r = await api('update/install', { method: 'POST' });
    } catch (err) {
      closeOverlay();
      return toast(t(err.message), true);
    }
    if (r.restart === 'manual') return msg(t('Installiert. Bitte PrintDock jetzt neu starten.'));
    msg(r.restart === 'supervisor' ? t('Home Assistant baut PrintDock {v} – die Seite lädt sich danach selbst neu.', { v: r.version }) : t('PrintDock startet neu …'));
    // Warten, bis die neue Version antwortet
    for (let i = 0; i < 300; i++) {
      await new Promise((res) => setTimeout(res, 3000));
      try {
        const x = await fetch('api/app', { cache: 'no-store' });
        if (x.ok && (await x.json()).version === r.version) return location.reload();
      } catch {}
    }
    return msg(t('Das dauert ungewöhnlich lange. Bitte im Add-on-Protokoll nachsehen.'));
  }
  if (act === 'lang') {
    try { localStorage.removeItem('pd-lang'); } catch {}
    return saveApp({ lang: el.dataset.v });
  }
  if (act === 'saveAuth') {
    const pw = $('#gPw').value;
    const body = { auth: { user: $('#gUser').value } };
    if (pw) body.auth.password = pw;
    // Erst Zugang eintragen, dann einschalten (Schalter „Login-Schutz“ hat die Felder geöffnet)
    if (S.authEdit && !S.app.auth.enabled) body.auth.enabled = true;
    const r = await saveApp(body, body.auth.enabled ? t('Login-Schutz eingeschaltet') : t('Zugang gespeichert'));
    if (r) S.authEdit = false;
    if (r && pw && r.auth.enabled) await api('login', { method: 'POST', body: { user: r.auth.user, password: pw } }).catch(() => {});
    return;
  }
  if (act === 'showKey') {
    const r = await run(() => api('app/key'));
    const box = $('[data-key]');
    if (r && box) { box.textContent = r.apiKey; box.hidden = false; }
    return;
  }
  if (act === 'newKey') {
    if (!(await confirmBox(t('Neuen API-Key erzeugen'), t('Der alte Schlüssel funktioniert danach nicht mehr.'), t('Neu erzeugen')))) return;
    await saveApp({ newApiKey: true }, t('Neuer Schlüssel erzeugt'));
    return;
  }
  if (act === 'wizard') return showSetup();
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.gMod) {
    const mods = fixModules({ ...S.app.modules, [el.dataset.gMod]: el.checked }, el.dataset.gMod);
    return saveApp({ modules: mods });
  }
  if (el.matches('[data-g-plate]')) return saveApp({ plateCheck: el.checked });
  if (el.matches('[data-g-auth]')) {
    const enable = el.checked;
    if (enable && !$('#gPw')) {
      // Felder für Benutzer und Passwort einblenden; eingeschaltet wird mit „Zugang speichern“
      el.checked = false;
      S.authEdit = true;
      render();
      $('#gPw')?.focus();
      return;
    }
    if (enable) {
      const pw = $('#gPw').value;
      const body = { auth: { enabled: true, user: $('#gUser').value } };
      if (pw) body.auth.password = pw;
      const r = await saveApp(body, t('Login-Schutz eingeschaltet'));
      if (!r) { el.checked = false; return; }
      if (pw) await api('login', { method: 'POST', body: { user: r.auth.user, password: pw } }).catch(() => {});
      return;
    }
    if (!(await confirmBox(t('Login-Schutz ausschalten'), t('Dann kann jeder, der PrintDock erreicht, alles bedienen. Nur im eigenen Netz empfehlenswert.'), t('Ausschalten'), 'b-fault'))) { el.checked = true; return; }
    return saveApp({ auth: { enabled: false } }, t('Login-Schutz ausgeschaltet'));
  }
});


// ================================================================ Sicherung einspielen

async function restoreBackup(file) {
  if (!file) return;
  if (!(await confirmBox(t('Sicherung einspielen'), t('Alle aktuellen Drucker, Einstellungen und Daten werden durch die Sicherung „{n}“ ersetzt. Der bisherige Stand wird im Datenordner aufgehoben. Fortfahren?', { n: file.name }), t('Einspielen'), 'b-fault'))) return;
  overlay(`<div class="wizard" style="max-width:460px"><h2>${t('Sicherung wird eingespielt …')}</h2><p class="intro" data-rs>${t('Datei wird hochgeladen.')}</p></div>`);
  const msg = (txt) => { const el = document.querySelector('#overlay [data-rs]'); if (el) el.textContent = txt; };
  let r;
  try {
    const res = await fetch('api/backup/restore', { method: 'POST', body: file, headers: { 'Content-Type': 'application/zip' } });
    r = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(r.error || `HTTP ${res.status}`);
  } catch (err) {
    closeOverlay();
    return toast(t(err.message), true);
  }
  if (r.restart !== 'auto') {
    return msg(t('Sicherung vom {d} ist bereit. Bitte PrintDock jetzt neu starten – beim Start wird sie eingespielt.', { d: new Date(r.createdAt).toLocaleString() }));
  }
  msg(t('Sicherung vom {d} ist hochgeladen. PrintDock startet neu …', { d: new Date(r.createdAt).toLocaleString() }));
  // Warten, bis PrintDock weg und wieder da ist
  let wasDown = false;
  for (let i = 0; i < 90; i++) {
    await new Promise((res) => setTimeout(res, 2000));
    try {
      const res = await fetch('api/app', { cache: 'no-store' });
      if (res.ok && wasDown) return location.reload();
      if (!res.ok) wasDown = true;
    } catch {
      wasDown = true;
    }
  }
  msg(t('PrintDock antwortet nicht. Bitte von Hand neu starten und die Seite neu laden.'));
}

document.addEventListener('change', (e) => {
  if (e.target.matches?.('[data-restore]')) {
    const f = e.target.files?.[0];
    e.target.value = '';
    restoreBackup(f);
  }
});
