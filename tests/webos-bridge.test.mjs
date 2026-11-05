// HomeTV's LG bridge (app/src/bridge.ts, platform.ts, pageChecks.ts) against a fake PalmServiceBridge: the app list,
// artwork, opening apps and titles, the checks, and the heartbeat. And the service's heartbeat (service/service.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadTs } from './ts-module.mjs';

const POINTS = [
  { id: 'netflix', title: 'Netflix', largeIcon: '/apps/netflix/large.png', icon: '/apps/netflix/icon.png' },
  { id: 'youtube.leanback.v4', title: 'YouTube', icon: '/apps/yt/icon.png' },
  { id: 'com.wbd.stream', title: 'Max', icon: '/apps/max/icon.png' },
  { id: 'com.webos.app.hdmi1', title: 'HDMI 1' },
  { id: 'com.hometv.app', title: 'HomeTV' },
];

const calls = [];
let answers = {};
class FakeBridge {
  call(uri, params) {
    const p = JSON.parse(params);
    calls.push({ uri, params: p });
    const a = answers[uri];
    const reply = typeof a === 'function' ? a(p) : a || { returnValue: false, errorText: 'unknown method' };
    setTimeout(() => this.onservicecallback(JSON.stringify(reply)), 1);
  }
}

const store = {};
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => (store[k] = String(v)),
};
globalThis.document = { hidden: false, addEventListener() {} };
globalThis.PalmServiceBridge = FakeBridge;

const { bridge } = await loadTs('bridge.ts');

function reset(extra = {}) {
  calls.length = 0;
  answers = {
    'luna://com.webos.applicationManager/listLaunchPoints': { returnValue: true, launchPoints: POINTS },
    'luna://com.webos.applicationManager/launch': { returnValue: true },
    'luna://com.hometv.app.service/alive': { returnValue: true },
    ...extra,
  };
}
reset();

test('on an LG TV the bridge is the own app; Home tiles are found by LG id, HomeTV itself never listed', async () => {
  assert.equal(await bridge.connect(), 'app');
  const apps = await bridge.apps();
  const by = Object.fromEntries(apps.map((a) => [a.key, a.installed]));
  assert.equal(by.netflix, true);
  assert.equal(by.youtube, true);
  assert.equal(by.max, true);
  assert.equal(by.disney, false);
  const all = await bridge.installedApps();
  assert.ok(!all.some((a) => a.id === 'com.hometv.app'));
  assert.equal(bridge.appCount(), 4);
});

test('artwork: the large icon first, no repeats; none for a missing app', () => {
  assert.deepEqual(bridge.artwork('netflix'), ['/apps/netflix/large.png', '/apps/netflix/icon.png']);
  assert.deepEqual(bridge.artwork('disney'), []);
});

test('launch opens the LG id; "app:" ids open as given; a missing app is reported', async () => {
  reset();
  assert.deepEqual(await bridge.launch('youtube'), { ok: true, id: 'youtube.leanback.v4' });
  assert.deepEqual(calls.at(-1), { uri: 'luna://com.webos.applicationManager/launch', params: { id: 'youtube.leanback.v4' } });
  assert.equal((await bridge.launch('app:com.webos.app.hdmi1')).id, 'com.webos.app.hdmi1');
  assert.deepEqual(await bridge.launch('disney'), { ok: false, id: null, error: 'not on this TV' });
});

test('a refused launch says why, in the toast too', async () => {
  reset({ 'luna://com.webos.applicationManager/launch': { returnValue: false, errorText: 'app is locked' } });
  const toasts = [];
  bridge.setToast((t) => toasts.push(t));
  const r = await bridge.launch('netflix');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'app is locked');
  assert.match(toasts[0], /app is locked/);
  bridge.setToast(() => {});
});

test('openTitle: YouTube gets its video as contentId; Netflix opens on its home unless the old-form flag is on', async () => {
  reset();
  let r = await bridge.openTitle({ how: 'link', app: { key: 'youtube', name: 'YouTube' }, url: null, payload: 'v=aqz-KE-bpKQ' });
  assert.deepEqual(r, { ok: true, id: 'youtube.leanback.v4', linked: true });
  assert.deepEqual(calls.at(-1).params, { id: 'youtube.leanback.v4', params: { contentId: 'v=aqz-KE-bpKQ' } });
  const netflix = { how: 'link', app: { key: 'netflix', name: 'Netflix' }, url: 'https://www.netflix.com/title/80057281', payload: 'm=80057281' };
  r = await bridge.openTitle(netflix);
  assert.deepEqual(r, { ok: true, id: 'netflix', linked: false, error: undefined });
  assert.deepEqual(calls.at(-1).params, { id: 'netflix' });
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k) => (k === 'hometv.netflix-old-link' ? '1' : null) }, configurable: true, writable: true });
  try {
    r = await bridge.openTitle(netflix);
  } finally {
    if (saved) Object.defineProperty(globalThis, 'localStorage', saved);
    else delete globalThis.localStorage;
  }
  assert.equal(r.linked, true);
  assert.match(calls.at(-1).params.params.contentId, /movies\/80057281&source_type=4$/);
});

test('openTitle: if the TV refuses the title, the app opens on its home', async () => {
  let n = 0;
  reset({ 'luna://com.webos.applicationManager/launch': (p) => (p.params ? { returnValue: false, errorText: 'bad params' } : (n++, { returnValue: true })) });
  const r = await bridge.openTitle({ how: 'link', app: { key: 'youtube', name: 'YouTube' }, url: null, payload: 'v=aqz-KE-bpKQ' });
  assert.deepEqual(r, { ok: true, id: 'youtube.leanback.v4', linked: false, error: undefined });
  assert.equal(n, 1);
});

test('checks: About this TV from LG system properties; app control with launch params; kept for the screen', async () => {
  reset({
    'luna://com.webos.service.tv.systemproperty/getSystemInfo': { returnValue: true, modelName: '43UT8000AUA', sdkVersion: '10.3.1', firmwareVersion: '33.31.61' },
  });
  const info = await bridge.check('info');
  assert.equal(info.ok, true);
  assert.equal(info.detail.model, '43UT8000AUA');
  assert.equal(info.detail.osVersion, '10.3.1');
  const link = await bridge.check('linkAppControl', { app: 'youtube' });
  assert.equal(link.ok, true);
  assert.deepEqual(link.detail.params, { contentId: 'v=aqz-KE-bpKQ' });
  const apps = await bridge.check('apps');
  assert.equal(apps.detail.count, POINTS.length);
  assert.equal(apps.detail.known.netflix, 'netflix');
  const kept = await bridge.results();
  assert.deepEqual(kept.slice(-3).map((r) => r.check), ['info', 'linkAppControl:youtube', 'apps']);
});

test('the heartbeat starts once and tells HomeTV’s service the page is alive', () => {
  reset();
  const timers = [];
  const real = globalThis.setInterval;
  globalThis.setInterval = (fn, ms) => (timers.push(ms), 1);
  try {
    bridge.platform.started();
    bridge.platform.started();
  } finally {
    globalThis.setInterval = real;
  }
  assert.deepEqual(timers, [10000]);
  assert.deepEqual(calls.map((c) => c.uri).filter((u) => /hometv\.app\.service/.test(u)), ['luna://com.hometv.app.service/alive']);
});

test('LG keys: Back is 461, colours sent without sign-up', () => {
  assert.equal(bridge.platform.keys[461], 'back');
  assert.equal(bridge.platform.buttons.blue, 406);
  assert.equal(bridge.platform.brand, 'LG');
});

test('the service touches the heartbeat file, for HomeTV only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hometv-alive-'));
  const file = path.join(dir, 'alive');
  process.env.HOMETV_ALIVE = file;
  const require = createRequire(import.meta.url);
  const svc = require('../service/service.js');
  const said = [];
  svc.methods.alive({ sender: 'com.hometv.app', respond: (r) => said.push(r) });
  assert.deepEqual(said[0], { returnValue: true });
  assert.ok(fs.existsSync(file));
  svc.methods.alive({ sender: 'com.example.other', respond: (r) => said.push(r) });
  assert.equal(said[1].returnValue, false);
  svc.methods.alive({ sender: 'com.webos.app.home', respond: (r) => said.push(r) });
  assert.equal(said[2].returnValue, true);
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.HOMETV_ALIVE;
});
