// Kleiner WebSocket-Server (RFC 6455) ohne Abhängigkeiten – nur für die PrintDock-Stationen.
// Unterstützt Text-Nachrichten (auch fragmentiert), Ping/Pong und Close; keine Erweiterungen.
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 256 * 1024;

class WsConnection extends EventEmitter {
  constructor(socket, req) {
    super();
    this.socket = socket;
    this.req = req;
    this.buf = Buffer.alloc(0);
    this.parts = [];
    this.open = true;
    socket.setNoDelay(true);
    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => this.closed());
    socket.on('error', () => this.closed());
    // Lebenszeichen: Ping alle 20 s, ohne Antwort nach 50 s trennen
    this.alive = Date.now();
    this.pinger = setInterval(() => {
      if (Date.now() - this.alive > 50_000) return this.close(1001, 'timeout');
      this.frame(0x9, Buffer.alloc(0));
    }, 20_000);
    this.pinger.unref?.();
  }

  onData(d) {
    this.alive = Date.now();
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 2) {
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2));
        off = 10;
      }
      if (len > MAX_MESSAGE) return this.close(1009, 'too big');
      const masked = b1 & 0x80;
      const need = off + (masked ? 4 : 0) + len;
      if (this.buf.length < need) return;
      let payload = this.buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) {
        const mask = this.buf.subarray(off, off + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      this.buf = this.buf.subarray(need);
      this.onFrame(b0 & 0x80, b0 & 0x0f, payload);
    }
  }

  onFrame(fin, op, payload) {
    if (op === 0x8) return this.close(1000);
    if (op === 0x9) return this.frame(0xa, payload);
    if (op === 0xa) return;
    if (op === 0x1 || op === 0x2 || op === 0x0) {
      this.parts.push(payload);
      if (this.parts.reduce((a, p) => a + p.length, 0) > MAX_MESSAGE) return this.close(1009, 'too big');
      if (!fin) return;
      const msg = Buffer.concat(this.parts).toString('utf8');
      this.parts = [];
      this.emit('message', msg);
    }
  }

  frame(op, payload) {
    if (!this.open) return;
    const len = payload.length;
    const head = len < 126 ? Buffer.from([0x80 | op, len]) : len < 65536 ? Buffer.from([0x80 | op, 126, len >> 8, len & 255]) : (() => {
      const h = Buffer.alloc(10);
      h[0] = 0x80 | op;
      h[1] = 127;
      h.writeBigUInt64BE(BigInt(len), 2);
      return h;
    })();
    this.socket.write(Buffer.concat([head, payload]));
  }

  send(obj) {
    this.frame(0x1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8'));
  }

  close(code = 1000, reason = '') {
    if (!this.open) return;
    const r = Buffer.from(reason);
    const p = Buffer.alloc(2 + r.length);
    p.writeUInt16BE(code, 0);
    r.copy(p, 2);
    this.frame(0x8, p);
    this.socket.end();
    this.closed();
  }

  closed() {
    if (!this.open) return;
    this.open = false;
    clearInterval(this.pinger);
    this.socket.destroy();
    this.emit('close');
  }
}

/** HTTP-Upgrade annehmen. Gibt die Verbindung zurück oder null (dann wurde abgelehnt). */
function accept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return null;
  }
  const acceptKey = crypto.createHash('sha1').update(key + GUID).digest('base64');
  // Angefragtes Unterprotokoll zurückgeben (der Arduino-Client schickt „arduino“)
  const proto = String(req.headers['sec-websocket-protocol'] || '').split(',')[0].trim();
  const head = ['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${acceptKey}`];
  if (proto) head.push(`Sec-WebSocket-Protocol: ${proto.replace(/[^\w.-]/g, '')}`);
  socket.write([...head, '', ''].join('\r\n'));
  return new WsConnection(socket, req);
}

module.exports = { accept };
