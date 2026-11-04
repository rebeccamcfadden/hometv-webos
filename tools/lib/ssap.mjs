// LG's remote-control connection (SSAP), the one Home Assistant and LG's phone app use. Pairing shows "Allow" on the
// TV once; the TV then gives a client key the laptop keeps. Permissions are the fewest the checks need: launch apps,
// read apps, settings, inputs and software version, and show a message (no WRITE_SETTINGS, no power, no keys).
// Permission names as in Home Assistant's aiowebostv (Apache-2.0).
import { connect } from './ws.mjs';

export const PERMISSIONS = [
  'LAUNCH',
  'APP_TO_APP',
  'READ_APP_STATUS',
  'READ_INSTALLED_APPS',
  'READ_RUNNING_APPS',
  'READ_INPUT_DEVICE_LIST',
  'READ_SETTINGS',
  'READ_UPDATE_INFO',
  'READ_COUNTRY_INFO',
  'READ_NETWORK_STATE',
  'READ_POWER_STATE',
  'WRITE_NOTIFICATION_TOAST'
];

export async function open(host, { clientKey, onPrompt, timeoutMs = 60000, ports } = {}) {
  const tries = ports || [
    { url: 'wss://' + host + ':3001/', insecure: true },
    { url: 'ws://' + host + ':3000/', insecure: false }
  ];
  let ws = null;
  const errors = [];
  for (const t of tries) {
    try { ws = await connect(t.url, { insecure: t.insecure }); break; } catch (e) { errors.push(t.url + ': ' + e.message); }
  }
  if (!ws) throw new Error('could not reach the TV (' + errors.join('; ') + ')');

  let next = 1;
  const waiting = new Map();
  ws.on('message', (text) => {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    const w = waiting.get(msg.id);
    if (w) w(msg);
  });

  const key = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete('register_0'); reject(new Error('no answer to pairing (was "Allow" pressed?)')); }, timeoutMs);
    waiting.set('register_0', (msg) => {
      if (msg.type === 'response' && msg.payload && msg.payload.pairingType === 'PROMPT') { if (onPrompt) onPrompt(); return; }
      if (msg.type === 'registered') { clearTimeout(timer); waiting.delete('register_0'); resolve(msg.payload['client-key']); return; }
      if (msg.type === 'error') { clearTimeout(timer); waiting.delete('register_0'); reject(new Error('pairing refused: ' + msg.error)); }
    });
    const payload = {
      forcePairing: false,
      pairingType: 'PROMPT',
      manifest: { manifestVersion: 1, appVersion: '1.0', permissions: PERMISSIONS }
    };
    if (clientKey) payload['client-key'] = clientKey;
    ws.send(JSON.stringify({ type: 'register', id: 'register_0', payload }));
  });

  function request(uri, payload, ms = 10000) {
    const id = 'req_' + next++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { waiting.delete(id); resolve({ returnValue: false, errorText: 'no answer in ' + ms / 1000 + ' s' }); }, ms);
      waiting.set(id, (msg) => {
        clearTimeout(timer);
        waiting.delete(id);
        if (msg.type === 'error') resolve({ returnValue: false, errorText: msg.error || 'error' });
        else resolve(msg.payload || {});
      });
      ws.send(JSON.stringify({ type: 'request', id, uri: 'ssap://' + uri, payload: payload || {} }));
    });
  }

  return { clientKey: key, request, close: () => ws.close() };
}
