// Optionale Anbindung an Spoolman (https://github.com/Donkie/Spoolman).
//
// Spoolman bleibt die Quelle für den Spulenbestand: PrintDock übernimmt alle Spulen
// (Material, Hersteller, Farbe, Gewichte, Preis, archiviert) und hält sie aktuell.
// Zurück an Spoolman gehen:
//   - Verbrauch nach jedem Druck bzw. von Hand ("use")
//   - Restgewicht nach dem Wiegen oder Korrekturen
//   - Ort: in welchem Drucker/Platz die Spule gerade steckt
//   - auf Wunsch neue Spulen, die in PrintDock angelegt werden
// Ist Spoolman nicht erreichbar, merkt sich PrintDock die Buchungen und holt sie nach.
const colors = require('./colors');

const round1 = (n) => Math.round(n * 10) / 10;
const httpError = (status, message) => Object.assign(new Error(message), { status });

class Spoolman {
  /**
   * @param ctx { db, filament, printers() }  db = Filament-Datenablage (spools.json)
   */
  constructor(ctx) {
    this.ctx = ctx;
    const d = ctx.db.data;
    d.spoolman ??= { enabled: false, url: '', syncLocation: true, pushNew: true, pending: [], syncedAt: null, error: null };
    d.spoolman.pending ??= [];
    this.cfg = d.spoolman;
    this.timer = setInterval(() => this.enabled && this.sync().catch(() => {}), 5 * 60_000);
    this.timer.unref?.();
    if (this.enabled) setTimeout(() => this.sync().catch(() => {}), 5000).unref?.();
  }

  get enabled() {
    return Boolean(this.cfg.enabled && this.cfg.url);
  }

  get base() {
    return String(this.cfg.url || '').trim().replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  }

  publicSettings() {
    const linked = this.ctx.db.data.spools.filter((s) => s.spoolmanId).length;
    return { enabled: this.cfg.enabled, url: this.cfg.url, syncLocation: this.cfg.syncLocation !== false, pushNew: this.cfg.pushNew !== false, syncedAt: this.cfg.syncedAt, error: this.cfg.error, pending: this.cfg.pending.length, linked };
  }

  async saveSettings(body = {}) {
    if (body.url !== undefined) {
      let u = String(body.url).trim();
      if (u && !/^https?:\/\//.test(u)) u = `http://${u}`;
      this.cfg.url = u;
    }
    for (const k of ['enabled', 'syncLocation', 'pushNew']) if (body[k] !== undefined) this.cfg[k] = Boolean(body[k]);
    this.cfg.error = null;
    this.ctx.db.save();
    if (this.enabled) await this.sync().catch(() => {});
    return this.publicSettings();
  }

  async api(path, { method = 'GET', body } = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const r = await fetch(`${this.base}/api/v1${path}`, {
        method, signal: ctrl.signal,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!r.ok) throw httpError(502, `Spoolman: HTTP ${r.status}${r.status === 404 ? ' – stimmt die Adresse?' : ''}`);
      return r.status === 204 ? null : r.json();
    } catch (err) {
      if (err.status) throw err;
      throw httpError(502, err.name === 'AbortError' ? 'Spoolman antwortet nicht' : `Spoolman nicht erreichbar (${err.cause?.code || err.message})`);
    } finally {
      clearTimeout(t);
    }
  }

  /** Verbindung prüfen (für den Knopf „Testen“). */
  async test() {
    const info = await this.api('/info');
    return { ok: true, version: info?.version || null };
  }

  // ---------------------------------------------------------------- Spoolman → PrintDock

  /** Alle Spulen holen und in PrintDock übernehmen bzw. aktualisieren. */
  async sync() {
    if (!this.enabled) throw httpError(400, 'Spoolman ist nicht eingeschaltet');
    try {
      const list = await this.api('/spool?allow_archived=true');
      this.listOk = true; // Adresse stimmt – ab jetzt darf ein 404 eine einzelne gelöschte Spule bedeuten
      await this.flush().catch(() => {});
      const spools = this.ctx.db.data.spools;
      const seen = new Set();
      let added = 0;
      let updated = 0;
      for (const sm of list || []) {
        seen.add(sm.id);
        const fields = this.map(sm);
        let s = spools.find((x) => x.spoolmanId === sm.id);
        if (!s) {
          s = this.ctx.filament.saveSpool({ ...fields, remaining: fields.remaining }, null, { silent: true })[0];
          s.spoolmanId = sm.id;
          added += 1;
        } else {
          const before = JSON.stringify(s);
          Object.assign(s, fields, { archived: fields.archived, slot: fields.archived ? null : s.slot });
          if (JSON.stringify(s) !== before) updated += 1;
        }
      }
      // In Spoolman gelöscht → in PrintDock als aufgebraucht markieren
      for (const s of spools) if (s.spoolmanId && !seen.has(s.spoolmanId) && !s.archived) { s.archived = true; s.slot = null; updated += 1; }
      this.cfg.syncedAt = new Date().toISOString();
      this.cfg.error = null;
      this.ctx.filament.save();
      if (added || updated) console.log(`Spoolman: ${added} neu, ${updated} aktualisiert`);
      return { added, updated, total: (list || []).length };
    } catch (err) {
      this.cfg.error = err.message;
      this.ctx.db.save();
      throw err;
    }
  }

  /** Spoolman-Spule → PrintDock-Felder */
  map(sm) {
    const f = sm.filament || {};
    const color = colors.normalize(f.color_hex ? `#${String(f.color_hex).replace(/^#/, '').slice(0, 6)}` : f.multi_color_hexes ? `#${String(f.multi_color_hexes).split(',')[0]}` : null);
    const net = Number(sm.initial_weight) || Number(f.weight) || 1000;
    return {
      material: String(f.material || 'PLA').slice(0, 40),
      brand: String(f.vendor?.name || '').slice(0, 60),
      colorName: String(f.name || (color ? colors.nameOf(color) : '')).slice(0, 60),
      color: color || '#888888',
      diameter: Number(f.diameter) === 2.85 ? 2.85 : 1.75,
      netWeight: net,
      remaining: Math.max(0, round1(Number(sm.remaining_weight ?? net))),
      tare: Number(sm.spool_weight ?? f.spool_weight) || 0,
      price: sm.price ?? f.price ?? null,
      archived: Boolean(sm.archived),
      note: String(sm.comment || '').slice(0, 300),
      ...(sm.lot_nr ? { lot: String(sm.lot_nr).slice(0, 40) } : {}),
    };
  }

  // ---------------------------------------------------------------- PrintDock → Spoolman

  /** Verbrauch melden (nach Druck oder „− g“). */
  used(spool, grams) {
    if (!this.enabled || !spool?.spoolmanId || !(grams > 0)) return;
    this.cfg.pending.push({ kind: 'use', id: spool.spoolmanId, grams: round1(grams) });
    this.ctx.db.save();
    this.flush().catch(() => {});
  }

  /** Restgewicht gesetzt (Wiegen, Korrektur). */
  remainingSet(spool) {
    if (!this.enabled || !spool?.spoolmanId) return;
    this.cfg.pending = this.cfg.pending.filter((p) => !(p.kind === 'remaining' && p.id === spool.spoolmanId));
    this.cfg.pending.push({ kind: 'remaining', id: spool.spoolmanId, grams: spool.remaining });
    this.ctx.db.save();
    this.flush().catch(() => {});
  }

  /** Spule eingelegt oder entnommen: Ort in Spoolman nachziehen. */
  placed(spool) {
    if (!this.enabled || !spool?.spoolmanId || this.cfg.syncLocation === false) return;
    let location = spool.location || '';
    if (spool.slot) {
      const cfg = this.ctx.printers().find((p) => p.id === spool.slot.printerId);
      const slot = cfg ? this.ctx.filament.slotsFor(cfg).find((s) => s.key === spool.slot.key) : null;
      location = `${cfg?.name || 'Drucker'} · ${slot?.label || spool.slot.key}`;
    }
    this.cfg.pending = this.cfg.pending.filter((p) => !(p.kind === 'location' && p.id === spool.spoolmanId));
    this.cfg.pending.push({ kind: 'location', id: spool.spoolmanId, location: location.slice(0, 64) });
    this.ctx.db.save();
    this.flush().catch(() => {});
  }

  /** Neue PrintDock-Spule auch in Spoolman anlegen (Hersteller und Filament werden gesucht oder angelegt). */
  async created(spool) {
    if (!this.enabled || this.cfg.pushNew === false || spool.spoolmanId) return;
    try {
      let vendorId = null;
      if (spool.brand) {
        const vendors = await this.api('/vendor');
        vendorId = (vendors || []).find((v) => v.name.toLowerCase() === spool.brand.toLowerCase())?.id
          ?? (await this.api('/vendor', { method: 'POST', body: { name: spool.brand } })).id;
      }
      const hex = String(spool.color || '#888888').replace('#', '').toUpperCase();
      const filaments = await this.api('/filament');
      let fil = (filaments || []).find((f) => (f.material || '').toUpperCase() === spool.material.toUpperCase()
        && String(f.color_hex || '').toUpperCase() === hex && (f.vendor?.id ?? null) === vendorId && Number(f.diameter || 1.75) === spool.diameter);
      if (!fil) {
        fil = await this.api('/filament', {
          method: 'POST',
          body: { name: spool.colorName || `${spool.material} ${hex}`, material: spool.material, color_hex: hex, vendor_id: vendorId ?? undefined, diameter: spool.diameter || 1.75, density: 1.24, weight: spool.netWeight, spool_weight: spool.tare || undefined },
        });
      }
      const sm = await this.api('/spool', {
        method: 'POST',
        body: { filament_id: fil.id, initial_weight: spool.netWeight, remaining_weight: spool.remaining, spool_weight: spool.tare || undefined, price: spool.price ?? undefined, location: spool.location || undefined, comment: spool.note || undefined },
      });
      spool.spoolmanId = sm.id;
      this.ctx.filament.save();
      console.log(`Spoolman: Spule ${spool.nr} als #${sm.id} angelegt`);
    } catch (err) {
      console.warn(`Spoolman: neue Spule nicht angelegt – ${err.message}`);
    }
  }

  /** Gemerkte Buchungen an Spoolman schicken (der Reihe nach, bei Fehler später erneut). */
  async flush() {
    if (!this.enabled || this.flushing) return;
    this.flushing = true;
    try {
      while (this.cfg.pending.length) {
        const p = this.cfg.pending[0];
        if (p.kind === 'use') await this.api(`/spool/${p.id}/use`, { method: 'PUT', body: { use_weight: p.grams } });
        else if (p.kind === 'remaining') await this.api(`/spool/${p.id}`, { method: 'PATCH', body: { remaining_weight: p.grams } });
        else if (p.kind === 'location') await this.api(`/spool/${p.id}`, { method: 'PATCH', body: { location: p.location } });
        this.cfg.pending.shift();
        this.ctx.db.save();
      }
      this.cfg.error = null;
    } catch (err) {
      // Spule gibt es in Spoolman nicht mehr: Buchung verwerfen, sonst später erneut
      if (/HTTP 404/.test(err.message) && this.listOk) this.cfg.pending.shift();
      this.cfg.error = err.message;
      this.ctx.db.save();
      throw err;
    } finally {
      this.flushing = false;
    }
  }
}

module.exports = { Spoolman };
