/* PrintDock – Einstellungen → Fernzugriff: Tailscale und Cloudflare Tunnel direkt aus PrintDock. */

const REMOTE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18"/></svg>';

// Navigation: eigener Punkt vor „System“
{
  const g = NAV_ALL.find((x) => x.g === 'set');
  const i = g.v.findIndex((v) => v[0] === 'system');
  g.v.splice(i, 0, ['remote', 'Fernzugriff']);
  const j = SET_NAV.findIndex((v) => v[0] === 'system');
  SET_NAV.splice(j, 0, ['remote', 'Fernzugriff', REMOTE_ICON, 'Von unterwegs: Tailscale, Cloudflare']);
}

loaders.remote = async () => (S.remote = await api('remote'));
loaders.relay = async () => (S.relay = S.app?.me?.role === 'operator' ? null : await api('relay'));
loaders.portal = async () => (S.portal = S.app?.me?.role === 'operator' ? null : await api('portal'));

const RS = {
  off: ['aus', ''],
  downloading: ['wird heruntergeladen …', 'pause'],
  starting: ['startet …', 'pause'],
  login: ['Anmeldung nötig', 'pause'],
  running: ['verbunden', 'run'],
  error: ['Fehler', 'bad'],
};
const rPill = (st) => { const [l, c] = RS[st] || [st, '']; return `<i class="pill ${c}">${t(l)}</i>`; };
const urlRow = (label, url) => url ? `<div class="rm-url"><span class="meta">${esc(label)}</span><a href="${esc(url)}" target="_blank" rel="noopener" class="code">${esc(url)}</a><button class="b b-sm" type="button" data-act="copy" data-text="${esc(url)}">${t('Kopieren')}</button></div>` : '';

function vRemote() {
  const R = S.remote;
  const a = S.app || {};
  if (!R) return `<div class="page-head"><h1>${t('Fernzugriff')}</h1></div><div class="empty">${t('Lade …')}</div>`;
  const ts = R.tailscale;
  const cf = R.cloudflare;
  const auth = a.auth || {};
  const row = (label, hint, control) => `<div class="lrow"><div class="lt"><b>${label}</b>${hint ? `<span>${hint}</span>` : ''}</div><div class="lc">${control}</div></div>`;
  const tgl = (attr, onv, dis = false) => `<label class="tgl"><input type="checkbox" ${attr} ${onv ? 'checked' : ''} ${dis ? 'disabled' : ''}><span class="sw"></span></label>`;

  const loginBox = `<div class="sbox rm-auth ${auth.enabled ? '' : 'warn'}">
    ${row(t('Login-Schutz'), auth.enabled ? t('An – Benutzer „{u}“.', { u: esc(auth.user) }) : t('Aus. Für Cloudflare Pflicht, für Tailscale empfohlen.'), `<button class="b b-sm ${auth.enabled ? '' : 'b-go'}" data-view="system">${auth.enabled ? t('Ändern') : t('Einschalten …')}</button>`)}
    ${auth.enabled ? row(t('Anmeldung verlangen'), t('„Nur von außen“: im Heimnetz und in der Home-Assistant-Seitenleiste ohne Passwort, über Tunnel und Tailscale mit.'), `<select class="in" data-rm-scope><option value="all" ${auth.scope !== 'remote' ? 'selected' : ''}>${t('Immer')}</option><option value="remote" ${auth.scope === 'remote' ? 'selected' : ''}>${t('Nur von außen')}</option></select>`) : ''}
  </div>`;

  const tsBox = `<div class="sbox">
    ${row(`Tailscale ${rPill(ts.enabled ? ts.status : 'off')}`, t('Privates VPN: nur deine eigenen Geräte mit Tailscale-App erreichen PrintDock. Nichts ist öffentlich.'), tgl('data-rm-ts', ts.enabled))}
    ${ts.enabled && ts.status === 'login' ? `<div class="rm-note">${ts.loginUrl ? `${t('Einmal bei Tailscale anmelden, dann ist dieses Gerät in deinem Tailnet:')} <a class="b b-sm b-go" href="${esc(ts.loginUrl)}" target="_blank" rel="noopener">${t('Bei Tailscale anmelden')}</a>` : t('Warte auf den Anmelde-Link …')}</div>` : ''}
    ${ts.enabled && ts.status === 'running' ? `<div class="rm-note ok">${urlRow(t('Im Tailnet'), ts.url)}${urlRow(t('Mit HTTPS'), ts.httpsUrl)}${ts.ips?.length ? `<div class="meta">${t('Adressen')}: ${ts.ips.map(esc).join(' · ')}</div>` : ''}</div>` : ''}
    ${ts.enabled && ts.msg ? `<div class="rm-note ${ts.status === 'error' ? 'bad' : ''}">${esc(t(ts.msg))}${ts.httpsEnableUrl ? ` <a class="b b-sm" href="${esc(ts.httpsEnableUrl)}" target="_blank" rel="noopener">${t('HTTPS einschalten')}</a>` : ''}</div>` : ''}
    <details class="adv" ${ts.enabled ? '' : 'open'}><summary>${t('Einstellungen')}</summary>
      ${row(t('Gerätename'), t('So heißt PrintDock im Tailnet (http://printdock:{p}).', { p: R.port }), `<input class="in" data-rm-tsf="hostname" value="${esc(ts.hostname)}" style="max-width:12rem">`)}
      ${row(t('Auth-Key (optional)'), t('Ohne Key meldest du dich einmal per Link an. Key erzeugen: Tailscale-Admin → Settings → Keys.'), `<input class="in" type="password" data-rm-tsf="authKey" value="${ts.hasKey ? '••••' : ''}" placeholder="tskey-auth-…" autocomplete="off" style="max-width:16rem">`)}
      ${row(t('HTTPS'), t('Adresse https://….ts.net mit Zertifikat – nötig für NFC am Handy. Im Tailscale-Admin unter DNS „HTTPS Certificates“ einschalten.'), tgl('data-rm-tsf="https"', ts.https))}
      <div class="st-foot"><button class="b b-sm b-go" data-rm="tsSave">${t('Speichern')}</button>${ts.enabled || ts.status !== 'off' ? `<button class="b b-sm b-fault" data-rm="tsLogout">${t('Abmelden und zurücksetzen')}</button>` : ''}</div>
    </details>
  </div>`;

  const cfBox = `<div class="sbox">
    ${row(`Cloudflare Tunnel ${rPill(cf.enabled ? cf.status : 'off')}`, t('Eigene Adresse mit HTTPS, ohne Portfreigabe – erreichbar von jedem Browser. Nur mit Login-Schutz.'), tgl('data-rm-cf', cf.enabled, !auth.enabled && !cf.enabled))}
    ${cf.enabled && cf.url ? `<div class="rm-note ok">${urlRow(t('Adresse'), cf.url)}${cf.mode === 'quick' ? `<div class="meta">${t('Schnelltest: Die Adresse ändert sich bei jedem Neustart.')}</div>` : ''}</div>` : ''}
    ${cf.enabled && cf.status === 'running' && !cf.url ? `<div class="rm-note ok">${t('Tunnel steht ({n} Verbindungen). Adresse wie im Cloudflare-Dashboard eingetragen.', { n: cf.connections })}</div>` : ''}
    ${cf.enabled && cf.msg ? `<div class="rm-note ${cf.status === 'error' ? 'bad' : ''}">${esc(t(cf.msg))}</div>` : ''}
    <details class="adv" ${cf.enabled ? '' : 'open'}><summary>${t('Einstellungen')}</summary>
      <div class="fmt-pick rm-mode">
        <label class="radio-card"><input type="radio" name="cfmode" value="quick" ${cf.mode !== 'token' ? 'checked' : ''}><span><b>${t('Schnelltest')}</b><small>${t('Ohne Konto: zufällige Adresse …trycloudflare.com. Zum Ausprobieren.')}</small></span></label>
        <label class="radio-card"><input type="radio" name="cfmode" value="token" ${cf.mode === 'token' ? 'checked' : ''}><span><b>${t('Eigene Adresse')}</b><small>${t('Mit eigener Domain bei Cloudflare – feste Adresse, z. B. drucker.example.com.')}</small></span></label>
      </div>
      <div data-cf-token ${cf.mode === 'token' ? '' : 'hidden'}>
        ${row(t('Tunnel-Token'), t('Cloudflare Zero Trust → Networks → Tunnels → Create → Cloudflared → Token kopieren (auch der ganze Befehl geht).'), `<input class="in" type="password" data-rm-cff="token" value="${cf.hasToken ? '••••' : ''}" placeholder="eyJh…" autocomplete="off" style="max-width:16rem">`)}
        ${row(t('Öffentliche Adresse'), t('Im Dashboard unter „Public Hostname“ anlegen, Service HTTP, URL: {u}', { u: `localhost:${R.port}` }), `<input class="in" data-rm-cff="hostname" value="${esc(cf.hostname || '')}" placeholder="drucker.example.com" style="max-width:16rem">`)}
      </div>
      <div class="st-foot"><button class="b b-sm b-go" data-rm="cfSave">${t('Speichern')}</button></div>
    </details>
  </div>`;

  const ha = R.addon ? `<p class="meta">${t('Als Home-Assistant-Add-on geht es auch ohne beides: Ist Home Assistant von unterwegs erreichbar (z. B. Nabu Casa), ist es PrintDock in der Seitenleiste auch – mit der Home-Assistant-Anmeldung.')}</p>` : '';
  const sec = !window.isSecureContext ? `<p class="meta">📱 ${t('NFC-Tags lesen und beschreiben klappt am Handy nur über HTTPS – also über Tailscale mit HTTPS, Cloudflare oder Home Assistant mit HTTPS.')}</p>` : '';
  return `<div class="page-head"><h1>${t('Fernzugriff')}</h1></div>
    <p class="meta" style="margin-top:0">${t('Von unterwegs auf PrintDock zugreifen – ohne Port am Router freizugeben. PrintDock lädt das nötige Programm beim Einschalten selbst herunter.')}</p>
    <h3 class="shead">${t('Zugang')}</h3>${loginBox}
    <h3 class="shead">Tailscale</h3>${tsBox}
    <h3 class="shead">Cloudflare</h3>${cfBox}
    ${relayHTML()}
    ${portalHTML()}
    ${ha}${sec}`;
}

VIEW_FN.remote = () => settingsShell('remote', vRemote());

const rmVal = (sel) => $(sel)?.type === 'checkbox' ? $(sel).checked : $(sel)?.value;
async function rmSave(body, ok) {
  const r = await run(() => api('remote', { method: 'PUT', body }), ok);
  if (r) S.remote = r;
  render();
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-rm]');
  if (!b) return;
  const act = b.dataset.rm;
  if (act === 'tsSave') return rmSave({ tailscale: { hostname: rmVal('[data-rm-tsf="hostname"]'), authKey: rmVal('[data-rm-tsf="authKey"]'), https: rmVal('[data-rm-tsf="https"]') } }, t('Gespeichert'));
  if (act === 'cfSave') return rmSave({ cloudflare: { mode: $('input[name=cfmode]:checked')?.value, token: rmVal('[data-rm-cff="token"]'), hostname: rmVal('[data-rm-cff="hostname"]') } }, t('Gespeichert'));
  if (act === 'tsLogout') {
    if (!(await confirmBox(t('Tailscale abmelden'), t('PrintDock verlässt das Tailnet und vergisst die Anmeldung. Das Gerät danach im Tailscale-Admin entfernen.'), t('Abmelden'), 'b-fault'))) return;
    const r = await run(() => api('remote/tailscale/logout', { method: 'POST' }), t('Abgemeldet'));
    if (r) S.remote = r;
    render();
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.matches('[data-rm-ts]')) {
    const body = { enabled: el.checked };
    // Felder gleich mit übernehmen, falls schon ausgefüllt
    if (el.checked) Object.assign(body, { hostname: rmVal('[data-rm-tsf="hostname"]'), authKey: rmVal('[data-rm-tsf="authKey"]'), https: rmVal('[data-rm-tsf="https"]') });
    return rmSave({ tailscale: body }, el.checked ? t('Tailscale wird gestartet …') : t('Tailscale gestoppt'));
  }
  if (el.matches('[data-rm-cf]')) {
    const body = { enabled: el.checked };
    if (el.checked) Object.assign(body, { mode: $('input[name=cfmode]:checked')?.value, token: rmVal('[data-rm-cff="token"]'), hostname: rmVal('[data-rm-cff="hostname"]') });
    return rmSave({ cloudflare: body }, el.checked ? t('Tunnel wird gestartet …') : t('Tunnel gestoppt'));
  }
  if (el.name === 'cfmode') {
    const box = $('[data-cf-token]');
    if (box) box.hidden = el.value !== 'token';
  }
  if (el.matches('[data-rm-scope]')) {
    await run(() => api('app', { method: 'PUT', body: { auth: { scope: el.value } } }), t('Gespeichert'));
    await loaders.app();
    render();
  }
});

// ---------------------------------------------------------------- Kunden-Links über den Status-Server (relay/)

function relayHTML() {
  const R = S.relay;
  if (!R) return '';
  const st = R.state || {};
  const row = (label, hint, control) => `<div class="lrow"><div class="lt"><b>${label}</b>${hint ? `<span>${hint}</span>` : ''}</div><div class="lc">${control}</div></div>`;
  return `<h3 class="shead">${t('Kunden-Links')}</h3>
    <div class="sbox">
      ${row(`${t('Status-Server')} ${R.enabled ? (st.ok ? '<i class="pill run">' + t('verbunden') + '</i>' : st.ok === false ? '<i class="pill bad">' + t('Fehler') + '</i>' : '') : '<i class="pill">' + t('aus') + '</i>'}`, t('Kunden-Statusseiten liegen auf eurem eigenen Server – erreichbar von überall, ohne das Heimnetz zu öffnen. PrintDock schickt bei jeder Änderung die Daten (ohne Kosten) und die Fotos der fertigen Teile.'), `<label class="tgl"><input type="checkbox" data-rl-on ${R.enabled ? 'checked' : ''}><span class="sw"></span></label>`)}
      ${st.ok === false && R.enabled ? `<div class="rm-note bad">${esc(t(st.error || ''))}</div>` : ''}
      ${R.enabled && st.ok ? `<div class="rm-note ok">${t('Kunden-Links zeigen auf {u}', { u: `<b>${esc(R.url)}/s/…</b>` })}${st.name ? ` · ${t('Schlüssel „{n}“', { n: esc(st.name) })}` : ''}</div>` : ''}
      ${row(t('Adresse des Status-Servers'), t('z. B. https://eure-domain.de/status – den Ordner „relay/php“ per FTP auf euer Webhosting laden (Anleitung: relay/README.de.md). Eigener Server: relay/server.js oder Docker.'), `<input class="in" data-rl="url" value="${esc(R.url || '')}" placeholder="https://status.example.com" style="min-width:16rem">`)}
      ${row(t('Schlüssel'), t('Wie in RELAY_KEYS auf dem Server.'), `<input class="in" type="password" data-rl="key" value="${esc(R.key || '')}" autocomplete="off" style="max-width:16rem">`)}
      ${row(t('Firmenname auf der Seite'), t('Steht unten auf jeder Statusseite, mit Link.'), `<div class="two"><input class="in" data-rl="bname" value="${esc(R.brand?.name || '')}" placeholder="Meine Werkstatt"><input class="in" data-rl="burl" value="${esc(R.brand?.url || '')}" placeholder="https://…"></div>`)}
      ${row(t('Nach Abschluss erreichbar'), t('So lange bleibt die Seite nach Fertigstellung des Auftrags auf dem Server.'), `<span class="inu"><input class="in" type="number" min="1" max="365" data-rl="keep" value="${esc(R.keepDays)}" style="width:5rem"><span>${t('Tage')}</span></span>`)}
      <div class="st-foot"><button class="b b-sm" data-rlact="test">${t('Verbindung testen')}</button><button class="b b-sm" data-rlact="sync">${t('Alle Links jetzt senden')}</button><button class="b b-sm b-go" data-rlact="save">${t('Speichern')}</button></div>
    </div>`;
}

const rlVal = (k) => $(`[data-rl="${k}"]`)?.value;
async function relaySave(extra = {}) {
  const r = await run(() => api('relay', { method: 'PUT', body: { url: rlVal('url'), key: rlVal('key'), keepDays: rlVal('keep'), brand: { name: rlVal('bname'), url: rlVal('burl') }, ...extra } }), t('Gespeichert'));
  if (r) S.relay = r;
  await loaders.app().catch(() => {});
  reload('relay', 'orders');
  render();
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-rlact]');
  if (!b) return;
  if (b.dataset.rlact === 'save') return relaySave();
  if (b.dataset.rlact === 'test') {
    const r = await run(() => api('relay/test', { method: 'POST' }), t('Status-Server erreichbar'));
    await loaders.relay().catch(() => {});
    return render();
  }
  if (b.dataset.rlact === 'sync') {
    const r = await run(() => api('relay/sync', { method: 'POST' }), t('Gesendet'));
    if (r) S.relay = r;
    render();
  }
});
document.addEventListener('change', (e) => {
  if (e.target.matches('[data-rl-on]')) relaySave({ enabled: e.target.checked });
});

// ---------------------------------------------------------------- Druckportal: Aufträge abholen, Status zurück, Werkstatt live

function portalHTML() {
  const P = S.portal;
  if (!P) return '';
  const st = P.state || {};
  const L = P.last || {};
  const W = P.werkstatt || {};
  const row = (label, hint, control) => `<div class="lrow"><div class="lt"><b>${label}</b>${hint ? `<span>${hint}</span>` : ''}</div><div class="lc">${control}</div></div>`;
  const tgl = (attr, onv) => `<label class="tgl"><input type="checkbox" ${attr} ${onv ? 'checked' : ''}><span class="sw"></span></label>`;
  const pill = P.enabled ? (st.ok ? `<i class="pill run">${t('verbunden')}</i>` : st.ok === false ? `<i class="pill bad">${t('Fehler')}</i>` : '') : `<i class="pill">${t('aus')}</i>`;
  const when = (iso) => iso ? new Date(iso).toLocaleString(S.app?.lang === 'en' ? 'en-GB' : 'de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–';
  const pRows = (W.printers || []).map((p) => `<div class="lrow" data-pw="${esc(p.id)}">
      <div class="lt"><b>${esc(p.printer)}</b><span>${t('Spitzname und Farbe auf der Seite')}</span></div>
      <div class="lc" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input class="in" data-pwf="name" value="${esc(p.nick)}" maxlength="40" aria-label="${esc(t('Spitzname'))}" style="width:9rem">
        <input type="color" data-pwf="color" value="${esc(p.color)}" style="width:2.6rem;height:2.2rem;padding:2px;border-radius:8px">
        ${tgl('data-pwf="show"', p.show)}
      </div></div>`).join('');
  return `<h3 class="shead">${t('Druckportal')}</h3>
    <div class="sbox">
      ${row(`${t('Druckportal')} ${pill}`, t('Bestätigte Aufträge aus deinem Druckportal (z. B. druck.example.com) automatisch übernehmen: Modelldateien in die Bibliothek, Auftrag mit Positionen und Statuslink. Der Fortschritt geht zurück ans Portal. PrintDock verbindet sich dabei nur nach draußen.'), tgl('data-pt-on', P.enabled))}
      ${st.ok === false && P.enabled ? `<div class="rm-note bad">${esc(t(st.error || ''))}</div>` : ''}
      ${P.enabled && st.ok ? `<div class="rm-note ok">${t('Übernommene Aufträge: {n} · zuletzt abgefragt {d}', { n: P.imported, d: when(L.importAt) })}</div>` : ''}
      ${(L.errors || []).length ? `<div class="rm-note bad">${L.errors.map(esc).join('<br>')}</div>` : ''}
      ${row(t('Adresse des Portals'), t('Die Adresse, unter der das Portal läuft – ohne /api.'), `<input class="in" data-pt="url" value="${esc(P.url || '')}" placeholder="https://druck.example.com" style="min-width:16rem">`)}
      ${row(t('API-Schlüssel'), t('Im Portal unter Admin → Einstellungen → Schnittstelle für PrintDock erzeugen.'), `<input class="in" type="password" data-pt="key" value="${esc(P.key || '')}" autocomplete="off" style="max-width:16rem">`)}
      ${row(t('Aufträge übernehmen'), t('Wann ein Auftrag nach PrintDock kommt.'), `<select class="in" data-pt="importWhen"><option value="bestaetigt" ${P.importWhen !== 'bezahlt' ? 'selected' : ''}>${t('sobald der Kunde bestätigt hat')}</option><option value="bezahlt" ${P.importWhen === 'bezahlt' ? 'selected' : ''}>${t('erst wenn als bezahlt markiert')}</option></select>`)}
      ${row(t('Abfragen alle'), t('So oft schaut PrintDock nach neuen Aufträgen.'), `<span class="inu"><input class="in" type="number" min="1" max="60" data-pt="pollMin" value="${esc(P.pollMin)}" style="width:5rem"><span>${t('Minuten')}</span></span>`)}
      ${row(t('Kunden-Links über das Portal'), t('Statusseiten der Aufträge liegen im Portal – der Kunde sieht dort den Fortschritt und Fotos der fertigen Teile. Stellt die Kunden-Links oben auf dieselbe Adresse.'), tgl('data-pt="useRelay"', P.useRelay))}
      <div class="st-foot"><button class="b b-sm" data-ptact="test">${t('Verbindung testen')}</button><button class="b b-sm" data-ptact="sync">${t('Jetzt abholen')}</button><button class="b b-sm b-go" data-ptact="save">${t('Speichern')}</button></div>
    </div>
    <h3 class="shead">${t('Werkstatt live')}</h3>
    <div class="sbox">
      ${row(`${t('Werkstatt live')} ${W.enabled ? (L.werkstattError ? `<i class="pill bad">${t('Fehler')}</i>` : `<i class="pill run">${t('an')}</i>`) : `<i class="pill">${t('aus')}</i>`}`, t('Jede Minute geht ein Schnappschuss der Drucker ans Portal: Spitzname, Status, Fortschritt, Material und Endzeit. Keine Kunden, keine Dateinamen von Kundenaufträgen.'), tgl('data-pw-on', W.enabled))}
      ${L.werkstattError && W.enabled ? `<div class="rm-note bad">${esc(t(L.werkstattError))}</div>` : ''}
      ${W.enabled && L.werkstattAt ? `<div class="rm-note ok">${t('Zuletzt gesendet {d}', { d: when(L.werkstattAt) })}${P.url ? ` · <a href="${esc(P.url.replace(/\/+$/, ''))}/werkstatt.php" target="_blank" rel="noopener">${t('Seite ansehen')}</a>` : ''}</div>` : ''}
      ${row(t('Hinweis über den Druckern'), t('Ein Satz für die Besucher, leer = keiner.'), `<input class="in" data-pw="hinweis" value="${esc(W.hinweis || '')}" maxlength="200" placeholder="${esc(t('Heute laufen vor allem Teile für Balkonkraftwerke.'))}" style="min-width:16rem">`)}
      ${row(t('Namen eigener Teile zeigen'), t('Bei eigenen Teilen den Teil- bzw. Dateinamen zeigen. Kundenaufträge erscheinen immer nur als „Kundenauftrag“.'), tgl('data-pw="ownNames"', W.ownNames))}
      ${pRows}
      <div class="st-foot"><button class="b b-sm" data-ptact="werkstatt">${t('Jetzt senden')}</button><button class="b b-sm b-go" data-ptact="wsave">${t('Speichern')}</button></div>
    </div>`;
}

const ptVal = (k) => { const el = $(`[data-pt="${k}"]`); return el?.type === 'checkbox' ? el.checked : el?.value; };
function pwBody(extra = {}) {
  const printers = {};
  for (const r of document.querySelectorAll('[data-pw]')) {
    if (!r.matches('.lrow')) continue;
    const f = (k) => r.querySelector(`[data-pwf="${k}"]`);
    printers[r.dataset.pw] = { name: f('name').value, color: f('color').value, show: f('show').checked };
  }
  const el = (k) => $(`[data-pw="${k}"]`);
  return { werkstatt: { hinweis: el('hinweis')?.value, ownNames: el('ownNames')?.checked, printers, ...extra } };
}
async function portalSave(body) {
  const r = await run(() => api('portal', { method: 'PUT', body }), t('Gespeichert'));
  if (r) S.portal = r;
  reload('relay', 'orders', 'portal');
  render();
}
const portalBody = (extra = {}) => ({ url: ptVal('url'), key: ptVal('key'), importWhen: ptVal('importWhen'), pollMin: ptVal('pollMin'), useRelay: ptVal('useRelay'), ...extra });

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-ptact]');
  if (!b) return;
  const act = b.dataset.ptact;
  if (act === 'save') return portalSave(portalBody());
  if (act === 'wsave') return portalSave(pwBody());
  const ok = { test: t('Druckportal erreichbar'), sync: t('Abgefragt'), werkstatt: t('Gesendet') }[act];
  const r = await run(() => api(`portal/${act}`, { method: 'POST' }), ok);
  if (r) S.portal = r;
  reload('orders');
  render();
});
document.addEventListener('change', (e) => {
  if (e.target.matches('[data-pt-on]')) portalSave(portalBody({ enabled: e.target.checked }));
  if (e.target.matches('[data-pw-on]')) portalSave(pwBody({ enabled: e.target.checked }));
});
