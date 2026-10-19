/* PrintDock – Stil (Einstellungen → Allgemein → Darstellung): „PrintDock“ oder ein eigenes Theme-Paket.
   Theme-Pakete (Zip mit theme.json, Logo, Schriften, theme.css) liegen im Datenordner unter themes/.
   Aufbau und Beispiel: docs/themes.md */

const themeCur = () => (S.app?.skin && S.app.skin !== 'printdock' ? (S.app.themes || []).find((x) => x.id === S.app.skin) || null : null);

/** Stylesheet, Logo, Name, Symbol im Tab und Farbe der Browserleiste passend zum Stil */
function applySkin() {
  const th = themeCur();
  const root = document.documentElement;
  root.dataset.skin = th ? 'custom' : 'printdock';

  let link = document.getElementById('pd-theme-css');
  if (th) {
    if (!link) { link = document.createElement('link'); link.rel = 'stylesheet'; link.id = 'pd-theme-css'; document.head.append(link); }
    if (link.getAttribute('href') !== th.css) link.setAttribute('href', th.css);
  } else if (link) link.remove();

  const brand = $('.side-brand');
  if (brand) {
    if (!brand._orig) brand._orig = brand.innerHTML;
    const b = th?.brand || {};
    const logo = th?.logo ? `<img src="${esc(th.logo)}" alt="">` : (brand._orig.match(/<svg[\s\S]*<\/svg>/) || [''])[0];
    const html = th ? `${logo}<b>${esc(b.text)}${b.accentText ? `<span>${esc(b.accentText)}</span>` : ''}${b.sub ? `<small>${esc(b.sub)}</small>` : ''}</b>` : brand._orig;
    if (brand._html !== html) { brand.innerHTML = html; brand._html = html; }
  }
  const mt = $('.mtop b');
  if (mt) mt.innerHTML = th ? `${esc(th.brand.text)}${th.brand.accentText ? `<span style="color:var(--accent)">${esc(th.brand.accentText)}</span>` : ''}` : 'PrintDock';

  const icon = $('link[rel="icon"]');
  if (icon) {
    if (!icon._orig) icon._orig = icon.getAttribute('href');
    icon.setAttribute('href', th?.favicon || icon._orig);
  }
  const meta = $('meta[name="theme-color"]');
  if (meta) {
    if (!meta._orig) meta._orig = meta.getAttribute('content');
    const c = th ? (isDark() ? th.themeColor?.dark : th.themeColor?.light) : null;
    meta.setAttribute('content', c || meta._orig);
  }
  document.title = th ? `${th.brand.title || th.name} · PrintDock` : 'PrintDock';
}

{
  const base = applyAppearance;
  applyAppearance = function () {
    base();
    applySkin();
  };
}

// Einstellungen → Allgemein → Darstellung: Zeile „Stil“ vor „Größe“
{
  const base = VIEW_FN.general;
  VIEW_FN.general = function () {
    const html = base();
    const mark = `<div class="lrow"><div class="lt"><b>${t('Größe')}</b>`;
    const i = html.indexOf(mark);
    if (i < 0) return html;
    const list = S.app?.themes || [];
    const cur = themeCur()?.id || 'printdock';
    const admin = S.app?.me?.role !== 'operator';
    const opts = [['printdock', 'PrintDock'], ...list.map((x) => [x.id, x.name])];
    const row = `<div class="lrow"><div class="lt"><b>${t('Stil')}</b><span>${t('Farben, Schriften und Logo. Eigene Stile kommen als Theme-Paket (Zip) – Aufbau in der Anleitung unter docs/themes.md.')}${cur !== 'printdock' ? ` ${t('Die Akzentfarbe kommt dann aus dem Theme.')}` : ''}</span></div>
      <div class="lc th-list"><div class="seg">${opts.map(([k, l]) => `<button type="button" data-g-skin="${esc(k)}" aria-pressed="${cur === k}">${esc(l)}</button>`).join('')}</div>
        ${admin ? `<div class="th-row"><label class="b b-sm"><input type="file" accept=".zip,application/zip" data-th-upload hidden>${ICON.plus}${t('Theme-Paket hochladen …')}</label>${cur !== 'printdock' ? `<button type="button" class="b b-sm b-fault" data-th-del="${esc(cur)}">${t('Theme entfernen')}</button>` : ''}</div>` : ''}
      </div></div>`;
    return html.slice(0, i) + row + html.slice(i);
  };
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-g-skin]');
  if (b) return saveApp({ skin: b.dataset.gSkin });
  const del = e.target.closest('[data-th-del]');
  if (del) {
    const th = (S.app?.themes || []).find((x) => x.id === del.dataset.thDel);
    if (!th || !(await confirmBox(t('Theme „{n}“ entfernen?', { n: th.name }), t('Das Paket wird aus dem Datenordner gelöscht. PrintDock zeigt dann wieder den Standard-Stil.'), t('Entfernen'), 'b-fault'))) return;
    const r = await run(() => api(`themes/${th.id}`, { method: 'DELETE' }), t('Theme entfernt'));
    if (r) { await loaders.app(); applyAppearance(); render(); }
  }
});

document.addEventListener('change', async (e) => {
  const inp = e.target.closest('[data-th-upload]');
  if (!inp || !inp.files?.[0]) return;
  const f = inp.files[0];
  inp.value = '';
  const th = await run(() => api('themes', { method: 'POST', raw: true, headers: { 'Content-Type': 'application/zip' }, body: f }));
  if (!th) return;
  await loaders.app();
  await saveApp({ skin: th.id }, t('Theme „{n}“ installiert', { n: th.name }));
});

// Hell/Dunkel umgeschaltet: Farbe der Browserleiste nachziehen
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applySkin());
document.addEventListener('click', (e) => { if (e.target.closest('#themeBtn,[data-g-theme]')) setTimeout(applySkin, 0); });
