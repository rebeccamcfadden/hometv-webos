// Runs HomeTV checks in a browser on the PC with a pretend TV: serves dist/checks-app (run `npm run build` first),
// gives the page a fake PalmServiceBridge whose calls come here, and runs the real phone page server on
// 127.0.0.1:8766 (the TV listens on all addresses; the PC keeps it to itself). Usage: node tools/dev.mjs, then open
// http://localhost:5190/ . Every Luna call is printed, so a launch shows what the TV would have been asked.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createPhoneServer } = require('../checks/service/phone.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'dist', 'checks-app');
const PORT = Number(process.env.PORT || 5190);
const PHONE_PORT = 8766;

let phone = null;
let startedAt = 0;
const calls = [];

const FAKE_BRIDGE = `
window.PalmServiceBridge = function () {};
window.PalmServiceBridge.prototype.call = function (uri, params) {
  var self = this;
  fetch('/luna', { method: 'POST', body: JSON.stringify({ uri: uri, params: JSON.parse(params) }) })
    .then(function (r) { return r.text(); })
    .then(function (t) { setTimeout(function () { self.onservicecallback(t); }, 150); });
};
window.PalmSystem = { platformBack: function () { console.log('platformBack'); } };
`;

function info() {
  return {
    returnValue: true, running: !!phone, port: PHONE_PORT, addresses: ['127.0.0.1'],
    code: phone && phone.state.code, uptimeS: startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0,
    lastPhone: phone && phone.state.lastPhone, notes: phone ? phone.state.notes.slice() : [], node: process.version
  };
}

async function luna(uri, params) {
  calls.push({ uri, params });
  console.log('luna', uri, JSON.stringify(params));
  if (uri.endsWith('/getSystemInfo')) {
    return { returnValue: true, modelName: 'PRETEND-TV', firmwareVersion: '00.00.00', sdkVersion: '10.3.1' };
  }
  if (uri.endsWith('/listApps')) {
    return { returnValue: true, apps: [{ id: 'netflix' }, { id: 'youtube.leanback.v4' }, { id: 'com.webos.app.home' }] };
  }
  if (uri.endsWith('/launch')) {
    return params.id === 'netflix' || params.id === 'youtube.leanback.v4'
      ? { returnValue: true }
      : { returnValue: false, errorCode: -101, errorText: 'not installed on the pretend TV' };
  }
  if (uri === 'luna://com.hometv.checks.service/start') {
    if (!phone) {
      phone = createPhoneServer();
      await new Promise((r) => phone.server.listen(PHONE_PORT, '127.0.0.1', r));
      startedAt = Date.now();
    }
    return info();
  }
  if (uri === 'luna://com.hometv.checks.service/status') return info();
  if (uri === 'luna://com.hometv.checks.service/report') {
    if (!phone) return { returnValue: false, errorText: 'start the phone page first' };
    phone.state.report = params.results || {};
    return { returnValue: true };
  }
  if (uri === 'luna://com.hometv.checks.service/devmode') {
    return { returnValue: true, readable: false, reason: 'ENOENT (a PC has no Developer Mode session)' };
  }
  return { returnValue: false, errorText: 'unknown on the pretend TV: ' + uri };
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/luna') {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', async () => {
      const { uri, params } = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(await luna(uri, params)));
    });
    return;
  }
  if (req.url === '/calls') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(calls, null, 2));
    return;
  }
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.join(app, rel);
  if (!file.startsWith(app) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  let data = fs.readFileSync(file);
  if (rel === 'index.html') {
    data = Buffer.from(String(data).replace('<script src="qr.js">', '<script>' + FAKE_BRIDGE + '</script><script src="qr.js">'));
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(data);
}).listen(PORT, '127.0.0.1', () => console.log('HomeTV checks with a pretend TV: http://localhost:' + PORT + '/'));
