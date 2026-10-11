// PrintDock-Stationen: kleine ESP32-Geräte mit NFC-Leser (PN532), Waage (HX711) und Display.
// Firmware: https://github.com/Codegulasch/printdock-station
//
// Die Station ist bewusst „dumm“: sie meldet rohe Tag-Seiten, das Gewicht und Tastendrücke und
// zeigt an, was PrintDock ihr schickt. Alles andere – welches Tag-Format, welche Spule, wohin sie
// gehört, Restmenge aus dem Gewicht – entscheidet PrintDock. Verbindung: WebSocket
//   ws://<PrintDock>/api/station/ws      (Protokoll: docs/station-protocol.md)
//
// Ablauf an der Station:
//   Spule auflegen → PrintDock erkennt sie (Tag-UID, Link oder OpenSpool/ACE-Daten), zeigt sie an,
//   bucht die Restmenge nach dem Gewicht und merkt sie sich 3 Minuten: das nächste Fach, in das an
//   einem Drucker eine Spule eingelegt wird, bekommt diese Spule (Bambu: Material und Farbe gehen
//   gleich ans AMS). Unbekannte Tags fragt die Oberfläche einmal ab; leere Tags lassen sich von
//   PrintDock aus beschreiben.
const crypto = require('crypto');
const { store } = require('./store');
const tags = require('./tags');
const colors = require('./colors');
const ws = require('./ws');

const WRITE_TIMEOUT = 60_000;
const MIN_GROSS = 30; // darunter liegt keine Spule auf der Waage
const httpError = (status, message) => Object.assign(new Error(message), { status });
const round = (n) => Math.round(n);
const normUid = (v) => String(v || '').toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 40) || null;

class Stations {
  /**
   * @param ctx { filament, spools() , printers(), baseUrl(), broadcast(event) }
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.db = store('stations.json', { stations: [] });
    this.db.data.stations ??= [];
    this.conns = new Map(); // stationId -> Verbindung
    this.pairing = new Map(); // Geräte-ID -> { conn, code, hello, at }
    this.jobs = new Map(); // jobId -> Schreibauftrag
  }

  get list() {
    return this.db.data.stations;
  }

  save() {
    this.db.save();
    this.changed();
  }

  changed() {
    clearTimeout(this.bcTimer);
    this.bcTimer = setTimeout(() => this.ctx.broadcast('filament', null), 120);
  }

  // ================================================================ Verbindung

  /** HTTP-Upgrade auf /api/station/ws */
  upgrade(req, socket) {
    const conn = ws.accept(req, socket);
    if (!conn) return;
    conn.ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    conn.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      try {
        this.onMessage(conn, msg);
      } catch (err) {
        console.warn(`Station: ${err.message}`);
        conn.send({ t: 'error', msg: err.message });
      }
    });
    conn.on('close', () => {
      if (conn.station) {
        if (this.conns.get(conn.station.id) === conn) this.conns.delete(conn.station.id);
        console.log(`Station „${conn.station.name}“ getrennt`);
        this.changed();
      }
      for (const [id, p] of this.pairing) if (p.conn === conn) this.pairing.delete(id);
    });
    // Ohne „hello“ binnen 10 s wieder trennen
    setTimeout(() => !conn.hello && conn.close(1008, 'hello missing'), 10_000).unref?.();
  }

  onMessage(conn, msg) {
    if (msg.t === 'hello') return this.onHello(conn, msg);
    if (!conn.station) return; // erst nach dem Koppeln
    const st = conn.station;
    st.lastSeen = new Date().toISOString();
    switch (msg.t) {
      case 'tag': return this.onTag(conn, msg);
      case 'tag_gone': return this.onTagGone(conn);
      case 'weight': return this.onWeight(conn, msg);
      case 'button': return this.onButton(conn, msg);
      case 'written': return this.onWritten(conn, msg);
      case 'calibrated':
        conn.cal = { ok: msg.ok !== false, at: Date.now() };
        if (msg.ok !== false) this.show(conn, ['Waage kalibriert', `${msg.grams ?? ''} g`], { beep: 'ok' });
        return this.changed();
      case 'log': return console.log(`Station „${st.name}“: ${String(msg.msg).slice(0, 200)}`);
      default:
    }
  }

  onHello(conn, msg) {
    const hello = {
      id: String(msg.id || '').replace(/[^0-9A-Za-z:_-]/g, '').slice(0, 40),
      name: String(msg.name || '').slice(0, 40),
      fw: String(msg.fw || '').slice(0, 20),
      hw: String(msg.hw || '').slice(0, 30),
      caps: msg.caps && typeof msg.caps === 'object' ? msg.caps : {},
    };
    if (!hello.id) return conn.close(1008, 'id missing');
    conn.hello = hello;
    const st = msg.token ? this.list.find((s) => s.token && s.token === String(msg.token)) : null;
    if (st) return this.attach(conn, st, hello);
    // Unbekannt → Kopplung: Code auf dem Display, in PrintDock bestätigen
    if (!this.pairing.has(hello.id) && this.pairing.size >= 10) return conn.close(1013, 'too many pairing requests');
    const prev = this.pairing.get(hello.id);
    const code = prev?.code || String(crypto.randomInt(100000, 1000000));
    this.pairing.set(hello.id, { conn, code, hello, at: Date.now(), ip: conn.ip });
    conn.send({ t: 'pair', code });
    this.show(conn, ['Koppeln', `Code ${code}`, 'in PrintDock bestätigen'], { color: '#3B82F6' });
    console.log(`Station ${hello.id} möchte sich koppeln – Code ${code}`);
    this.changed();
  }

  attach(conn, st, hello) {
    const old = this.conns.get(st.id);
    if (old && old !== conn) old.close(4000, 'replaced');
    conn.station = st;
    Object.assign(st, { hwId: hello.id, fw: hello.fw, hw: hello.hw, caps: hello.caps, ip: conn.ip, lastSeen: new Date().toISOString() });
    if (!hello.caps?.scale) st.autoWeigh = st.autoWeigh ?? false;
    this.conns.set(st.id, conn);
    this.db.save();
    conn.send({ t: 'welcome', id: st.id, name: st.name, token: st.token });
    this.idle(conn);
    console.log(`Station „${st.name}“ verbunden (${conn.ip}, Firmware ${hello.fw || '?'})`);
    this.changed();
  }

  /** Kopplung bestätigen (aus der Oberfläche). */
  accept(hwId, body = {}) {
    const p = this.pairing.get(hwId);
    if (!p || !p.conn.open) throw httpError(404, 'Die Station wartet nicht mehr – bitte neu starten');
    if (body.code && String(body.code) !== p.code) throw httpError(400, 'Der Code stimmt nicht');
    const st = {
      id: `st-${crypto.randomBytes(4).toString('hex')}`,
      name: String(body.name || p.hello.name || `Station ${this.list.length + 1}`).slice(0, 40),
      token: crypto.randomBytes(18).toString('base64url'),
      role: 'storage',
      printerId: null,
      slotKey: null,
      autoWeigh: true,
      createdAt: new Date().toISOString(),
    };
    this.list.push(st);
    this.pairing.delete(hwId);
    this.db.save();
    this.attach(p.conn, st, p.hello);
    this.show(p.conn, ['Gekoppelt', st.name], { beep: 'ok', color: '#22C55E' });
    setTimeout(() => this.refresh(p.conn), 2500).unref?.();
    return this.publicStation(st);
  }

  reject(hwId) {
    const p = this.pairing.get(hwId);
    if (p) {
      p.conn.send({ t: 'pair_rejected' });
      p.conn.close(4001, 'rejected');
      this.pairing.delete(hwId);
    }
    this.changed();
  }

  update(id, body = {}) {
    const st = this.byId(id);
    if (body.name !== undefined) st.name = String(body.name).trim().slice(0, 40) || st.name;
    if (body.role !== undefined) st.role = body.role === 'printer' ? 'printer' : 'storage';
    if (body.printerId !== undefined) {
      const cfg = body.printerId ? this.ctx.printers().find((p) => p.id === body.printerId) : null;
      if (body.printerId && !cfg) throw httpError(404, 'Drucker nicht gefunden');
      st.printerId = cfg?.id || null;
    }
    if (body.slotKey !== undefined) st.slotKey = body.slotKey || null;
    if (st.role !== 'printer') Object.assign(st, { printerId: null, slotKey: null });
    if (body.autoWeigh !== undefined) st.autoWeigh = Boolean(body.autoWeigh);
    this.save();
    const conn = this.conns.get(st.id);
    if (conn) this.idle(conn);
    return this.publicStation(st);
  }

  remove(id) {
    const st = this.byId(id);
    const conn = this.conns.get(id);
    if (conn) {
      conn.send({ t: 'forget' }); // Station löscht ihren Schlüssel und fragt neu
      conn.close(4002, 'removed');
    }
    this.db.data.stations = this.list.filter((s) => s !== st);
    this.save();
  }

  byId(id) {
    const st = this.list.find((s) => s.id === id);
    if (!st) throw httpError(404, 'Station nicht gefunden');
    return st;
  }

  online(id) {
    const c = this.conns.get(id);
    if (!c?.open) throw httpError(409, 'Die Station ist nicht verbunden');
    return c;
  }

  // ================================================================ Tags

  findSpool(uid, decoded) {
    const list = this.ctx.spools().filter((s) => !s.archived);
    return (uid && list.find((s) => normUid(s.rfid) === uid))
      || (decoded?.spoolRef && list.find((s) => s.nr === decoded.spoolRef || s.id === decoded.spoolRef))
      || null;
  }

  onTag(conn, msg) {
    const uid = normUid(msg.uid);
    if (!uid) return;
    const kind = String(msg.kind || 'ntag').toLowerCase();
    const decoded = msg.pages ? tags.decode(msg.pages) : { format: kind === 'ntag' ? 'unknown' : kind, data: null, capacity: null };
    conn.tag = { uid, kind, decoded, at: Date.now() };
    conn.spoolId = null;
    conn.applied = null;
    this.changed();
    // Wartet ein Schreibauftrag auf einen Tag?
    const job = [...this.jobs.values()].find((j) => j.stationId === conn.station.id && !j.sent);
    if (job) return this.sendWrite(conn, job);
    this.identify(conn);
  }

  /** Erkannten Tag einer Spule zuordnen und anzeigen. */
  identify(conn) {
    const { uid, decoded, kind } = conn.tag;
    const fil = this.ctx.filament;
    const st = conn.station;
    const spool = this.findSpool(uid, decoded);
    if (!spool) {
      fil.pendingTag = {
        tag: uid, kind, at: new Date().toISOString(), stationId: st.id, stationName: st.name,
        printerId: st.role === 'printer' ? st.printerId : null, slotKey: st.role === 'printer' ? st.slotKey : null,
        format: decoded.format, data: decoded.data || null, capacity: decoded.capacity, blank: Boolean(decoded.blank),
        writable: kind === 'ntag',
      };
      fil.save();
      const d = decoded.data;
      const lines = d ? ['Neue Spule erkannt', `${d.material || ''} ${d.color ? colors.nameOf(d.color) : ''}`.trim(), 'in PrintDock anlegen'] : [decoded.blank ? 'Leerer Tag' : 'Unbekannter Tag', uid.slice(0, 14), 'in PrintDock zuordnen'];
      this.show(conn, lines, { color: d?.color || null, beep: 'warn' });
      return;
    }
    // Tag zeigt (per Link) auf die Spule, kennt aber die UID noch nicht → merken
    if (normUid(spool.rfid) !== uid) {
      for (const s of this.ctx.spools()) if (s !== spool && normUid(s.rfid) === uid) s.rfid = null;
      spool.rfid = uid;
    }
    if (fil.pendingTag?.tag === uid) fil.pendingTag = null;
    conn.spoolId = spool.id;
    conn.applied = null; // Gewicht neu auswerten (bucht nur bei echter Änderung)
    this.place(conn, spool);
    fil.save();
    this.showSpool(conn, spool);
    this.applyWeight(conn);
  }

  /** Station am Drucker mit festem Platz: gleich einlegen; sonst aufs Einlegen warten. */
  place(conn, spool) {
    const st = conn.station;
    const fil = this.ctx.filament;
    if (st.role === 'printer' && st.printerId) {
      const cfg = this.ctx.printers().find((p) => p.id === st.printerId);
      const slots = cfg ? fil.slotsFor(cfg) : [];
      const key = st.slotKey && slots.some((s) => s.key === st.slotKey) ? st.slotKey : slots.length === 1 ? slots[0].key : null;
      if (cfg && key) {
        fil.placeSpool(spool, cfg.id, key, { push: true });
        conn.placed = { spoolId: spool.id, text: `${cfg.name} · ${slots.find((s) => s.key === key)?.label || key}` };
        return;
      }
    }
    conn.placed = null;
    fil.arm(spool, { stationId: st.id, printerId: st.role === 'printer' ? st.printerId : null });
  }

  onTagGone(conn) {
    conn.tag = null;
    conn.spoolId = null;
    conn.applied = null;
    this.changed();
    this.idle(conn);
  }

  // ================================================================ Waage

  onWeight(conn, msg) {
    const g = Number(msg.g);
    if (!Number.isFinite(g)) return;
    const prev = conn.weight;
    conn.weight = { g: Math.round(g * 10) / 10, stable: Boolean(msg.stable), at: Date.now() };
    if (conn.weight.stable && (!prev?.stable || Math.abs(prev.g - g) >= 2)) {
      this.changed();
      this.applyWeight(conn);
    }
  }

  /** Spule liegt auf und das Gewicht ist ruhig → Restmenge buchen (bzw. Leerspule lernen). */
  applyWeight(conn, force = false) {
    const w = conn.weight;
    const st = conn.station;
    if (!conn.spoolId || !w?.stable || w.g < MIN_GROSS || st.autoWeigh === false) return;
    if (Date.now() - w.at > 10_000) return;
    const spool = this.ctx.spools().find((s) => s.id === conn.spoolId);
    if (!spool) return;
    const key = `${spool.id}:${Math.round(w.g / 2)}`;
    if (conn.applied === key && !force) return;
    conn.applied = key;
    const fil = this.ctx.filament;
    if (spool.tare > 0) {
      const rest = Math.max(0, round(w.g - spool.tare));
      if (Math.abs(rest - spool.remaining) >= 2 || force) {
        fil.setRemaining(spool, rest, `gewogen an „${st.name}“: ${round(w.g)} g brutto`, 'weigh');
        fil.save();
      }
      this.showSpool(conn, spool, `Rest ${rest} g`);
      return;
    }
    // Neue, volle Spule: Leergewicht = brutto − netto
    const unused = spool.remaining >= spool.netWeight - 0.5 && !spool.lastUsedAt;
    const tare = round(w.g - spool.netWeight);
    if (unused && tare >= 40 && tare <= 800) {
      spool.tare = tare;
      fil.save();
      console.log(`Station: Leerspule ${spool.nr} = ${tare} g (gewogen)`);
      this.showSpool(conn, spool, `Leerspule ${tare} g gespeichert`);
      return;
    }
    this.showSpool(conn, spool, 'Leerspule fehlt');
  }

  tare(id) {
    this.online(id).send({ t: 'tare' });
    return { ok: true };
  }

  calibrate(id, grams) {
    const g = Number(grams);
    if (!(g >= 10 && g <= 20000)) throw httpError(400, 'Bitte das Gewicht des Prüfgewichts in Gramm angeben (z. B. 1000)');
    this.online(id).send({ t: 'calibrate', grams: g });
    return { ok: true };
  }

  identifyStation(id) {
    const conn = this.online(id);
    conn.send({ t: 'blink' });
    this.show(conn, ['Hier bin ich', conn.station.name], { beep: 'ok', color: '#F59E0B' });
    setTimeout(() => this.refresh(conn), 3000).unref?.();
    return { ok: true };
  }

  // ================================================================ Taste

  onButton(conn, msg) {
    if (msg.press === 'long') return; // lang = Tara, macht die Station selbst
    if (conn.spoolId) {
      const spool = this.ctx.spools().find((s) => s.id === conn.spoolId);
      if (spool) {
        this.place(conn, spool);
        this.applyWeight(conn, true);
        this.showSpool(conn, spool);
      }
      return;
    }
    this.idle(conn);
  }

  // ================================================================ Tag beschreiben

  /**
   * Schreibauftrag: Spule auf einen Tag an der Station schreiben. Liegt schon ein Tag auf,
   * sofort; sonst wartet die Station bis zu 60 s darauf.
   */
  write(id, spoolId, format = 'universal') {
    const conn = this.online(id);
    const spool = this.ctx.spools().find((s) => s.id === spoolId);
    if (!spool) throw httpError(404, 'Spule nicht gefunden');
    if (!tags.FORMATS.includes(format)) throw httpError(400, 'Unbekanntes Tag-Format');
    if (format !== 'openspool' && format !== 'ace' && !this.ctx.baseUrl()) throw httpError(400, 'Die Adresse von PrintDock im Heimnetz ist nicht bekannt');
    for (const j of this.jobs.values()) if (j.stationId === id) this.finishJob(j, httpError(409, 'Durch einen neuen Schreibauftrag ersetzt'));
    return new Promise((resolve, reject) => {
      const job = { id: crypto.randomBytes(4).toString('hex'), stationId: id, spoolId, format, resolve, reject, sent: false };
      job.timer = setTimeout(() => {
        this.finishJob(job, httpError(408, 'Kein Tag aufgelegt'));
        if (conn.open) this.refresh(conn);
      }, WRITE_TIMEOUT);
      this.jobs.set(job.id, job);
      if (conn.tag) this.sendWrite(conn, job);
      else this.show(conn, ['Tag auflegen', `für ${spool.nr} ${spool.material}`], { color: spool.color, beep: 'ok' });
      this.changed();
    });
  }

  sendWrite(conn, job) {
    const spool = this.ctx.spools().find((s) => s.id === job.spoolId);
    try {
      if (!spool) throw httpError(404, 'Spule nicht gefunden');
      if (conn.tag.kind !== 'ntag') throw httpError(400, 'Dieser Tag lässt sich nicht beschreiben (nur NTAG213/215/216 bzw. MIFARE Ultralight)');
      const enc = tags.encode(job.format, spool, { baseUrl: this.ctx.baseUrl(), capacity: conn.tag.decoded?.capacity || null });
      job.sent = true;
      job.uid = conn.tag.uid;
      conn.send({ t: 'write', job: job.id, uid: conn.tag.uid, start: enc.pages[0].page, data: enc.pages.map((p) => p.hex).join('') });
      this.show(conn, ['Schreibe …', `${spool.nr} ${spool.material}`], { color: spool.color });
    } catch (err) {
      this.show(conn, ['Nicht beschrieben', err.message.slice(0, 40)], { beep: 'error', color: '#EF4444' });
      this.finishJob(job, err);
    }
  }

  onWritten(conn, msg) {
    const job = this.jobs.get(String(msg.job));
    if (!job) return;
    if (!msg.ok) {
      this.show(conn, ['Schreiben fehlgeschlagen', String(msg.error || '').slice(0, 40)], { beep: 'error', color: '#EF4444' });
      return this.finishJob(job, httpError(502, `Station: ${msg.error || 'Schreiben fehlgeschlagen'}`));
    }
    // Zur Kontrolle liest die Station den Tag erneut
    const check = msg.pages ? tags.decode(msg.pages) : null;
    const spool = this.ctx.spools().find((s) => s.id === job.spoolId);
    const okRead = !check || (job.format === 'ace' ? check.format === 'ace' : job.format === 'openspool' ? Boolean(check.data) : check.spoolRef === spool?.nr);
    if (!okRead) {
      this.show(conn, ['Prüfung fehlgeschlagen', 'bitte erneut'], { beep: 'error', color: '#EF4444' });
      return this.finishJob(job, httpError(502, 'Der Tag enthält nach dem Schreiben nicht die erwarteten Daten'));
    }
    const uid = normUid(msg.uid) || job.uid;
    if (spool) {
      for (const s of this.ctx.spools()) if (s !== spool && normUid(s.rfid) === uid) s.rfid = null;
      spool.rfid = uid;
      if (this.ctx.filament.pendingTag?.tag === uid) this.ctx.filament.pendingTag = null;
    }
    if (conn.tag) conn.tag.decoded = check || conn.tag.decoded;
    this.finishJob(job, null, { ok: true, uid, format: job.format });
    console.log(`Station „${conn.station.name}“: ${spool?.nr} auf Tag ${uid} geschrieben (${job.format})`);
    this.show(conn, ['Tag beschrieben ✓', `${spool?.nr || ''} ${spool?.material || ''}`], { beep: 'ok', color: spool?.color });
    setTimeout(() => conn.open && conn.tag && this.identify(conn), 1500).unref?.();
  }

  finishJob(job, err, result) {
    if (!this.jobs.has(job.id)) return;
    clearTimeout(job.timer);
    this.jobs.delete(job.id);
    if (err) job.reject(err);
    else job.resolve(result);
    this.changed();
  }

  // ================================================================ Anzeige

  show(conn, lines, { color = null, beep = null } = {}) {
    if (!conn?.open) return;
    conn.shown = { lines, color };
    conn.send({ t: 'show', lines: lines.map((l) => String(l ?? '').slice(0, 40)), color: colors.normalize(color) || null, beep });
  }

  showSpool(conn, spool, status = null) {
    const where = conn.placed?.spoolId === spool.id ? `→ ${conn.placed.text}` : this.ctx.filament.armed?.spoolId === spool.id ? 'jetzt einlegen' : null;
    this.show(conn, [
      `${spool.nr} ${spool.material}`,
      `${spool.colorName || ''}${spool.brand ? ` · ${spool.brand}` : ''}`.trim() || ' ',
      status || `${round(spool.remaining)} g von ${round(spool.netWeight)} g`,
      where || ' ',
    ], { color: spool.color });
  }

  idle(conn) {
    const st = conn.station;
    if (!st) return;
    const cfg = st.role === 'printer' && st.printerId ? this.ctx.printers().find((p) => p.id === st.printerId) : null;
    this.show(conn, [st.name, cfg ? cfg.name : 'Spule auflegen', cfg ? 'Spule auflegen' : ' ']);
  }

  /** Anzeige nach einer Unterbrechung wiederherstellen. */
  refresh(conn) {
    if (!conn.open) return;
    const spool = conn.spoolId && this.ctx.spools().find((s) => s.id === conn.spoolId);
    if (spool) this.showSpool(conn, spool);
    else if (conn.tag) this.identify(conn);
    else this.idle(conn);
  }

  // ---- Rückmeldungen aus der Filamentverwaltung

  /** Gescannte Spule wurde an einem Drucker eingelegt. */
  onPlaced(spool, cfg, slot, source) {
    const conn = source?.stationId && this.conns.get(source.stationId);
    if (!conn?.open) return;
    conn.placed = { spoolId: spool.id, text: `${cfg.name} · ${slot.label}` };
    this.show(conn, [`${spool.nr} eingelegt`, cfg.name, slot.label], { beep: 'ok', color: spool.color });
    setTimeout(() => this.refresh(conn), 4000).unref?.();
  }

  /** Unbekannter Tag wurde in der Oberfläche einer Spule zugeordnet. */
  onTagAssigned(spool, pending) {
    const conn = pending?.stationId && this.conns.get(pending.stationId);
    if (!conn?.open || conn.tag?.uid !== pending.tag) return;
    conn.spoolId = spool.id;
    this.showSpool(conn, spool);
    this.applyWeight(conn);
  }

  // ================================================================ Oberfläche

  publicStation(st) {
    const c = this.conns.get(st.id);
    const spool = c?.spoolId ? this.ctx.spools().find((s) => s.id === c.spoolId) : null;
    return {
      id: st.id, name: st.name, role: st.role, printerId: st.printerId, slotKey: st.slotKey, autoWeigh: st.autoWeigh !== false,
      fw: st.fw || null, hw: st.hw || null, ip: st.ip || null, caps: st.caps || {}, lastSeen: st.lastSeen || null,
      online: Boolean(c?.open),
      tag: c?.tag ? { uid: c.tag.uid, kind: c.tag.kind, format: c.tag.decoded?.format || null, capacity: c.tag.decoded?.capacity || null } : null,
      spool: spool ? { id: spool.id, nr: spool.nr } : null,
      weight: c?.weight || null,
      writing: [...this.jobs.values()].some((j) => j.stationId === st.id),
    };
  }

  view() {
    return {
      list: this.list.map((s) => this.publicStation(s)),
      pairing: [...this.pairing.values()].filter((p) => p.conn.open).map((p) => ({ id: p.hello.id, code: p.code, name: p.hello.name, fw: p.hello.fw, hw: p.hello.hw, ip: p.ip, at: new Date(p.at).toISOString() })),
    };
  }
}

module.exports = { Stations };
