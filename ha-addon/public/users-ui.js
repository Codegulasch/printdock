/* PrintDock – Benutzer (Admin / Bediener) und Protokoll unter Einstellungen → System. */

loaders.users = async () => {
  const admin = S.app?.me?.role !== 'operator';
  S.users = admin && S.app?.auth?.enabled ? await api('users') : null;
  S.audit = admin ? await api('audit?limit=150') : null;
};

const ROLE = { admin: 'Admin', operator: 'Bediener' };

/** Lesbare Beschreibung eines Protokolleintrags */
function auditText(a) {
  const p = a.path;
  const M = [
    [/^queue\/[^/]+\/start$/, 'Druck gestartet'], [/^queue\/[^/]+\/dry-start$/, 'Erst trocknen, dann starten'], [/^queue\/[^/]+\/resolve$/, 'Hängenden Eintrag abgeschlossen'],
    [/^queue\/[^/]+\/requeue$|^history\/[^/]+\/requeue$/, 'Neu eingereiht'], [/^queue$/, 'Eingeplant'], [/^queue\/reorder$/, 'Warteschlange sortiert'], [/^queue\/[^/]+$/, a.method === 'DELETE' ? 'Aus der Warteschlange entfernt' : 'Eintrag geändert'],
    [/^printers\/[^/]+\/plate-clear$/, 'Platte frei bestätigt'], [/^printers\/[^/]+\/command$/, 'Befehl an Drucker'], [/^printers\/[^/]+\/power$/, 'Steckdose geschaltet'],
    [/^printers(\/[^/]+)?$/, a.method === 'DELETE' ? 'Drucker entfernt' : 'Drucker eingestellt'],
    [/^history\/[^/]+\/fail$/, 'Als Fehldruck gewertet'], [/^history\/[^/]+\/dismiss$/, 'Fehldruck erledigt'],
    [/^orders\/[^/]+\/plan$/, 'Auftrag eingeplant'], [/^orders\/[^/]+\/post$/, 'Nachbearbeitung'], [/^orders(\/[^/]+)?$/, a.method === 'DELETE' ? 'Auftrag gelöscht' : 'Auftrag gespeichert'],
    [/^spools\/[^/]+\/weigh$|^stations\/[^/]+\/weigh$/, 'Spule gewogen'], [/^spools\/[^/]+\/book$/, 'Verbrauch abgebucht'], [/^spools/, 'Spule geändert'],
    [/^filament\/assign$/, 'Spule zugeordnet'], [/^filament\/dry$/, 'Trocknen'], [/^filament\/shop/, 'Einkauf'], [/^rfid/, 'RFID-Tag'],
    [/^app$/, 'Einstellungen geändert'], [/^users/, 'Benutzer geändert'], [/^remote$/, 'Fernzugriff geändert'], [/^backup|^restore/, 'Sicherung'], [/^update/, 'Update'],
    [/^stations\/pair$/, 'Station gekoppelt'], [/^stations/, 'Station'], [/^ha\/emergency\/test$/, 'Notaus-Probealarm'], [/^ha\/emergency$/, 'Notaus eingestellt'], [/^ha/, 'Home Assistant'],
    [/^notifications/, 'Benachrichtigungen'], [/^files/, 'Dateien'], [/^maintenance/, 'Wartung'],
    [/^login$/, 'Angemeldet'], [/^logout$/, 'Abgemeldet'],
  ];
  const hit = M.find(([re]) => re.test(p));
  return hit ? t(hit[1]) : `${a.method} ${p}`;
}

function usersHTML() {
  const rows = (S.users || []).map((u) => `<div class="em-row"><div><b>${esc(u.name)}</b><small>${t(ROLE[u.role])}${u.main ? ` · ${t('Haupt-Zugang')}` : ''}</small></div><span></span><span></span>
    <button class="x" data-usr="edit" data-id="${esc(u.id)}" title="${esc(t('Bearbeiten'))}">${ICON.edit}</button></div>`).join('');
  const audit = (S.audit || []).slice(0, 40).map((a) => `<div class="au-row"><span class="meta num">${tfmt(a.at)}</span><b>${esc(a.user || '–')}</b><span>${esc(auditText(a))}</span></div>`).join('');
  return `<h3 class="shead">${t('Benutzer')}</h3>
    <div class="sbox">${S.app?.auth?.enabled ? `${rows}<div class="st-foot"><button class="b b-sm" data-usr="add">${ICON.plus}${t('Benutzer')}</button></div>`
      : `<div class="st-empty"><span>${t('Mehrere Benutzer gibt es, sobald der Login-Schutz an ist.')}</span></div>`}</div>
    <p class="meta">${t('Admin darf alles. Bediener darf Drucke starten, „Platte frei“ bestätigen, Fehldrucke neu einreihen, Spulen wiegen und zuordnen – aber nichts einstellen oder löschen.')}</p>
    <h3 class="shead">${t('Protokoll')}</h3>
    <div class="sbox au-box">${audit || `<div class="st-empty"><span>${t('Noch keine Änderungen.')}</span></div>`}</div>`;
}

function userDialog(u = null) {
  const d = openDialog(`<form class="dlg" method="dialog"><h2>${u ? t('Benutzer {n}', { n: esc(u.name) }) : t('Neuer Benutzer')}</h2>
    <label>${t('Name')}<input name="name" required value="${esc(u?.name || '')}" autocomplete="off"></label>
    ${u?.main ? `<p class="meta" style="margin:0">${t('Haupt-Zugang – immer Admin.')}</p>` : `<label>${t('Rolle')}<select name="role"><option value="operator" ${u?.role !== 'admin' ? 'selected' : ''}>${t('Bediener')}</option><option value="admin" ${u?.role === 'admin' ? 'selected' : ''}>${t('Admin')}</option></select></label>`}
    <label>${u ? t('Neues Passwort (leer = unverändert)') : t('Passwort (mindestens 6 Zeichen)')}<input name="password" type="password" autocomplete="new-password" ${u ? '' : 'required'}></label>
    <p class="form-error" hidden></p>
    <div class="dlg-actions">${u && !u.main ? `<button class="b b-fault left" type="button" data-udel>${t('Löschen')}</button>` : ''}<button class="b" type="button" data-close>${t('Abbrechen')}</button><button class="b b-done">${t('Speichern')}</button></div></form>`);
  const form = $('form', d);
  $('[data-udel]', d)?.addEventListener('click', async () => {
    try {
      S.users = await api(`users/${u.id}`, { method: 'DELETE' });
      d.close();
      render();
    } catch (err) { formError(d, err.message); }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { name: form.name.value, role: form.role?.value || 'admin', password: form.password.value };
    try {
      S.users = await api(u ? `users/${u.id}` : 'users', { method: u ? 'PUT' : 'POST', body });
      d.close();
      toast(t('Gespeichert'));
      reload('app', 'users');
    } catch (err) { formError(d, err.message); }
  });
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-usr]');
  if (!b) return;
  if (b.dataset.usr === 'add') return userDialog();
  return userDialog((S.users || []).find((u) => u.id === b.dataset.id));
});
