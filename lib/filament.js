// Filamentverwaltung: Spulenlager, Belegung der Filament-Plätze je Drucker
// (AMS, ACE, Werkzeugköpfe, externe Spule) und automatische Abbuchung.
//
// Plätze eines Druckers – in dieser Reihenfolge:
//   1. vom Drucker gemeldet (Bambu AMS inkl. RFID und Restmenge in %)
//   2. zuletzt gemeldete Plätze, wenn der Drucker gerade offline ist
//   3. von Hand festgelegt (Drucker-Einstellung "Filament-Plätze", z. B. "ACE 1, ACE 2, ACE 3, ACE 4")
//   4. je Düse ein Platz (z. B. Snapmaker U1: T0–T3), sonst ein einzelner Platz
//
// Abbuchung nach jedem Druck:
//   - aus PrintDock gestartet: Gramm je Filament aus der Datei (Slicer-Angabe),
//     bei Abbruch/Fehler anteilig nach Fortschritt; Filament i → Platz nach
//     AMS-Zuordnung (Bambu) bzw. Reihenfolge der Plätze (Werkzeug i)
//   - am Drucker gestartet: gemeldeter Verbrauch in mm (Klipper) → Gramm über
//     Dichte und Durchmesser, auf den zuletzt aktiven Platz – als "geschätzt" markiert
//   - sonst nichts; der Verbrauch lässt sich von Hand nachtragen

const crypto = require('crypto');
const { store } = require('./store');
const files = require('./files');
const colors = require('./colors');

const db = store('spools.json', { spools: [], usage: [], liveSlots: {}, settings: { lowGrams: 100 } });
db.data.settings ??= { lowGrams: 100 };
db.data.liveSlots ??= {};
db.data.slotSig ??= {}; // printerId -> { key: "MATERIAL|#RRGGBB|uid" } – zuletzt gemeldete Belegung
db.data.ignored ??= {}; // "printerId:key" -> Signatur, für die keine Spule angelegt werden soll
db.data.humidity ??= {}; // "printerId|Einheit" -> [[Zeit, %rF, °C]] der letzten 7 Tage
db.data.settings.humWarn ??= 40;
db.data.settings.humAlarm ??= 55;
db.data.settings.pushAms ??= true;
// Feuchte-Messstellen ohne eigene Messung im AMS/ACE: Sensor aus Home Assistant oder einer PrintDock Station
// [{ id, kind: 'ha'|'station', entity?, stationId?, name?, target: { type: 'printer', printerId, unit } | { type: 'storage', name } }]
db.data.humSources ??= [];
const STORAGE = '@lager'; // Schlüssel-Präfix für Trockenboxen und Lagerorte // Belegung (Material/Farbe) an Bambu-AMS übertragen

const ARM_MS = 3 * 60_000; // so lange wartet eine an der Station gescannte Spule aufs Einlegen

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const round1 = (n) => Math.round(n * 10) / 10;

/** Dichte in g/cm³ – Richtwerte, für die Umrechnung mm → g. */
const DENSITY = { PLA: 1.24, PETG: 1.27, PCTG: 1.23, ABS: 1.04, ASA: 1.07, TPU: 1.21, PA: 1.14, PC: 1.2, PVA: 1.19, HIPS: 1.04, PP: 0.9 };
const MATERIALS = ['PLA', 'PLA+', 'PLA Silk', 'PLA Matt', 'PETG', 'PCTG', 'ABS', 'ASA', 'TPU', 'PA', 'PA-CF', 'PC', 'PVA', 'HIPS'];

function density(material) {
  const m = String(material || '').toUpperCase();
  const key = Object.keys(DENSITY).find((k) => m.startsWith(k));
  return key ? DENSITY[key] : 1.24;
}

function mmToGrams(mm, material, diameter = 1.75) {
  const r = diameter / 20; // cm
  return (mm / 10) * Math.PI * r * r * density(material);
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

const normMat = (s) => String(s || '').toUpperCase().replace(/[^A-Z]/g, '');
/** Gleiches Material? „PLA Basic“ ≈ „PLA“, „PETG HF“ ≈ „PETG“. */
const sameMaterial = (a, b) => {
  const x = normMat(a);
  const y = normMat(b);
  if (!x || !y) return false;
  return x.startsWith(y) || y.startsWith(x) || x.slice(0, 3) === y.slice(0, 3);
};
const COLOR_MATCH = 70; // bis zu diesem Abstand gilt ein Farbton als gleich
const slotSig = (slot) => (slot.material ? `${normMat(slot.material)}|${colors.normalize(slot.color) || ''}|${slot.uid || ''}` : '');

/** RFID-Kennungen, die mehrere Plätze gleichzeitig melden, sind keine echten Chips → verwerfen. */
function uniqueUids(list) {
  const count = {};
  for (const sl of list) if (sl.uid) count[sl.uid] = (count[sl.uid] || 0) + 1;
  return list.map((sl) => (sl.uid && count[sl.uid] > 1 ? { ...sl, uid: null } : sl));
}

// Aufräumen: Spulen mit Schein-RFID (z. B. „0“ oder dieselbe Kennung bei mehreren Spulen) aus älteren Versionen
{
  const seen = {};
  for (const sp of db.data.spools) if (sp.rfid) seen[sp.rfid] = (seen[sp.rfid] || 0) + 1;
  let fixed = 0;
  for (const sp of db.data.spools) {
    if (sp.rfid && (seen[sp.rfid] > 1 || /^[0\s,:.-]*$/.test(sp.rfid))) { sp.rfid = null; fixed++; }
  }
  if (fixed) db.save();
}

/** Platz für einen Tag ohne Platzangabe: der gerade aktive Platz des Druckers (falls bekannt). */
function status0(self, cfg) {
  return self.ctx.runtime.get(cfg.id)?.driver.status?.activeSlot || null;
}

class Filament {
  /**
   * @param ctx { printers(), runtime, broadcast(event), notify(event, cfg, status, extra), getQueueItem(id) }
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.present = {}; // "printerId:key" -> steckt eine Spule? (für das Erkennen des Einlegens)
    this.armed = null; // { spoolId, at, source } – gescannt, wartet aufs Einlegen
  }

  get lowGrams() {
    return Number(db.data.settings.lowGrams) || 100;
  }

  save() {
    db.save();
    this.ctx.broadcast('filament', null);
  }

  // ================================================================ Plätze

  slotsFor(cfg) {
    const status = this.ctx.runtime.get(cfg.id)?.driver.status;
    if (status?.filament?.length) return uniqueUids(status.filament).map((s) => ({ ...s, live: true }));
    if (db.data.liveSlots[cfg.id]?.length) return db.data.liveSlots[cfg.id].map((s) => ({ ...s, live: false }));
    const manual = String(cfg.settings?.slots || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (manual.length) return manual.map((label, i) => ({ key: `s${i}`, label, unit: null }));
    const n = status?.nozzles?.length || 0;
    if (n > 1) return Array.from({ length: n }, (_, i) => ({ key: `T${i}`, label: `Werkzeug ${i + 1}`, unit: 'Werkzeug' }));
    return [{ key: 'main', label: 'Spule', unit: null }];
  }

  spoolAt(printerId, key) {
    return db.data.spools.find((s) => !s.archived && s.slot?.printerId === printerId && s.slot?.key === key) || null;
  }

  /**
   * Bei jedem Status-Update:
   *  - gemeldete Plätze merken,
   *  - Spulenwechsel erkennen (anderes Material/andere Farbe → alte Spule zurück ins Lager),
   *  - Spulen zuordnen: zuerst per RFID, sonst nach Material und Farbe aus dem Lager.
   * Was sich nicht zuordnen lässt, bietet die Oberfläche zum Anlegen an.
   */
  onStatus(cfg, status) {
    for (const u of status.filamentUnits || []) if (u.humidityPct != null) this.recordHumidity(cfg, u.name, u.humidityPct, u.temp);
    const live = status.filament || [];
    if (!live.length) return;
    const slim = live.map(({ key, label, unit }) => ({ key, label, unit }));
    let changed = false;
    if (JSON.stringify(db.data.liveSlots[cfg.id]) !== JSON.stringify(slim)) {
      db.data.liveSlots[cfg.id] = slim;
      changed = true;
    }
    const sigs = (db.data.slotSig[cfg.id] ||= {});
    // Eine Kennung, die mehrere Plätze gleichzeitig melden, ist keine echte RFID (z. B. „0“ oder Artikelnummer)
    for (const slot of uniqueUids(live)) {
      const sig = slotSig(slot);
      const prev = sigs[slot.key];
      // Eingelegt? (Fach meldet jetzt eine Spule, vorher nicht – oder es meldet etwas anderes)
      const pk = `${cfg.id}:${slot.key}`;
      const isPresent = slot.present ?? Boolean(slot.material || slot.uid);
      const wasPresent = this.present[pk];
      this.present[pk] = isPresent;
      const inserted = wasPresent !== undefined && isPresent && (!wasPresent || (prev !== undefined && prev !== sig && Boolean(sig)));
      let current = this.spoolAt(cfg.id, slot.key);
      if (prev !== undefined && prev !== sig) {
        // Am Drucker wurde getauscht
        if (current && (!sig || !this.spoolMatches(current, slot))) {
          current.slot = null;
          this.ext?.placed(current);
          current = null;
          changed = true;
        }
        delete db.data.ignored[`${cfg.id}:${slot.key}`];
      }
      if (prev !== sig) {
        sigs[slot.key] = sig;
        changed = true;
      }
      // 0. Gerade an einer Station gescannte Spule → kommt in das Fach, in das jetzt etwas eingelegt wurde
      if (inserted && this.armed && Date.now() - this.armed.at < ARM_MS && (!this.armed.source?.printerId || this.armed.source.printerId === cfg.id)) {
        const spool = db.data.spools.find((s) => s.id === this.armed.spoolId && !s.archived);
        const other = slot.uid && db.data.spools.find((s) => !s.archived && s.rfid === slot.uid && s !== spool);
        // Meldet der Drucker per Chip ein anderes Material, ist es nicht die gescannte Spule
        const contradicts = spool && slot.uid && slot.material && !sameMaterial(spool.material, slot.material);
        if (spool && !other && !contradicts) {
          const source = this.armed.source;
          this.armed = null;
          if (slot.uid && !spool.rfid) spool.rfid = slot.uid;
          this.placeSpool(spool, cfg.id, slot.key, { push: true });
          this.ctx.onPlaced?.(spool, cfg, slot, source);
          console.log(`Station: ${spool.nr} → ${cfg.name} · ${slot.label}`);
          changed = true;
          continue;
        }
      }
      if (!slot.material) continue;
      // 1. RFID
      if (slot.uid) {
        const byTag = db.data.spools.find((s) => !s.archived && s.rfid && s.rfid === slot.uid);
        // Nur umziehen, wenn der bisherige Platz der Spule diese Kennung nicht mehr meldet
        const elsewhere = byTag?.slot && !(byTag.slot.printerId === cfg.id && byTag.slot.key === slot.key) && this.reportsUid(byTag.slot, slot.uid);
        if (byTag && byTag !== current && !elsewhere) {
          this.placeSpool(byTag, cfg.id, slot.key);
          changed = true;
          continue;
        }
      }
      // 2. Material und Farbe aus dem Lager
      if (!current) {
        const match = this.findMatch(slot);
        if (match) {
          this.placeSpool(match, cfg.id, slot.key);
          changed = true;
        }
      }
    }
    if (changed) this.save();
  }

  /** Meldet der Platz (Drucker, Schlüssel) gerade diese RFID-Kennung? */
  reportsUid(where, tag) {
    const st = this.ctx.runtime.get(where.printerId)?.driver.status;
    return Boolean(st?.filament?.some((sl) => sl.key === where.key && sl.uid === tag));
  }

  /** Passt eine Spule zu dem, was der Drucker in diesem Platz meldet? */
  spoolMatches(spool, slot) {
    if (slot.uid && spool.rfid) return slot.uid === spool.rfid;
    if (!sameMaterial(spool.material, slot.material)) return false;
    const c = colors.normalize(slot.color);
    return !c || !spool.color || colors.distance(c, spool.color) <= COLOR_MATCH;
  }

  /** Beste freie Spule im Lager für einen gemeldeten Platz (nur bei eindeutigem Treffer). */
  findMatch(slot) {
    const c = colors.normalize(slot.color);
    if (!c) return null;
    const cands = db.data.spools
      .filter((s) => !s.archived && !s.slot && (!s.rfid || !slot.uid) && s.remaining > 0 && sameMaterial(s.material, slot.material))
      .map((s) => ({ s, d: colors.distance(c, s.color) + (slot.brand && s.brand && normMat(slot.brand).includes(normMat(s.brand)) ? -10 : 0) }))
      .filter((x) => x.d <= COLOR_MATCH)
      .sort((a, b) => a.d - b.d || (Date.parse(b.s.lastUsedAt || 0) - Date.parse(a.s.lastUsedAt || 0)));
    return cands[0]?.s || null;
  }

  /** Für diesen Platz keine Spule anlegen (bis sich die Belegung ändert). */
  ignoreSlot(printerId, key) {
    const cfg = this.ctx.printers().find((p) => p.id === printerId);
    const slot = cfg && this.slotsFor(cfg).find((s) => s.key === key);
    if (!slot) throw httpError(404, 'Platz nicht gefunden');
    db.data.ignored[`${printerId}:${key}`] = slotSig(slot);
    this.save();
  }

  /** opts.push: Material/Farbe an den Drucker übertragen (Bambu-AMS), wenn das Fach etwas anderes meldet */
  placeSpool(spool, printerId, key, opts = {}) {
    const occupant = this.spoolAt(printerId, key);
    if (occupant && occupant.id !== spool.id) {
      occupant.slot = null;
      this.ext?.placed(occupant);
    }
    const changed = spool.slot?.printerId !== printerId || spool.slot?.key !== key;
    spool.slot = { printerId, key };
    if (this.armed?.spoolId === spool.id) this.armed = null;
    if (changed) this.ext?.placed(spool);
    if (opts.push && db.data.settings.pushAms !== false) {
      const cfg = this.ctx.printers().find((p) => p.id === printerId);
      const slot = cfg && this.slotsFor(cfg).find((s) => s.key === key);
      // Bambu-Spulen mit eigenem Chip nicht überschreiben; passt die Meldung schon, nichts tun
      if (slot && slot.live && !slot.uid && !(slot.material && this.spoolMatches(spool, slot))) {
        Promise.resolve(this.ctx.pushSlot?.(cfg, key, spool)).catch((err) => console.warn(`Belegung an ${cfg.name} nicht übertragen: ${err.message}`));
      }
    }
  }

  /**
   * Gescannte Spule merken: das nächste Einlegen an einem Drucker ordnet sie zu.
   * source: { stationId, printerId? } – mit printerId nur an diesem Drucker
   */
  arm(spool, source = null) {
    this.armed = { spoolId: spool.id, at: Date.now(), source };
    this.ctx.broadcast('filament', null);
  }

  disarm() {
    this.armed = null;
    this.ctx.broadcast('filament', null);
  }

  armedView() {
    const a = this.armed;
    if (!a || Date.now() - a.at > ARM_MS) return null;
    return { ...a, until: new Date(a.at + ARM_MS).toISOString() };
  }

  // ================================================================ Ansicht

  view() {
    const printers = this.ctx.printers().map((cfg) => {
      const status = this.ctx.runtime.get(cfg.id)?.driver.status;
      return {
        id: cfg.id,
        name: cfg.name,
        online: Boolean(status?.online),
        activeSlot: status?.activeSlot || null,
        slots: this.slotsFor(cfg).map((slot) => {
          const spool = this.spoolAt(cfg.id, slot.key);
          const mismatch = Boolean(spool && slot.material && slot.live !== false && !this.spoolMatches(spool, slot));
          const ignored = db.data.ignored[`${cfg.id}:${slot.key}`] === slotSig(slot);
          return { ...slot, spoolId: spool?.id || null, mismatch, unmatched: Boolean(slot.material && slot.live && !spool && !ignored) };
        }),
      };
    });
    const since = Date.now() - 30 * 864e5;
    const recent = db.data.usage.filter((u) => Date.parse(u.at) >= since && u.kind === 'print');
    const byMaterial = {};
    for (const u of recent) {
      const k = u.material || 'unbekannt';
      byMaterial[k] = byMaterial[k] || { grams: 0, cost: 0 };
      byMaterial[k].grams += u.grams || 0;
      byMaterial[k].cost += u.cost || 0;
    }
    return {
      spools: db.data.spools.map((s) => ({ ...s, low: !s.archived && s.remaining <= this.lowGrams, pricePerKg: s.price && s.netWeight ? round1((s.price / s.netWeight) * 1000) : null })),
      printers,
      usage: db.data.usage.slice(-300).reverse(),
      stats30: Object.entries(byMaterial).map(([material, v]) => ({ material, grams: round1(v.grams), cost: Math.round(v.cost * 100) / 100 })).sort((a, b) => b.grams - a.grams),
      settings: db.data.settings,
      materials: MATERIALS,
      humidity: this.humidityView(),
      pendingTag: this.pendingTag ? { ...this.pendingTag, printerName: this.ctx.printers().find((p) => p.id === this.pendingTag.printerId)?.name || null } : null,
      armed: this.armedView(),
      humPoints: this.humPoints(),
    };
  }

  /** Verbrauchsbuchungen (für die Statistik). */
  usageRecords() {
    return db.data.usage;
  }

  summary() {
    const active = db.data.spools.filter((s) => !s.archived);
    return {
      spools: active.length,
      spoolsLow: active.filter((s) => s.remaining <= this.lowGrams).length,
      stockKg: round1(active.reduce((a, s) => a + (s.remaining || 0), 0) / 1000),
    };
  }

  // ================================================================ Spulen bearbeiten

  nextNr() {
    const nums = db.data.spools.map((s) => Number(String(s.nr).replace(/\D/g, ''))).filter(Boolean);
    return (nums.length ? Math.max(...nums) : 0) + 1;
  }

  saveSpool(body, id = null, opts = {}) {
    const existing = id ? db.data.spools.find((s) => s.id === id) : null;
    if (id && !existing) throw httpError(404, 'Spule nicht gefunden');
    const material = String(body.material || '').trim();
    if (!material) throw httpError(400, 'Bitte das Material angeben');
    const netWeight = Number(body.netWeight) || existing?.netWeight || 1000;
    if (netWeight <= 0 || netWeight > 20000) throw httpError(400, 'Nettogewicht unplausibel');
    const fields = {
      material: material.slice(0, 40),
      brand: String(body.brand || '').trim().slice(0, 60),
      colorName: String(body.colorName || '').trim().slice(0, 60),
      color: /^#[0-9a-f]{6}$/i.test(body.color || '') ? body.color.toUpperCase() : existing?.color || '#888888',
      diameter: [1.75, 2.85].includes(Number(body.diameter)) ? Number(body.diameter) : 1.75,
      netWeight,
      tare: Math.max(0, Number(body.tare) || 0),
      price: body.price === '' || body.price == null ? null : Math.max(0, Number(body.price) || 0),
      location: String(body.location || '').trim().slice(0, 60),
      rfid: String(body.rfid || '').trim().slice(0, 64) || null,
      note: String(body.note || '').slice(0, 300),
    };
    if (existing) {
      Object.assign(existing, fields);
      if (body.remaining !== undefined && body.remaining !== '') this.setRemaining(existing, Number(body.remaining), 'Restmenge korrigiert');
      if (body.archived !== undefined) {
        existing.archived = Boolean(body.archived);
        if (existing.archived) existing.slot = null;
      }
      this.save();
      return existing;
    }
    const count = Math.max(1, Math.min(50, Number(body.count) || 1));
    const created = [];
    for (let i = 0; i < count; i++) {
      const s = {
        id: uid(),
        nr: `S-${String(this.nextNr()).padStart(3, '0')}`,
        ...fields,
        rfid: i === 0 ? fields.rfid : null,
        remaining: body.remaining !== undefined && body.remaining !== '' ? Math.max(0, Number(body.remaining)) : netWeight,
        slot: null,
        archived: false,
        createdAt: now(),
        lastUsedAt: null,
      };
      db.data.spools.push(s);
      created.push(s);
    }
    if (body.printerId && body.slotKey) this.placeSpool(created[0], body.printerId, body.slotKey);
    this.save();
    if (!opts.silent) for (const c of created) this.ext?.created(c);
    return created;
  }

  setRemaining(spool, grams, note, kind = 'correction') {
    const before = spool.remaining;
    spool.remaining = Math.max(0, round1(grams));
    if (spool.remaining > this.lowGrams) spool.lowNotified = false;
    if (before !== spool.remaining) {
      db.data.usage.push({
        id: uid(), at: now(), kind, spoolId: spool.id, spoolNr: spool.nr, material: spool.material, color: spool.color,
        grams: round1(before - spool.remaining), note,
      });
      this.ext?.remainingSet(spool);
    }
  }

  deleteSpool(id) {
    const idx = db.data.spools.findIndex((s) => s.id === id);
    if (idx < 0) throw httpError(404, 'Spule nicht gefunden');
    db.data.spools.splice(idx, 1);
    this.save();
  }

  /** Spule in einen Platz legen (spoolId null = Platz leeren). */
  assign(printerId, key, spoolId) {
    const cfg = this.ctx.printers().find((p) => p.id === printerId);
    if (!cfg) throw httpError(404, 'Drucker nicht gefunden');
    if (!this.slotsFor(cfg).some((s) => s.key === key)) throw httpError(400, 'Unbekannter Filament-Platz');
    const current = this.spoolAt(printerId, key);
    if (!spoolId) {
      if (current) {
        current.slot = null;
        this.ext?.placed(current);
      }
    } else {
      const spool = db.data.spools.find((s) => s.id === spoolId && !s.archived);
      if (!spool) throw httpError(404, 'Spule nicht gefunden');
      this.placeSpool(spool, printerId, key, { push: true });
    }
    this.save();
  }

  /** Spule wiegen: Bruttogewicht minus Leerspule = Rest. */
  weigh(id, gross) {
    const s = db.data.spools.find((x) => x.id === id);
    if (!s) throw httpError(404, 'Spule nicht gefunden');
    const g = Number(gross);
    if (!(g >= 0)) throw httpError(400, 'Gewicht fehlt');
    if (!s.tare) throw httpError(400, 'Für diese Spule ist kein Leergewicht hinterlegt – bitte bei der Spule eintragen');
    this.setRemaining(s, g - s.tare, `gewogen: ${g} g brutto`, 'weigh');
    this.save();
    return s;
  }

  /** Verbrauch von Hand abbuchen (z. B. Druck ohne erfassten Verbrauch). */
  book(id, grams, note) {
    const s = db.data.spools.find((x) => x.id === id);
    if (!s) throw httpError(404, 'Spule nicht gefunden');
    const g = Number(grams);
    if (!(g > 0)) throw httpError(400, 'Bitte eine Menge in Gramm angeben');
    s.remaining = Math.max(0, round1(s.remaining - g));
    s.lastUsedAt = now();
    this.ext?.used(s, g);
    db.data.usage.push({
      id: uid(), at: now(), kind: 'manual', spoolId: s.id, spoolNr: s.nr, material: s.material, color: s.color,
      grams: round1(g), cost: s.price && s.netWeight ? round1((s.price / s.netWeight) * g * 100) / 100 : null, note: String(note || '').slice(0, 200),
    });
    this.save();
    this.checkLow(s, null);
    return s;
  }

  /** Neue Spule aus den Angaben eines Platzes (z. B. Bambu-RFID-Spule). */
  fromSlot(printerId, key, overrides = {}) {
    const cfg = this.ctx.printers().find((p) => p.id === printerId);
    const slot = cfg && this.slotsFor(cfg).find((s) => s.key === key);
    if (!slot) throw httpError(404, 'Platz nicht gefunden');
    const net = Number(overrides.netWeight) || slot.weight || 1000;
    const remaining = overrides.remaining != null && overrides.remaining !== '' ? Number(overrides.remaining) : slot.remainPct != null ? round1((net * slot.remainPct) / 100) : net;
    const color = colors.normalize(slot.color);
    return this.saveSpool({
      material: slot.material || 'PLA',
      brand: overrides.brand ?? (slot.vendor || (slot.uid && /bambu/i.test(cfg.driver) ? 'Bambu Lab' : '') || ''),
      colorName: colors.nameOf(color),
      color, netWeight: net, remaining, rfid: slot.uid,
      note: slot.brand && slot.brand !== slot.material ? slot.brand : '',
      printerId, slotKey: key,
    })[0];
  }

  saveSettings(body) {
    if (body.lowGrams !== undefined) db.data.settings.lowGrams = Math.max(0, Number(body.lowGrams) || 0);
    if (body.humWarn !== undefined) db.data.settings.humWarn = Math.min(95, Math.max(5, Number(body.humWarn) || 40));
    if (body.pushAms !== undefined) db.data.settings.pushAms = Boolean(body.pushAms);
    if (body.humAlarm !== undefined) db.data.settings.humAlarm = Math.min(99, Math.max(Number(db.data.settings.humWarn) + 1, Number(body.humAlarm) || 55));
    this.save();
    return db.data.settings;
  }

  // ================================================================ Abbuchung

  /**
   * Nach Druckende: Verbrauch ermitteln, von den Spulen abziehen, im Verlauf vermerken.
   * @param entry Verlaufseintrag (enthält queueId, progress, filamentMm, activeSlot)
   */
  onJobEnd(cfg, entry) {
    const slots = this.slotsFor(cfg);
    const item = entry.queueId ? this.ctx.getQueueItem(entry.queueId) : null;
    const file = item ? files.get(item.fileId) : null;
    const factor = entry.result === 'finished' ? 1 : Math.max(0, Math.min(1, (entry.progress ?? 0) / 100));
    const parts = []; // { key, grams, material, estimated }

    if (file?.meta && factor > 0) {
      const m = file.meta;
      let grams = (m.materials || []).map((x) => x.grams);
      if (!grams.length || grams.some((g) => g == null)) grams = m.filamentGs || (m.filamentG != null ? [m.filamentG] : []);
      const isBambu = cfg.driver === 'bambu';
      const mapping = String(item.options?.amsMapping || '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
        .map(Number);
      grams.forEach((g, i) => {
        if (!(g > 0)) return;
        let key;
        if (Array.isArray(item.options?.slotMap) && item.options.slotMap[i]) {
          key = item.options.slotMap[i];
        } else if (isBambu) {
          const Bambu = require('../drivers/bambu');
          key = Bambu.slotForMapping(mapping.length ? mapping[i] : i);
          if (grams.length === 1 && !mapping.length && entry.activeSlot) key = entry.activeSlot;
        } else if (grams.length === 1) {
          key = entry.activeSlot || slots[0]?.key;
        } else {
          key = slots[i]?.key;
        }
        parts.push({ key, grams: g * factor, material: m.materials?.[i]?.type || null, estimated: false });
      });
    } else if (entry.filamentMm > 0) {
      const key = entry.activeSlot || slots.find((s) => this.spoolAt(cfg.id, s.key))?.key || slots[0]?.key;
      const spool = key ? this.spoolAt(cfg.id, key) : null;
      parts.push({ key, grams: mmToGrams(entry.filamentMm, spool?.material, spool?.diameter), material: spool?.material || null, estimated: true });
    }

    entry.filament = [];
    for (const p of parts) {
      const spool = p.key ? this.spoolAt(cfg.id, p.key) : null;
      const grams = round1(p.grams);
      const slotLabel = slots.find((s) => s.key === p.key)?.label || p.key || '?';
      const cost = spool?.price && spool.netWeight ? Math.round((spool.price / spool.netWeight) * grams * 100) / 100 : null;
      if (spool) {
        spool.remaining = Math.max(0, round1(spool.remaining - grams));
        spool.lastUsedAt = now();
        this.ext?.used(spool, grams);
      }
      db.data.usage.push({
        id: uid(), at: now(), kind: 'print', spoolId: spool?.id || null, spoolNr: spool?.nr || null,
        material: spool?.material || p.material, color: spool?.color || null, printerId: cfg.id, printerName: cfg.name,
        slot: slotLabel, historyId: entry.id, file: entry.file, grams, cost, estimated: p.estimated,
        note: spool ? null : 'Keine Spule zugeordnet – nicht abgebucht',
      });
      entry.filament.push({ spoolId: spool?.id || null, spoolNr: spool?.nr || null, slot: slotLabel, grams, estimated: p.estimated });
      if (spool) this.checkLow(spool, cfg);
    }
    db.data.usage = db.data.usage.slice(-5000);
    this.save();
    return entry.filament;
  }

  checkLow(spool, cfg) {
    if (spool.remaining <= this.lowGrams && !spool.lowNotified) {
      spool.lowNotified = true;
      const printer = cfg || this.ctx.printers().find((p) => p.id === spool.slot?.printerId) || { id: 'lager', name: 'Filamentlager' };
      this.ctx.notify('filamentLow', printer, null, { spool });
      db.save();
    }
  }

  /** Reicht das geladene Filament für eine Datei? Für die Prüfung vor dem Start. */
  check(cfg, file, options = {}) {
    if (!file?.meta) return [];
    const slots = this.slotsFor(cfg);
    const m = file.meta;
    let grams = (m.materials || []).map((x) => x.grams);
    if (!grams.length || grams.some((g) => g == null)) grams = m.filamentGs || (m.filamentG != null ? [m.filamentG] : []);
    const mapping = String(options.amsMapping || '').split(',').map((v) => v.trim()).filter(Boolean).map(Number);
    const status = this.ctx.runtime.get(cfg.id)?.driver.status;
    const slotMap = Array.isArray(options.slotMap) ? options.slotMap : null;
    return grams.map((g, i) => {
      let key;
      if (slotMap?.[i]) key = slotMap[i];
      else if (cfg.driver === 'bambu') {
        key = require('../drivers/bambu').slotForMapping(mapping.length ? mapping[i] : i);
        if (grams.length === 1 && !mapping.length && status?.activeSlot) key = status.activeSlot;
      } else key = grams.length === 1 ? status?.activeSlot || slots[0]?.key : slots[i]?.key;
      const spool = key ? this.spoolAt(cfg.id, key) : null;
      const wantMat = m.materials?.[i]?.type || null;
      return {
        slot: slots.find((s) => s.key === key)?.label || key || '?',
        need: round1(g || 0),
        material: wantMat,
        spool: spool ? { nr: spool.nr, material: spool.material, color: spool.color, remaining: spool.remaining } : null,
        enough: spool ? spool.remaining >= (g || 0) : null,
        materialOk: spool && wantMat ? normMat(spool.material).startsWith(normMat(wantMat).slice(0, 3)) : null,
      };
    });
  }

  // ================================================================ Filamentfeuchte

  humLevel(pct) {
    if (pct == null) return null;
    if (pct >= Number(db.data.settings.humAlarm)) return 'alarm';
    if (pct >= Number(db.data.settings.humWarn)) return 'warn';
    return 'ok';
  }

  /**
   * Feuchtewert einer AMS/ACE-Einheit oder eines externen Sensors merken.
   * Speichert höchstens alle 10 Minuten (oder bei deutlicher Änderung) und meldet,
   * wenn eine Einheit über den Warn- bzw. Alarmwert steigt (höchstens alle 6 Stunden).
   */
  recordHumidity(cfg, unit, pct, temp = null) {
    const h = Number(pct);
    if (!Number.isFinite(h) || h < 0 || h > 100) return;
    const key = `${cfg.id}|${unit}`;
    const list = (db.data.humidity[key] ||= []);
    const last = list[list.length - 1];
    const t = Date.now();
    this.humNow ||= {};
    this.humNow[key] = { pct: h, temp: temp != null ? Number(temp) : null, at: t };
    if (!last || t - last[0] > 10 * 60_000 || Math.abs(last[1] - h) >= 3) {
      list.push([t, round1(h), temp != null ? round1(Number(temp)) : null]);
      while (list.length && list[0][0] < t - 7 * 864e5) list.shift();
      this.dirtyHum = true;
      if (!this.humSaveTimer) this.humSaveTimer = setTimeout(() => { this.humSaveTimer = null; if (this.dirtyHum) { this.dirtyHum = false; db.save(); } }, 30_000);
    }
    // Meldung beim Überschreiten
    const level = this.humLevel(h);
    this.humState ||= {};
    const prev = this.humState[key] || { level: 'ok', at: 0 };
    const rank = { ok: 0, warn: 1, alarm: 2 };
    if (rank[level] > rank[prev.level] && t - prev.at > 6 * 3600_000) {
      this.humState[key] = { level, at: t };
      const spools = cfg.id === STORAGE
        ? this.spoolsAtLocation(unit)
        : this.slotsFor(cfg).filter((sl) => !sl.unit || sl.unit === unit).map((sl) => this.spoolAt(cfg.id, sl.key)).filter(Boolean);
      const who = cfg.id === STORAGE ? { id: `${STORAGE}:${unit}`, name: unit } : cfg;
      this.ctx.notify('humidity', who, null, { unit: cfg.id === STORAGE ? 'Lager' : unit, pct: round1(h), level, spools: spools.map((sp) => `${sp.nr} ${sp.material}`) });
      this.ctx.broadcast('filament', null);
    } else if (rank[level] !== rank[prev.level]) {
      this.humState[key] = { level, at: prev.at };
      this.ctx.broadcast('filament', null); // Farbe an Druckern und Karten nachziehen
    }
  }

  /** Feuchte je Einheit mit Verlauf (stündlich gemittelt, 48 h) für die Oberfläche. */
  humidityView() {
    const printers = this.ctx.printers();
    const out = [];
    for (const [key, list] of Object.entries(db.data.humidity)) {
      const [pid, unit] = key.split('|');
      const storage = pid === STORAGE;
      const cfg = storage ? { id: STORAGE, name: unit } : printers.find((p) => p.id === pid);
      if (!cfg || !list.length) continue;
      if (storage && !db.data.humSources.some((x) => x.target?.type === 'storage' && x.target.name === unit)) continue;
      const now = this.humNow?.[key];
      const last = list[list.length - 1];
      const pct = now?.pct ?? last[1];
      const since = Date.now() - 48 * 3600_000;
      const buckets = {};
      for (const [t, h] of list) if (t >= since) (buckets[Math.floor(t / 3600_000)] ||= []).push(h);
      const series = Object.entries(buckets).sort((a, b) => a[0] - b[0]).map(([hour, v]) => [Number(hour) * 3600_000, round1(v.reduce((a, b) => a + b, 0) / v.length)]);
      const src = db.data.humSources.find((x) => (storage ? x.target?.type === 'storage' && x.target.name === unit : x.target?.printerId === pid && this.sourceUnit(x) === unit));
      out.push({ printerId: storage ? null : pid, storage, source: src ? src.kind : 'builtin', sourceId: src?.id || null, printerName: storage ? unit : cfg.name, unit: storage ? 'Lager' : unit, pct, temp: now?.temp ?? last[2], level: this.humLevel(pct), at: now?.at ?? last[0], stale: Date.now() - (now?.at ?? last[0]) > 30 * 60_000, series });
    }
    return out.sort((a, b) => Number(a.storage) - Number(b.storage) || a.printerName.localeCompare(b.printerName) || a.unit.localeCompare(b.unit));
  }

  // ---------------------------------------------------------------- Feuchte-Messstellen

  /** Spulen im Lager an einem Ort (Trockenbox), Groß-/Kleinschreibung egal */
  spoolsAtLocation(name) {
    const n = String(name || '').trim().toLowerCase();
    return db.data.spools.filter((sp) => !sp.archived && !sp.slot && String(sp.location || '').trim().toLowerCase() === n);
  }

  /** Unter welcher Einheit eine Quelle am Drucker geführt wird */
  sourceUnit(src) {
    return src.target?.unit || src.name || 'Sensor';
  }

  /** Messwert einer Quelle (HA-Sensor, Station) der Messstelle zuschreiben. */
  recordSource(src, pct, temp = null) {
    const tg = src.target || {};
    if (tg.type === 'storage') return this.recordHumidity({ id: STORAGE, name: tg.name }, tg.name, pct, temp);
    const cfg = this.ctx.printers().find((p) => p.id === tg.printerId);
    if (cfg) this.recordHumidity(cfg, this.sourceUnit(src), pct, temp);
  }

  /** Neuer Wert von einer PrintDock Station mit Feuchtesensor */
  stationEnv(stationId, pct, temp) {
    for (const src of db.data.humSources) if (src.kind === 'station' && src.stationId === stationId) this.recordSource(src, pct, temp);
  }

  /** Messstellen für die Einstellungen: je Drucker die Einheiten und ob sie selbst messen, dazu die Lagerorte. */
  humPoints() {
    const now = this.humNow || {};
    const value = (key) => (now[key] && Date.now() - now[key].at < 30 * 60_000 ? { pct: now[key].pct, temp: now[key].temp, at: new Date(now[key].at).toISOString() } : null);
    const points = [];
    for (const cfg of this.ctx.printers()) {
      const st = this.ctx.runtime.get(cfg.id)?.driver.status;
      const reported = st?.filamentUnits || [];
      const units = [...new Set(this.slotsFor(cfg).map((sl) => sl.unit).filter(Boolean))].filter((u) => u !== 'Extern' && u !== 'Werkzeug');
      for (const u of reported) if (!units.includes(u.name)) units.push(u.name);
      if (!units.length) units.push(null); // Drucker ohne Einheiten: Messstelle für den ganzen Drucker (z. B. Trockenbox daneben)
      for (const unit of units) {
        const r = reported.find((x) => x.name === unit);
        const builtin = r?.humidityPct != null;
        const src = db.data.humSources.find((x) => x.target?.type === 'printer' && x.target.printerId === cfg.id && (x.target.unit || null) === unit);
        const key = `${cfg.id}|${src ? this.sourceUnit(src) : unit}`;
        points.push({
          type: 'printer', printerId: cfg.id, printerName: cfg.name, unit, builtin, source: src || null,
          value: builtin ? { pct: r.humidityPct, temp: r.temp ?? null } : value(key), level: this.humLevel(builtin ? r.humidityPct : value(key)?.pct),
        });
      }
      // Quellen „für den ganzen Drucker“ zusätzlich zu Einheiten
      for (const src of db.data.humSources.filter((x) => x.target?.type === 'printer' && x.target.printerId === cfg.id && !x.target.unit && units[0] !== null)) {
        const v = value(`${cfg.id}|${this.sourceUnit(src)}`);
        points.push({ type: 'printer', printerId: cfg.id, printerName: cfg.name, unit: null, builtin: false, source: src, value: v, level: this.humLevel(v?.pct) });
      }
    }
    for (const src of db.data.humSources.filter((x) => x.target?.type === 'storage')) {
      const v = value(`${STORAGE}|${src.target.name}`);
      points.push({ type: 'storage', name: src.target.name, source: src, value: v, level: this.humLevel(v?.pct), spools: this.spoolsAtLocation(src.target.name).map((sp) => sp.nr) });
    }
    return points;
  }

  saveHumSource(body = {}, id = null) {
    const list = db.data.humSources;
    const existing = id ? list.find((x) => x.id === id) : null;
    if (id && !existing) throw httpError(404, 'Messstelle nicht gefunden');
    const kind = body.kind === 'station' ? 'station' : 'ha';
    const entity = String(body.entity || '').trim();
    if (kind === 'ha' && !/^sensor\.[\w]+$/.test(entity)) throw httpError(400, 'Bitte einen Feuchtesensor aus Home Assistant wählen (sensor.…)');
    if (kind === 'station' && !body.stationId) throw httpError(400, 'Bitte eine PrintDock Station wählen');
    const tg = body.target || {};
    let target;
    if (tg.type === 'storage') {
      const name = String(tg.name || '').trim().slice(0, 60);
      if (!name) throw httpError(400, 'Bitte einen Namen für die Trockenbox bzw. den Lagerort angeben');
      target = { type: 'storage', name };
    } else {
      if (!this.ctx.printers().some((p) => p.id === tg.printerId)) throw httpError(404, 'Drucker nicht gefunden');
      target = { type: 'printer', printerId: tg.printerId, unit: tg.unit ? String(tg.unit).slice(0, 40) : null };
    }
    // Eine Messstelle hat genau eine Quelle
    const same = (x) => x !== existing && JSON.stringify(x.target) === JSON.stringify(target);
    db.data.humSources = list.filter((x) => !same(x));
    const src = { id: existing?.id || uid(), kind, ...(kind === 'ha' ? { entity } : { stationId: String(body.stationId) }), name: String(body.name || existing?.name || '').slice(0, 40) || null, target };
    if (existing) Object.assign(existing, src);
    else db.data.humSources.push(src);
    this.save();
    return existing || src;
  }

  deleteHumSource(id) {
    const src = db.data.humSources.find((x) => x.id === id);
    if (!src) throw httpError(404, 'Messstelle nicht gefunden');
    db.data.humSources = db.data.humSources.filter((x) => x !== src);
    const key = src.target.type === 'storage' ? `${STORAGE}|${src.target.name}` : `${src.target.printerId}|${this.sourceUnit(src)}`;
    delete db.data.humidity[key];
    if (this.humNow) delete this.humNow[key];
    this.save();
  }

  /** Früher: ein Feuchtesensor je Drucker in den Druckereinstellungen → als Messstelle übernehmen. */
  migrateHumidityEntities(save) {
    let changed = false;
    for (const cfg of this.ctx.printers()) {
      const e = cfg.settings?.humidityEntity;
      if (!e) continue;
      if (!db.data.humSources.some((x) => x.kind === 'ha' && x.entity === e)) db.data.humSources.push({ id: uid(), kind: 'ha', entity: e, name: null, target: { type: 'printer', printerId: cfg.id, unit: null } });
      delete cfg.settings.humidityEntity;
      changed = true;
    }
    if (changed) {
      db.save();
      save();
    }
  }

  // ================================================================ RFID / NFC

  /**
   * Ein Leser (z. B. ESPHome mit PN532 über Home Assistant) oder das Handy meldet einen Tag.
   * body: { tag: UID | spool: "S-012", printer: Name oder ID, slot: Schlüssel oder Bezeichnung }
   * Bekannte Spule + Drucker → Spule in den Platz legen. Unbekannter Tag → merken, die Oberfläche fragt.
   */
  rfidScan(body = {}) {
    const tag = String(body.tag || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 40) || null;
    const nr = String(body.spool || '').trim();
    const printers = this.ctx.printers();
    const cfg = body.printer ? printers.find((p) => p.id === body.printer || p.name.toLowerCase() === String(body.printer).toLowerCase()) : null;
    if (body.printer && !cfg) throw httpError(404, `Drucker „${body.printer}“ nicht gefunden`);
    let slotKey = null;
    if (cfg) {
      const slots = this.slotsFor(cfg);
      const want = String(body.slot || '').toLowerCase();
      slotKey = want ? slots.find((s) => s.key.toLowerCase() === want || String(s.label).toLowerCase() === want)?.key : slots.length === 1 ? slots[0].key : status0(this, cfg);
      if (want && !slotKey) throw httpError(404, `Platz „${body.slot}“ nicht gefunden`);
    }
    const norm = (v) => String(v || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
    const spool = db.data.spools.find((s) => !s.archived && ((tag && norm(s.rfid) === tag) || (nr && (s.nr === nr || s.id === nr))));
    if (!spool) {
      if (!tag) throw httpError(404, 'Spule nicht gefunden');
      this.pendingTag = { tag, printerId: cfg?.id || null, slotKey, at: now() };
      this.ctx.broadcast('filament', null);
      return { known: false, tag, message: 'Unbekannter Tag – in PrintDock einer Spule zuordnen' };
    }
    let placed = null;
    if (cfg && slotKey) {
      this.placeSpool(spool, cfg.id, slotKey, { push: true });
      placed = { printer: cfg.name, slot: this.slotsFor(cfg).find((s) => s.key === slotKey)?.label || slotKey };
      console.log(`RFID: ${spool.nr} → ${placed.printer} · ${placed.slot}`);
    }
    this.save();
    return { known: true, spool: { id: spool.id, nr: spool.nr, material: spool.material, colorName: spool.colorName, remaining: spool.remaining }, placed };
  }

  /** Zuletzt gemeldeten unbekannten Tag einer Spule zuordnen (und ggf. in den Platz legen). */
  rfidAssign(spoolId) {
    const p = this.pendingTag;
    if (!p) throw httpError(404, 'Kein offener Tag');
    const spool = db.data.spools.find((s) => s.id === spoolId);
    if (!spool) throw httpError(404, 'Spule nicht gefunden');
    for (const s of db.data.spools) if (s !== spool && s.rfid === p.tag) s.rfid = null;
    spool.rfid = p.tag;
    if (p.printerId && p.slotKey) this.placeSpool(spool, p.printerId, p.slotKey, { push: true });
    else if (p.stationId) this.arm(spool, { stationId: p.stationId, printerId: p.printerId || null });
    this.pendingTag = null;
    this.ctx.onTagAssigned?.(spool, p);
    this.save();
    return spool;
  }

  /** Spule als getrocknet markieren. */
  dried(id) {
    const s = db.data.spools.find((x) => x.id === id);
    if (!s) throw httpError(404, 'Spule nicht gefunden');
    s.driedAt = now();
    this.save();
    return s;
  }

  /** Kann PrintDock dem Drucker sagen, welcher Platz welches Filament druckt? (Bambu: ams_mapping) */
  canMap(cfg) {
    if (cfg.driver === 'bambu') return true;
    return cfg.driver === 'demo' && this.slotsFor(cfg).some((s) => /^ams/.test(s.key));
  }

  /**
   * Filament-Zuordnung für den Druckstart: welche Farben/Materialien der Slice braucht,
   * was im Drucker liegt und welcher Platz am besten passt (Material + Farbe).
   */
  mappingFor(cfg, file, options = {}) {
    const m = file?.meta;
    if (!m) return { filaments: [], slots: [], suggested: [], mappable: false };
    let mats = (m.materials || []).map((x) => ({ type: x.type || null, color: colors.normalize(x.color) || null, grams: x.grams ?? null }));
    const gs = m.filamentGs || (m.filamentG != null ? [m.filamentG] : []);
    if (!mats.length && gs.length) mats = gs.map((g) => ({ type: null, color: null, grams: g }));
    mats.forEach((x, i) => { if (x.grams == null && gs[i] != null) x.grams = gs[i]; });
    const slots = this.slotsFor(cfg).map((sl) => {
      const spool = this.spoolAt(cfg.id, sl.key);
      return {
        key: sl.key, label: sl.label, unit: sl.unit || null,
        material: spool?.material || sl.material || null,
        color: spool?.color || colors.normalize(sl.color) || null,
        spool: spool ? { nr: spool.nr, remaining: spool.remaining, colorName: spool.colorName || '' } : null,
      };
    }).filter((sl) => sl.material || sl.spool);
    const mappable = this.canMap(cfg);
    // Vorschlag: bereits gewählte Zuordnung, sonst bestes Material/Farbe, möglichst jeder Platz nur einmal
    let suggested = Array.isArray(options.slotMap) && options.slotMap.length === mats.length && options.slotMap.every((k) => slots.some((sl) => sl.key === k)) ? [...options.slotMap] : null;
    if (!suggested) {
      const used = new Set();
      suggested = mats.map((f, i) => {
        if (!mappable) return slots[i]?.key || (mats.length === 1 ? slots[0]?.key : null) || null;
        let best = null;
        for (const sl of slots) {
          let score = 0;
          if (f.type && sl.material) score += sameMaterial(f.type, sl.material) ? 0 : 400;
          score += f.color && sl.color ? colors.distance(f.color, sl.color) : 60;
          if (used.has(sl.key)) score += 1000;
          if (!best || score < best.score) best = { key: sl.key, score };
        }
        if (best) used.add(best.key);
        return best?.key || null;
      });
    }
    return { filaments: mats, slots, suggested, mappable };
  }

  /** Bambu: Zuordnung (Platz-Schlüssel je Slice-Filament) → ams_mapping (Fach-Nr. je Projekt-Filament). */
  amsMappingFor(file, slotMap) {
    const toTray = (key) => {
      if (key === 'ext') return 254;
      const mm = /^ams(\d+)-(\d+)$/.exec(key || '');
      return mm ? Number(mm[1]) * 4 + Number(mm[2]) : -1;
    };
    const mats = file?.meta?.materials || [];
    // In Bambu-3MFs tragen die Filamente ihre Projekt-Nummer (1-basiert); ams_mapping ist danach indiziert
    const ids = mats.map((x, i) => (Number(x.slot) > 0 ? Number(x.slot) - 1 : i));
    const out = Array.from({ length: Math.max(slotMap.length, ...ids.map((x) => x + 1), 0) }, () => -1);
    slotMap.forEach((key, i) => { out[ids[i] ?? i] = toTray(key); });
    return out.join(',');
  }

  importDemo({ spools = [], usage = [] }) {
    db.data.spools.push(...spools);
    db.data.usage.push(...usage);
    db.data.usage.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    this.save();
  }

  removeDemo(printerIds) {
    db.data.spools = db.data.spools.filter((s) => !s.demo);
    db.data.usage = db.data.usage.filter((u) => !u.demo);
    for (const id of printerIds) delete db.data.liveSlots[id];
    this.save();
  }

  printerRemoved(printerId) {
    for (const s of db.data.spools) if (s.slot?.printerId === printerId) s.slot = null;
    delete db.data.liveSlots[printerId];
    this.save();
  }
}

module.exports = { Filament, mmToGrams, MATERIALS, db };
