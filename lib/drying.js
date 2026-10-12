// Filament trocknen per Knopf – für möglichst viele Geräte:
//
//   builtin  Gerät trocknet selbst und PrintDock steuert es direkt:
//            Bambu AMS 2 Pro (45–65 °C) und AMS HT (45–85 °C) per MQTT
//   gcode    Klipper/Moonraker-Drucker mit Trockner-Makro, z. B. ACE Pro mit Klipper-ACE-Treiber
//            (ACE_START_DRYING TEMP={temp} DURATION={minutes}) – Befehle frei einstellbar
//   ha       alles, was Home Assistant schalten kann:
//            - Trockenbox an einer Steckdose (an, nach Ablauf aus)
//            - Trockner mit eigener Integration: Start-/Stopp-Taste und optional Zahl-Entitäten
//              für Temperatur und Dauer (z. B. Anycubic ACE über die Anycubic-Integration,
//              Sunlu/eSun über Tuya/Smart-Plug, Skripte)
//
// Ziel ist eine Feuchte-Messstelle: Drucker + Einheit (AMS/ACE) oder Trockenbox/Lagerort.
// Nach Ablauf meldet PrintDock „Trocknen fertig“ und vermerkt bei den Spulen das Trocknungsdatum.
const crypto = require('crypto');

const httpError = (status, message) => Object.assign(new Error(message), { status });
const STORAGE = '@lager';

// Empfehlungen je Material: [°C, Stunden]
const PROFILES = [
  [/^PLA[- ]?CF/, 55, 8], [/^PLA/, 50, 6], [/^(PETG|PCTG)[- ]?CF/, 65, 8], [/^(PETG|PCTG)/, 65, 6],
  [/^(ABS|ASA)/, 70, 4], [/^PC/, 70, 6], [/^(PA|PAHT|PPA)/, 75, 12], [/^TPU|^TPE/, 55, 8], [/^PVA|^BVOH/, 50, 8], [/^HIPS/, 65, 4], [/^PP/, 60, 6],
];
function profileFor(material) {
  const m = String(material || '').toUpperCase().trim();
  const hit = PROFILES.find(([re]) => re.test(m));
  return hit ? { temp: hit[1], hours: hit[2] } : { temp: 45, hours: 6 };
}

const keyOf = (tg) => (tg.type === 'storage' ? `${STORAGE}|${tg.name}` : `${tg.printerId}|${tg.unit || ''}`);

class Drying {
  /** ctx: { db (Filament-Ablage), filament, printers(), runtime, ha(), notify(event, who, entry), broadcast } */
  constructor(ctx) {
    this.ctx = ctx;
    const d = ctx.db.data;
    d.dryers ??= []; // eingerichtete Trockner (gcode/ha)
    d.dryJobs ??= {}; // key -> laufender Vorgang
    d.dryErrors ??= {}; // key -> { msg, at } – letzte Rückmeldung, wenn ein Gerät nicht reagiert hat
    d.dryKnown ??= {}; // key -> zuletzt gemeldeter eingebauter Trockner (AMS 2 Pro/HT), damit er auch offline sichtbar bleibt
    this.timer = setInterval(() => this.tick().catch(() => {}), 15_000);
    this.timer.unref?.();
  }

  get data() {
    return this.ctx.db.data;
  }

  save() {
    this.ctx.db.save();
    this.ctx.broadcast('filament', null);
  }

  cfgOf(tg) {
    return tg.type === 'printer' ? this.ctx.printers().find((p) => p.id === tg.printerId) : null;
  }

  /** Eingebauter Trockner (Bambu AMS 2 Pro / HT, Demo) laut Druckerstatus */
  builtinFor(tg) {
    if (tg.type !== 'printer' || !tg.unit) return null;
    const st = this.ctx.runtime.get(tg.printerId)?.driver.status;
    const u = st?.filamentUnits?.find((x) => x.name === tg.unit);
    return u?.dryer ? { ...u.dryer, unitId: u.id, model: u.model || null } : null;
  }

  /** Materialien, die an der Messstelle liegen (für die Empfehlung) */
  materialsAt(tg) {
    const fil = this.ctx.filament;
    if (tg.type === 'storage') return fil.spoolsAtLocation(tg.name).map((s) => s.material);
    const cfg = this.cfgOf(tg);
    if (!cfg) return [];
    return fil.slotsFor(cfg).filter((sl) => !tg.unit || sl.unit === tg.unit)
      .map((sl) => fil.spoolAt(cfg.id, sl.key)?.material || sl.material).filter(Boolean);
  }

  /** Vorschlag: niedrigste empfohlene Temperatur (schont alle Spulen), längste Dauer – begrenzt aufs Gerät */
  suggest(tg, dryer) {
    const mats = [...new Set(this.materialsAt(tg))];
    const profs = mats.map(profileFor);
    let temp = profs.length ? Math.min(...profs.map((p) => p.temp)) : 50;
    let hours = profs.length ? Math.max(...profs.map((p) => p.hours)) : 6;
    if (dryer?.maxTemp) temp = Math.min(temp, dryer.maxTemp);
    if (dryer?.minTemp) temp = Math.max(temp, dryer.minTemp);
    if (dryer?.maxHours) hours = Math.min(hours, dryer.maxHours);
    return { temp, hours, materials: mats };
  }

  /** Alle Trockner für die Oberfläche: eingebaute und eingerichtete, mit Zustand */
  view() {
    const out = [];
    const seen = new Set();
    const add = (tg, kind, dryer, cfgEntry = null) => {
      const key = keyOf(tg);
      if (seen.has(key)) return;
      seen.add(key);
      const job = this.data.dryJobs[key] || null;
      const active = kind === 'builtin' ? Boolean(dryer?.active) || Boolean(job && Date.parse(job.until) > Date.now()) : Boolean(job);
      const until = kind === 'builtin' && dryer?.remainMin ? new Date(Date.now() + dryer.remainMin * 60_000).toISOString() : job?.until || null;
      const cfg = this.cfgOf(tg);
      out.push({
        key, target: tg, kind, id: cfgEntry?.id || null, name: tg.type === 'storage' ? tg.name : `${cfg?.name || '?'}${tg.unit ? ` · ${tg.unit}` : ''}`,
        model: dryer?.model || cfgEntry?.label || null, maxTemp: dryer?.maxTemp ?? cfgEntry?.maxTemp ?? null, minTemp: dryer?.minTemp ?? cfgEntry?.minTemp ?? null,
        tempControl: kind === 'builtin' || (kind === 'gcode' && /\{temp\}/.test(cfgEntry?.start || '')) || (kind === 'ha' && Boolean(cfgEntry?.tempEntity)),
        active, until, temp: dryer?.targetTemp || job?.temp || null, suggest: this.suggest(tg, dryer || cfgEntry), config: cfgEntry,
        pending: Boolean(job && !job.verified && kind === 'builtin' && !dryer?.active),
        loaded: Boolean(dryer?.loaded), unloadTemp: dryer?.unloadTemp || null, preparing: dryer?.preparing || false,
        offline: Boolean(dryer?.offline),
        error: this.data.dryErrors[key] && Date.now() - Date.parse(this.data.dryErrors[key].at) < 30 * 60_000
          ? { code: this.data.dryErrors[key].code || 'noreply', reason: this.data.dryErrors[key].reason || '' } : null,
      });
    };
    // Eingebaute Trockner der Drucker – live, sonst der zuletzt gemeldete (Drucker offline)
    let learned = false;
    for (const cfg of this.ctx.printers()) {
      const st = this.ctx.runtime.get(cfg.id)?.driver.status;
      for (const u of st?.filamentUnits || []) {
        if (!u.dryer) continue;
        const tg = { type: 'printer', printerId: cfg.id, unit: u.name };
        add(tg, 'builtin', { ...u.dryer, model: u.model || null });
        const known = { model: u.model || null, maxTemp: u.dryer.maxTemp ?? null, minTemp: u.dryer.minTemp ?? null };
        const prev = this.data.dryKnown[keyOf(tg)];
        if (!prev || prev.model !== known.model || prev.maxTemp !== known.maxTemp) {
          this.data.dryKnown[keyOf(tg)] = { ...known, printerId: cfg.id, unit: u.name };
          learned = true;
        }
      }
    }
    for (const [key, k] of Object.entries(this.data.dryKnown)) {
      if (seen.has(key)) continue;
      if (!this.ctx.printers().some((p) => p.id === k.printerId)) continue;
      add({ type: 'printer', printerId: k.printerId, unit: k.unit }, 'builtin', { model: k.model, maxTemp: k.maxTemp, minTemp: k.minTemp, offline: true });
    }
    if (learned) this.ctx.db.save();
    for (const c of this.data.dryers) add(c.target, c.method, null, c);
    return out;
  }

  // ---------------------------------------------------------------- Einrichten

  saveDryer(body = {}, id = null) {
    const list = this.data.dryers;
    const existing = id ? list.find((x) => x.id === id) : null;
    if (id && !existing) throw httpError(404, 'Trockner nicht gefunden');
    const method = body.method === 'gcode' ? 'gcode' : 'ha';
    const tgIn = body.target || {};
    const target = tgIn.type === 'storage'
      ? { type: 'storage', name: String(tgIn.name || '').trim().slice(0, 60) }
      : { type: 'printer', printerId: String(tgIn.printerId || ''), unit: tgIn.unit ? String(tgIn.unit).slice(0, 40) : null };
    if (target.type === 'storage' && !target.name) throw httpError(400, 'Bitte die Trockenbox wählen');
    if (target.type === 'printer' && !this.cfgOf(target)) throw httpError(404, 'Drucker nicht gefunden');
    const ent = (v) => {
      const s = String(v || '').trim();
      if (s && !/^[a-z_]+\.[\w]+$/.test(s)) throw httpError(400, `Ungültige Entität „${s}“`);
      return s || null;
    };
    const c = {
      id: existing?.id || crypto.randomUUID(),
      method,
      target,
      label: String(body.label || '').slice(0, 40) || null,
      maxTemp: Number(body.maxTemp) > 0 ? Math.min(120, Number(body.maxTemp)) : null,
      minTemp: Number(body.minTemp) > 0 ? Number(body.minTemp) : null,
    };
    if (method === 'gcode') {
      const cfg = this.cfgOf(target);
      if (!cfg) throw httpError(400, 'G-Code geht nur an einem Drucker');
      c.start = String(body.start || '').trim().slice(0, 300);
      c.stop = String(body.stop || '').trim().slice(0, 300);
      if (!c.start) throw httpError(400, 'Bitte den Start-Befehl angeben');
    } else {
      c.startEntity = ent(body.startEntity);
      c.stopEntity = ent(body.stopEntity);
      c.tempEntity = ent(body.tempEntity);
      c.durationEntity = ent(body.durationEntity);
      c.durationUnit = body.durationUnit === 'h' ? 'h' : 'min';
      if (!c.startEntity) throw httpError(400, 'Bitte die Entität zum Einschalten bzw. Starten wählen');
    }
    // eine Messstelle – ein Trockner
    this.data.dryers = list.filter((x) => x !== existing && keyOf(x.target) !== keyOf(target));
    this.data.dryers.push(c);
    this.save();
    return c;
  }

  deleteDryer(id) {
    const c = this.data.dryers.find((x) => x.id === id);
    if (!c) throw httpError(404, 'Trockner nicht gefunden');
    this.data.dryers = this.data.dryers.filter((x) => x !== c);
    delete this.data.dryJobs[keyOf(c.target)];
    this.save();
  }

  // ---------------------------------------------------------------- Starten / Stoppen

  find(key) {
    const d = this.view().find((x) => x.key === key);
    if (!d) throw httpError(404, 'Für diese Stelle ist kein Trockner bekannt');
    return d;
  }

  async start(key, body = {}) {
    const d = this.find(key);
    const temp = Math.round(Number(body.temp) || d.suggest.temp);
    const hours = Math.max(0.5, Math.min(48, Number(body.hours) || d.suggest.hours));
    if (d.maxTemp && temp > d.maxTemp) throw httpError(400, `Höchstens ${d.maxTemp} °C für dieses Gerät`);
    if (d.minTemp && temp < d.minTemp) throw httpError(400, `Mindestens ${d.minTemp} °C für dieses Gerät`);
    const minutes = Math.round(hours * 60);
    if (d.kind === 'builtin') {
      const rt = this.ctx.runtime.get(d.target.printerId);
      const b = this.builtinFor(d.target);
      if (!rt || !b) throw httpError(409, d.offline ? 'Drucker ist offline – Trocknen geht, sobald er wieder erreichbar ist' : 'Drucker nicht verbunden');
      await rt.driver.command('dry', { unitId: b.unitId, temp, hours: Math.max(1, Math.round(hours)), material: d.suggest.materials[0] || '', unload: Boolean(body.unload) });
    } else if (d.kind === 'gcode') {
      const rt = this.ctx.runtime.get(d.target.printerId);
      if (typeof rt?.driver.gcode !== 'function') throw httpError(409, 'Dieser Drucker nimmt keine G-Code-Befehle an (nur Klipper/Moonraker und OctoPrint)');
      await rt.driver.gcode(fillCmd(d.config.start, { temp, hours, minutes }));
    } else {
      const ha = this.ctx.ha();
      const c = d.config;
      if (c.tempEntity) await ha.callEntity(c.tempEntity, 'set', temp);
      if (c.durationEntity) await ha.callEntity(c.durationEntity, 'set', c.durationUnit === 'h' ? Math.round(hours) : minutes);
      await ha.callEntity(c.startEntity, 'on');
    }
    delete this.data.dryErrors[key];
    this.data.dryJobs[key] = { startedAt: new Date().toISOString(), until: new Date(Date.now() + minutes * 60_000).toISOString(), temp, hours, kind: d.kind, verified: d.kind !== 'builtin' };
    this.save();
    for (const ms of [8000, 20000, 45000, 80000]) setTimeout(() => this.tick().catch(() => {}), ms).unref?.();
    console.log(`Trocknen gestartet: ${d.name} · ${temp} °C · ${hours} h`);
    return this.find(key);
  }

  async stop(key, { finished = false } = {}) {
    const d = this.find(key);
    if (d.kind === 'builtin') {
      const rt = this.ctx.runtime.get(d.target.printerId);
      const b = this.builtinFor(d.target);
      if (!finished && rt && b) await rt.driver.command('dry', { unitId: b.unitId, stop: true });
    } else if (d.kind === 'gcode') {
      const rt = this.ctx.runtime.get(d.target.printerId);
      if (!finished && d.config.stop && rt?.driver.gcode) await rt.driver.gcode(fillCmd(d.config.stop, {}));
    } else {
      const c = d.config;
      const ha = this.ctx.ha();
      const dom = String(c.startEntity).split('.')[0];
      // Steckdose/Schalter: nach Ablauf ausschalten; Taste/Skript: Stopp nur auf Wunsch (das Gerät kennt die Dauer selbst)
      if (c.stopEntity && (!finished || !c.durationEntity)) await ha.callEntity(c.stopEntity, c.stopEntity === c.startEntity ? 'off' : 'on');
      else if (['switch', 'input_boolean', 'fan', 'climate', 'light'].includes(dom)) await ha.callEntity(c.startEntity, 'off');
    }
    const job = this.data.dryJobs[key];
    delete this.data.dryJobs[key];
    // von Hand vorzeitig beendet, aber mindestens eine Stunde gelaufen → trotzdem als getrocknet vermerken
    if (!finished && job && Date.now() - Date.parse(job.startedAt) > 60 * 60_000) this.markDried(d.target);
    this.save();
    return { ok: true };
  }

  /** Spulen an der Stelle als getrocknet vermerken */
  markDried(tg) {
    const fil = this.ctx.filament;
    const spools = tg.type === 'storage'
      ? fil.spoolsAtLocation(tg.name)
      : (() => {
        const cfg = this.cfgOf(tg);
        return cfg ? fil.slotsFor(cfg).filter((sl) => !tg.unit || sl.unit === tg.unit).map((sl) => fil.spoolAt(cfg.id, sl.key)).filter(Boolean) : [];
      })();
    const now = new Date().toISOString();
    for (const sp of spools) sp.driedAt = now;
    return spools;
  }

  /** Abgelaufene Vorgänge beenden; eingebaute Trockner: Ende am Gerät erkennen */
  /** Hat das Gerät den Befehl angenommen? Sonst Vorgang verwerfen und Grund merken. */
  verify(key, job, d) {
    const b = this.builtinFor(d.target);
    if (b?.active) {
      job.verified = true;
      this.save();
      return true;
    }
    const rt = this.ctx.runtime.get(d.target.printerId);
    const reply = rt?.driver.cmdResults?.[b?.replyCommand || 'ams_filament_drying'];
    const failed = reply && reply.at >= Date.parse(job.startedAt) && /fail|error/i.test(reply.result);
    // Während das Filament zurückgezogen wird, länger warten (Düse heizt, AMS spult zurück)
    if (b?.preparing) job.prepAt = Date.now();
    const since = job.prepAt || Date.parse(job.startedAt);
    const wait = b?.preparing ? 8 * 60_000 : 75_000;
    if (failed || Date.now() - since > wait) {
      const why = failed ? `Der Drucker lehnt das Trocknen ab${reply.reason ? `: ${reply.reason}` : ''}`
        : 'Das Gerät hat nicht reagiert. Bei Bambu muss für Befehle aus PrintDock der LAN-Modus mit Entwicklermodus aktiv sein; während eines Drucks trocknet manches AMS nicht.';
      this.data.dryErrors[key] = { code: failed ? 'refused' : 'noreply', reason: failed ? String(reply.reason || '') : '', at: new Date().toISOString() };
      delete this.data.dryJobs[key];
      this.save();
      console.warn(`Trocknen ${d.name}: ${why}`);
      return false;
    }
    return null;
  }

  async tick() {
    for (const [key, job] of Object.entries(this.data.dryJobs)) {
      const d = this.view().find((x) => x.key === key);
      if (!d) { delete this.data.dryJobs[key]; continue; }
      if (d.kind === 'builtin' && !job.verified) {
        if (this.verify(key, job, d) !== true) continue;
      }
      const builtinDone = d.kind === 'builtin' && job.verified && Date.now() - Date.parse(job.startedAt) > 3 * 60_000 && !this.builtinFor(d.target)?.active;
      if (Date.parse(job.until) <= Date.now() || builtinDone) {
        const spools = this.markDried(d.target);
        await this.stop(key, { finished: true }).catch((err) => console.warn(`Trocknen beenden: ${err.message}`));
        const who = d.target.type === 'storage' ? { id: `${STORAGE}:${d.target.name}`, name: d.target.name } : this.cfgOf(d.target);
        if (who) this.ctx.notify('dryingDone', who, { unit: d.target.unit || d.target.name, temp: job.temp, hours: job.hours, spools: spools.map((s) => `${s.nr} ${s.material}`) });
        console.log(`Trocknen fertig: ${d.name}`);
      }
    }
  }
}

function fillCmd(tpl, v) {
  return String(tpl).replace(/\{(temp|hours|minutes)\}/g, (_, k) => String(v[k] ?? ''));
}

module.exports = { Drying, profileFor, keyOf };
