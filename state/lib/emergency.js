// Notaus über Home Assistant: Meldet ein Rauchmelder, Temperatur- oder anderer Sensor Alarm,
// schaltet PrintDock die Steckdosen der Drucker aus und schickt eine Meldung („Notaus“).
// Regel: { id, entity, mode: 'on' | 'above', value, printers: [] (leer = alle mit Steckdose), name }
// Ausgelöst wird nur beim Wechsel von „normal“ auf „Alarm“ – wieder scharf, sobald der Sensor normal meldet.

const crypto = require('crypto');
const { store } = require('./store');

const db = store('emergency.json', { enabled: false, rules: [], log: [] });
db.data.rules ??= [];
db.data.log ??= [];

const httpError = (status, message) => Object.assign(new Error(message), { status });
const ALARM_ON = ['on', 'true', 'detected', 'smoke', 'heat', 'problem', 'unsafe', 'triggered', 'open'];

class Emergency {
  /** ctx: { ha: () => HomeAssistant, printers(), notify(cfg, entry), broadcast } */
  constructor(ctx) {
    this.ctx = ctx;
    this.state = {}; // ruleId -> { alarm, value, at }
    this.timer = setInterval(() => this.poll().catch(() => {}), 15_000);
    this.timer.unref?.();
  }

  view() {
    return { enabled: db.data.enabled, rules: db.data.rules, log: db.data.log.slice(-20).reverse(), state: this.state };
  }

  save(body = {}) {
    if ('enabled' in body) db.data.enabled = Boolean(body.enabled);
    if (Array.isArray(body.rules)) {
      db.data.rules = body.rules.slice(0, 20).map((r) => {
        const entity = String(r.entity || '').trim();
        if (!/^(binary_sensor|sensor|input_boolean|switch)\.[\w]+$/.test(entity)) throw httpError(400, `Ungültige Entität „${entity}“`);
        return {
          id: r.id || crypto.randomUUID(),
          entity,
          name: String(r.name || '').trim().slice(0, 60),
          mode: r.mode === 'above' ? 'above' : 'on',
          value: Number(r.value) || 60,
          printers: Array.isArray(r.printers) ? r.printers.map(String).slice(0, 50) : [],
        };
      });
    }
    db.save();
    return this.view();
  }

  isAlarm(rule, st) {
    if (!st) return false;
    if (rule.mode === 'above') {
      const v = Number(st.state);
      return Number.isFinite(v) && v > rule.value;
    }
    return ALARM_ON.includes(String(st.state).toLowerCase());
  }

  async poll() {
    if (!db.data.enabled || !db.data.rules.length) return;
    const ha = this.ctx.ha();
    for (const rule of db.data.rules) {
      let st;
      try {
        st = await ha.rest(`states/${encodeURIComponent(rule.entity)}`);
      } catch {
        continue;
      }
      const alarm = this.isAlarm(rule, st);
      const prev = this.state[rule.id];
      this.state[rule.id] = { alarm, value: st?.state ?? null, at: new Date().toISOString() };
      if (alarm && !prev?.alarm) await this.trigger(rule, st?.state).catch((err) => console.warn(`Notaus: ${err.message}`));
    }
  }

  /** Alarm: Steckdosen der betroffenen Drucker aus, melden. test = nur melden, nichts ausschalten */
  async trigger(rule, value, { test = false } = {}) {
    const printers = this.ctx.printers().filter((p) => p.settings?.powerEntity && (!rule.printers.length || rule.printers.includes(p.id)));
    const sensor = rule.name || rule.entity;
    console.warn(`NOTAUS${test ? ' (Test)' : ''}: ${sensor} meldet ${value} → ${printers.map((p) => p.name).join(', ') || 'keine Drucker mit Steckdose'}`);
    const results = [];
    for (const p of printers) {
      let error = null;
      if (!test) {
        try {
          await this.ctx.ha().setPower(p.id, false);
        } catch (err) {
          error = err.message;
        }
      }
      results.push({ printer: p.name, error });
      this.ctx.notify(p, { sensor, value: test ? `${value} (Test)` : value, error });
    }
    db.data.log.push({ at: new Date().toISOString(), sensor, value, test, printers: results });
    db.data.log = db.data.log.slice(-50);
    db.save();
    this.ctx.broadcast('ha', null);
    return { printers: results };
  }

  test(id) {
    const rule = db.data.rules.find((r) => r.id === id);
    if (!rule) throw httpError(404, 'Regel nicht gefunden');
    return this.trigger(rule, 'Probealarm', { test: true });
  }
}

module.exports = { Emergency };
