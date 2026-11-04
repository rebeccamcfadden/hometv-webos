// HomeTV's settings on Samsung, run as TypeScript by Node: the settings store (launcherSettings.ts, localStorage
// `hometv-settings-v1`), first run's once-only flag (`hometv-setup-done`), the one region and what follows from it
// (the unit, the clock, the v1 stand-in's services), Home's top-bar words (clockText.ts) and About's update line
// (updates.ts). `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './ts-module.mjs';

const { ls, clock, up, data } = await loadTs({
  ls: 'launcherSettings.ts',
  clock: 'clockText.ts',
  up: 'updates.ts',
  data: 'data/settings.ts',
});

const memory = () => {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map };
};
const GBG = { name: 'Gothenburg', region: 'Västra Götaland County', country: 'Sweden', latitude: 57.70716, longitude: 11.96679 };
const MALMO = { name: 'Malmö', region: 'Skåne County', country: 'Sweden', latitude: 55.60587, longitude: 13.00073 };
const NYC = { name: 'New York', region: 'New York', country: 'United States', latitude: 40.71427, longitude: -74.00597 };

test('nothing chosen at first: no region, no place (no sample data), the unit follows the region', () => {
  const p = ls.loadPrefs(memory());
  assert.deepEqual(p, { region: null, place: null, recentPlaces: [], unit: 'region', motion: 'full', screensaverAfter: 'off', screensaverBack: 'glow' });
  assert.equal(ls.fahrenheit(p), false);
});

test('choices are saved under hometv-settings-v1 and read back; unreadable ones fall back', () => {
  const storage = memory();
  const store = ls.createPrefs(storage);
  let told = 0;
  const off = store.on(() => told++);
  store.set({ region: 'us' });
  store.set(ls.withPlace(store.get(), NYC));
  off();
  store.set({ unit: 'c' });
  assert.equal(told, 2, 'a listener stops when asked');
  const saved = JSON.parse(storage.map.get(ls.SETTINGS_KEY));
  assert.equal(saved.region, 'us');
  assert.deepEqual(ls.loadPrefs(storage), { region: 'us', place: NYC, recentPlaces: [], unit: 'c', motion: 'full', screensaverAfter: 'off', screensaverBack: 'glow' });

  storage.setItem(ls.SETTINGS_KEY, JSON.stringify({ region: 'fr', place: { name: 'Nowhere', latitude: 200, longitude: 0 }, unit: 'k', recentPlaces: 'x' }));
  assert.deepEqual(ls.loadPrefs(storage), ls.defaults());
  storage.setItem(ls.SETTINGS_KEY, '{oops');
  assert.deepEqual(ls.loadPrefs(storage), ls.defaults());
  // Blocked storage: the defaults, and saving doesn't throw.
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.deepEqual(ls.loadPrefs(blocked), ls.defaults());
  ls.createPrefs(blocked).set({ region: 'se' });
});

test('one region at a time, chosen by the person: °C or °F follows it until a unit is chosen', () => {
  const store = ls.createPrefs(memory());
  store.set({ region: 'us' });
  assert.equal(ls.fahrenheit(store.get()), true);
  assert.equal(ls.UNIT_LABELS(store.get()).region, 'Region’s (°F)');
  store.set({ region: 'se' });
  assert.equal(store.get().region, 'se', 'the new region replaces the old; there is only one');
  assert.equal(ls.fahrenheit(store.get()), false);
  store.set({ unit: 'f' });
  assert.equal(ls.fahrenheit(store.get()), true);
  assert.deepEqual(ls.REGIONS, ['se', 'us']);
});

test('a new place puts the one before it first among the quick picks, three at most, never twice', () => {
  let p = ls.defaults();
  const apply = (place) => (p = { ...p, ...ls.withPlace(p, place) });
  apply(GBG);
  assert.deepEqual(p.recentPlaces, []);
  apply(MALMO);
  assert.deepEqual(p.recentPlaces, [GBG]);
  apply(NYC);
  apply({ ...GBG, name: 'gothenburg' });
  assert.equal(p.place.name, 'gothenburg');
  assert.deepEqual(p.recentPlaces.map((x) => x.name), ['New York', 'Malmö'], 'Gothenburg is showing, so not a quick pick');
  apply(GBG);
  assert.equal(p.recentPlaces.length, 2, 'the same place again changes nothing');
});

test('first run shows once: until it ends (done or skipped) it shows at every start', () => {
  const storage = memory();
  assert.equal(ls.setupDone(storage), false);
  assert.equal(ls.setupDone(storage), false, 'still not done at the next start');
  ls.markSetupDone(storage);
  assert.equal(storage.map.get(ls.SETUP_KEY), '1');
  assert.equal(ls.setupDone(storage), true);
  assert.equal(ls.setupDone(null), false);
});

test('the v1 stand-in reads the region from Settings: Sweden until one is chosen, then that one’s lists', () => {
  assert.ok(data.pickServices().some((x) => x.id === 'svtplay'));
  ls.prefs.set({ region: 'us' });
  assert.ok(data.pickServices().some((x) => x.id === 'hulu'));
  assert.ok(!data.pickServices().some((x) => x.id === 'svtplay'));
  assert.ok(data.settings.get().services.every((id) => data.pickServices().some((x) => x.id === id)), 'its own first ticks');
  assert.equal(data.CURRENCY, 'kr', 'the sample prices stay in kronor');
  ls.prefs.set({ region: 'se' });
  assert.ok(data.pickServices().some((x) => x.id === 'svtplay'));
});

test('Home’s top bar: greeting, date and time, from the TV’s clock', () => {
  assert.equal(clock.greeting(9), 'Good morning');
  assert.equal(clock.greeting(12), 'Good afternoon');
  assert.equal(clock.greeting(18), 'Good evening');
  assert.equal(clock.dateLine({ year: 2026, month: 10, date: 4, weekday: 3, hours: 21, minutes: 5, hour24: null }), 'Wednesday, November 4');
  assert.deepEqual(clock.timeParts(21, 5, false), { time: '9:05', ampm: 'PM' });
  assert.deepEqual(clock.timeParts(0, 30, false), { time: '12:30', ampm: 'AM' });
  assert.deepEqual(clock.timeParts(9, 5, true), { time: '09:05', ampm: '' });
  assert.equal(clock.use24(false, 'se'), false, 'the TV’s own format wins');
  assert.equal(clock.use24(null, 'se'), true);
  assert.equal(clock.use24(null, 'us'), false);
  assert.equal(clock.use24(null, null), false, 'the design’s 12-hour clock');
  assert.equal(clock.ago(0, 30000), 'just now');
  assert.equal(clock.ago(0, 25 * 60000), '25 minutes ago');
  assert.equal(clock.ago(0, 3 * 3600000), '3 hours ago');
  assert.equal(clock.ago(0, 26 * 3600000), '1 day ago');
});

test('About’s update line and Home’s notice, once per version', () => {
  const ago = () => '5 minutes ago';
  assert.match(up.updateLine(null, ago), /isn’t the installed Samsung app/);
  const base = { app: '0.0.2', page: '0.0.1', on: true, next: null, checkedAt: null, failed: false };
  assert.match(up.updateLine({ ...base, on: false }, ago), /off in this build/);
  assert.match(up.updateLine(base, ago), /shortly after Home shows/);
  assert.equal(up.updateLine({ ...base, checkedAt: 1 }, ago), 'Up to date · checked 5 minutes ago');
  assert.match(up.updateLine({ ...base, checkedAt: 1, failed: true }, ago), /Couldn’t check/);
  const ready = { ...base, next: '0.0.3' };
  assert.match(up.updateLine(ready, ago), /Version 0\.0\.3 is downloaded and checked\. It shows the next time HomeTV starts/);
  assert.equal(up.aboutValue(ready, '0.0.1'), '0.0.3 ready');
  assert.equal(up.aboutValue(null, '0.0.1'), '0.0.1');
  const storage = memory();
  assert.equal(up.takeNotice(storage, base), null);
  assert.equal(up.takeNotice(storage, ready), '0.0.3');
  assert.equal(up.takeNotice(storage, ready), null, 'once per version');
  assert.equal(up.takeNotice(storage, { ...base, next: '0.0.4' }), '0.0.4');
});
