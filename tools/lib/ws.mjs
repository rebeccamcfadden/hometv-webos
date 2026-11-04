// A minimal WebSocket client (RFC 6455) for LG's SSAP: text frames only, no extensions. Node built-ins only, so the
// laptop tool has no dependencies. wss on the TV uses a self-signed certificate: `insecure` accepts it (the pairing
// key, not the certificate, is what the TV checks; Home Assistant's aiowebostv does the same).
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 16 * 1024 * 1024;

export function connect(url, { insecure = false, timeoutMs = 8000 } = {}) {
  const u = new URL(url);
  const secure = u.protocol === 'wss:';
  const port = Number(u.port || (secure ? 443 : 80));
  const key = crypto.randomBytes(16).toString('base64');
  const expected = crypto.createHash('sha1').update(key + GUID).digest('base64');
  const ws = new EventEmitter();

  return new Promise((resolve, reject) => {
    const sock = secure
      ? tls.connect({ host: u.hostname, port, rejectUnauthorized: !insecure })
      : net.connect({ host: u.hostname, port });
    let buf = Buffer.alloc(0);
    let open = false;
    let fragments = [];
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('timed out connecting to ' + url)); }, timeoutMs);

    sock.on(secure ? 'secureConnect' : 'connect', () => {
      sock.write([
        'GET ' + (u.pathname || '/') + ' HTTP/1.1',
        'Host: ' + u.host,
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Key: ' + key,
        'Sec-WebSocket-Version: 13',
        '', ''
      ].join('\r\n'));
    });
    sock.on('error', (e) => { clearTimeout(timer); if (!open) reject(e); else ws.emit('error', e); });
    sock.on('close', () => { clearTimeout(timer); if (open) ws.emit('close'); else reject(new Error('closed before the WebSocket opened')); });
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!open) {
        const end = buf.indexOf('\r\n\r\n');
        if (end < 0) return;
        const lines = buf.subarray(0, end).toString('latin1').split('\r\n');
        buf = buf.subarray(end + 4);
        const accept = lines.find((l) => /^sec-websocket-accept:/i.test(l));
        if (!/^HTTP\/1\.1 101/.test(lines[0]) || !accept || accept.split(':')[1].trim() !== expected) {
          clearTimeout(timer);
          sock.destroy();
          reject(new Error('not a WebSocket answer: ' + lines[0]));
          return;
        }
        open = true;
        clearTimeout(timer);
        resolve(ws);
      }
      for (;;) {
        if (buf.length < 2) return;
        const fin = (buf[0] & 0x80) !== 0;
        const op = buf[0] & 0x0f;
        const masked = (buf[1] & 0x80) !== 0;
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (len > MAX_FRAME) { sock.destroy(); ws.emit('error', new Error('frame too large')); return; }
        const maskLen = masked ? 4 : 0;
        if (buf.length < off + maskLen + len) return;
        let payload = Buffer.from(buf.subarray(off + maskLen, off + maskLen + len));
        if (masked) {
          const m = buf.subarray(off, off + 4);
          for (let i = 0; i < payload.length; i++) payload[i] ^= m[i % 4];
        }
        buf = buf.subarray(off + maskLen + len);
        if (op === 0x8) { sock.end(); return; }
        if (op === 0x9) { write(sock, 0xa, payload); continue; }
        if (op === 0x1 || op === 0x0) {
          fragments.push(payload);
          if (fin) { ws.emit('message', Buffer.concat(fragments).toString('utf8')); fragments = []; }
        }
      }
    });

    ws.send = (text) => write(sock, 0x1, Buffer.from(text, 'utf8'));
    ws.close = () => { try { write(sock, 0x8, Buffer.alloc(0)); } catch { /* already gone */ } sock.end(); };
  });
}

function write(sock, op, payload) {
  const mask = crypto.randomBytes(4);
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([0x80 | op, 0x80 | len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 0x80 | 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(len), 2); }
  const body = Buffer.from(payload);
  for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
  sock.write(Buffer.concat([head, mask, body]));
}
