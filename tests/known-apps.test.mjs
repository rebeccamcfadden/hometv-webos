// HomeTV's known apps (app/src/webos/apps.ts KNOWN_APPS, pickKnown) and the bridge's fallback to them when the TV
// denies listLaunchPoints to a Developer Mode app (the 2026-11-17 call, webOS 10.3.2): getAppLoadStatus says which are
// installed, and if the TV won't say that either, every known app is offered unchecked. Nothing prompts on the TV.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './ts-module.mjs';

const DENIED = { returnValue: false, errorCode: -1, errorText: 'Denied method call "listLaunchPoints" for category "/"' };
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
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.document = { hidden: false, addEventListener() {} };
globalThis.PalmServiceBridge = FakeBridge;

const { KNOWN_APPS, pickKnown } = await loadTs('webos/apps.ts');

test('pickKnown: only "not installed" drops an app; an unanswered one stays; one per title, a sure id first', () => {
  const known = [{ id: 'a.new', title: 'A' }, { id: 'a.old', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }, { id: 'd', title: 'D' }];
  const r = pickKnown(known, [{ returnValue: false }, { returnValue: true, exist: true }, { returnValue: true, exist: true }, { returnValue: false }, { returnValue: true, exist: false }]);
  assert.equal(r.checked, true);
  assert.deepEqual(r.apps.map((a) => a.id), ['a.old', 'b', 'c']);
  assert.deepEqual(r.absent, ['d']);
});

test('pickKnown: no answer from the TV at all offers every known app once, unchecked', () => {
  const known = [{ id: 'a.new', title: 'A' }, { id: 'a.old', title: 'A' }, { id: 'b', title: 'B' }];
  const r = pickKnown(known, known.map(() => ({ returnValue: false, errorText: 'Denied' })));
  assert.equal(r.checked, false);
  assert.deepEqual(r.apps.map((a) => a.id), ['a.new', 'b']);
});

test('the known list has every Home tile\'s LG ids and no HomeTV or Developer Mode app', () => {
  const ids = KNOWN_APPS.map((a) => a.id);
  for (const id of ['netflix', 'youtube.leanback.v4', 'amazon', 'com.disney.disneyplus-prod', 'com.wbd.stream', 'com.apple.appletv', 'hulu']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.some((id) => /^com\.hometv\.|devmode/.test(id)));
  assert.equal(new Set(ids).size, ids.length);
});

test('listLaunchPoints denied: the bridge asks getAppLoadStatus per known app and uses the installed ones', async () => {
  const { bridge } = await loadTs('bridge.ts');
  const here = new Set(['youtube.leanback.v4', 'com.peacock.tv', 'com.wbd.stream']);
  answers = {
    'luna://com.webos.applicationManager/listLaunchPoints': DENIED,
    // Netflix's check gets no answer (refused): it isn't dropped, as the TV may have it
    'luna://com.webos.applicationManager/getAppLoadStatus': (p) => (p.appId === 'netflix' ? { returnValue: false, errorText: 'timeout' } : { returnValue: true, exist: here.has(p.appId) }),
    'luna://com.webos.applicationManager/launch': { returnValue: true },
  };
  assert.equal(await bridge.connect(), 'app');
  const apps = await bridge.apps();
  const by = Object.fromEntries(apps.map((a) => [a.key, a.installed]));
  assert.equal(by.netflix, true);
  assert.equal(by.youtube, true);
  assert.equal(by.max, true);
  assert.equal(by.disney, false, 'the TV said Disney+ isn\'t installed');
  assert.equal(by.viaplay === undefined || by.viaplay === null, true, 'a tile with no known LG id isn\'t called missing');
  assert.equal(bridge.appSource(), 'checked');
  assert.match(bridge.problem(), /Denied method call "listLaunchPoints"/, 'the Checks screen still says why');
  const all = await bridge.installedApps();
  assert.deepEqual(all.map((a) => a.name).sort(), ['HBO Max', 'Netflix', 'Peacock', 'YouTube']);
  assert.equal(all.filter((a) => a.name === 'HBO Max')[0].key, 'max');
  assert.equal(calls.filter((c) => /listLaunchPoints/.test(c.uri)).length, 1, 'asked once per start');
  assert.equal(calls.filter((c) => /getAppLoadStatus/.test(c.uri)).length, KNOWN_APPS.length);
  assert.ok(calls.every((c) => !/ssap|pairing|register|createToast|createAlert/i.test(c.uri)), 'nothing that shows on the TV');
  assert.deepEqual(await bridge.launch('app:com.peacock.tv'), { ok: true, id: 'com.peacock.tv' });
  assert.deepEqual(await bridge.launch('disney'), { ok: false, id: null, error: 'not on this TV' });
  assert.deepEqual(await bridge.launch('app:se.example.play'), { ok: true, id: 'se.example.play' }, 'a pinned app outside the known list still opens');
  await bridge.apps();
  assert.equal(calls.filter((c) => /getAppLoadStatus/.test(c.uri)).length, KNOWN_APPS.length, 'not asked again');
});

test('getAppLoadStatus denied too: every known app is offered, no tile says "not on this TV", and opening one tries its id', async () => {
  const { bridge } = (await loadTs({ bridge: 'bridge.ts' })).bridge;
  calls.length = 0;
  answers = {
    'luna://com.webos.applicationManager/listLaunchPoints': DENIED,
    'luna://com.webos.applicationManager/getAppLoadStatus': { returnValue: false, errorText: 'Denied method call "getAppLoadStatus"' },
    'luna://com.webos.applicationManager/launch': (p) => (p.id === 'hulu' ? { returnValue: false, errorCode: -101, errorText: 'The app was not found' } : { returnValue: true }),
  };
  await bridge.connect();
  const apps = await bridge.apps();
  assert.ok(apps.every((a) => a.installed !== false));
  assert.equal(bridge.appSource(), 'known');
  const all = await bridge.installedApps();
  assert.equal(all.length, new Set(KNOWN_APPS.map((a) => a.title)).size);
  assert.deepEqual(await bridge.launch('disney'), { ok: true, id: 'com.disney.disneyplus-prod' });
  const r = await bridge.launch('hulu');
  assert.equal(r.ok, false);
  assert.match(r.error, /not found/);
});
