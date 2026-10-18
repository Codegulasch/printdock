/* PrintDock – RFID/NFC-Tags mit dem Handy lesen (Web NFC, Chrome auf Android).
   Schreiben: tagWriteDialog() in filament-ui.js („Dieses Handy (NFC)“). */

function nfcSupport() {
  if (!('NDEFReader' in window)) {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    return { ok: false, reason: ios ? 'ios' : 'browser' };
  }
  if (!window.isSecureContext) return { ok: false, reason: 'https' };
  return { ok: true };
}

const NFC_WHY = {
  ios: 'Auf dem iPhone erlaubt Apple Webseiten keinen Zugriff auf NFC. Spulen-Etiketten mit QR-Code funktionieren dort, ebenso Tags, die einen Link enthalten (iPhone öffnet ihn von selbst).',
  browser: 'Dieser Browser kann kein NFC. Auf Android-Handys geht es mit Chrome.',
  https: 'NFC funktioniert nur über eine sichere Verbindung (https://). PrintDock über Home Assistant (Nabu Casa), Tailscale (HTTPS einschalten) oder einen Cloudflare Tunnel öffnen – siehe Einstellungen → Fernzugriff.',
};

/** Seriennummer „04:a1:b2:…“ → „04A1B2…“ */
const nfcUid = (sn) => String(sn || '').toUpperCase().replace(/[^0-9A-F]/g, '');

function nfcRecords(message) {
  const out = { url: null, openspool: null, records: 0 };
  const dec = new TextDecoder();
  for (const r of message?.records || []) {
    out.records += 1;
    try {
      if (r.recordType === 'url' || r.recordType === 'absolute-url') out.url = dec.decode(r.data);
      else if (r.recordType === 'mime' && /json/i.test(r.mediaType || '')) out.openspool = dec.decode(r.data);
      else if (r.recordType === 'text' && /openspool/i.test(dec.decode(r.data))) out.openspool = dec.decode(r.data);
    } catch { /* unlesbarer Eintrag */ }
  }
  return out;
}

/** Dialog: Tag ans Handy halten → Spule öffnen bzw. neu anlegen/zuordnen */
async function nfcScanDialog() {
  const sup = nfcSupport();
  if (!sup.ok) {
    openDialog(`<div class="dlg"><h2>📱 ${t('Tags mit dem Handy lesen')}</h2><p style="margin:0">${t(NFC_WHY[sup.reason])}</p>
      <p class="meta" style="margin:0">${t('Bambu-Original-Tags sind verschlüsselt: PrintDock kann nur die Kennung lesen (je nach Handy) und erkennt die Spule daran wieder. Beschreiben lassen sich NTAG213/215/216-Sticker.')}</p>
      <div class="dlg-actions"><button class="b" data-close>${t('OK')}</button></div></div>`);
    return;
  }
  const ctrl = new AbortController();
  const d = openDialog(`<div class="dlg"><h2>📱 ${t('Tag lesen')}</h2>
    <div class="nfc-wait"><span class="nfc-pulse"></span><b>${t('Tag an die Rückseite des Handys halten …')}</b></div>
    <p class="meta" style="margin:0" data-nfc-state>${t('Spulen-Tag oder Sticker. Bekannte Spulen öffnen sich, neue lassen sich gleich anlegen.')}</p>
    <div class="dlg-actions"><button class="b" data-close>${t('Abbrechen')}</button></div></div>`);
  d.addEventListener('close', () => ctrl.abort());
  const state = (txt, bad = false) => { const el = $('[data-nfc-state]', d); if (el) { el.textContent = txt; el.style.color = bad ? 'var(--fault)' : ''; } };
  try {
    const r = new NDEFReader();
    await r.scan({ signal: ctrl.signal });
    r.addEventListener('readingerror', () => state(t('Tag nicht lesbar – z. B. Bambu-Original-Tag auf diesem Handy. Nochmal versuchen oder QR-Code nutzen.'), true));
    r.addEventListener('reading', async (ev) => {
      const rec = nfcRecords(ev.message);
      try {
        const res = await api('rfid/phone', { method: 'POST', body: { uid: nfcUid(ev.serialNumber), ...rec } });
        ctrl.abort();
        d.close();
        if (res.known) {
          toast(t('{nr} erkannt', { nr: res.spool.nr }));
          await loaders.filament();
          location.hash = `spool=${encodeURIComponent(res.spool.nr)}`;
        } else {
          toast(res.data ? t('Neue Spule auf dem Tag – bitte anlegen') : t('Unbekannter Tag – Spule anlegen oder zuordnen'));
          if (S.view !== 'spools') setView('spools');
          reload('filament');
        }
      } catch (err) {
        state(err.message, true);
      }
    });
  } catch (err) {
    if (err.name === 'AbortError') return;
    state(err.name === 'NotAllowedError' ? t('NFC-Zugriff wurde nicht erlaubt – in den Chrome-Einstellungen für diese Seite erlauben.') : t('NFC: {e}', { e: err.message }), true);
  }
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-nfc="scan"]')) nfcScanDialog();
});
