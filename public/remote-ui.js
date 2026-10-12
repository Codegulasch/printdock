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
