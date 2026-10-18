/* PrintDock – Einstellungen → System → Plattform-Check: was diese Installation kann und was fehlt. */

loaders.platform = async () => (S.platform = S.app?.me?.role === 'operator' ? null : await api('platform'));

function platformHTML() {
  const P = S.platform;
  if (!P) return '';
  const rows = P.items.map((x) => `<div class="pf-row"><span class="pf-ic ${x.ok === true ? 'ok' : x.ok === false ? 'bad' : 'na'}">${x.ok === true ? '✓' : x.ok === false ? '!' : '–'}</span>
    <div><b>${esc(t(x.label))}</b><span class="code">${esc(t(String(x.value ?? '')))}</span>${x.hint ? `<small>${esc(t(x.hint))}</small>` : ''}</div></div>`).join('');
  const bad = P.items.filter((x) => x.ok === false).length;
  return `<h3 class="shead">${t('Plattform-Check')} <span class="meta" style="text-transform:none;letter-spacing:0;font-weight:400">· ${bad ? t('{n} Punkt(e) prüfen', { n: bad }) : t('alles bereit')}</span></h3>
    <div class="sbox pf-box">${rows}<div class="st-foot"><button class="b b-sm" data-pf="reload">${t('Erneut prüfen')}</button></div></div>
    <p class="meta">${t('PrintDock läuft als Home-Assistant-Add-on, in Docker, auf dem Raspberry Pi/Server und unter Windows oder macOS mit denselben Funktionen. Was auf dieser Installation fehlt, steht hier – mit dem, was zu tun ist.')}</p>`;
}

document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-pf="reload"]')) return;
  await loaders.platform().catch(() => {});
  render();
});
