// The key page's TV side in platform.ts (keyPages: start, token, tmdbKey, priceKeys, address) against a fake
// PalmServiceBridge, and on a PC against the dev server's routes (a fake XMLHttpRequest). Nothing real is called.
// `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './ts-module.mjs';

const SERVICE = 'luna://com.hometv.app.service';
const calls = [];
let answers = {};

class FakeBridge {
  call(uri, params) {
    calls.push({ uri, params: JSON.parse(params) });
    const a = answers[uri];
    const reply = typeof a === 'function' ? a() : a || { returnValue: false, errorText: 'unknown method' };
    setTimeout(() => this.onservicecallback(JSON.stringify(reply)), 1);
  }
}

const requested = [];
let routes = {};
class FakeXhr {
  open(method, url) {
    this.url = url;
  }
  send() {
    requested.push(this.url);
    setTimeout(() => {
      const r = routes[this.url];
      if (!r) return this.onerror();
      this.status = r.status;
      this.responseText = r.text;
      this.onload();
    }, 1);
  }
}

globalThis.window = new EventTarget();
globalThis.XMLHttpRequest = FakeXhr;
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, userAgent: 'test' }, configurable: true, writable: true });
const onTv = (on) => (on ? (globalThis.PalmServiceBridge = FakeBridge) : delete globalThis.PalmServiceBridge);

const { platform } = await loadTs('platform.ts');
const keys = platform.keyPages;

function reset(a = {}) {
  calls.length = 0;
  requested.length = 0;
  routes = {};
  answers = a;
}

test('on the TV the key page lives in HomeTV’s service, reached over Luna', async () => {
  onTv(true);
  reset({
    [SERVICE + '/start']: { returnValue: true, port: 8766 },
    [SERVICE + '/token']: { returnValue: true, token: 'a'.repeat(48) },
    [SERVICE + '/tmdbKey']: { returnValue: true, key: '  fake.good-tmdb-token ' },
    [SERVICE + '/priceKeys']: { returnValue: true, watchmode: 'fake-wm', motn: '' },
  });
  assert.equal(keys.onTv(), true);
  keys.start();
  assert.equal(await keys.token(), 'a'.repeat(48));
  assert.equal(await keys.tmdbKey(), 'fake.good-tmdb-token');
  assert.deepEqual(await keys.priceKeys(), { watchmode: 'fake-wm', motn: '' });
  assert.deepEqual(calls.map((c) => c.uri.replace(SERVICE, '')), ['/start', '/token', '/tmdbKey', '/priceKeys']);
  assert.deepEqual(requested, [], 'a TV never asks the dev server');
});

test('on the TV a service that refuses, or gives nonsense, gives no token and no keys', async () => {
  onTv(true);
  reset({
    [SERVICE + '/token']: { returnValue: false, errorText: 'not HomeTV' },
    [SERVICE + '/tmdbKey']: { returnValue: false, errorText: 'not HomeTV' },
    [SERVICE + '/priceKeys']: { returnValue: true, watchmode: 5, motn: null },
  });
  assert.equal(await keys.token(), '');
  assert.equal(await keys.tmdbKey(), '');
  assert.deepEqual(await keys.priceKeys(), { watchmode: '', motn: '' });
  reset({ [SERVICE + '/priceKeys']: { returnValue: false } });
  assert.deepEqual(await keys.priceKeys(), { watchmode: '', motn: '' });
  reset({});
  assert.equal(await keys.tmdbKey(), '');
});

test('on a PC (npm run dev:app) the dev server’s routes stand in for Luna', async () => {
  onTv(false);
  reset();
  routes = {
    '/__hometv/pages-token': { status: 200, text: 'b'.repeat(48) + '\n' },
    '/__hometv/tmdb-key': { status: 200, text: 'fake.good-tmdb-token' },
    '/__hometv/price-keys': { status: 200, text: JSON.stringify({ watchmode: 'fake-wm', motn: 'fake-motn' }) },
  };
  assert.equal(keys.onTv(), false);
  assert.doesNotThrow(() => keys.start());
  assert.equal(await keys.token(), 'b'.repeat(48));
  assert.equal(await keys.tmdbKey(), 'fake.good-tmdb-token');
  assert.deepEqual(await keys.priceKeys(), { watchmode: 'fake-wm', motn: 'fake-motn' });
  assert.deepEqual(calls, [], 'no Luna on a PC');
  assert.equal(await keys.address(), '');
});

test('on a PC with no route (a build, or no keys saved) the members answer empty, not an error', async () => {
  onTv(false);
  reset();
  assert.equal(await keys.token(), '');
  assert.equal(await keys.tmdbKey(), '');
  assert.deepEqual(await keys.priceKeys(), { watchmode: '', motn: '' });
  routes = { '/__hometv/price-keys': { status: 200, text: 'not json' }, '/__hometv/tmdb-key': { status: 403, text: '' } };
  assert.deepEqual(await keys.priceKeys(), { watchmode: '', motn: '' });
  assert.equal(await keys.tmdbKey(), '');
});

test('the TV’s address comes from the connection manager: Wi-Fi, then wired', async () => {
  onTv(true);
  const status = (wifi, wired) => ({ returnValue: true, wifi, wired });
  reset({ 'luna://com.webos.service.connectionmanager/getStatus': status({ state: 'connected', ipAddress: '192.168.1.40' }, { state: 'disconnected' }) });
  assert.equal(await keys.address(), '192.168.1.40');
  reset({ 'luna://com.webos.service.connectionmanager/getStatus': status({ state: 'disconnected' }, { state: 'connected', ipAddress: '192.168.1.41' }) });
  assert.equal(await keys.address(), '192.168.1.41');
});
