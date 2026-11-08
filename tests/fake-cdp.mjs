// A pretend Web Inspector for the Developer Mode tests: /json/list and one page's DevTools WebSocket, answering
// Runtime.evaluate by the /*hometv:name {args}*/ tag the checks put on every expression, and taking
// Input.dispatchKeyEvent. page.answer(name, args) gives the value; page.onKey(keyCode) sees each key press.
import http from 'node:http';
import crypto from 'node:crypto';

export function fakeCdp(page, { title = 'HomeTV' } = {}) {
  const seen = { evals: [], keys: [] };
  const server = http.createServer((req, res) => {
    if (req.url === '/json/list') {
      const port = server.address().port;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify([
        { title: 'Other', url: 'http://elsewhere/', webSocketDebuggerUrl: 'ws://127.0.0.1:' + port + '/devtools/page/0' },
        { title, url: 'file:///usr/palm/applications/com.hometv.app/index.html', webSocketDebuggerUrl: 'ws://127.0.0.1:' + port + '/devtools/page/1' }
      ]));
    } else { res.statusCode = 404; res.end(); }
  });
  server.on('upgrade', (req, sock) => {
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    const send = (obj) => {
      const p = Buffer.from(JSON.stringify(obj));
      const head = p.length < 126 ? Buffer.from([0x81, p.length]) : Buffer.from([0x81, 126, p.length >> 8, p.length & 0xff]);
      sock.write(Buffer.concat([head, p]));
    };
    let buf = Buffer.alloc(0);
    sock.on('error', () => {});
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (buf.length < 2) return;
        let len = buf[1] & 0x7f; let off = 2;
        if (len === 126) { len = buf.readUInt16BE(2); off = 4; }
        if (buf.length < off + 4 + len) return;
        const mask = buf.subarray(off, off + 4);
        const p = Buffer.from(buf.subarray(off + 4, off + 4 + len)).map((b, i) => b ^ mask[i % 4]);
        const op = buf[0] & 0x0f;
        buf = buf.subarray(off + 4 + len);
        if (op === 0x8) { sock.end(); return; }
        const msg = JSON.parse(Buffer.from(p).toString('utf8'));
        if (msg.method === 'Runtime.evaluate') {
          const m = /^\/\*hometv:(\w+)(?: (.*?))?\*\//.exec(msg.params.expression);
          seen.evals.push(m ? m[1] : msg.params.expression);
          const value = m ? page.answer(m[1], m[2] ? JSON.parse(m[2]) : undefined) : undefined;
          send({ id: msg.id, result: { result: { type: typeof value, value } } });
        } else if (msg.method === 'Input.dispatchKeyEvent') {
          if (msg.params.type === 'keyDown') { seen.keys.push(msg.params.windowsVirtualKeyCode); if (page.onKey) page.onKey(msg.params.windowsVirtualKeyCode); }
          send({ id: msg.id, result: {} });
        } else send({ id: msg.id, error: { message: 'unknown method' } });
      }
    });
  });
  return { server, seen };
}
