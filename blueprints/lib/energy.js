// Stromverbrauch je Druck über Home Assistant.
// Energiezähler (kWh): Stand bei Druckbeginn und -ende, Differenz = Verbrauch.
// Nur Leistungssensor (W): alle 30 s ablesen und aufsummieren.
// Welcher Sensor: beim Drucker eingetragen, sonst der Zähler am selben Gerät wie die Steckdose.

class EnergyTracker {
  constructor({ ha }) {
    this.ha = ha;
    this.timers = new Map(); // printerId → Intervall (Leistungssensor)
  }

  enabled(cfg) {
    return require('./app').moduleOn('homeassistant') && Boolean(cfg.settings?.energyEntity || cfg.settings?.powerEntity);
  }

  /** Druck beginnt: Ausgangswert merken */
  async start(cfg, job) {
    if (!this.enabled(cfg)) return;
    try {
      const entity = await this.ha.energyForPrinter(cfg);
      if (!entity) return;
      const v = await this.ha.readEnergy(entity);
      if (!v) return;
      job.energy = { entity, kind: v.kind, startKwh: v.kwh ?? null, kwh: 0, lastW: v.w ?? null, lastAt: Date.now() };
      if (v.kind === 'power') {
        clearInterval(this.timers.get(cfg.id));
        const t = setInterval(async () => {
          if (!job.energy || job.energy.done) return clearInterval(t);
          try {
            const r = await this.ha.readEnergy(entity);
            const now = Date.now();
            const w = r?.w ?? job.energy.lastW ?? 0;
            // Trapezregel zwischen zwei Messungen
            job.energy.kwh += (((job.energy.lastW ?? w) + w) / 2) * ((now - job.energy.lastAt) / 3600_000) / 1000;
            job.energy.lastW = w;
            job.energy.lastAt = now;
          } catch {}
        }, 30_000);
        t.unref?.();
        this.timers.set(cfg.id, t);
      }
    } catch (err) {
      console.warn(`[${cfg.name}] Stromzähler: ${err.message}`);
    }
  }

  /** Druck zu Ende: Verbrauch in kWh (oder null) */
  async finish(cfg, job) {
    const e = job?.energy;
    if (!e) return null;
    e.done = true;
    clearInterval(this.timers.get(cfg.id));
    this.timers.delete(cfg.id);
    try {
      if (e.kind === 'energy') {
        const v = await this.ha.readEnergy(e.entity);
        if (v?.kwh == null || e.startKwh == null) return null;
        const d = v.kwh - e.startKwh;
        return d >= 0 && d < 100 ? Math.round(d * 1000) / 1000 : null; // Zähler zurückgesetzt → unbekannt
      }
      return Math.round(e.kwh * 1000) / 1000;
    } catch {
      return null;
    }
  }
}

module.exports = { EnergyTracker };
