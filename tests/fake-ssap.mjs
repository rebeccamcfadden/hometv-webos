// A pretend LG TV speaking SSAP over plain ws, for the tests and for trying the laptop tool by hand:
//   node tests/fake-ssap.mjs   (prints its port)
import http from 'node:http';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function fakeTv(handlers) {
  const seen = { registers: [], requests: [] };
  const server = http.createServer();
  server.on('upgrade', (req, sock) => {
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    const send = (obj) => {
      const p = Buffer.from(JSON.stringify(obj));
      const head = p.length < 126 ? Buffer.from([0x81, p.length]) : Buffer.from([0x81, 126, p.length >> 8, p.length & 0xff]);
      sock.write(Buffer.concat([head, p]));
    };
    let buf = Buffer.alloc(0);
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
        if (msg.type === 'register') {
          seen.registers.push(msg.payload);
          if (!msg.payload['client-key']) send({ type: 'response', id: msg.id, payload: { pairingType: 'PROMPT' } });
          send({ type: 'registered', id: msg.id, payload: { 'client-key': 'KEY123' } });
        } else if (msg.type === 'request') {
          const uri = msg.uri.replace('ssap://', '');
          seen.requests.push({ uri, payload: msg.payload });
          const h = handlers[uri];
          if (!h) send({ type: 'error', id: msg.id, error: '404 no such service or method' });
          else send({ type: 'response', id: msg.id, payload: h(msg.payload) });
        }
      }
    });
  });
  return { server, seen };
}

export const HANDLERS = {
  'com.webos.service.update/getCurrentSWInformation': () => ({
    returnValue: true, product_name: 'webOSTV 10.3.1', model_name: 'HE_DTV_W24P_AFADATAA', major_ver: '33', minor_ver: '31.61',
    country: 'US', device_id: 'aa:bb:cc:dd:ee:ff', serial: 'SECRET123'
  }),
  'system/getSystemInfo': () => ({ returnValue: true, modelName: '43UT8000AUA', receiverType: 'atsc', serialNumber: 'SECRET123' }),
  'com.webos.applicationManager/listLaunchPoints': () => ({
    returnValue: true, launchPoints: [{ id: 'netflix', title: 'Netflix' }, { id: 'youtube.leanback.v4', title: 'YouTube' }, { id: 'com.webos.app.browser', title: 'Web Browser' }, { id: 'com.palmdts.devmode', title: 'Developer Mode' }]
  }),
  'com.webos.applicationManager/getForegroundAppInfo': () => ({ returnValue: true, appId: 'com.webos.app.home', windowId: 'x' }),
  'tv/getExternalInputList': () => ({ returnValue: true, devices: [{ id: 'HDMI_1', label: 'HDMI 1', connected: true, appId: 'com.webos.app.hdmi1', icon: 'x.png' }] }),
  'com.webos.service.apiadapter/audio/getSoundOutput': () => ({ returnValue: true, soundOutput: 'tv_speaker' }),
  'settings/getSystemSettings': (p) => (p.category === 'picture' && p.keys[0] === 'backlight'
    ? { returnValue: true, settings: { backlight: '80' } } : { returnValue: false, errorText: 'no such key' }),
  'com.webos.applicationManager/launch': (p) => (p.id === 'netflix' ? { returnValue: true } : { returnValue: false, errorText: 'not installed' }),
  // The TV's browser: fetches the page like the real one would, from this machine.
  'system.launcher/open': (p) => {
    if (!/^http:\/\//.test(p.target || '')) return { returnValue: false, errorText: 'bad target' };
    setTimeout(() => { http.get(p.target, (r) => r.resume()).on('error', () => {}); }, 100);
    return { returnValue: true, id: 'com.webos.app.browser', sessionId: 'browser-1' };
  },
  'system.launcher/close': () => ({ returnValue: true })
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tv = fakeTv(HANDLERS);
  tv.server.listen(Number(process.env.PORT || 0), '127.0.0.1', () => console.log('pretend TV on port ' + tv.server.address().port));
}
