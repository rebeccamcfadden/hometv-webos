// The laptop check against a pretend TV: a small WebSocket server speaking SSAP's register/request messages. Checks
// pairing (prompt, then key; key reused), the read-only checks, and that nothing outside the allowlist (device id,
// serial) reaches the report.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { open } from '../tools/lib/ssap.mjs';
import { readOnlyChecks, readSettings, launch } from '../tools/lib/checks.mjs';

function fakeTv(handlers) {
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

const HANDLERS = {
  'com.webos.service.update/getCurrentSWInformation': () => ({
    returnValue: true, product_name: 'webOSTV 10.3.1', model_name: 'HE_DTV_W24P_AFADATAA', major_ver: '33', minor_ver: '31.61',
    country: 'US', device_id: 'aa:bb:cc:dd:ee:ff', serial: 'SECRET123'
  }),
  'system/getSystemInfo': () => ({ returnValue: true, modelName: '43UT8000AUA', receiverType: 'atsc', serialNumber: 'SECRET123' }),
  'com.webos.applicationManager/listLaunchPoints': () => ({
    returnValue: true, launchPoints: [{ id: 'netflix', title: 'Netflix' }, { id: 'youtube.leanback.v4', title: 'YouTube' }, { id: 'com.webos.app.browser', title: 'Web Browser' }]
  }),
  'com.webos.applicationManager/getForegroundAppInfo': () => ({ returnValue: true, appId: 'com.webos.app.home', windowId: 'x' }),
  'tv/getExternalInputList': () => ({ returnValue: true, devices: [{ id: 'HDMI_1', label: 'HDMI 1', connected: true, appId: 'com.webos.app.hdmi1', icon: 'x.png' }] }),
  'com.webos.service.apiadapter/audio/getSoundOutput': () => ({ returnValue: true, soundOutput: 'tv_speaker' }),
  'settings/getSystemSettings': (p) => (p.category === 'picture' && p.keys[0] === 'backlight'
    ? { returnValue: true, settings: { backlight: '80' } } : { returnValue: false, errorText: 'no such key' }),
  'com.webos.applicationManager/launch': (p) => (p.id === 'netflix' ? { returnValue: true } : { returnValue: false, errorText: 'not installed' })
};

async function withTv(fn) {
  const tv = fakeTv(HANDLERS);
  await new Promise((r) => tv.server.listen(0, '127.0.0.1', r));
  const port = tv.server.address().port;
  try { await fn(port, tv.seen); } finally { tv.server.close(); }
}

test('pairing asks once, keeps the key, and asks for no write or power permissions', async () => {
  await withTv(async (port, seen) => {
    let prompted = 0;
    const ports = [{ url: 'ws://127.0.0.1:' + port + '/', insecure: false }];
    const a = await open('127.0.0.1', { ports, onPrompt: () => prompted++ });
    assert.equal(a.clientKey, 'KEY123');
    assert.equal(prompted, 1);
    a.close();
    const b = await open('127.0.0.1', { ports, clientKey: 'KEY123', onPrompt: () => prompted++ });
    assert.equal(prompted, 1);
    b.close();
    const perms = seen.registers[0].manifest.permissions;
    for (const p of ['WRITE_SETTINGS', 'CONTROL_POWER', 'CONTROL_INPUT_TEXT', 'CONTROL_MOUSE_AND_KEYBOARD']) assert.ok(!perms.includes(p), p);
    assert.equal(seen.registers[1]['client-key'], 'KEY123');
  });
});

test('the read-only checks keep only allowlisted values (no device id, no serial)', async () => {
  await withTv(async (port) => {
    const tv = await open('127.0.0.1', { ports: [{ url: 'ws://127.0.0.1:' + port + '/' }] });
    const r = await readOnlyChecks(tv);
    tv.close();
    const text = JSON.stringify(r);
    assert.ok(!text.includes('SECRET123'));
    assert.ok(!text.includes('aa:bb:cc'));
    assert.equal(r.checks.software.major_ver, '33');
    assert.equal(r.checks.system.modelName, '43UT8000AUA');
    assert.deepEqual(r.checks.apps.streaming.map((a) => a.name), ['Netflix', 'YouTube']);
    assert.equal(r.checks.foreground.appId, 'com.webos.app.home');
    assert.deepEqual(r.checks.inputs.devices, [{ id: 'HDMI_1', label: 'HDMI 1', connected: true, appId: 'com.webos.app.hdmi1' }]);
  });
});

test('the settings backup asks key by key and records what the TV refuses', async () => {
  await withTv(async (port, seen) => {
    const tv = await open('127.0.0.1', { ports: [{ url: 'ws://127.0.0.1:' + port + '/' }] });
    const s = await readSettings(tv, [{ category: 'picture', keys: ['backlight', 'contrast'] }]);
    tv.close();
    assert.deepEqual(s.picture.backlight, { ok: true, value: '80' });
    assert.equal(s.picture.contrast.ok, false);
    assert.equal(seen.requests.filter((r) => r.uri === 'settings/getSystemSettings').length, 2);
  });
});

test('launch reports success and failure; an unknown method is an error, not a hang', async () => {
  await withTv(async (port) => {
    const tv = await open('127.0.0.1', { ports: [{ url: 'ws://127.0.0.1:' + port + '/' }] });
    assert.deepEqual(await launch(tv, { app: 'netflix' }), { ok: true });
    assert.equal((await launch(tv, { app: 'hulu' })).ok, false);
    const r = await tv.request('nope/nothing');
    assert.equal(r.returnValue, false);
    tv.close();
  });
});
