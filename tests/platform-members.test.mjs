// The platform's new members (app/src/platform.ts, docs/platform-lg.md) against a fake PalmServiceBridge: the connection
// for the nav's Wi-Fi, the inputs for its Inputs menu, opening LG's settings, the TV software's version, and their safe
// answers with no TV at all and when the TV refuses. `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './ts-module.mjs';

const CONNECTION = 'luna://com.webos.service.connectionmanager/getStatus';
const INPUTS = 'luna://com.webos.service.eim/getAllInputStatus';
const SYSTEM = 'luna://com.webos.service.tv.systemproperty/getSystemInfo';
const LAUNCH = 'luna://com.webos.applicationManager/launch';

const calls = [];
const live = [];
let answers = {};
let silent = false;

/** Answers from `answers` by uri; a subscribed call keeps its bridge so a test can push news and see the cancel. */
class FakeBridge {
  cancelled = false;
  call(uri, params) {
    const p = JSON.parse(params);
    calls.push({ uri, params: p });
    if (p.subscribe) live.push({ uri, bridge: this });
    if (silent) return;
    const a = answers[uri];
    const reply = typeof a === 'function' ? a(p) : a || { returnValue: false, errorText: 'unknown method' };
    setTimeout(() => !this.cancelled && this.onservicecallback(JSON.stringify(reply)), 1);
  }
  cancel() {
    this.cancelled = true;
  }
}

const win = new EventTarget();
globalThis.window = win;
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, userAgent: 'test' }, configurable: true, writable: true });
const setOnLine = (onLine) => Object.defineProperty(globalThis, 'navigator', { value: { onLine, userAgent: 'test' }, configurable: true, writable: true });
const onTv = (on) => (on ? (globalThis.PalmServiceBridge = FakeBridge) : delete globalThis.PalmServiceBridge);
const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms));

const { platform, inputsFrom, lgDeviceName, netFrom } = await loadTs('platform.ts');

function reset(extra = {}) {
  calls.length = 0;
  live.length = 0;
  silent = false;
  answers = {
    [SYSTEM]: { returnValue: true, sdkVersion: '25.2.1' },
    [LAUNCH]: { returnValue: true },
    ...extra,
  };
}

const wifi = (more = {}) => ({ returnValue: true, isInternetConnectionAvailable: true, wired: { state: 'disconnected' }, wifi: { state: 'connected', ssid: 'Living room', signalLevel: 80, ...more } });

test('no TV (a PC): every member answers safely', async () => {
  onTv(false);
  setOnLine(true);
  assert.deepEqual(await platform.network(), { kind: 'unknown', signal: null, name: '', online: true });
  setOnLine(false);
  assert.deepEqual(await platform.network(), { kind: 'none', signal: null, name: '', online: false });
  setOnLine(true);
  assert.equal(await platform.inputs.list(), null);
  const input = { id: 'HDMI_1', kind: 'hdmi', port: 'HDMI 1', device: '', connected: true, active: false, raw: { appId: 'com.webos.app.hdmi1' } };
  assert.equal(await platform.inputs.show(input), 'preview');
  assert.doesNotThrow(() => platform.inputs.leave());
  assert.equal(typeof platform.inputs.onChange(() => {}), 'function');
  const stop = platform.onNetworkChange(() => {});
  assert.doesNotThrow(stop);
  assert.equal(await platform.openTvSettings('network'), false);
  for (const page of ['main', 'network', 'picture', 'sound', 'inputs']) assert.match(platform.settingsWhere(page), /Settings|Input/);
  assert.equal(platform.osVersion(), '');
  assert.equal(platform.pageUpdates(), null);
  assert.match(platform.credits, /Homebrew Channel/);
  assert.match(platform.credits, /lasharor/);
});

test('the connection: Wi-Fi with its name and signal, a cable, none, offline, and a TV that won’t say', async () => {
  onTv(true);
  reset({ [CONNECTION]: wifi() });
  assert.deepEqual(await platform.network(), { kind: 'wifi', signal: 0.8, name: 'Living room', online: true });
  assert.deepEqual(calls.filter((c) => c.uri === CONNECTION), [{ uri: CONNECTION, params: {} }], 'a plain read, nothing subscribed');
  assert.deepEqual(calls.filter((c) => c.uri === SYSTEM).map((c) => c.params), [{ keys: ['sdkVersion'] }], 'the first look also starts reading the TV software’s version');
  answers[CONNECTION] = wifi({ signalLevel: undefined, signalBars: 3 });
  assert.equal((await platform.network()).signal, 0.6, 'bars out of 5');
  answers[CONNECTION] = wifi({ signalLevel: 900, ssid: undefined });
  assert.deepEqual(await platform.network(), { kind: 'wifi', signal: null, name: '', online: true }, 'an odd signal and no name are left out');
  answers[CONNECTION] = { returnValue: true, isInternetConnectionAvailable: true, wired: { state: 'connected' }, wifi: { state: 'disconnected' } };
  assert.deepEqual(await platform.network(), { kind: 'ethernet', signal: null, name: '', online: true });
  answers[CONNECTION] = { ...wifi(), isInternetConnectionAvailable: false };
  assert.equal((await platform.network()).online, false, 'connected to a router with no internet');
  answers[CONNECTION] = { returnValue: true, isInternetConnectionAvailable: false, wired: { state: 'disconnected' }, wifi: { state: 'disconnected' } };
  assert.deepEqual(await platform.network(), { kind: 'none', signal: null, name: '', online: false });
  answers[CONNECTION] = { returnValue: false, errorText: 'denied' };
  assert.equal((await platform.network()).kind, 'unknown', 'refused');
  assert.equal(netFrom({ returnValue: true }).kind, 'unknown', 'an answer with nothing in it');
});

test('a TV that never answers: the fallback after a moment, not a hang', async () => {
  onTv(true);
  reset();
  silent = true;
  const t0 = Date.now();
  assert.equal((await platform.network()).kind, 'unknown');
  assert.equal(await platform.inputs.list(), null);
  assert.ok(Date.now() - t0 < 7000);
});

test('network changes: the first answer of the subscription is the state now, later ones call fn; stop cancels it', async () => {
  onTv(true);
  reset({ [CONNECTION]: wifi() });
  let n = 0;
  const stop = platform.onNetworkChange(() => n++);
  await wait();
  assert.equal(n, 0, 'the first answer is not a change');
  assert.equal(calls[0].uri, CONNECTION);
  assert.equal(calls[0].params.subscribe, true);
  live[0].bridge.onservicecallback(JSON.stringify(wifi({ ssid: 'Other' })));
  assert.equal(n, 1);
  win.dispatchEvent(new Event('offline'));
  assert.equal(n, 2, 'and the browser’s own offline');
  stop();
  assert.equal(live[0].bridge.cancelled, true);
  win.dispatchEvent(new Event('online'));
  live[0].bridge.onservicecallback(JSON.stringify(wifi()));
  assert.equal(n, 2, 'nothing after stop');
});

test('device names: the TV’s placeholders aren’t names', () => {
  assert.equal(lgDeviceName('PlayStation 5', 'HDMI 1'), 'PlayStation 5');
  assert.equal(lgDeviceName('  Apple   TV ', 'HDMI 2'), 'Apple TV');
  for (const n of ['HDMI 1', 'HDMI_1', 'hdmi-3', 'AV 1', 'Unknown device', 'No device', 'Disconnected', 'Input HDMI 2', '', '   ', 7, null]) {
    assert.equal(lgDeviceName(n, 'HDMI 1'), '', String(n));
  }
});

const DEVICES = {
  returnValue: true,
  devices: [
    { id: 'HDMI_3', label: 'HDMI 3', connected: false, appId: 'com.webos.app.hdmi3' },
    { id: 'HDMI_2', label: 'PlayStation 5', connected: true, appId: 'com.webos.app.hdmi2' },
    { id: 'HDMI_1', label: 'HDMI 1', connected: true, appId: 'com.webos.app.hdmi1', activeInput: true },
    { id: 'AV_1', label: 'AV', connected: false, appId: 'com.webos.app.externalinput.av1' },
    { id: 'COMP_1', label: 'Component', connected: true, appId: 'com.webos.app.externalinput.component' },
    { id: 'BROKEN', label: 'No app id', connected: true },
    null,
  ],
};

test('the inputs list: one per port, names kept, HDMI connected first, other ports after, Live TV last', async () => {
  const list = inputsFrom(DEVICES);
  assert.deepEqual(
    list.map((i) => [i.id, i.kind, i.port, i.device, i.connected, i.active]),
    [
      ['HDMI_1', 'hdmi', 'HDMI 1', '', true, true],
      ['HDMI_2', 'hdmi', 'HDMI 2', 'PlayStation 5', true, false],
      ['HDMI_3', 'hdmi', 'HDMI 3', '', false, false],
      ['COMP_1', 'av', 'Component 1', '', true, false],
      ['AV_1', 'av', 'AV 1', '', false, false],
      ['TV_1', 'tv', 'Live TV', '', true, false],
    ],
  );
  assert.deepEqual(inputsFrom(null).map((i) => i.kind), ['tv']);
  onTv(true);
  reset({ [INPUTS]: DEVICES });
  assert.equal((await platform.inputs.list()).length, 6);
  answers[INPUTS] = { returnValue: false, errorText: 'denied' };
  assert.equal(await platform.inputs.list(), null, 'eim refusing');
});

test('showing an input: LG’s app for it opens and HomeTV leaves; failures come back in words', async () => {
  onTv(true);
  reset({ [INPUTS]: DEVICES });
  const list = await platform.inputs.list();
  calls.length = 0;
  assert.equal(await platform.inputs.show(list[1]), 'left');
  assert.deepEqual(calls, [{ uri: LAUNCH, params: { id: 'com.webos.app.hdmi2' } }]);
  assert.equal(await platform.inputs.show(list[5]), 'left');
  assert.equal(calls[1].params.id, 'com.webos.app.livetv');
  answers[LAUNCH] = { returnValue: false, errorText: 'app not found' };
  assert.equal(await platform.inputs.show(list[0]), 'app not found');
  assert.equal(await platform.inputs.show({ ...list[0], raw: {} }), 'this TV didn’t say how to open it');
  assert.doesNotThrow(() => platform.inputs.leave());
});

test('input changes: later answers of the subscription call fn; stop cancels', async () => {
  onTv(true);
  reset({ [INPUTS]: DEVICES });
  let n = 0;
  const stop = platform.inputs.onChange(() => n++);
  await wait();
  assert.equal(n, 0);
  assert.equal(calls[0].params.subscribe, true);
  live[0].bridge.onservicecallback(JSON.stringify(DEVICES));
  assert.equal(n, 1);
  stop();
  assert.equal(live[0].bridge.cancelled, true);
});

test('the TV’s settings open through LG’s Settings app; a refusal says false', async () => {
  onTv(true);
  reset();
  assert.equal(await platform.openTvSettings('network'), true);
  assert.deepEqual(calls, [{ uri: LAUNCH, params: { id: 'com.palm.app.settings' } }], 'no page ids are known: the main screen');
  answers[LAUNCH] = { returnValue: false, errorText: 'no such app' };
  assert.equal(await platform.openTvSettings('picture'), false);
});

test('the TV software’s version: read once through Luna by the first look, only when it looks like one', async () => {
  onTv(true);
  reset();
  assert.equal(platform.osVersion(), '25.2.1', 'kept from the first read');
  await platform.network();
  assert.equal(calls.filter((c) => c.uri === SYSTEM).length, 0, 'not asked again');
});

test('the clock is the page’s: LG pages follow the TV’s time zone; 24 hours is unknown', () => {
  const c = platform.clock();
  const d = new Date();
  assert.equal(c.year, d.getFullYear());
  assert.ok(c.hours >= 0 && c.hours < 24);
  assert.equal(c.hour24, null);
});
