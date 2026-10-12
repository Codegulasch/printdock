// Statistik: wertet Verlauf und Filamentbuchungen über einen Zeitraum aus.

const DAY = 864e5;

function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {object} p { history, usage, printers, days }  days = 0 → alles
 */
function compute({ history, usage, printers, days }) {
  const now = Date.now();
  const since = days > 0 ? now - days * DAY : Math.min(now, ...history.map((h) => Date.parse(h.endedAt)).filter(Number.isFinite));
  const hs = history.filter((h) => Date.parse(h.endedAt) >= since);
  const us = usage.filter((u) => Date.parse(u.at) >= since && u.kind === 'print');

  const ok = hs.filter((h) => h.result === 'finished');
  const failed = hs.filter((h) => h.result === 'error');
  const cancelled = hs.filter((h) => h.result === 'cancelled');
  const hours = hs.reduce((a, h) => a + (h.durationSec || 0), 0) / 3600;
  const grams = us.reduce((a, u) => a + (u.grams || 0), 0);
  // Ausschuss: Filament nicht erfolgreicher Drucke
  const badIds = new Set(hs.filter((h) => h.result !== 'finished').map((h) => h.id));
  const scrapGrams = us.filter((u) => badIds.has(u.historyId)).reduce((a, u) => a + (u.grams || 0), 0);
  const cost = us.reduce((a, u) => a + (u.cost || 0), 0);

  // Tagesreihe (bei langen Zeiträumen wochenweise)
  const span = Math.max(1, Math.ceil((now - since) / DAY));
  const bucketDays = span > 120 ? 7 : 1;
  const buckets = [];
  const start = new Date(since);
  start.setHours(0, 0, 0, 0);
  for (let t = start.getTime(); t <= now; t += bucketDays * DAY) buckets.push({ from: t, key: dayKey(t), ok: 0, failed: 0, cancelled: 0, hours: 0, grams: 0 });
  const bucketOf = (ms) => buckets[Math.min(buckets.length - 1, Math.max(0, Math.floor((ms - start.getTime()) / (bucketDays * DAY))))];
  for (const h of hs) {
    const b = bucketOf(Date.parse(h.endedAt));
    if (!b) continue;
    if (h.result === 'finished') b.ok += 1;
    else if (h.result === 'error') b.failed += 1;
    else b.cancelled += 1;
    b.hours += (h.durationSec || 0) / 3600;
  }
  for (const u of us) {
    const b = bucketOf(Date.parse(u.at));
    if (b) b.grams += u.grams || 0;
  }

  // Je Drucker
  const byPrinter = printers.map((p) => {
    const list = hs.filter((h) => h.printerId === p.id);
    const h = list.reduce((a, x) => a + (x.durationSec || 0), 0) / 3600;
    const done = list.filter((x) => x.result === 'finished').length;
    return {
      id: p.id, name: p.name, prints: list.length, ok: done,
      failed: list.filter((x) => x.result === 'error').length,
      cancelled: list.filter((x) => x.result === 'cancelled').length,
      scrapGrams: Math.round(us.filter((u) => u.printerId === p.id && badIds.has(u.historyId)).reduce((a, u) => a + (u.grams || 0), 0)),
      // Häufigste Fehlergründe je Drucker
      reasons: Object.entries(list.filter((x) => x.result !== 'finished' && x.failReason).reduce((m, x) => ((m[x.failReason] = (m[x.failReason] || 0) + 1), m), {})).map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n).slice(0, 3),
      hours: r1(h),
      successRate: list.length ? Math.round((done / list.length) * 100) : null,
      utilization: Math.min(100, Math.round((h / (span * 24)) * 100)),
      grams: Math.round(us.filter((u) => u.printerId === p.id).reduce((a, u) => a + (u.grams || 0), 0)),
    };
  }).sort((a, b) => b.hours - a.hours);

  // Je Material
  const mats = {};
  for (const u of us) {
    const k = u.material || '?';
    mats[k] ||= { material: k, grams: 0, cost: 0, color: u.color || null };
    mats[k].grams += u.grams || 0;
    mats[k].cost += u.cost || 0;
  }
  const byMaterial = Object.values(mats).map((m) => ({ ...m, grams: Math.round(m.grams), cost: r2(m.cost) })).sort((a, b) => b.grams - a.grams);

  // Häufigste Dateien
  const filesMap = {};
  for (const h of hs) {
    if (!h.file) continue;
    filesMap[h.file] ||= { file: h.file, prints: 0, ok: 0, hours: 0 };
    filesMap[h.file].prints += 1;
    if (h.result === 'finished') filesMap[h.file].ok += 1;
    filesMap[h.file].hours += (h.durationSec || 0) / 3600;
  }
  const topFiles = Object.values(filesMap).map((f) => ({ ...f, hours: r1(f.hours) })).sort((a, b) => b.prints - a.prints).slice(0, 8);

  // Fehlerursachen (Meldungen)
  const reasons = {};
  for (const h of hs.filter((x) => x.result === 'error' || x.failReason)) {
    const k = h.failReason || (h.message || '').trim() || '–';
    reasons[k] = (reasons[k] || 0) + 1;
  }

  return {
    days, span, bucketDays,
    totals: {
      prints: hs.length, ok: ok.length, failed: failed.length, cancelled: cancelled.length,
      successRate: hs.length ? Math.round((ok.length / hs.length) * 100) : null,
      hours: r1(hours), grams: Math.round(grams), cost: r2(cost), scrapGrams: Math.round(scrapGrams),
      avgHours: hs.length ? r1(hours / hs.length) : null,
    },
    series: buckets.map((b) => ({ key: b.key, ok: b.ok, failed: b.failed, cancelled: b.cancelled, hours: r1(b.hours), grams: Math.round(b.grams) })),
    byPrinter, byMaterial, topFiles,
    failReasons: Object.entries(reasons).map(([message, n]) => ({ message, n })).sort((a, b) => b.n - a.n).slice(0, 6),
  };
}

module.exports = { compute };
