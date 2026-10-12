/* PrintDock – Einstellungen → System → Speicherort: Druckdateien, Fotos und Sicherungen auf ein NAS legen. */

loaders.storage = async () => (S.storage = S.app?.me?.role === 'operator' ? null : await api('storage'));

const STORAGE_HINT = {
  addon: 'In Home Assistant unter Einstellungen → System → Speicher → „Netzwerkspeicher hinzufügen“ das NAS einbinden (Verwendung: „Freigabe“). Es erscheint hier als /share/<Name>, z. B. /share/nas/printdock. Was dort liegt, steckt nicht mehr in jeder Home-Assistant-Sicherung.',
  docker: 'Den NAS-Ordner auf dem Host einhängen und in der docker-compose.yml als Volume durchreichen, z. B. „- /mnt/nas/printdock:/nas“ – dann hier /nas eintragen.',
  linux: 'Das NAS per /etc/fstab einhängen (cifs oder nfs), z. B. nach /mnt/nas – dann hier /mnt/nas/printdock eintragen.',
  windows: 'Netzwerkpfad direkt eintragen, z. B. \\\\nas\\drucken\\printdock. Der Benutzer, unter dem PrintDock läuft, braucht dort Schreibrecht.',
  mac: 'Die Freigabe im Finder verbinden (⌘K, smb://nas/drucken) – dann hier /Volumes/drucken/printdock eintragen.',
};

const mbTxt = (mb) => (mb == null ? '' : mb >= 1024 ? `${fnum(mb / 1024, 1)} GB` : `${mb} MB`);

function storageHTML() {
  const v = S.storage;
  if (!v) return '';
  // Entwurf nur behalten, solange der Nutzer etwas geändert hat – sonst immer den gespeicherten Stand zeigen
  if (!S.storageDirty || !S.storageDraft) S.storageDraft = { path: v.path, files: v.files, photos: v.photos, backups: v.backups };
  const draft = S.storageDraft;
  const changed = draft.path !== v.path || draft.files !== v.files || draft.photos !== v.photos || draft.backups !== v.backups;
  const test = S.storageTest && S.storageTest.path === draft.path ? S.storageTest : null;
  const mv = v.moving;
  const rows = v.kinds.map((k) => `<div class="st-kind">
      <b>${t(k.label)}</b>
      <span class="code">${esc(k.dir)}</span>
      <span class="meta">${k.count ? `${k.count} · ${mbTxt(k.usedMb)}` : t('leer')}${k.external && k.freeMb != null ? ` · ${t('{n} frei', { n: mbTxt(k.freeMb) })}` : ''}</span>
      ${k.external ? (k.ok ? `<span class="vl ok">✓ ${t('erreichbar')}</span>` : `<span class="vl bad">⚠ ${esc(t(k.error || 'nicht erreichbar'))}</span>`) : `<span class="meta">${t('Datenordner')}</span>`}
      ${k.localPending ? `<span class="meta warn-txt">${t('{n} Dateien warten lokal aufs Nachziehen', { n: k.localPending })}</span>` : ''}
    </div>`).join('');
  return `<h3 class="shead">${t('Speicherort')}</h3>
    <div class="sbox">
      ${srow(t('Externer Speicherort'), t(STORAGE_HINT[v.platform] || STORAGE_HINT.linux), `<div class="st-path">
          <input class="in" data-stpath value="${esc(draft.path)}" placeholder="${esc(t('leer = Datenordner von PrintDock'))}" autocomplete="off" ${mv ? 'disabled' : ''}>
          <button class="b b-sm" data-stact="test" ${draft.path && !mv ? '' : 'disabled'}>${t('Prüfen')}</button></div>
          ${test ? `<div class="meta ${test.ok ? '' : 'warn-txt'}" style="margin-top:6px">${test.ok ? `✓ ${t('Schreibzugriff klappt')}${test.freeMb != null ? ` · ${t('{n} frei', { n: mbTxt(test.freeMb) })}` : ''}` : `⚠ ${esc(t(test.error))}`}</div>${test.ok && test.sameDisk ? `<div class="meta warn-txt" style="margin-top:4px">⚠ ${t('Der Ordner liegt auf derselben Platte wie der Datenordner – ist das NAS wirklich eingehängt?')}</div>` : ''}` : ''}
          ${v.suggestions?.length && !mv ? `<div class="chips" style="margin-top:8px">${v.suggestions.map((p) => `<button class="chip" data-stsug="${esc(p)}">${esc(p)}</button>`).join('')}</div>` : ''}`)}
      ${srow(t('Was dort liegt'), t('In eigenen Unterordnern (dateien, fotos, sicherungen). Einstellungen, Archiv und Spulen bleiben im Datenordner – sie sind klein.'), `<div class="st-checks">
          ${['files', 'photos', 'backups'].map((k) => `<label class="fr-check"><input type="checkbox" data-stkind="${k}" ${draft[k] ? 'checked' : ''} ${draft.path && !mv ? '' : 'disabled'}> ${t({ files: 'Druckdateien', photos: 'Fotos', backups: 'Sicherungen' }[k])}</label>`).join('')}</div>`)}
      <div class="st-kinds">${rows}</div>
      ${mv ? `<div class="srow"><div class="sl"><b>${t('Verschiebe Dateien …')}</b><span>${t('{a} von {b}', { a: mv.done, b: mv.total })}${mv.current ? ` · ${esc(mv.current)}` : ''}</span></div><div class="sc" style="flex:1"><div class="bar"><i style="width:${mv.total ? Math.round((mv.done / mv.total) * 100) : 0}%"></i></div></div></div>` : ''}
      ${v.lastError && !mv ? `<div class="srow"><div class="sl"><b class="warn-txt">${t('Verschieben fehlgeschlagen')}</b><span>${esc(v.lastError.msg)}</span></div></div>` : ''}
      <div class="srow"><div class="sl"><span>${t('Beim Übernehmen kopiert PrintDock die vorhandenen Dateien an den neuen Ort und löscht sie erst danach am alten. Ist der Ort später einmal nicht erreichbar, speichert PrintDock so lange im Datenordner und zieht die Dateien nach.')}</span></div>
        <div class="sc"><div class="btns" style="margin:0">${v.kinds.some((k) => k.localPending) && !mv ? `<button class="b b-sm" data-stact="sync">${t('Jetzt nachziehen')}</button>` : ''}<button class="b b-sm b-go" data-stact="apply" ${changed && !mv ? '' : 'disabled'}>${t('Übernehmen')}</button></div></div></div>
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

document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-stpath]');
  if (!el || !S.storageDraft) return;
  S.storageDirty = true;
  S.storageDraft.path = el.value.trim();
  // Knöpfe gleich freigeben, ohne die Seite neu zu zeichnen (sonst springt der Cursor)
  const v = S.storage;
  const d = S.storageDraft;
  const changed = d.path !== v.path || d.files !== v.files || d.photos !== v.photos || d.backups !== v.backups;
  const tb = $('[data-stact="test"]');
  if (tb) tb.disabled = !d.path;
  const ab = $('[data-stact="apply"]');
  if (ab) ab.disabled = !changed;
  $$('[data-stkind]').forEach((c) => (c.disabled = !d.path));
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-stpath]');
  if (el) return render();
  const k = e.target.closest('[data-stkind]');
  if (k && S.storageDraft) {
    S.storageDirty = true;
    S.storageDraft[k.dataset.stkind] = k.checked;
    render();
  }
});
document.addEventListener('click', async (e) => {
  const sug = e.target.closest('[data-stsug]');
  if (sug && S.storageDraft) {
    S.storageDirty = true;
    S.storageDraft.path = sug.dataset.stsug;
    S.storageTest = await api('storage/test', { method: 'POST', body: { path: sug.dataset.stsug } }).catch((err) => ({ path: sug.dataset.stsug, ok: false, error: err.message }));
    return render();
  }
  const b = e.target.closest('[data-stact]');
  if (!b || !S.storageDraft) return;
  const act = b.dataset.stact;
  if (act === 'test') {
    S.storageDraft.path = $('[data-stpath]')?.value.trim() || '';
    S.storageTest = await api('storage/test', { method: 'POST', body: { path: S.storageDraft.path } }).catch((err) => ({ path: S.storageDraft.path, ok: false, error: err.message }));
    return render();
  }
  if (act === 'sync') {
    const r = await run(() => api('storage/sync', { method: 'POST' }));
    if (r) toast(t('{n} Dateien nachgezogen', { n: r.moved }));
    return reload('storage');
  }
  if (act === 'apply') {
    S.storageDraft.path = $('[data-stpath]')?.value.trim() ?? S.storageDraft.path;
    const v = S.storage;
    const n = v.kinds.reduce((a, k) => a + k.count, 0);
    if (!(await confirmBox(t('Speicherort übernehmen'), S.storageDraft.path
      ? t('PrintDock kopiert die vorhandenen Dateien ({n}) nach {p} und löscht sie danach im Datenordner. Je nach Netz kann das ein paar Minuten dauern – PrintDock läuft in der Zeit normal weiter.', { n, p: S.storageDraft.path })
      : t('PrintDock holt die Dateien ({n}) zurück in den Datenordner.', { n }), t('Übernehmen')))) return;
    const r = await run(() => api('storage', { method: 'PUT', body: S.storageDraft }));
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
