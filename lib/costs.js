// Kosten je Druck und je Auftrag: Material + Strom + Maschinenstunden, dazu Aufschlag.
//   Ist-Kosten:   aus dem Verlauf (gebuchtes Filament, gemessener Strom, tatsächliche Dauer)
//   Kalkulation:  aus den geslicten Dateien (Gramm, Druckzeit) – für Angebote vor dem Druck
// Preise: Spulenpreis je kg (sonst Durchschnitt gleicher Materialien, sonst Standardpreis),
// Strompreis, Maschinenstunde und Aufschlag aus den Einstellungen.

const app = require('./app');
const files = require('./files');

const r2 = (n) => Math.round(n * 100) / 100;
const matKey = (m) => String(m || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

class Costs {
  constructor({ filament, history, printers }) {
    this.filament = filament; // Filament-Instanz
    this.history = history; // () => Verlauf
    this.printers = printers; // () => Druckerliste
  }

  get c() {
    return app.costs;
  }

  /** Preis je Gramm für ein Material: Durchschnitt der Spulen mit Preis, sonst Standard */
  pricePerGram(material) {
    const key = matKey(material);
    const spools = this.filament.spoolRecords().filter((s) => !s.archived).filter((s) => s.price && s.netWeight && (!key || matKey(s.material) === key));
    if (spools.length) return spools.reduce((a, s) => a + s.price / s.netWeight, 0) / spools.length;
    return (Number(this.c.kgPrice) || 0) / 1000;
  }

  /** Durchschnittliche Leistung eines Druckers aus gemessenen Drucken, sonst Standard (W) */
  wattsFor(printerId) {
    const list = this.history().filter((h) => h.printerId === printerId && h.energyKwh > 0 && h.durationSec > 600);
    if (list.length) return (list.reduce((a, h) => a + h.energyKwh, 0) * 1000) / (list.reduce((a, h) => a + h.durationSec, 0) / 3600);
    return Number(this.c.watts) || 0;
  }

  finish(material, energy, machine) {
    const subtotal = material + energy + machine;
    const markup = (subtotal * (Number(this.c.markup) || 0)) / 100;
    return { material: r2(material), energy: r2(energy), machine: r2(machine), subtotal: r2(subtotal), markup: r2(markup), total: r2(subtotal + markup), currency: this.c.currency };
  }

  /** Ist-Kosten eines beendeten Drucks */
  forEntry(h) {
    const usage = this.filament.usageRecords().filter((u) => u.historyId === h.id);
    const grams = usage.reduce((a, u) => a + (u.grams || 0), 0);
    const material = usage.reduce((a, u) => a + (u.cost != null ? u.cost : (u.grams || 0) * this.pricePerGram(u.material)), 0);
    const hours = (h.durationSec || 0) / 3600;
    const kwh = h.energyKwh != null ? h.energyKwh : (this.wattsFor(h.printerId) * hours) / 1000;
    const out = this.finish(material, kwh * (Number(this.c.kwhPrice) || 0), hours * (Number(this.c.machineRate) || 0));
    return { ...out, grams: Math.round(grams * 10) / 10, hours: Math.round(hours * 100) / 100, kwh: Math.round(kwh * 1000) / 1000, kwhMeasured: h.energyKwh != null };
  }

  /** Kalkulation für ein Teil aus der geslicten Datei */
  forFile(file, printerId = null) {
    const m = file?.meta || {};
    const mats = m.materials?.length ? m.materials : [{ type: null, grams: m.filamentG }];
    const gs = m.filamentGs || [];
    let grams = 0;
    let material = 0;
    mats.forEach((x, i) => {
      const g = Number(x.grams ?? gs[i] ?? (mats.length === 1 ? m.filamentG : 0)) || 0;
      grams += g;
      material += g * this.pricePerGram(x.type);
    });
    const hours = (Number(m.estimatedSec) || 0) / 3600;
    const watts = printerId ? this.wattsFor(printerId) : Number(this.c.watts) || 0;
    const kwh = (watts * hours) / 1000;
    const out = this.finish(material, kwh * (Number(this.c.kwhPrice) || 0), hours * (Number(this.c.machineRate) || 0));
    return { ...out, grams: Math.round(grams * 10) / 10, hours: Math.round(hours * 100) / 100, kwh: Math.round(kwh * 1000) / 1000, known: Boolean(grams || hours) };
  }

  /** Auftrag: Kalkulation (alle Stück) und Ist-Kosten (bisher gedruckt) */
  forOrder(o) {
    const positions = (o.positions || []).map((pos) => {
      const f = files.get(pos.fileId);
      const one = this.forFile(f);
      const mul = (k) => r2(one[k] * pos.qty);
      return { id: pos.id, file: f?.name || '?', qty: pos.qty, each: one, material: mul('material'), energy: mul('energy'), machine: mul('machine'), total: mul('total'), grams: Math.round(one.grams * pos.qty), hours: r2(one.hours * pos.qty) };
    });
    const sum = (list, k) => r2(list.reduce((a, x) => a + (x[k] || 0), 0));
    const estimate = { ...this.finish(sum(positions, 'material'), sum(positions, 'energy'), sum(positions, 'machine')), grams: sum(positions, 'grams'), hours: sum(positions, 'hours'), positions };
    const entries = this.history().filter((h) => h.orderId === o.id);
    const each = entries.map((h) => ({ id: h.id, file: h.file, printerName: h.printerName, result: h.result, endedAt: h.endedAt, photo: Boolean(h.photo), ...this.forEntry(h) }));
    const actual = { ...this.finish(sum(each, 'material'), sum(each, 'energy'), sum(each, 'machine')), grams: sum(each, 'grams'), hours: sum(each, 'hours'), kwh: sum(each, 'kwh'), prints: each.length, failed: each.filter((x) => x.result !== 'finished').length, entries: each };
    return { estimate, actual };
  }
}

module.exports = { Costs };
