// API keys: the household's TMDB, Watchmode and Movie of the Night keys, sent from a phone or a laptop to HomeTV's
// pages service (service/pages.js, the own app's second background service). This screen shows a QR of the page's
// address with the code after the #, the address and the code to type on a laptop, each key's state (only its last
// four characters), and New code. Pushed from Home; Back returns.
//
// While it shows, it holds the service's key routes open (POST /tv/keys/hold every few seconds, as the Android
// launcher's pane holds its KeyInbox); when it goes, or HomeTV goes to the background, it lets go and the page on the
// phone stops taking keys. It talks to the service on loopback only, with the token the service leaves in the app's
// private folder (its TOKEN_FILE): a web page on the TV can't read that folder, so it can't use the screen's routes.

import { h, replace } from '../shell/dom';
import { focusable } from '../shell/focus';
import { shell, type Screen } from '../shell/app';
import { encodeQr, dark } from '../qr';
import { KEY_INFO, keyStatus, keysValue, type KeyEntry, type KeyId } from '@hometv/core/keys.ts';
import { topBar } from './home';
import { bridge } from '../bridge';

const keyPages = bridge.platform.keyPages;

/** The service's port on the TV. */
const TV_PORT = 8766;
/**
 * On a PC (`npm run dev`) the TizenBrew module's fake service has 8766, so the pages service is on 8767. Never tried on
 * the TV: another program could listen there and collect the token the screen sends.
 */
const DEV_PORT = 8767;
/** Under the service's own hold (15 s), so a slow answer never lets the routes close while the screen shows. */
const HOLD_EVERY_MS = 3000;

export interface TvKeys {
  ok: boolean;
  open: boolean;
  port: number;
  addresses: string[];
  code: string;
  saving: boolean;
  keys: Record<KeyId, KeyEntry>;
}

interface Ping {
  ok: boolean;
  service?: string;
}

type HttpError = Error & { status?: number };

/** XMLHttpRequest with a timeout (Chromium 56 has no AbortController); `token` for the service's /tv/ routes. */
function request<T>(base: string, method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = 4000, token?: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, base + path);
    xhr.timeout = timeoutMs;
    const fail = (message: string) => {
      const e: HttpError = new Error(message);
      e.status = xhr.status;
      reject(e);
    };
    xhr.onload = () => {
      try {
        const j = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(j as T);
        else fail((j && j.message) || `HTTP ${xhr.status}`);
      } catch (e) {
        fail(`HTTP ${xhr.status}`);
      }
    };
    xhr.onerror = () => reject(new Error('no answer'));
    xhr.ontimeout = () => reject(new Error('timed out'));
    if (body !== undefined) xhr.setRequestHeader('Content-Type', 'application/json');
    if (token !== undefined) xhr.setRequestHeader('X-HomeTV-Token', token);
    xhr.send(body === undefined ? null : JSON.stringify(body));
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Where the pages service answers: its base address, or why it doesn't. As its own app, the TV starts the service at
 * power-on; if it isn't there yet, it's started here, as AeroTizen starts its watcher.
 */
async function findService(): Promise<{ base: string } | { problem: string }> {
  let taken = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    for (const port of keyPages.onTv() ? [TV_PORT] : [TV_PORT, DEV_PORT]) {
      const base = `http://127.0.0.1:${port}`;
      try {
        const p = await request<Ping>(base, 'GET', '/ping', undefined, 1200);
        if (p.service === 'hometv-pages') return { base };
        if (port === TV_PORT) taken = true;
      } catch (e) {
        // Not there.
      }
    }
    if (!keyPages.onTv()) break;
    if (attempt === 0) keyPages.start();
    await wait(800);
  }
  if (taken) return { problem: 'Another service holds port 8766 (HomeTV’s TizenBrew module?), so the key page can’t open. Close it and try again.' };
  return {
    problem: keyPages.onTv()
      ? 'HomeTV’s key service didn’t start. Back, then open API keys again; if it still fails, restart the TV.'
      : 'Preview: no TV here. On the TV, or with `npm run dev`, this shows the QR for the key page.',
  };
}

/** The address the QR holds: the page, with the code after the # so the phone keeps it to itself. */
export function pageUrl(address: string, port: number, code: string): string {
  return `http://${address}:${port}/keys#${code.replace(/[\s-]/g, '').toUpperCase()}`;
}

/** The QR as a canvas: black modules on white, with the standard light border of 4. */
function qrCanvas(text: string, px: number): HTMLCanvasElement {
  const qr = encodeQr(text);
  const modules = qr.size + 8;
  const scale = Math.max(1, Math.floor(px / modules));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = modules * scale;
  canvas.className = 'qr';
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) if (dark(qr, x, y)) ctx.fillRect((x + 4) * scale, (y + 4) * scale, scale, scale);
  }
  return canvas;
}

let open: Screen | null = null;

export function showKeys() {
  if (open && shell.has(open)) return;
  const el = h('div.screen.keys');
  el.appendChild(topBar('API keys'));
  const lead = h(
    'p.keyslead',
    'Movies, TV Shows, Search and prices come from three free services. Scan the code with a phone on this Wi-Fi, or open the address on a laptop and type the code.',
  );
  const qrBox = h('div.qrbox');
  const address = h('div.keyaddr');
  const codeEl = h('div.keycode');
  const value = h('div.keysvalue');
  const note = h('p.keysnote');
  const rows: Record<string, { el: HTMLElement; status: HTMLElement }> = {};
  const list = h('div.keyrows');
  let base = '';
  let token = '';
  /** The service took the token at least once. */
  let accepted = false;
  let state: TvKeys | null = null;
  let fallbackAddress = '';
  let askedTv = false;
  let shownQr = '';
  let timer = 0;
  let alive = true;

  for (const info of KEY_INFO) {
    const status = h('span.keystatus');
    const row = focusable(h('button.keyrow', h('span.keyname', info.name), h('span.keyuse', info.use), status), {
      key: 'key-' + info.id,
      group: 'keyrows',
      onOk: () => recheck(info.id),
    });
    rows[info.id] = { el: row, status };
    list.appendChild(row);
  }
  const newCode = focusable(h('button.button', 'New code'), { key: 'newcode', onOk: () => fresh() });
  el.appendChild(lead);
  el.appendChild(
    h(
      'div.keycols',
      qrBox,
      h('div.keyside', h('div.keylabel', 'On a laptop, open'), address, h('div.keylabel', 'and type the code'), codeEl, value, list, h('div.lowerrow', newCode, note)),
    ),
  );
  el.appendChild(h('p.hint', 'OK on a key checks it again. New code: a phone that has the old one can’t send keys any more. Back: Home.'));

  function paint() {
    if (!state) return;
    const addr = (state.addresses && state.addresses[0]) || fallbackAddress;
    if (!addr && !askedTv) {
      askedTv = true;
      keyPages.address().then((ip) => {
        fallbackAddress = ip;
        if (ip && alive) paint();
      });
    }
    const link = addr ? pageUrl(addr, state.port, state.code) : '';
    if (link !== shownQr) {
      shownQr = link;
      replace(qrBox, link ? qrCanvas(link, 440) : h('div.qrnone', 'No network: connect the TV to Wi-Fi.'));
    }
    address.textContent = addr ? `http://${addr}:${state.port}/keys` : 'The TV has no address on the home network yet.';
    codeEl.textContent = state.code;
    const v = keysValue(state.keys);
    value.textContent = v.text;
    value.className = 'keysvalue' + (v.warn ? ' warn' : '');
    for (const info of KEY_INFO) {
      const s = keyStatus(info.id, state.keys[info.id]);
      rows[info.id].status.textContent = s.text;
      rows[info.id].status.className = 'keystatus tone-' + s.tone;
    }
    note.textContent = state.saving ? '' : 'This TV can’t keep keys: HomeTV’s private folder wasn’t found.';
    shell.refocus();
  }

  function problem(text: string) {
    replace(qrBox, h('div.qrnone', text));
    shownQr = '';
    note.textContent = text;
  }

  /**
   * A call to the service's TV routes. Refused after it once took the token, the token is read again once: the
   * service restarted with a new one. One that never took it isn't sent another.
   */
  async function tvCall(path: string, body?: unknown): Promise<TvKeys> {
    try {
      const r = await request<TvKeys>(base, 'POST', path, body, 4000, token);
      accepted = true;
      return r;
    } catch (e) {
      if ((e as HttpError).status !== 403 || !accepted) throw e;
      accepted = false;
      token = await keyPages.token();
      return tvCall(path, body);
    }
  }

  async function tick() {
    if (!alive || !base) return;
    if (!document.hidden) {
      try {
        state = await tvCall('/tv/keys/hold');
        if (alive) paint();
      } catch (e) {
        if (!alive) return;
        problem(
          (e as HttpError).status === 403
            ? 'HomeTV couldn’t read its key service’s pass in its private folder. Back, then open API keys again.'
            : 'The key service stopped answering. Back, then open API keys again.',
        );
      }
    }
    if (alive) timer = window.setTimeout(tick, HOLD_EVERY_MS);
  }

  async function recheck(id: KeyId) {
    if (!base || !state) return;
    if (state.keys[id].state === 'unset') return shell.toast('No key yet. Send one from the phone page.');
    try {
      state = await tvCall('/tv/keys/recheck', { id });
      paint();
    } catch (e) {
      shell.toast('The key service didn’t answer.', true);
    }
  }

  async function fresh() {
    if (!base) return;
    try {
      state = await tvCall('/tv/keys/code');
      paint();
      shell.toast('New code. Scan the QR again on the phone.');
    } catch (e) {
      shell.toast('The key service didn’t answer.', true);
    }
  }

  function release() {
    window.clearTimeout(timer);
    timer = 0;
    if (base) request(base, 'POST', '/tv/keys/release', undefined, 4000, token).catch(() => undefined);
  }

  // HomeTV in the background (another app, standby): let go now; back in front, hold again.
  const onVisibility = () => {
    if (!alive) return;
    if (document.hidden) release();
    else if (!timer) tick();
  };
  document.addEventListener('visibilitychange', onVisibility);

  const screen: Screen = { label: 'API keys', el, defaultFocus: () => rows.tmdb.el };
  open = screen;
  const stop = shell.onChange(() => {
    if (shell.has(screen)) return;
    alive = false;
    stop();
    document.removeEventListener('visibilitychange', onVisibility);
    release();
  });
  shell.push(screen);

  problem('Finding HomeTV’s key service…');
  findService().then((found) => {
    if (!alive) return;
    if ('problem' in found) return problem(found.problem);
    base = found.base;
    keyPages.token().then((t) => {
      token = t;
      if (!alive) return;
      note.textContent = '';
      tick();
    });
  });
}
