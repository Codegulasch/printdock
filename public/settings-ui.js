/* PrintDock – Einstellungen mit eigener Seitennavigation (links), Inhalte als Karten.
   „Drucker & Filament“ fasst zusammen, was zur Werkstatt gehört: Drucker, Druckstart (Druckplatte),
   Filament mit Spoolman und Etiketten sowie Feuchte & Trocknen. */

const SET_ICON = {
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg>',
  slicer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M4 12h16M4 17h10"/><path d="m17 15 3 2-3 2"/></svg>',
  station: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="13" width="16" height="7" rx="1.5"/><circle cx="12" cy="8" r="4"/><circle cx="12" cy="8" r="1.2"/></svg>',
  system: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6H9zM9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/></svg>',
};

/** Navigation in den Einstellungen: [Ansicht, Bezeichnung, Symbol, Beschreibung] */
const SET_NAV = [
  ['general', 'Allgemein', NAV_ICON.gear, 'Sprache, Aussehen, Funktionen'],
  ['workshop', 'Drucker & Filament', NAV_ICON.printer, 'Drucker, Druckstart, Filament, Feuchte & Trocknen'],
  ['station', 'PrintDock Station', SET_ICON.station, 'NFC-Leser und Waage'],
  ['notify', 'Benachrichtigungen', SET_ICON.bell, 'Wohin Meldungen gehen'],
  ['ha', 'Home Assistant', SET_ICON.home, 'Steckdosen, Karten, Sensoren'],
  ['slicer', 'Slicer', SET_ICON.slicer, 'Aus OrcaSlicer & Co. senden'],
  ['system', 'System', SET_ICON.system, 'Updates, Sicherung, Zugang'],
];

/** Seitenkopf eines Inhalts entfernen (die Einstellungsseite hat ihre eigene Überschrift) */
const noHead = (html) => String(html).replace(/^\s*<div class="page-head">[\s\S]*?<\/div>/, '');

function settingsShell(view, inner) {
  const avail = viewsAvailable();
  const nav = SET_NAV.filter(([k]) => avail.includes(k)).map(([k, l, ic, d]) => `<button class="sn-i" data-view="${k}" aria-current="${S.view === k ? 'page' : 'false'}">${ic}<span><b>${esc(t(l))}</b><small>${esc(t(d))}</small></span></button>`).join('');
  return `<div class="set-wrap">
    <aside class="set-nav"><div class="set-title"><h1>${NAV_ICON.gear}${t('Einstellungen')}</h1><span>${t('PrintDock einrichten')}</span></div><nav>${nav}</nav></aside>
    <div class="set-main">${inner}</div></div>`;
}

/** Abschnitt mit Überschrift und Sprungmarke */
const setSection = (id, title, body, action = '') => `<section class="set-sec" id="${id}"><div class="set-sh"><h2>${esc(title)}</h2>${action}</div>${body}</section>`;

function vWorkshop() {
  const a = S.app || {};
  const parts = [['ws-printers', t('Drucker#pl')], ['ws-start', t('Druckstart')]];
  if (on('filament')) parts.push(['ws-fil', t('Filament')], ['ws-hum', t('Feuchte & Trocknen')]);
  const jump = `<div class="set-jump">${parts.map(([id, l]) => `<button class="chip" data-anchor="${id}">${esc(l)}</button>`).join('')}</div>`;
  const printers = setSection('ws-printers', t('Drucker#pl'), noHead(VIEW_FN.printers()), `<button class="b b-sm b-go" data-act="editPrinter">${ICON.plus}${t('Drucker hinzufügen')}</button>`);
  const start = setSection('ws-start', t('Druckstart'), `<div class="sbox">
      ${lrow(t('Druckplatte abfragen'), t('Vor jedem Start aus Warteschlange oder Auftrag bestätigen, dass die Platte geräumt ist.'), `<label class="tgl"><input type="checkbox" data-g-plate ${a.plateCheck ? 'checked' : ''}><span class="sw"></span></label>`)}
      ${on('queue') ? lrow(t('Automatisch starten'), t('Je Drucker unter „Drucker“ einstellbar: der nächste Druck startet, sobald die Platte frei ist.'), `<span class="meta">${t('{n} von {m} Druckern', { n: S.printers.filter((p) => p.settings?.autoStart).length, m: S.printers.length })}</span>`) : ''}
    </div>`);
  const fil = on('filament') ? setSection('ws-fil', t('Filament'), noHead(vFilSettings())) : '';
  const hum = on('filament') ? setSection('ws-hum', t('Feuchte & Trocknen'), noHead(vHumSettings())) : '';
  return `<div class="page-head"><h1>${t('Drucker & Filament')}</h1></div>${jump}${printers}${start}${fil}${hum}`;
}

// Einstellungsansichten in die Hülle setzen
for (const k of ['general', 'station', 'notify', 'ha', 'slicer', 'system']) {
  const raw = VIEW_FN[k];
  if (raw) VIEW_FN[k] = () => settingsShell(k, raw());
}
VIEW_FN.workshop = () => settingsShell('workshop', vWorkshop());

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-anchor]');
  if (!el) return;
  document.getElementById(el.dataset.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
