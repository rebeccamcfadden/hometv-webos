// Can the TV reach the laptop? Rooting (SlopBro) and the root install serve files from the laptop to the TV, so the
// connection must work in both directions. The laptop listens on one port for a moment and asks the TV's own browser
// to open that address (LG's remote-control connection); a request arriving from the TV proves it. The browser is
// closed again. Windows may ask whether to allow the tool on private networks: that is the point of the check.
import http from 'node:http';
import os from 'node:os';

export function laptopAddress(tvHost) {
  if (/^127\./.test(String(tvHost))) return '127.0.0.1'; // a pretend TV on this machine
  const tvParts = String(tvHost).split('.');
  let fallback = null;
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (a.address.split('.').slice(0, 3).join('.') === tvParts.slice(0, 3).join('.')) return a.address;
      fallback = fallback || a.address;
    }
  }
  return fallback;
}

export async function reach(tv, tvHost, { address, port = 0, waitMs = 25000 } = {}) {
  const host = address || laptopAddress(tvHost);
  if (!host) return { ok: false, error: 'the laptop has no network address' };
  let seen = null;
  const server = http.createServer((req, res) => {
    seen = { at: new Date().toISOString(), fromTv: req.socket.remoteAddress && req.socket.remoteAddress.replace(/^::ffff:/, '') === tvHost };
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('<!doctype html><title>HomeTV</title><body style="background:#000;color:#fff;font:48px sans-serif;padding:80px">HomeTV: the TV reached the laptop. You can press Back.</body>');
  });
  await new Promise((r, j) => { server.once('error', j); server.listen(port, '0.0.0.0', r); });
  const url = 'http://' + host + ':' + server.address().port + '/hometv-reach';
  try {
    const opened = await tv.request('system.launcher/open', { target: url });
    if (opened.returnValue === false) return { ok: false, error: 'the TV did not open its browser: ' + (opened.errorText || 'refused') };
    const until = Date.now() + waitMs;
    while (!seen && Date.now() < until) await new Promise((r) => setTimeout(r, 250));
    if (opened.sessionId) await tv.request('system.launcher/close', { id: opened.id || 'com.webos.app.browser', sessionId: opened.sessionId });
    if (!seen) return { ok: false, error: 'nothing arrived from the TV (firewall on the laptop, or the TV can\'t reach it)' };
    return { ok: seen.fromTv !== false, fromTv: seen.fromTv };
  } finally {
    server.close();
  }
}
