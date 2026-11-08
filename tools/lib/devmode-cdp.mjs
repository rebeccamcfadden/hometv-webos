// The Web Inspector of a page on the TV, the way ares-inspect reaches it: the TV's inspector listens on port 9998 on
// the TV itself, so an SSH forward brings it to this laptop; the page's DevTools WebSocket then answers Runtime.evaluate
// and takes Input.dispatchKeyEvent, which is how a remote's keys reach the page. Nothing here is saved or printed
// with the TV's address.
import net from 'node:net';
import http from 'node:http';
import { connect } from './ws.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
  });
}

function getJson(port, path, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path, timeout: timeoutMs }, (res) => {
      const parts = [];
      res.on('data', (d) => parts.push(d));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8'))); } catch { resolve(null); } });
      res.on('error', () => resolve(null));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

/** The forward to the TV's inspector, and its page list; { error } when it can't be reached. */
export async function openInspector(shell, { remotePort = 9998, waitMs = 12000 } = {}) {
  const local = await freePort();
  const fwd = shell.forward(local, remotePort);
  const until = Date.now() + waitMs;
  while (Date.now() < until && !(await portOpen(local))) await sleep(250);
  if (!(await portOpen(local))) { fwd.close(); return { error: 'inspector: not reachable' }; }
  return { port: local, pid: fwd.pid, close: () => fwd.close() };
}

/** The HomeTV page in the inspector's list (url has com.hometv.app, or its title is HomeTV), or null. */
export async function findPage(port, { waitMs = 20000 } = {}) {
  const until = Date.now() + waitMs;
  for (;;) {
    const list = await getJson(port, '/json/list');
    const page = Array.isArray(list) && list.find((p) => p.webSocketDebuggerUrl && (/com\.hometv\.app/.test(p.url || '') || /^HomeTV/i.test(p.title || '')));
    if (page) return { ws: new URL(page.webSocketDebuggerUrl).pathname };
    if (Date.now() >= until) return null;
    await sleep(500);
  }
}

/** A DevTools session on one page: eval(expr) gives the value, key(code) presses a remote key. */
export async function openPage(port, wsPath) {
  const ws = await connect('ws://127.0.0.1:' + port + wsPath, { timeoutMs: 8000 });
  let next = 1;
  const waiting = new Map();
  ws.on('message', (text) => {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    const w = waiting.get(msg.id);
    if (w) { waiting.delete(msg.id); w(msg); }
  });
  ws.on('error', () => {});
  const send = (method, params, ms = 8000) => new Promise((resolve) => {
    const id = next++;
    const timer = setTimeout(() => { waiting.delete(id); resolve({ error: { message: 'no answer in ' + ms / 1000 + ' s' } }); }, ms);
    waiting.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
    try { ws.send(JSON.stringify({ id, method, params: params || {} })); } catch { clearTimeout(timer); resolve({ error: { message: 'closed' } }); }
  });
  return {
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true });
      if (r.error || (r.result && r.result.exceptionDetails)) return undefined;
      return r.result && r.result.result ? r.result.result.value : undefined;
    },
    async key(code) {
      const p = { windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
      await send('Input.dispatchKeyEvent', { type: 'keyDown', ...p });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...p });
    },
    close: () => { try { ws.close(); } catch { /* gone */ } }
  };
}

/** The remote's keys by keyCode (LG's remote, app/src/platform.ts). */
export const KEYS = { ok: 13, left: 37, up: 38, right: 39, down: 40, back: 461, blue: 406, info: 457 };

/**
 * What the checks ask the page. Each is a self-contained expression that starts with a /*hometv:name {args}*\/ tag
 * (the tests' pretend page answers by that tag). Old-Chromium JavaScript only.
 */
export const ask = (name, args) => '/*hometv:' + name + (args === undefined ? '' : ' ' + JSON.stringify(args)) + '*/' + PAGE[name](args);

const KEYS_STORED = ['hometv-settings-v1', 'hometv-setup-done', 'hometv-home-row', 'hometv-household-v1'];
const PAGE = {
  ready: () => "(function(){return !!document.querySelector('#stage .screen')})()",
  // the top screen's classes: 'screen home', 'screen screen--full screen--setup', 'screen checks', 'screen keys'
  top: () => "(function(){var s=document.querySelectorAll('#stage > .screen');var t=s[s.length-1];return t?t.className:''})()",
  click: (key) => '(function(k){var e=document.querySelector(\'[data-key="\'+k+\'"]\');if(!e)return false;e.click();return true})(' + JSON.stringify(key) + ')',
  has: (key) => '(function(k){return !!document.querySelector(\'[data-key="\'+k+\'"]\')})(' + JSON.stringify(key) + ')',
  snapshot: () => '(function(){var o={};' + JSON.stringify(KEYS_STORED) + '.forEach(function(k){o[k]=localStorage.getItem(k)});return JSON.stringify(o)})()',
  problem: () => "(function(){var p=document.querySelector('.problem');return JSON.stringify({problem:p?p.textContent:'',tiles:document.querySelectorAll('.approw .tile').length,missing:document.querySelectorAll('.approw .tile.missing').length})})()",
  result: () => "(function(){var all=document.querySelectorAll('.log .result');var r=all[0];return JSON.stringify({n:all.length,ok:!!r&&r.className.indexOf('ok')>=0,check:r?r.querySelector('.rcheck').textContent:'',text:r?r.querySelector('.rtext').textContent:''})})()",
  visible: () => 'document.visibilityState',
  keypage: () => "(function(){var a=document.querySelector('.keyaddr');return JSON.stringify({address:a?a.textContent:'',qr:!!document.querySelector('.qrbox canvas, .qrbox img, .qrbox svg')})})()"
};
