/* PrintDock – Einstellungen → System → Speicherort: Druckdateien, Fotos und Sicherungen auf ein NAS legen.
   Drei Arten: Datenordner, SMB-Freigabe direkt (Server/Freigabe/Benutzer/Passwort), eingehängter Ordner. */

loaders.storage = async () => (S.storage = S.app?.me?.role === 'operator' ? null : await api('storage'));

const FOLDER_HINT = {
  addon: 'Ein in Home Assistant eingebundener Netzwerkspeicher (Einstellungen → System → Speicher, Verwendung „Freigabe“) erscheint hier als /share/<Name>.',
  docker: 'Den NAS-Ordner auf dem Host einhängen und in der docker-compose.yml als Volume durchreichen, z. B. „- /mnt/nas/printdock:/nas“ – dann hier /nas eintragen.',
  linux: 'Das NAS per /etc/fstab einhängen (cifs oder nfs), z. B. nach /mnt/nas – dann hier /mnt/nas/printdock eintragen.',
  windows: 'Netzwerkpfad oder zweite Platte, z. B. D:\\PrintDock. Für ein NAS ist „SMB-Freigabe“ einfacher.',
  mac: 'Die Freigabe im Finder verbinden (⌘K, smb://nas/drucken) – dann hier /Volumes/drucken/printdock eintragen.',
};

const mbTxt = (mb) => (mb == null ? '' : mb >= 1024 ? `${fnum(mb / 1024, 1)} GB` : `${mb} MB`);

function storageDraftFrom(v) {
  return {
    mode: v.mode, path: v.path || '', files: v.files, photos: v.photos, backups: v.backups,
    smb: { server: v.smb?.server || '', share: v.smb?.share || '', dir: v.smb?.dir || '', user: v.smb?.user || '', password: '', domain: v.smb?.domain || '' },
  };
}

function storageChanged(d, v) {
  if (d.mode !== v.mode || d.files !== v.files || d.photos !== v.photos || d.backups !== v.backups) return true;
  if (d.mode === 'folder') return d.path !== (v.path || '');
  if (d.mode === 'smb') {
    const s = v.smb || {};
    return ['server', 'share', 'dir', 'user', 'domain'].some((k) => (d.smb[k] || '') !== (s[k] || '')) || Boolean(d.smb.password);
  }
  return false;
}

function storageHTML() {
  const v = S.storage;
  if (!v) return '';
  // Entwurf nur behalten, solange der Nutzer etwas geändert hat – sonst immer den gespeicherten Stand zeigen
  if (!S.storageDirty || !S.storageDraft) S.storageDraft = storageDraftFrom(v);
  const d = S.storageDraft;
  const mv = v.moving;
  const dis = mv ? 'disabled' : '';
  const changed = storageChanged(d, v);
  const test = S.storageTest;
  const modes = [['local', 'Datenordner', 'So wie bisher – alles bleibt bei PrintDock.'], ['smb', 'SMB-Freigabe (NAS)', 'Direkt mit Server, Freigabe, Benutzer und Passwort – ohne Einhängen, ohne Home Assistant.'], ['folder', 'Eingehängter Ordner', 'Ein Ordner, der auf diesem Rechner schon erreichbar ist.']];
  const modePick = `<div class="pmode-opts">${modes.map(([m, l, h]) => `<label class="pmode-opt"><input type="radio" name="stmode" value="${m}" ${d.mode === m ? 'checked' : ''} ${dis}><span><b>${t(l)}</b><small>${t(h)}</small></span></label>`).join('')}</div>`;
  const smbFields = d.mode === 'smb' ? `
      ${!v.smbclient ? `<div class="srow"><div class="sl"><b class="warn-txt">${t('smbclient fehlt')}</b><span>${t('Pi/Linux: „sudo apt install smbclient“ · macOS: „brew install samba“ – danach PrintDock neu starten.')}</span></div></div>` : ''}
      ${srow(t('Server'), t('IP-Adresse des NAS (zuverlässiger als der Name), z. B. 192.168.1.20'), `<input class="in" data-stsmb="server" value="${esc(d.smb.server)}" placeholder="192.168.1.20" autocomplete="off" ${dis}>`)}
      ${srow(t('Freigabe'), t('Nur der Name der Freigabe, z. B. „printdock“ – nicht der Pfad auf dem NAS (/mnt/tank/…).'), `<input class="in" data-stsmb="share" value="${esc(d.smb.share)}" placeholder="printdock" autocomplete="off" ${dis}>`)}
      ${srow(t('Unterordner'), t('optional, z. B. „werkstatt“ – wird angelegt'), `<input class="in" data-stsmb="dir" value="${esc(d.smb.dir)}" autocomplete="off" ${dis}>`)}
      ${srow(t('Benutzer und Passwort'), t('Ein Benutzer mit Schreibrecht auf die Freigabe. Bei TrueNAS: Benutzer mit „Samba Authentication“.'), `<div class="two"><input class="in" data-stsmb="user" value="${esc(d.smb.user)}" autocomplete="off" placeholder="${esc(t('Benutzer'))}" ${dis}>
          <input class="in" type="password" data-stsmb="password" value="${esc(d.smb.password)}" autocomplete="new-password" placeholder="${esc(v.smb?.hasPassword ? t('gespeichert – leer lassen zum Behalten') : t('Passwort'))}" ${dis}></div>`)}
      <details class="adv srow-adv"><summary>${t('Domäne')}</summary>${srow(t('Domäne / Arbeitsgruppe'), t('Meist leer lassen (WORKGROUP).'), `<input class="in" data-stsmb="domain" value="${esc(d.smb.domain)}" autocomplete="off" ${dis}>`)}</details>` : '';
  const folderFields = d.mode === 'folder' ? srow(t('Ordner'), t(FOLDER_HINT[v.platform] || FOLDER_HINT.linux), `<input class="in st-pathin" data-stpath value="${esc(d.path)}" placeholder="/share/nas/printdock" autocomplete="off" ${dis}>
        ${v.suggestions?.length && !mv ? `<div class="chips" style="margin-top:8px">${v.suggestions.map((p) => `<button class="chip" data-stsug="${esc(p)}">${esc(p)}</button>`).join('')}</div>` : ''}`) : '';
  const testRow = d.mode !== 'local' ? `<div class="srow"><div class="sl"><b>${t('Verbindung prüfen')}</b><span>${t('Schreibt eine kleine Testdatei und löscht sie wieder.')}</span>
        ${test ? `<span class="${test.ok ? 'ok-txt' : 'warn-txt'}">${test.ok ? `✓ ${t('Schreibzugriff klappt')}${test.freeMb != null ? ` · ${t('{n} frei', { n: mbTxt(test.freeMb) })}` : ''}${test.path ? ` · ${esc(test.path)}` : ''}` : `⚠ ${esc(t(test.error || 'Fehler'))}`}</span>${test.ok && test.sameDisk ? `<span class="warn-txt">⚠ ${t('Der Ordner liegt auf derselben Platte wie der Datenordner – ist das NAS wirklich eingehängt?')}</span>` : ''}` : ''}</div>
        <div class="sc"><button class="b b-sm" data-stact="test" ${dis}>${t('Prüfen')}</button></div></div>` : '';
  const rows = v.kinds.map((k) => `<div class="st-kind">
      <b>${t(k.label)}</b>
      <span class="code">${esc(k.dir)}</span>
      <span class="meta">${k.count ? `${k.count} · ${mbTxt(k.usedMb)}` : t('leer')}${k.external && k.freeMb != null ? ` · ${t('{n} frei', { n: mbTxt(k.freeMb) })}` : ''}</span>
      ${k.external ? (k.ok ? `<span class="vl ok">✓ ${t('erreichbar')}</span>` : `<span class="vl bad">⚠ ${esc(t(k.error || 'nicht erreichbar'))}</span>`) : `<span class="meta">${t('Datenordner')}</span>`}
      ${k.localPending ? `<span class="meta warn-txt">${v.mode === 'smb' ? t('{n} Dateien warten lokal auf die Übertragung', { n: k.localPending }) : t('{n} Dateien warten lokal aufs Nachziehen', { n: k.localPending })}</span>` : ''}
    </div>`).join('');
  return `<h3 class="shead">${t('Speicherort')}</h3>
    <div class="sbox">
      <div class="srow st-moderow"><div class="sl"><b>${t('Wo liegen Druckdateien, Fotos und Sicherungen?')}</b><span>${t('Auf einem NAS läuft Home Assistant nicht voll, und die Home-Assistant-Sicherungen bleiben klein.')}</span></div></div>
      <div class="st-modes">${modePick}</div>
      ${smbFields}${folderFields}
      ${d.mode !== 'local' ? srow(t('Was dort liegt'), t('In eigenen Unterordnern (dateien, fotos, sicherungen). Einstellungen, Archiv, Spulen und Vorschaubilder bleiben im Datenordner – sie sind klein.'), `<div class="st-checks">
          ${['files', 'photos', 'backups'].map((k) => `<label class="fr-check"><input type="checkbox" data-stkind="${k}" ${d[k] ? 'checked' : ''} ${dis}> ${t({ files: 'Druckdateien', photos: 'Fotos', backups: 'Sicherungen' }[k])}</label>`).join('')}</div>`) : ''}
      ${testRow}
      <div class="st-kinds">${rows}</div>
      ${v.mode === 'smb' && v.sync?.at && !mv ? `<div class="srow"><div class="sl"><span>${t('Zuletzt abgeglichen: {d}', { d: new Date(v.sync.at).toLocaleString() })}${v.sync.error ? ` · <span class="warn-txt">${esc(t(v.sync.error))}</span>` : ''}</span></div></div>` : ''}
      ${mv ? `<div class="srow"><div class="sl"><b>${t('Übertrage Dateien …')}</b><span>${t('{a} von {b}', { a: mv.done, b: mv.total || '?' })}${mv.current ? ` · ${esc(mv.current)}` : ''}</span></div><div class="sc" style="flex:1"><div class="bar"><i style="width:${mv.total ? Math.round((mv.done / mv.total) * 100) : 0}%"></i></div></div></div>` : ''}
      ${v.lastError && !mv ? `<div class="srow"><div class="sl"><b class="warn-txt">${t('Umziehen fehlgeschlagen')}</b><span>${esc(t(v.lastError.msg))}</span></div></div>` : ''}
      <div class="srow"><div class="sl"><span>${d.mode === 'smb' ? t('PrintDock speichert zuerst lokal und überträgt im Hintergrund; die lokale Kopie wird erst gelöscht, wenn die Datei vollständig auf dem NAS liegt. Gebraucht (Druckstart, Download) wird sie kurz zurückgeholt. Druckdateien und Fotos auf dem NAS sind nicht Teil der PrintDock-Sicherung – das NAS ist die Ablage.') : t('Beim Übernehmen kopiert PrintDock die vorhandenen Dateien an den neuen Ort und löscht sie erst danach am alten. Ist der Ort später einmal nicht erreichbar, speichert PrintDock so lange im Datenordner und zieht die Dateien nach.')}</span></div>
        <div class="sc"><div class="btns" style="margin:0">${v.kinds.some((k) => k.localPending) && !mv && v.mode !== 'local' ? `<button class="b b-sm" data-stact="sync">${t('Jetzt übertragen')}</button>` : ''}<button class="b b-sm b-go" data-stact="apply" ${changed && !mv ? '' : 'disabled'}>${t('Übernehmen')}</button></div></div></div>
    </div>`;
}

let storagePoll = null;
function pollStorage() {
  clearTimeout(storagePoll);
  if (!S.storage?.moving) return;
  storagePoll = setTimeout(async () => {
    await loaders.storage().catch(() => {});
    if (!S.storage?.moving) reload('files', 'autobackup');
    render();
    pollStorage();
  }, 1500);
}

/** Knöpfe nach Eingaben freigeben, ohne neu zu zeichnen (sonst springt der Cursor) */
function storageButtons() {
  const ab = $('[data-stact="apply"]');
  if (ab && S.storage && S.storageDraft) ab.disabled = !storageChanged(S.storageDraft, S.storage) || Boolean(S.storage.moving);
}

document.addEventListener('input', (e) => {
  if (!S.storageDraft) return;
  const p = e.target.closest('[data-stpath]');
  const s = e.target.closest('[data-stsmb]');
  if (!p && !s) return;
  S.storageDirty = true;
  S.storageTest = null;
  if (p) S.storageDraft.path = p.value.trim();
  if (s) S.storageDraft.smb[s.dataset.stsmb] = s.dataset.stsmb === 'password' ? s.value : s.value.trim();
  storageButtons();
});
document.addEventListener('change', (e) => {
  if (!S.storageDraft) return;
  const m = e.target.closest('[name="stmode"]');
  if (m) {
    S.storageDirty = true;
    S.storageTest = null;
    S.storageDraft.mode = m.value;
    return render();
  }
  const k = e.target.closest('[data-stkind]');
  if (k) {
    S.storageDirty = true;
    S.storageDraft[k.dataset.stkind] = k.checked;
    storageButtons();
  }
});

const storageBody = () => {
  const d = S.storageDraft;
  return { mode: d.mode, path: d.mode === 'folder' ? d.path : '', smb: d.mode === 'smb' ? d.smb : undefined, files: d.files, photos: d.photos, backups: d.backups };
};

document.addEventListener('click', async (e) => {
  const sug = e.target.closest('[data-stsug]');
  if (sug && S.storageDraft) {
    S.storageDirty = true;
    S.storageDraft.path = sug.dataset.stsug;
    S.storageTest = await api('storage/test', { method: 'POST', body: storageBody() }).catch((err) => ({ ok: false, error: err.message }));
    return render();
  }
  const b = e.target.closest('[data-stact]');
  if (!b || !S.storageDraft) return;
  const act = b.dataset.stact;
  if (act === 'test') {
    b.disabled = true;
    b.textContent = t('Prüfe …');
    S.storageTest = await api('storage/test', { method: 'POST', body: storageBody() }).catch((err) => ({ ok: false, error: err.message }));
    return render();
  }
  if (act === 'sync') {
    const r = await run(() => api('storage/sync', { method: 'POST' }));
    if (r) toast(t('{n} Dateien übertragen', { n: r.moved }));
    return reload('storage');
  }
  if (act === 'apply') {
    const v = S.storage;
    const d = S.storageDraft;
    const n = v.kinds.reduce((a, k) => a + k.count, 0);
    const where = d.mode === 'smb' ? `\\\\${d.smb.server}\\${d.smb.share}${d.smb.dir ? `\\${d.smb.dir}` : ''}` : d.path;
    if (!(await confirmBox(t('Speicherort übernehmen'), d.mode === 'local'
      ? t('PrintDock holt die Dateien ({n}) zurück in den Datenordner.', { n })
      : t('PrintDock überträgt die vorhandenen Dateien nach {p} und löscht sie danach im Datenordner. Je nach Netz kann das ein paar Minuten dauern – PrintDock läuft in der Zeit normal weiter.', { p: where }), t('Übernehmen')))) return;
    const r = await run(() => api('storage', { method: 'PUT', body: storageBody() }));
    if (r) {
      S.storage = r;
      S.storageDraft = null;
      S.storageDirty = false;
      S.storageTest = null;
      render();
      pollStorage();
    }
  }
});
