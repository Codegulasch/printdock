// Startregeln je Drucker – gelten nur für automatische Starts (Auto-Start, Auftrags-Auto-Start, nach dem Trocknen).
//   Zeitfenster   z. B. 07:00–22:00; außerhalb nur Drucke bis zu einer Höchstdauer (0 = gar keine)
//   Strom         lange Drucke warten, bis eine Home-Assistant-Entität „günstig“ meldet:
//                 Schalter/Binärsensor an (z. B. „PV-Überschuss“) oder Zahl unter/über einem Wert
//                 (z. B. Strompreis von Tibber/aWATTar unter 0,25 €, Einspeisung über 1500 W)

const hm = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Liegt die Minute des Tages im Fenster (auch über Mitternacht, z. B. 22:00–06:00)? */
function inWindow(minute, from, to) {
  if (from == null || to == null || from === to) return true;
  return from < to ? minute >= from && minute < to : minute >= from || minute < to;
}

function cleanRules(st = {}) {
  const time = (v, def) => (hm(v) != null ? String(v).padStart(5, '0') : def);
  return {
    orderNext: ['same', 'prio'].includes(st.orderNext) ? st.orderNext : 'off',
    winOn: st.winOn === true || st.winOn === 'true',
    winFrom: time(st.winFrom, '07:00'),
    winTo: time(st.winTo, '22:00'),
    winOutsideMaxH: Math.max(0, Math.min(48, Number(st.winOutsideMaxH) || 0)),
    cheapEntity: /^(sensor|binary_sensor|input_boolean|switch|input_number)\.[\w]+$/.test(String(st.cheapEntity || '').trim()) ? String(st.cheapEntity).trim() : '',
    cheapMode: ['on', 'below', 'above'].includes(st.cheapMode) ? st.cheapMode : 'on',
    cheapValue: Number.isFinite(Number(st.cheapValue)) ? Number(st.cheapValue) : 0,
    cheapMinH: Math.max(0, Math.min(48, Number(st.cheapMinH) || 0)),
  };
}

class StartRules {
  /** ctx: { ha: () => HomeAssistant, printers() } */
  constructor(ctx) {
    this.ctx = ctx;
    this.states = {}; // entity -> { state, at }
    this.timer = setInterval(() => this.poll().catch(() => {}), 60_000);
    this.timer.unref?.();
    setTimeout(() => this.poll().catch(() => {}), 5000).unref?.();
  }

  async poll() {
    const ents = [...new Set(this.ctx.printers().map((p) => p.settings?.cheapEntity).filter(Boolean))];
    const ha = this.ctx.ha();
    for (const e of ents) {
      try {
        const st = await ha.rest(`states/${encodeURIComponent(e)}`);
        this.states[e] = { state: st?.state, at: Date.now() };
      } catch {
        /* nicht erreichbar → Regel greift nicht (lieber drucken als ewig warten) */
      }
    }
  }

  cheapNow(st) {
    const s = this.states[st.cheapEntity];
    if (!s || Date.now() - s.at > 10 * 60_000) return null; // unbekannt
    if (st.cheapMode === 'on') return ['on', 'true', 'home', 'open'].includes(String(s.state).toLowerCase());
    const v = Number(s.state);
    if (!Number.isFinite(v)) return null;
    return st.cheapMode === 'below' ? v < st.cheapValue : v > st.cheapValue;
  }

  /** Darf jetzt automatisch gestartet werden? null = ja, sonst Grund */
  check(p, file, now = new Date()) {
    const st = cleanRules(p.settings || {});
    const hours = (Number(file?.meta?.estimatedSec) || 0) / 3600;
    if (st.winOn) {
      const minute = now.getHours() * 60 + now.getMinutes();
      if (!inWindow(minute, hm(st.winFrom), hm(st.winTo)) && !(st.winOutsideMaxH && hours && hours <= st.winOutsideMaxH)) {
        return st.winOutsideMaxH ? `startet erst ab ${st.winFrom} (außerhalb nur Drucke bis ${st.winOutsideMaxH} h)` : `startet erst ab ${st.winFrom}`;
      }
    }
    if (st.cheapEntity && hours >= st.cheapMinH) {
      const ok = this.cheapNow(st);
      if (ok === false) return 'wartet auf günstigen Strom';
    }
    return null;
  }
}

module.exports = { StartRules, cleanRules, inWindow };
