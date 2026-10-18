'use strict';
/* PrintDock – Ansichten frei anordnen: Kästen auf „Heute“ (Reihenfolge, ausblenden) und Druckerkarten (Reihenfolge).
   Gilt für alle oder nur auf diesem Gerät (wie das Menü). Mit „Anordnen“ wird umgestellt – im Alltag verschiebt
   man so nichts aus Versehen. Ziehen mit der Maus oder die Pfeile (auch am Handy). */

S.arrange = null; // 'today' | 'board'

const TODAY_LABELS = { todo: 'Zu tun', printers: 'Drucker#pl', next: 'Als Nächstes', filament: 'Filament', dues: 'Termine diese Woche', week: 'Letzte 7 Tage' };

function layoutLocal() {
  try {
    return Boolean(localStorage.getItem('pd-layout'));
  } catch {
    return false;
  }
}
function layoutCfg() {
  try {
    const l = JSON.parse(localStorage.getItem('pd-layout') || 'null');
    if (l) return l;
  } catch {}
  return S.app?.layout || {};
}
async function saveLayout(patch) {
  const next = { ...layoutCfg(), ...patch };
  if (layoutLocal()) {
    try { localStorage.setItem('pd-layout', JSON.stringify(next)); } catch {}
    render();
    return;
  }
  S.app.layout = next;
  render();
  await saveApp({ layout: next });
}

/** Schlüssel in gespeicherter Reihenfolge (Unbekanntes hinten) */
function orderedKeys(keys, order = []) {
  const idx = (k) => {
    const i = order.indexOf(k);
    return i < 0 ? 1000 + keys.indexOf(k) : i;
  };
  return keys.slice().sort((a, b) => idx(a) - idx(b));
}

function arrangeBtnHTML(kind) {
  return S.arrange === kind ? '' : `<button class="b b-sm arr-btn" data-arr="start" data-kind="${kind}" title="${esc(t('Reihenfolge und sichtbare Kästen ändern'))}">⇅ ${t('Anordnen')}</button>`;
}

function arrangeBarHTML(kind) {
  if (S.arrange !== kind) return '';
  return `<div class="arr-bar"><b>${t('Anordnen')}</b><span class="meta">${kind === 'today' ? t('Kästen ziehen oder mit den Pfeilen verschieben, mit dem Auge aus- und einblenden.') : t('Drucker ziehen oder mit den Pfeilen verschieben.')}</span>
    <label class="check"><input type="checkbox" data-arr-local ${layoutLocal() ? 'checked' : ''}> ${t('nur auf diesem Gerät')}</label>
    <button class="b b-sm" data-arr="reset" data-kind="${kind}">${t('Standard')}</button><button class="b b-sm b-go" data-arr="done">${t('Fertig')}</button></div>`;
}

/** Heute: Kästen in Reihen – die ersten zwei nebeneinander (breit/schmal), danach Reihen mit bis zu drei Kästen */
function todayGridHTML(cards) {
  const cfg = layoutCfg().today || {};
  const hidden = new Set(cfg.hidden || []);
  const arr = S.arrange === 'today';
  const keys = orderedKeys(Object.keys(cards), cfg.order).filter((k) => cards[k] && (arr || !hidden.has(k)));
  const html = (k, i) => {
    const tools = arr ? `<span class="arr-tools"><button class="x" data-arr="left" data-k="${k}" title="${esc(t('Nach vorne'))}" ${i === 0 ? 'disabled' : ''}>◀</button><button class="x" data-arr="right" data-k="${k}" title="${esc(t('Nach hinten'))}" ${i === keys.length - 1 ? 'disabled' : ''}>▶</button><button class="x" data-arr="eye" data-k="${k}" title="${esc(hidden.has(k) ? t('Einblenden') : t('Ausblenden'))}">${hidden.has(k) ? '◌' : '👁'}</button></span>` : '';
    return cards[k]
      .replace('<section class="td-card', `<section data-lk="${k}" ${arr ? 'draggable="true"' : ''} class="td-card${arr ? ' arr' : ''}${hidden.has(k) ? ' is-hidden' : ''}`)
      .replace('<h3>', `<h3>${tools}`);
  };
  const row1 = keys.slice(0, 2);
  const rest = keys.slice(2);
  const rows = [];
  for (let i = 0; i < rest.length; i += 3) rows.push(rest.slice(i, i + 3));
  // vier Kästen übrig: zwei Reihen à zwei sehen ruhiger aus als drei + einer
  if (rest.length === 4) rows.splice(0, rows.length, rest.slice(0, 2), rest.slice(2));
  return `${row1.length ? `<div class="td-row1 ${row1.length === 1 ? 'one' : ''}" data-lgroup="today">${row1.map((k) => html(k, keys.indexOf(k))).join('')}</div>` : ''}
    ${rows.map((r) => `<div class="td-row2 n${r.length}" data-lgroup="today">${r.map((k) => html(k, keys.indexOf(k))).join('')}</div>`).join('')}`;
}

/** Drucker: gespeicherte Reihenfolge anwenden */
function sortPrinters(list) {
  const order = layoutCfg().board?.order || [];
  if (!order.length) return list;
  const ids = orderedKeys(list.map((p) => p.id), order);
  return ids.map((id) => list.find((p) => p.id === id));
}

/** Drucker anordnen: kompakte Kacheln statt der Live-Karten */
function boardArrangeHTML(list) {
  const ps = sortPrinters(list);
  return `<div class="arr-grid" data-lgroup="board">${ps.map((p, i) => `<div class="arr-tile" data-lk="${esc(p.id)}" draggable="true">
    <span class="arr-grip">⠿</span><div style="min-width:0"><b>${esc(p.name)}</b><small>${esc(p.settings?.model || '')}${p.settings?.area ? ` · ${esc(areaName(p.settings.area))}` : ''}</small></div>
    <span class="arr-tools"><button class="x" data-arr="left" data-k="${esc(p.id)}" ${i === 0 ? 'disabled' : ''}>◀</button><button class="x" data-arr="right" data-k="${esc(p.id)}" ${i === ps.length - 1 ? 'disabled' : ''}>▶</button></span></div>`).join('')}</div>`;
}

function currentOrder(kind) {
  if (kind === 'today') return $$('[data-lgroup="today"] [data-lk]').map((el) => el.dataset.lk);
  return $$('[data-lgroup="board"] [data-lk]').map((el) => el.dataset.lk);
}
function storeOrder(kind, order) {
  const cur = layoutCfg();
  if (kind === 'today') return saveLayout({ today: { ...(cur.today || {}), order } });
  return saveLayout({ board: { order } });
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-arr]');
  if (!b) return;
  const act = b.dataset.arr;
  if (act === 'start') { S.arrange = b.dataset.kind; return render(); }
  if (act === 'done') { S.arrange = null; return render(); }
  const kind = S.arrange;
  if (act === 'reset') {
    if (kind === 'today') return saveLayout({ today: { order: [], hidden: [] } });
    return saveLayout({ board: { order: [] } });
  }
  if (act === 'left' || act === 'right') {
    const order = currentOrder(kind);
    const i = order.indexOf(b.dataset.k);
    const j = act === 'left' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    return storeOrder(kind, order);
  }
  if (act === 'eye') {
    const cur = layoutCfg().today || {};
    const hidden = new Set(cur.hidden || []);
    if (hidden.has(b.dataset.k)) hidden.delete(b.dataset.k);
    else hidden.add(b.dataset.k);
    return saveLayout({ today: { ...cur, order: cur.order?.length ? cur.order : currentOrder('today'), hidden: [...hidden] } });
  }
});

document.addEventListener('change', (e) => {
  if (!e.target.matches('[data-arr-local]')) return;
  const cfg = layoutCfg();
  try {
    if (e.target.checked) localStorage.setItem('pd-layout', JSON.stringify(cfg));
    else localStorage.removeItem('pd-layout');
  } catch {}
  render();
});

// Ziehen und Ablegen (Maus)
let dragKey = null;
document.addEventListener('dragstart', (e) => {
  const el = e.target.closest?.('[data-lk][draggable="true"]');
  if (!el || !S.arrange) return;
  dragKey = el.dataset.lk;
  el.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', dragKey); } catch {}
});
document.addEventListener('dragend', (e) => {
  e.target.closest?.('[data-lk]')?.classList.remove('dragging');
  $$('.drop-before').forEach((x) => x.classList.remove('drop-before'));
  dragKey = null;
});
document.addEventListener('dragover', (e) => {
  if (!dragKey) return;
  const over = e.target.closest('[data-lgroup] [data-lk]');
  if (!over) return;
  e.preventDefault();
  $$('.drop-before').forEach((x) => x !== over && x.classList.remove('drop-before'));
  if (over.dataset.lk !== dragKey) over.classList.add('drop-before');
});
document.addEventListener('drop', (e) => {
  if (!dragKey) return;
  const over = e.target.closest('[data-lgroup] [data-lk]');
  if (!over || over.dataset.lk === dragKey) return;
  e.preventDefault();
  const order = currentOrder(S.arrange).filter((k) => k !== dragKey);
  order.splice(order.indexOf(over.dataset.lk), 0, dragKey);
  dragKey = null;
  storeOrder(S.arrange, order);
});
