'use strict';
/* PrintDock – Einstellungen: Home Assistant und Demo-Daten. Ergänzt app.js. */

S.haEntities = null;

async function loadHaEntities() {
  try {
    S.haEntities = await api('ha/entities');
  } catch {
    S.haEntities = [];
  }
  return S.haEntities;
}

/**
 * Auswahlliste für schaltbare Entitäten (gruppiert nach Bereich). Der Wert steht im Textfeld `name`,
 * damit Formulare ihn wie bisher lesen; „Andere Entität …“ blendet das Textfeld zum Eintippen ein.
 */
function entityPickerHTML(name, value, cls = '', list = undefined, noneLabel = null) {
  const src = list === undefined ? S.haEntities : list;
  const ents = src || [];
  const val = value || '';
  const input = (show) => `<input class="${cls}" style="width:100%;${show ? '' : 'display:none'}" name="${name}" value="${esc(val)}" placeholder="${name === 'humidityEntity' ? 'sensor.trockenbox_feuchte' : 'switch.drucker_werkstatt'}" autocomplete="off">`;
  if (!ents.length) {
    const hint = src === null && S.haEntLoading ? t('Entitäten werden geladen …') : t('Keine Entitäten gefunden – Verbindung zu Home Assistant prüfen oder von Hand eintragen.');
    return `<div class="epick">${input(true)}<div class="meta" style="margin-top:3px">${hint}</div></div>`;
  }
  const known = ents.some((e) => e.entity_id === val);
  const stateTxt = (st) => (st === 'on' ? t('an') : st === 'off' ? t('aus') : st === 'unavailable' ? t('nicht erreichbar') : st);
  const groups = {};
  for (const e of ents) (groups[e.area || t('Ohne Bereich')] ||= []).push(e);
  const opts = Object.entries(groups).map(([area, list]) => `<optgroup label="${esc(area)}">${list.map((e) => `<option value="${esc(e.entity_id)}" ${e.entity_id === val ? 'selected' : ''}>${esc(e.name)} (${esc(stateTxt(e.state))}) · ${esc(e.entity_id)}</option>`).join('')}</optgroup>`).join('');
  return `<div class="epick"><select class="${cls}" style="width:100%" data-epick>
      <option value="" ${!val ? 'selected' : ''}>${noneLabel || t('– keine Steckdose –')}</option>
      ${val && !known ? `<option value="${esc(val)}" selected>${esc(val)} (${t('nicht gefunden')})</option>` : ''}
      ${opts}
      <option value="__other">${t('Andere Entität eintragen …')}</option>
    </select>${input(false)}</div>`;
}

document.addEventListener('change', (e) => {
  const sel = e.target.closest?.('[data-epick]');
  if (!sel) return;
  const input = sel.parentElement.querySelector('input');
  if (sel.value === '__other') {
    input.style.display = '';
    input.value = '';
    input.focus();
  } else {
    input.style.display = 'none';
    input.value = sel.value;
  }
});

function haStatusHTML(st, okText) {
  if (!st) return `<span class="meta">${t('nicht eingerichtet')}</span>`;
  if (st === 'ok') return `<span class="vl ok">${esc(okText)}</span>`;
  if (/Verbinde/.test(st)) return `<span class="meta">${esc(t(st))}</span>`;
  return `<span class="vl bad">${esc(t(st))}</span>`;
}

function vHa() {
  const h = S.ha;
  if (!h) return `<div class="empty">${t('Lade …')}</div>`;
  const rows = S.printers.map((p) => {
    const st = p.settings || {};
    const pw = p.power === 'on' ? t('an') : p.power === 'off' ? t('aus') : t('nicht erreichbar');
    return `<div class="row" style="grid-template-columns:minmax(140px,1fr) minmax(200px,1.4fr) 110px 90px 90px auto" data-pp="${p.id}">
      <div class="c-main"><b>${esc(p.name)}</b><div class="meta">${p.power ? `${t('Steckdose')}: <b>${pw}</b>` : t('keine Steckdose')}</div></div>
      <div><span class="lbl">${t('Entität')}</span>${entityPickerHTML('powerEntity', st.powerEntity, 'in')}</div>
      <label class="meta" style="display:flex;gap:6px;align-items:center"><input type="checkbox" name="autoOff" ${st.autoOff ? 'checked' : ''}> ${t('Auto-Aus')}</label>
      <div><span class="lbl">${t('nach Min.')}</span><input class="in" style="width:80px" type="number" min="1" name="autoOffDelay" value="${esc(st.autoOffDelay || 10)}" title="${esc(t('Minuten nach Druckende'))}"></div>
      <div><span class="lbl">${t('unter °C')}</span><input class="in" style="width:80px" type="number" min="30" name="autoOffMaxTemp" value="${esc(st.autoOffMaxTemp || 50)}" title="${esc(t('erst ausschalten, wenn die Düse kühler ist'))}"></div>
      <div class="acts"><button class="b b-sm b-done" data-hact="savePower" data-id="${p.id}">${t('Speichern')}</button></div></div>`;
  }).join('');
  const m = h.mqtt;
  const example = S.printers[0] ? S.printers[0].name.toLowerCase().replace(/[^a-z0-9]+/g, '_') : 'werkstatt_x2d';
  let n = 0;
  const num = () => `${++n}. `;
  // Als Add-on: Verbindung und Broker sind automatisch – nur der Status oben, keine Eingaben
  const addonHead = h.addon ? `<div class="card" style="margin-bottom:18px"><b>${t('PrintDock läuft als Home-Assistant-Add-on')}</b> – ${t('Verbindung und MQTT-Broker werden automatisch eingerichtet.')}
      <div class="meta" style="margin-top:6px">Home Assistant: ${haStatusHTML(h.status.rest || 'ok', t('verbunden'))} · MQTT: ${h.mqttAuto ? haStatusHTML(m.enabled ? h.status.mqtt : null, t('verbunden')) + (m.enabled ? '' : ` (${t('Geräte unten einschalten')})`) : `<span class="vl warn">${t('kein Broker gefunden – Mosquitto-Add-on installieren')}</span>`}</div></div>` : '';
  return `<div class="page-head"><h1>${NAV_ICON.gear}Home Assistant</h1></div>
    ${addonHead}
    ${h.addon ? '' : `<section class="sec"><h3>${num()}${t('Verbindung')}</h3>
      <p class="intro">${t('Für das Schalten der Drucker braucht PrintDock Zugriff auf Home Assistant: Adresse und ein Langzeit-Zugriffstoken (in Home Assistant unten links auf dein Profil → Sicherheit → „Token erstellen“).')}</p>
      <div class="card"><div class="kv" style="grid-template-columns:minmax(140px,200px) 1fr">
        <div>${t('Adresse')}</div><input class="in" id="haUrl" value="${esc(h.url)}" placeholder="http://homeassistant.local:8123">
        <div>${t('Token')}</div><input class="in" id="haToken" type="password" value="${esc(h.token)}" placeholder="eyJhbGciOi…">
      </div><div class="btns"><button class="b b-sm b-done" data-hact="saveConn">${t('Speichern und testen')}</button><span class="meta" style="align-self:center">${t('Status')}: ${haStatusHTML(h.status.rest, t('verbunden'))}</span></div></div>
    </section>`}
    <section class="sec"><h3>${num()}${t('Drucker ein- und ausschalten')}</h3>
      <p class="intro">${t('Steckdose wählen – dann gibt es auf der Druckerkarte einen Ein/Aus-Knopf. Auto-Aus schaltet nach dem Druck ab, sobald die Düse abgekühlt ist.')}</p>
      <div class="list">${rows || `<div class="empty">${t('Noch kein Drucker angelegt.')}</div>`}</div>
    </section>
    <section class="sec"><h3>${num()}${t('PrintDock in Home Assistant anzeigen')}</h3>
      <p class="intro">${t('Jeder Drucker erscheint in Home Assistant als Gerät mit Status, Temperaturen, Kamera und Knöpfen – Grundlage für Automationen und die Dashboard-Karten.')}</p>
      <div class="card"><div class="kv" style="grid-template-columns:minmax(140px,200px) 1fr">
        <div>${t('MQTT-Geräte')}</div><label class="meta" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="mqEnabled" ${m.enabled ? 'checked' : ''}> ${t('einschalten')}</label>
        ${h.addon && h.mqttAuto ? `<div>${t('Broker')}</div><div class="meta" style="align-self:center">${esc(t('automatisch: {h}', { h: h.mqttAuto.host }))}</div>` : `
        <div>${t('Broker')}</div><input class="in" id="mqUrl" value="${esc(m.url)}" placeholder="${h.mqttAuto ? esc(t('automatisch: {h}', { h: h.mqttAuto.host })) : 'mqtt://192.168.1.10:1883'}">
        <div>${t('Benutzer')}</div><input class="in" id="mqUser" value="${esc(m.username)}" placeholder="${h.mqttAuto ? t('automatisch') : t('optional')}">
        <div>${t('Passwort')}</div><input class="in" id="mqPass" type="password" value="${esc(m.password)}">`}
      </div>
      <details class="adv"><summary>${t('Erweitert')}</summary><div class="kv" style="grid-template-columns:minmax(140px,200px) 1fr;margin-top:8px">
        <div>${t('PrintDock-Adresse')}</div><input class="in" id="haPublic" value="${esc(h.publicUrl)}" placeholder="${esc(h.directUrl)}">
        <div>${t('Discovery-Präfix')}</div><input class="in" id="mqPrefix" value="${esc(m.discoveryPrefix)}">
        <div>${t('Basis-Topic')}</div><input class="in" id="mqBase" value="${esc(m.baseTopic)}">
      </div><p class="meta">${t('Die PrintDock-Adresse nutzt Home Assistant für den Link „Gerät besuchen“. Leer lassen = automatisch ({u}).', { u: esc(h.directUrl) })}</p></details>
      <div class="btns"><button class="b b-sm b-done" data-hact="saveMqtt">${t('Speichern')}</button><span class="meta" style="align-self:center">${t('Status')}: ${haStatusHTML(h.status.mqtt, t('verbunden – Geräte sind angemeldet'))}</span></div></div>
    </section>
    ${h.addon ? '' : `<section class="sec"><h3>${num()}${t('PrintDock in der Home-Assistant-Seitenleiste')}</h3>
      <div class="cards">
        <div class="card"><h3>${t('Als Add-on (empfohlen)')}</h3><p class="meta">${t('PrintDock läuft dann direkt in Home Assistant, mit eigenem Eintrag in der Seitenleiste, automatischer Verbindung und Datensicherung.')}</p>
          <ol style="margin:8px 0 0;padding-left:20px;line-height:1.6"><li>${t('Einstellungen → Add-ons → Add-on-Store → ⋮ → Repositories')}</li><li>${t('Adresse deines PrintDock-GitHub-Repositorys eintragen')}</li><li>${t('„PrintDock“ installieren, starten, „In Seitenleiste anzeigen“')}</li></ol></div>
        <div class="card"><h3>${t('Als Dashboard-Seite')}</h3><p class="meta">${t('Läuft PrintDock woanders (NAS, Raspberry Pi, PC), lässt es sich als Webseite einbinden: Einstellungen → Dashboards → Dashboard hinzufügen → Webseite → Adresse:')}</p>
          <p><span class="code">${esc(h.directUrl)}</span> <button class="b b-sm" data-act="copy" data-text="${esc(h.directUrl)}">${t('Kopieren')}</button></p>
          <p class="meta">${t('Funktioniert nur, wenn Home Assistant und PrintDock gleich erreichbar sind (beide http oder beide https).')}</p></div>
      </div>
    </section>`}
    <section class="sec"><h3>${num()}${t('PrintDock-Karten im Dashboard')}</h3>
      <p class="intro">${t('„PrintDock Card“ zeigt einen Drucker, „PrintDock Overview“ alle Drucker mit Warteschlange, Aufträgen, Spulen und Wartung. Braucht die MQTT-Geräte.')}</p>
      <div class="cards">
        <div class="card"><h3>${t('Einrichten')}</h3>
          ${h.addon
            ? cardStateHTML(h)
            : `<p class="meta">${t('Am einfachsten über HACS: Benutzerdefiniertes Repository hinzufügen, Typ „Dashboard“, dann „PrintDock Card“ installieren. Oder hier eintragen lassen (Verbindung aus Schritt 1 nötig):')}</p>
              <div class="btns"><button class="b b-sm b-done" data-hact="card">${t('In Home Assistant eintragen')}</button></div>
              <p class="meta">${t('Von Hand: Einstellungen → Dashboards → ⋮ → Ressourcen → Ressource hinzufügen, Typ „JavaScript-Modul“:')}<br><span class="code">${esc(h.directUrl)}/printdock-card.js</span></p>
              <p class="meta">${t('Läuft Home Assistant über https, blockiert der Browser eine http-Adresse – dann HACS nutzen.')}</p>`}
        </div>
        <div class="card"><h3>${t('Beispiel')}</h3><p class="meta">${t('Im Dashboard „Karte hinzufügen“ → „PrintDock Card“ wählen – oder als YAML:')}</p>
<pre class="code" style="white-space:pre-wrap;font-size:12.5px">type: custom:printdock-card
entity: sensor.${esc(example)}_status
show_camera: true
show_fans: false

type: custom:printdock-overview-card
sections: [printers, queue, orders, spools, maintenance]</pre></div>
      </div>
    </section>`;
}

/** Add-on: Stand der automatischen Karten-Einrichtung */
function cardStateHTML(h) {
  const c = h.card || {};
  const again = `<button class="b b-sm" data-hact="card">${t('Erneut einrichten')}</button>`;
  if (c.state === 'ok') return `<p class="meta"><span class="vl ok">${t('Eingerichtet')}</span> – ${t('die Karten stehen im Dashboard unter „Karte hinzufügen“. Falls nicht: Browser einmal neu laden (Strg+F5), in der App den Frontend-Cache leeren.')}</p><div class="btns">${again}</div>`;
  if (c.state === 'restart') return `<p class="meta"><span class="vl warn">${t('Neustart nötig')}</span> – ${t('Die Karten sind kopiert. Home Assistant liefert den Ordner „www“ erst nach einem Neustart aus.')}</p><div class="btns"><button class="b b-sm b-done" data-hact="restartHa">${t('Home Assistant neu starten')}</button>${again}</div>`;
  if (c.state === 'yaml') return `<p class="meta"><span class="vl warn">${t('Von Hand eintragen')}</span> – ${t('Deine Dashboards laufen im YAML-Modus. Diese Zeilen in die configuration.yaml unter lovelace: eintragen:')}</p>
<pre class="code" style="white-space:pre-wrap;font-size:12.5px">resources:
  - url: ${esc(c.url || '/local/printdock/printdock-card.js')}
    type: module</pre><div class="btns">${again}</div>`;
  if (c.state === 'error') return `<p class="meta"><span class="vl bad">${t('Fehler')}</span> – ${esc(c.error)}</p><div class="btns">${again}</div>`;
  if (c.state === 'working') return `<p class="meta">${t('Wird eingerichtet …')}</p>`;
  return `<p class="meta">${t('Das Add-on richtet die Karten beim Start selbst ein.')}</p><div class="btns">${again}</div>`;
}

function vDemo() {
  const loaded = S.printers.some((p) => p.demo);
  return `<div class="page-head"><h1>${NAV_ICON.gear}${t('Demo-Daten')}</h1></div>
    <div class="card" style="max-width:820px">
      <p style="margin-top:0">${t('Die Demo spielt einen kompletten, laufenden Druckerpark ein – ideal zum Ausprobieren, Zeigen oder Testen:')}</p>
      <ul style="line-height:1.7;margin:0 0 12px">
        <li>${t('5 simulierte Drucker: Bambu X2D mit AMS (druckt), Snapmaker U1 mit 4 Werkzeugen (druckt), Anycubic Kobra S1 mit ACE (fertig, Platte räumen), Voron 2.4 (bereit), Bambu A1 (pausiert, Filament leer)')}</li>
        <li>${t('9 Dateien mit Vorschaubildern, Druckzeit und Filament')}</li>
        <li>${t('20 Spulen – teils in AMS/ACE/Werkzeugen, teils im Lager, zwei davon knapp')}</li>
        <li>${t('4 Aufträge inklusive einem überfälligen, dazu eine gefüllte Warteschlange')}</li>
        <li>${t('30 Tage Verlauf mit Filamentverbrauch und Kosten, Wartungsaufgaben (teils fällig)')}</li>
      </ul>
      <p class="meta">${t('Demo-Einträge sind markiert und lassen sich jederzeit restlos entfernen. Eigene Drucker, Dateien und Einstellungen bleiben unberührt.')}</p>
      <div class="btns">${loaded
        ? `<button class="b b-fault" data-hact="demoRemove">${t('Demo-Daten entfernen')}</button><button class="b" data-view="board">${t('Zu den Druckern')}</button>`
        : `<button class="b b-go" data-hact="demoLoad">${ICON.plus}${t('Demo-Daten einspielen')}</button>`}</div>
      <p class="meta" style="margin-bottom:0">${loaded ? t('Status: Demo-Daten sind geladen.') : t('Status: keine Demo-Daten geladen.')} ${t('Die Demo-Kamera braucht ffmpeg (im Docker-Image und Add-on enthalten).')}</p>
    </div>`;
}

Object.assign(VIEW_FN, { ha: vHa, demo: vDemo });

// Beim Öffnen der HA-Seite Entitäten laden
const _render = render;
// eslint-disable-next-line no-global-assign
render = function renderWithHa() {
  _render();
  if (S.view === 'ha' && S.haEntities === null && !S.haEntLoading && S.ha && (S.ha.addon || S.ha.url)) {
    S.haEntLoading = true;
    loadHaEntities().then(() => { S.haEntLoading = false; if (S.view === 'ha') _render(); });
  }
};

async function loadDemo(btn) {
  if (btn) {
    btn.disabled = true;
    btn.textContent = t('Wird eingespielt …');
  }
  const r = await run(() => api('demo/load', { method: 'POST' }));
  if (r) toast(t('Demo geladen: {p} Drucker, {f} Dateien, {s} Spulen, {o} Aufträge', { p: r.printers, f: r.files, s: r.spools, o: r.orders }));
  reload(...Object.keys(loaders));
  return r;
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-hact]');
  if (!el || el.disabled) return;
  const act = el.dataset.hact;
  if (act === 'saveConn') {
    el.disabled = true;
    const r = await run(() => api('ha', { method: 'PUT', body: { url: $('#haUrl').value, token: $('#haToken').value } }));
    if (r) {
      S.ha = r;
      const ok = await run(() => api('ha/test', { method: 'POST' }), t('Verbindung zu Home Assistant steht'));
      if (ok) {
        S.haEntities = null;
        S.ha = await api('ha');
      }
    }
    return render();
  }
  if (act === 'saveMqtt') {
    el.disabled = true;
    const r = await run(() => api('ha', {
      method: 'PUT',
      body: {
        publicUrl: $('#haPublic').value,
        mqtt: { enabled: $('#mqEnabled').checked, url: $('#mqUrl')?.value, username: $('#mqUser')?.value, password: $('#mqPass')?.value, discoveryPrefix: $('#mqPrefix').value, baseTopic: $('#mqBase').value },
      },
    }), t('Gespeichert'));
    if (r) S.ha = r;
    setTimeout(() => reload('ha'), 2500);
    return render();
  }
  if (act === 'savePower') {
    const p = printerById(el.dataset.id);
    const row = el.closest('[data-pp]');
    const settings = {
      ...p.settings,
      powerEntity: $('[name=powerEntity]', row).value.trim(),
      autoOff: $('[name=autoOff]', row).checked,
      autoOffDelay: $('[name=autoOffDelay]', row).value,
      autoOffMaxTemp: $('[name=autoOffMaxTemp]', row).value,
    };
    if (settings.powerEntity && !/^(switch|light|input_boolean)\.\w+$/.test(settings.powerEntity)) return toast(t('Bitte eine Entität wie switch.drucker_werkstatt eintragen'), true);
    await run(() => api(`printers/${p.id}`, { method: 'PUT', body: { name: p.name, driver: p.driver, config: p.config, settings } }), t('Gespeichert'));
    return reload('printers');
  }
  if (act === 'card') {
    el.disabled = true;
    const r = await run(() => api('ha/card', { method: 'POST' }), S.ha?.addon ? null : t('Karten in Home Assistant eingetragen – Dashboard neu laden'));
    S.ha = await api('ha').catch(() => S.ha);
    return render();
  }
  if (act === 'restartHa') {
    if (!confirm(t('Home Assistant jetzt neu starten? Das dauert etwa eine Minute.'))) return;
    el.disabled = true;
    await run(() => api('ha/restart', { method: 'POST' }), t('Home Assistant startet neu – danach Browser neu laden'));
    return;
  }
  if (act === 'demoLoad') {
    await loadDemo(el);
    return setView('board');
  }
  if (act === 'demoRemove') {
    if (!(await confirmBox(t('Demo-Daten entfernen'), t('Alle Demo-Drucker, -Dateien, -Spulen, -Aufträge und den Demo-Verlauf löschen? Eigene Daten bleiben erhalten.'), t('Entfernen'), 'b-fault'))) return;
    await run(() => api('demo/remove', { method: 'POST' }), t('Demo-Daten entfernt'));
    return reload(...Object.keys(loaders));
  }
});
