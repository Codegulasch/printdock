// Feuchte-Check vor dem Start: Ist das Filament, aus dem gedruckt wird, zu feucht
// (Messwert der AMS/ACE-Einheit bzw. Trockenbox über dem Grenzwert des Materials)
// oder zu lange nicht getrocknet (nur für empfindliche Materialien)?
//   - Startdialog fragt: trotzdem drucken / erst trocknen, dann automatisch starten / anderer Drucker
//   - Auto-Start wartet bei zu feuchtem Filament (einstellbar)

const { store } = require('./store');
const { keyOf } = require('./drying');

// Grenzwerte je Material: hum = höchste rel. Feuchte (%), days = spätestens nach so vielen Tagen trocknen (0 = egal)
const DEFAULTS = [
  { m: 'PLA', hum: 60, days: 0 },
  { m: 'PETG', hum: 50, days: 0 },
  { m: 'ABS', hum: 50, days: 0 },
  { m: 'ASA', hum: 50, days: 0 },
  { m: 'TPU', hum: 40, days: 14 },
  { m: 'PA', hum: 30, days: 7 },
  { m: 'PC', hum: 35, days: 14 },
  { m: 'PVA', hum: 30, days: 7 },
  { m: '*', hum: 55, days: 0 },
];

const db = store('humcheck.json', { enabled: true, blockAuto: true, limits: DEFAULTS });
db.data.limits ??= DEFAULTS;

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z]/g, '');

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

class HumCheck {
  /** ctx: { filament, drying, printers(), files } */
  constructor(ctx) {
    this.ctx = ctx;
  }

  view() {
    return db.data;
  }

  save(body = {}) {
    if ('enabled' in body) db.data.enabled = Boolean(body.enabled);
    if ('blockAuto' in body) db.data.blockAuto = Boolean(body.blockAuto);
    if (Array.isArray(body.limits)) {
      const list = body.limits
        .map((x) => ({ m: String(x.m || '').trim().toUpperCase().slice(0, 12), hum: Math.max(5, Math.min(95, Number(x.hum) || 55)), days: Math.max(0, Math.min(365, Math.round(Number(x.days) || 0))) }))
        .filter((x) => x.m);
      if (!list.some((x) => x.m === '*')) list.push({ m: '*', hum: 55, days: 0 });
      db.data.limits = list;
    }
    db.save();
    return db.data;
  }

  /** Grenzwert für ein Material (längster passender Name gewinnt: „PA-CF“ → PA) */
  limitFor(material) {
    const m = norm(material);
    const hits = db.data.limits.filter((x) => x.m !== '*' && m.startsWith(norm(x.m))).sort((a, b) => norm(b.m).length - norm(a.m).length);
    return hits[0] || db.data.limits.find((x) => x.m === '*') || { m: '*', hum: 55, days: 0 };
  }

  /** Feuchte an der Stelle eines Platzes (Einheit des Druckers, sonst Messstelle für den ganzen Drucker) */
  humidityAt(printerId, unit) {
    const pts = this.ctx.filament.humPoints().filter((p) => p.type === 'printer' && p.printerId === printerId && p.value?.pct != null);
    return (pts.find((p) => p.unit === (unit || null)) || pts.find((p) => p.unit == null) || null)?.value?.pct ?? null;
  }

  /**
   * Prüfen, aus welchen Spulen ein Eintrag auf diesem Drucker druckt.
   * → { ok, issues: [{ nr, material, unit, pct, limit, days, dryDays, kind: 'hum'|'age' }], dryer }
   */
  check(cfg, file, options = {}) {
    if (!db.data.enabled || !cfg || !file) return { ok: true, issues: [], dryer: null };
    const fil = this.ctx.filament;
    const map = fil.mappingFor(cfg, file, options);
    const keys = Array.isArray(options.slotMap) && options.slotMap.length ? options.slotMap : map.suggested;
    const slots = fil.slotsFor(cfg);
    const issues = [];
    const units = new Set();
    for (const key of [...new Set(keys.filter(Boolean))]) {
      const sl = slots.find((s) => s.key === key);
      const sp = fil.spoolAt(cfg.id, key);
      const material = sp?.material || sl?.material;
      if (!material) continue;
      const lim = this.limitFor(material);
      const pct = this.humidityAt(cfg.id, sl?.unit || null);
      const base = { nr: sp?.nr || null, material, unit: sl?.unit || null, slot: sl?.label || key, limit: lim.hum };
      if (pct != null && pct > lim.hum) {
        issues.push({ ...base, kind: 'hum', pct: Math.round(pct) });
        units.add(sl?.unit || '');
      } else if (lim.days && sp) {
        const age = sp.driedAt ? (Date.now() - Date.parse(sp.driedAt)) / 864e5 : null;
        if (age == null || age > lim.days) {
          issues.push({ ...base, kind: 'age', days: lim.days, dryDays: age == null ? null : Math.floor(age) });
          units.add(sl?.unit || '');
        }
      }
    }
    // Trockner für die betroffene Stelle (AMS 2 Pro/HT, ACE-Makro, Trockenbox über HA)
    let dryer = null;
    if (issues.length) {
      const view = this.ctx.drying.view();
      for (const u of units) {
        const d = view.find((x) => x.key === keyOf({ type: 'printer', printerId: cfg.id, unit: u || null })) || view.find((x) => x.target.type === 'printer' && x.target.printerId === cfg.id && (!u || x.target.unit === u));
        if (d) { dryer = { key: d.key, name: d.name, active: d.active, suggest: d.suggest, loaded: d.loaded }; break; }
      }
    }
    return { ok: !issues.length, issues, dryer };
  }

  /** Kurzer Grund für die Warteschlange („PLA 64 % > 60 %“) oder null */
  blockReason(cfg, file, options = {}) {
    if (!db.data.enabled || !db.data.blockAuto) return null;
    const r = this.check(cfg, file, options);
    if (r.ok) return null;
    const x = r.issues[0];
    return x.kind === 'hum' ? `Filament zu feucht: ${x.nr || x.material} ${x.pct} % (max. ${x.limit} %)` : `${x.nr || x.material} sollte getrocknet werden (alle ${x.days} Tage)`;
  }
}

module.exports = { HumCheck, httpError };
