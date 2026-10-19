// Benachrichtigungen: erkennt Ereignisse (fertig, Fehler, pausiert, ...) und
// verschickt sie an die eingerichteten Kanäle – auf Wunsch mit Kamerabild.

const EVENTS = [
  { id: 'finished', label: 'Druck fertig', defaultOn: true },
  { id: 'error', label: 'Fehler', defaultOn: true },
  { id: 'paused', label: 'Pausiert (z. B. Filament leer)', defaultOn: true },
  { id: 'cancelled', label: 'Druck abgebrochen', defaultOn: false },
  { id: 'started', label: 'Druck gestartet', defaultOn: false },
  { id: 'offline', label: 'Drucker länger als 2 Minuten nicht erreichbar', defaultOn: false },
  { id: 'maintenance', label: 'Wartung fällig', defaultOn: true },
  { id: 'filamentLow', label: 'Spule wird knapp', defaultOn: true },
  { id: 'humidity', label: 'Filament zu feucht (AMS/ACE/Sensor)', defaultOn: true },
  { id: 'dryingDone', label: 'Trocknen fertig', defaultOn: true },
  { id: 'update', label: 'PrintDock-Update verfügbar', defaultOn: true },
  { id: 'firstLayer', label: 'Foto nach der ersten Schicht', defaultOn: false },
  { id: 'emergency', label: 'Notaus (Rauch, Hitze)', defaultOn: true },
  { id: 'portalRequest', label: 'Neue Anfrage im Druckportal', defaultOn: true },
  { id: 'portalAnswer', label: 'Kunde antwortet im Druckportal', defaultOn: true },
];

const STYLE = {
  finished: { emoji: '✅', tag: 'white_check_mark', priority: 3 },
  error: { emoji: '❌', tag: 'x', priority: 5 },
  paused: { emoji: '⏸️', tag: 'pause_button', priority: 4 },
  cancelled: { emoji: '⏹️', tag: 'stop_button', priority: 3 },
  started: { emoji: '▶️', tag: 'arrow_forward', priority: 2 },
  offline: { emoji: '⚠️', tag: 'warning', priority: 4 },
  maintenance: { emoji: '🔧', tag: 'wrench', priority: 3 },
  filamentLow: { emoji: '🧵', tag: 'thread', priority: 3 },
  humidity: { emoji: '💧', tag: 'droplet', priority: 3 },
  dryingDone: { emoji: '♨️', tag: 'hotsprings', priority: 3 },
  firstLayer: { emoji: '📷', tag: 'camera', priority: 2 },
  emergency: { emoji: '🚨', tag: 'rotating_light', priority: 5 },
  update: { emoji: '⬆️', tag: 'arrow_up', priority: 2 },
  portalRequest: { emoji: '📨', tag: 'incoming_envelope', priority: 4 },
  portalAnswer: { emoji: '🤝', tag: 'handshake', priority: 4 },
  test: { emoji: '🔔', tag: 'bell', priority: 3 },
};

// ------------------------------------------------------------------ Kanaltypen

const CHANNELS = {
  homeassistant: {
    label: 'Home Assistant (Companion-App)',
    hint: 'Schickt die Meldung über Home Assistant – an die Companion-App auf dem Handy oder als Meldung in Home Assistant. Als Add-on ohne weitere Einrichtung, sonst die Verbindung unter Einstellungen → Home Assistant eintragen.',
    fields: [{ key: 'service', label: 'Ziel', type: 'haNotify', required: true }],
    image: true,
    ha: null, // wird von server.js gesetzt
    async send(cfg, msg, image) {
      if (!CHANNELS.homeassistant.ha) throw new Error('Home Assistant ist nicht verbunden');
      const style = STYLE[msg.event] || STYLE.test;
      await CHANNELS.homeassistant.ha.notify(cfg.service, { ...msg, title: `${style.emoji} ${msg.title}` }, { image, priority: style.priority });
    },
  },

  ntfy: {
    label: 'ntfy (Push aufs Handy)',
    hint: 'Kostenlose App für Android und iOS. Thema in der App abonnieren – fertig. Eigener ntfy-Server möglich.',
    fields: [
      { key: 'server', label: 'Server', default: 'https://ntfy.sh' },
      { key: 'topic', label: 'Thema (möglichst schwer zu erraten)', required: true },
      { key: 'token', label: 'Zugangstoken (nur bei geschütztem Server)', secret: true },
    ],
    image: true,
    async send(cfg, msg, image) {
      const server = String(cfg.server || 'https://ntfy.sh').replace(/\/+$/, '');
      const style = STYLE[msg.event] || STYLE.test;
      const auth = cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {};
      if (image) {
        // Titel/Text als URL-Parameter, weil HTTP-Header keine Umlaute/Emojis erlauben
        const qs = new URLSearchParams({
          title: msg.title, message: msg.body, tags: style.tag, priority: String(style.priority), filename: 'kamera.jpg',
        });
        await post(`${server}/${encodeURIComponent(cfg.topic)}?${qs}`, { method: 'PUT', headers: auth, body: image });
      } else {
        await post(server, {
          headers: { 'Content-Type': 'application/json', ...auth },
          body: JSON.stringify({ topic: cfg.topic, title: msg.title, message: msg.body, tags: [style.tag], priority: style.priority }),
        });
      }
    },
  },

  telegram: {
    label: 'Telegram',
    hint: 'Bot über @BotFather anlegen, Token eintragen. Chat-ID z. B. über @userinfobot herausfinden und dem Bot einmal schreiben.',
    fields: [
      { key: 'botToken', label: 'Bot-Token', required: true, secret: true },
      { key: 'chatId', label: 'Chat-ID', required: true },
    ],
    image: true,
    async send(cfg, msg, image) {
      const base = `${process.env.TELEGRAM_API || 'https://api.telegram.org'}/bot${cfg.botToken}`;
      const text = `${(STYLE[msg.event] || STYLE.test).emoji} ${msg.title}\n${msg.body}`;
      if (image) {
        const form = new FormData();
        form.append('chat_id', String(cfg.chatId));
        form.append('caption', text.slice(0, 1024));
        form.append('photo', new Blob([image], { type: 'image/jpeg' }), 'kamera.jpg');
        await post(`${base}/sendPhoto`, { body: form });
      } else {
        await post(`${base}/sendMessage`, {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: cfg.chatId, text }),
        });
      }
    },
  },

  discord: {
    label: 'Discord',
    hint: 'Kanal → Einstellungen → Integrationen → Webhooks → Neuer Webhook → URL kopieren.',
    fields: [{ key: 'webhookUrl', label: 'Webhook-URL', required: true, secret: true }],
    image: true,
    async send(cfg, msg, image) {
      const content = `${(STYLE[msg.event] || STYLE.test).emoji} **${msg.title}**\n${msg.body}`;
      if (image) {
        const form = new FormData();
        form.append('payload_json', JSON.stringify({ content }));
        form.append('files[0]', new Blob([image], { type: 'image/jpeg' }), 'kamera.jpg');
        await post(cfg.webhookUrl, { body: form });
      } else {
        await post(cfg.webhookUrl, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
      }
    },
  },

  gotify: {
    label: 'Gotify',
    hint: 'Selbst gehosteter Push-Server. Unter „Apps“ eine App anlegen und deren Token eintragen.',
    fields: [
      { key: 'server', label: 'Server-URL', required: true },
      { key: 'appToken', label: 'App-Token', required: true, secret: true },
    ],
    image: false,
    async send(cfg, msg) {
      const server = String(cfg.server).replace(/\/+$/, '');
      const style = STYLE[msg.event] || STYLE.test;
      await post(`${server}/message?token=${encodeURIComponent(cfg.appToken)}`, {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `${style.emoji} ${msg.title}`, message: msg.body, priority: style.priority * 2 }),
      });
    },
  },

  webhook: {
    label: 'Webhook (Home Assistant, Node-RED, ...)',
    hint: 'Schickt die Meldung als JSON per POST. Mit Kamerabild enthält das Feld „image“ das JPEG als Base64.',
    fields: [{ key: 'url', label: 'URL', required: true, secret: true }],
    image: true,
    async send(cfg, msg, image) {
      await post(cfg.url, {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: msg.event,
          title: msg.title,
          message: msg.body,
          printer: msg.printer,
          status: msg.status,
          time: new Date().toISOString(),
          image: image ? image.toString('base64') : undefined,
        }),
      });
    },
  },
};

async function post(url, { method = 'POST', headers = {}, body }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { method, headers, body, signal: ctrl.signal });
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`HTTP ${res.status}${text ? `: ${text}` : ''}`);
    }
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Zeitüberschreitung');
    const code = err.cause?.code || err.cause?.errors?.[0]?.code;
    const reason = {
      ECONNREFUSED: 'Verbindung abgelehnt – Adresse und Port prüfen',
      ENOTFOUND: 'Adresse nicht gefunden – Schreibweise prüfen',
      EAI_AGAIN: 'Adresse nicht auflösbar – Internetverbindung prüfen',
      ETIMEDOUT: 'Zeitüberschreitung',
      ECONNRESET: 'Verbindung abgebrochen',
      EHOSTUNREACH: 'Ziel nicht erreichbar',
    }[code];
    if (reason) throw new Error(reason);
    if (code) throw new Error(`Ziel nicht erreichbar (${code})`);
    if (err.cause?.message) throw new Error(err.cause.message);
    throw err;
  } finally {
    clearTimeout(t);
  }
}

// ------------------------------------------------------------------ Texte

function fmtDuration(sec) {
  if (sec == null) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

function buildMessage(event, printer, status, entry) {
  const { tr, locale } = require('./lib/i18n');
  const file = entry?.file || status?.file;
  const pct = status?.progress != null ? `${Math.floor(status.progress)} %` : null;
  const lines = [];
  const msg = status?.message ? tr(status.message) : null;
  const name = printer?.name;
  let title;
  switch (event) {
    case 'finished':
      title = tr('{p}: Druck fertig', { p: name });
      if (file) lines.push(file);
      if (entry?.durationSec) lines.push(tr('Dauer: {d}', { d: fmtDuration(entry.durationSec) }));
      break;
    case 'error':
      title = tr('{p}: Fehler', { p: name });
      if (msg) lines.push(msg);
      if (file) lines.push(pct ? tr('Datei: {f} (bei {pct})', { f: file, pct }) : tr('Datei: {f}', { f: file }));
      break;
    case 'paused':
      title = tr('{p}: Druck pausiert', { p: name });
      if (msg) lines.push(msg);
      if (file) lines.push(pct ? tr('{f} – bei {pct}', { f: file, pct }) : file);
      lines.push(tr('Bitte am Drucker nachsehen.'));
      break;
    case 'cancelled':
      title = tr('{p}: Druck abgebrochen', { p: name });
      if (file) lines.push(entry?.progress != null ? tr('{f} – bei {pct}', { f: file, pct: `${Math.floor(entry.progress)} %` }) : file);
      break;
    case 'started':
      title = tr('{p}: Druck gestartet', { p: name });
      if (file) lines.push(file);
      if (status?.remainingSec) {
        const end = new Date(Date.now() + status.remainingSec * 1000);
        lines.push(tr('Voraussichtlich fertig um {t}', { t: end.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', timeZone: process.env.TZ || undefined }) }));
      }
      break;
    case 'filamentLow': {
      const sp = entry?.spool || {};
      title = tr('{p}: Filament wird knapp', { p: name });
      lines.push(`${`${sp.nr || tr('Spule')} ${sp.material || ''} ${sp.colorName || ''}`.replace(/\s+/g, ' ').trim()}: ${tr('noch {g} g', { g: Math.round(sp.remaining ?? 0) })}`);
      lines.push(tr('Neue Spule bereitlegen.'));
      break;
    }
    case 'humidity': {
      title = tr('{p}: Filament zu feucht', { p: name });
      lines.push(tr('{u}: {h} % Luftfeuchte', { u: tr(entry?.unit || ''), h: entry?.pct }));
      if (entry?.spools?.length) lines.push(entry.spools.join(', '));
      lines.push(entry?.level === 'alarm' ? tr('Filament trocknen, Trockenmittel tauschen.') : tr('Trockenmittel prüfen.'));
      lines.push(tr('Trocknen lässt sich in PrintDock unter Filament → Feuchte & Trocknen starten.'));
      break;
    }
    case 'dryingDone': {
      title = tr('{p}: Trocknen fertig', { p: name });
      lines.push(tr('{u}: {h} h bei {t} °C', { u: tr(entry?.unit || ''), h: entry?.hours, t: entry?.temp }));
      if (entry?.spools?.length) lines.push(entry.spools.join(', '));
      break;
    }
    case 'firstLayer':
      title = tr('{p}: erste Schicht', { p: name });
      if (file) lines.push(file);
      lines.push(tr('Haftung und erste Schicht auf dem Bild prüfen.'));
      break;
    case 'emergency':
      title = tr('{p}: NOTAUS', { p: name });
      lines.push(tr('{s} meldet {v} – Steckdose wurde ausgeschaltet.', { s: entry?.sensor || '?', v: entry?.value ?? '?' }));
      if (entry?.error) lines.push(tr('Ausschalten fehlgeschlagen: {e}', { e: entry.error }));
      break;
    case 'update':
      title = tr('PrintDock {v} ist verfügbar', { v: entry?.version || '' });
      lines.push(tr('Installieren unter Einstellungen → System → Updates.'));
      break;
    case 'portalRequest': {
      const list = entry?.orders || [];
      title = list.length === 1 ? tr('Neue Anfrage im Druckportal: {nr}', { nr: list[0].number }) : tr('{n} neue Anfragen im Druckportal', { n: list.length });
      for (const o of list.slice(0, 5)) {
        const n = (o.items || []).reduce((a, it) => a + (Number(it.qty) || 1), 0);
        const est = o.estimate ? `${Number(o.estimate.min).toFixed(2).replace('.', ',')}–${Number(o.estimate.max).toFixed(2).replace('.', ',')} €` : '';
        lines.push(`• ${o.number} · ${o.customer?.name || '?'} · ${tr('{n} Teile', { n })}${est ? ` · ${est}` : ''}`);
      }
      lines.push(tr('Bearbeiten in PrintDock unter Druckportal.'));
      break;
    }
    case 'portalAnswer': {
      const list = entry?.orders || [];
      const ev = (o) => o.kunde?.event;
      const what = (o) => (ev(o) === 'abgelehnt' ? tr('Angebot abgelehnt') : ev(o) === 'nachricht' ? tr('Nachricht') : tr('Angebot angenommen'));
      title = list.length === 1
        ? (ev(list[0]) === 'nachricht' ? tr('Nachricht zu {nr}', { nr: list[0].number }) : tr('Angebot {nr} {w}', { nr: list[0].number, w: ev(list[0]) === 'abgelehnt' ? tr('abgelehnt') : tr('angenommen') }))
        : tr('{n} Antworten im Druckportal', { n: list.length });
      for (const o of list.slice(0, 5)) {
        const price = o.offer?.price != null ? `${Number(o.offer.price).toFixed(2).replace('.', ',')} €` : '';
        lines.push(`• ${o.number} · ${o.customer?.name || '?'} · ${what(o)}${price ? ` · ${price}` : ''}`);
      }
      lines.push(tr('Bearbeiten in PrintDock unter Druckportal.'));
      break;
    }
    case 'maintenance':
      title = tr('{p}: Wartung fällig', { p: name });
      for (const t of entry?.tasks || []) lines.push(`• ${tr(t)}`);
      break;
    case 'offline':
      title = tr('{p}: nicht erreichbar', { p: name });
      lines.push(msg || tr('Seit 2 Minuten keine Verbindung.'));
      break;
    default:
      title = tr('PrintDock: Testnachricht');
      lines.push(tr('Wenn du das liest, funktioniert dieser Kanal.'));
  }
  return {
    event,
    title,
    body: lines.join('\n'),
    printer: printer ? { id: printer.id, name: printer.name } : null,
    status: status || null,
  };
}

// ------------------------------------------------------------------ Versand

class Notifier {
  /**
   * @param getChannels  () => Kanal-Konfigurationen
   * @param getSnapshot  async (printerId) => Buffer | null
   * @param onResult     (channelId, result) => void
   */
  constructor({ getChannels, getSnapshot, onResult }) {
    Object.assign(this, { getChannels, getSnapshot, onResult });
    this.lastSent = new Map(); // "printerId:event" -> Zeit, gegen Flattern
  }

  async dispatch(event, printer, status, entry) {
    const app = require('./lib/app');
    if (!app.moduleOn('notifications')) return;
    if ((event === 'maintenance' && !app.moduleOn('maintenance')) || (['filamentLow', 'humidity', 'dryingDone'].includes(event) && !app.moduleOn('filament'))) return;
    const key = `${printer.id}:${event}`;
    if (Date.now() - (this.lastSent.get(key) || 0) < 60_000) return;
    this.lastSent.set(key, Date.now());

    const channels = this.getChannels().filter((c) => c.enabled !== false && (c.events || []).includes(event));
    if (!channels.length) return;
    console.log(`[${printer.name}] Ereignis "${event}" → ${channels.length} Kanal/Kanäle`);

    const msg = buildMessage(event, printer, status, entry);
    const wantsImage = channels.some((c) => c.attachImage && CHANNELS[c.type]?.image);
    const image = wantsImage && status?.camera && !['maintenance', 'filamentLow', 'humidity', 'dryingDone', 'update', 'portalRequest', 'portalAnswer'].includes(event) ? await this.getSnapshot(printer.id) : null;
    await Promise.allSettled(channels.map((c) => this.sendTo(c, msg, c.attachImage ? image : null)));
  }

  async sendTo(channel, msg, image) {
    const type = CHANNELS[channel.type];
    try {
      if (!type) throw new Error(`Unbekannter Kanaltyp "${channel.type}"`);
      await type.send(channel.config || {}, msg, type.image ? image : null);
      this.onResult(channel.id, { ok: true, at: new Date().toISOString(), event: msg.event });
    } catch (err) {
      console.warn(`Benachrichtigung über "${channel.name}" fehlgeschlagen: ${err.message}`);
      this.onResult(channel.id, { ok: false, at: new Date().toISOString(), event: msg.event, error: err.message });
      throw err;
    }
  }

  /** Testnachricht, optional mit Kamerabild eines Druckers. */
  async test(channel, printer, status) {
    const image = channel.attachImage && printer && status?.camera ? await this.getSnapshot(printer.id) : null;
    await this.sendTo(channel, buildMessage('test', printer, null), image);
  }
}

// ------------------------------------------------------------------ Ereigniserkennung

const ACTIVE = new Set(['preparing', 'printing', 'paused']);
const OFFLINE_DELAY_MS = 2 * 60_000;

/**
 * Leitet aus Statuswechseln Ereignisse ab.
 * Wird bei jedem Status-Update eines Druckers aufgerufen.
 */
function detectEvents(rt, status, historyEntry, emit) {
  const prev = rt.lastState;
  const state = status.state;
  rt.lastState = state;

  // Offline mit Verzögerung melden – Drucker werden auch einfach ausgeschaltet
  if (state === 'offline') {
    if (prev && prev !== 'offline' && !rt.offlineTimer) {
      rt.offlineTimer = setTimeout(() => {
        rt.offlineTimer = null;
        if (rt.lastState === 'offline') emit('offline');
      }, OFFLINE_DELAY_MS);
    }
    return;
  }
  clearTimeout(rt.offlineTimer);
  rt.offlineTimer = null;

  // Abgeschlossene Jobs immer melden – auch wenn der Drucker zwischendurch weg war
  if (historyEntry?.result === 'finished') emit('finished', historyEntry);
  else if (historyEntry?.result === 'cancelled') emit('cancelled', historyEntry);

  // Erster Status nach Serverstart oder Rückkehr aus offline: nur merken, nichts melden
  if (prev === undefined || prev === 'offline') return;
  if (prev === state) return;

  if (state === 'error') emit('error', historyEntry);
  else if (state === 'paused') emit('paused');
  else if (ACTIVE.has(state) && !ACTIVE.has(prev)) emit('started');
}

module.exports = { Notifier, CHANNELS, EVENTS, detectEvents, buildMessage };
