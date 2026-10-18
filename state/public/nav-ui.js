/* PrintDock – Einstellungen → Allgemein → Menü: Reihenfolge, ausblenden, Startseite (für alle oder nur dieses Gerät). */

const navLocal = () => { try { return Boolean(localStorage.getItem('pd-nav')); } catch { return false; } };

/** Alle Menüpunkte (ohne Einstellungen) in aktueller Reihenfolge, auch ausgeblendete */
function navAllOrdered() {
  const cfg = navCfg();
  const all = NAV_ALL.filter((g) => g.g !== 'set').map((g) => ({ ...g, v: g.v.filter((v) => on(v[2])) })).filter((g) => g.v.length);
  if (!cfg.order?.length) return all;
  const pos = (g) => { const i = cfg.order.indexOf(g.g); return i < 0 ? 900 + NAV_ALL.indexOf(NAV_ALL.find((x) => x.g === g.g)) : i; };
  return all.sort((a, b) => pos(a) - pos(b));
}

function navSettingsHTML() {
  const cfg = navCfg();
  const hidden = new Set(cfg.hidden || []);
  const list = navAllOrdered();
  const rows = list.map((g, i) => `<div class="nv-row ${hidden.has(g.g) ? 'off' : ''}" data-nv="${g.g}">
      <span class="nv-ic">${NAV_ICON[g.icon] || ''}</span><b>${esc(t(g.l))}</b>
      <button class="x" data-nvmove="-1" ${i === 0 ? 'disabled' : ''} title="${esc(t('Nach oben'))}">${ICON.up}</button>
      <button class="x" data-nvmove="1" ${i === list.length - 1 ? 'disabled' : ''} title="${esc(t('Nach unten'))}">${ICON.down}</button>
      <label class="tgl" title="${esc(t('Im Menü zeigen'))}"><input type="checkbox" data-nvshow ${hidden.has(g.g) ? '' : 'checked'}><span class="sw"></span></label></div>`).join('');
  const views = navGroups().filter((g) => g.g !== 'set').flatMap((g) => g.v.map((v) => [v[0], g.v.length > 1 ? `${t(g.l)} · ${t(v[1])}` : t(v[1])]));
  const home = cfg.home && views.some((v) => v[0] === cfg.home) ? cfg.home : '';
  return `<h3 class="shead">${t('Menü')}</h3>
    <div class="sbox nv-box">${rows}
      <div class="lrow"><div class="lt"><b>${t('Startseite')}</b><span>${t('Diese Seite öffnet PrintDock beim Aufrufen.')}</span></div>
        <div class="lc"><select class="in" data-nvhome><option value="">${t('Erster Menüpunkt')}</option>${views.map(([k, l]) => `<option value="${k}" ${k === home ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div></div>
      <label class="lrow"><div class="lt"><b>${t('Nur auf diesem Gerät')}</b><span>${t('z. B. am Handy eine eigene Anordnung; sonst gilt sie für alle Geräte.')}</span></div>
        <div class="lc"><span class="tgl"><input type="checkbox" data-nvlocal ${navLocal() ? 'checked' : ''}><span class="sw"></span></span></div></label>
      <div class="st-foot"><button class="b b-sm" data-nvreset>${t('Standard wiederherstellen')}</button></div>
    </div>`;
}

/** Menü-Einstellung speichern – lokal oder für alle */
async function navSave(cfg) {
  if (navLocal()) {
    try { localStorage.setItem('pd-nav', JSON.stringify(cfg)); } catch {}
  } else {
    const r = await run(() => api('app', { method: 'PUT', body: { nav: cfg } }));
    if (!r) return;
    await loaders.app();
  }
  render();
}

function navCurrent() {
  const cfg = navCfg();
  return { order: navAllOrdered().map((g) => g.g), hidden: [...(cfg.hidden || [])], home: cfg.home || '' };
}

document.addEventListener('click', (e) => {
  const mv = e.target.closest('[data-nvmove]');
  if (mv) {
    const cur = navCurrent();
    const id = mv.closest('[data-nv]').dataset.nv;
    const i = cur.order.indexOf(id);
    const j = i + Number(mv.dataset.nvmove);
    if (i < 0 || j < 0 || j >= cur.order.length) return;
    [cur.order[i], cur.order[j]] = [cur.order[j], cur.order[i]];
    return navSave(cur);
  }
  if (e.target.closest('[data-nvreset]')) {
    if (navLocal()) { try { localStorage.removeItem('pd-nav'); } catch {} render(); return; }
    return navSave({ order: [], hidden: [], home: '' });
  }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.matches('[data-nvshow]')) {
    const cur = navCurrent();
    const id = el.closest('[data-nv]').dataset.nv;
    cur.hidden = cur.hidden.filter((x) => x !== id);
    if (!el.checked) {
      // mindestens ein Menüpunkt bleibt sichtbar
      if (cur.order.filter((x) => !cur.hidden.includes(x)).length <= 1) { el.checked = true; return toast(t('Mindestens ein Menüpunkt muss sichtbar bleiben'), true); }
      cur.hidden.push(id);
    }
    return navSave(cur);
  }
  if (el.matches('[data-nvhome]')) {
    const cur = navCurrent();
    cur.home = el.value;
    return navSave(cur);
  }
  if (el.matches('[data-nvlocal]')) {
    const cur = navCurrent();
    try {
      if (el.checked) localStorage.setItem('pd-nav', JSON.stringify(cur));
      else localStorage.removeItem('pd-nav');
    } catch {}
    render();
  }
});
