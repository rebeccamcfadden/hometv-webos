// M2's wiring: which pick services the TV's installed apps tick, the region's money on the screens, the price
// credit line, the filters that read details, and the loader that fetches those details a few at a time. No keys, no network.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './ts-module.mjs';

const { i, pf, o, s, ls, f, rr } = await loadTs({
  rr: 'screens/rentRules.ts',
  i: 'live/installed.ts',
  pf: 'live/prefetch.ts',
  o: 'data/offers.ts',
  s: 'data/settings.ts',
  ls: 'launcherSettings.ts',
  f: 'screens/filterDefs.ts',
});

// ---- Installed apps ---------------------------------------------------------------------------------------------------

test('an installed app ticks its service: by its Home tile, or by its name', () => {
  const picks = s.pickServices();
  const idOfKey = { appletv: 'appletvplus', netflix: 'netflix' };
  const apps = [
    { name: 'Netflix', key: 'netflix' },
    { name: 'Apple TV', key: 'appletv' },
    { name: 'SVT Play - Sverige', key: null },
    { name: 'Calculator', key: null },
  ];
  const ticked = i.installedPicks(apps, picks, idOfKey);
  assert.ok(ticked.includes('netflix'));
  assert.ok(ticked.includes('appletvplus'), 'the tile key maps back to the service');
  assert.ok(ticked.includes('svtplay'), 'the name matches without the suffix');
  assert.ok(!ticked.includes('disney') && !ticked.includes('max'), 'services whose app isn\'t installed stay off');
});

test('no installed apps tick nothing', () => {
  assert.deepEqual(i.installedPicks([], s.pickServices(), {}), []);
});

// ---- Money ------------------------------------------------------------------------------------------------------------

test('prices are written in the region\'s money', () => {
  ls.prefs.set({ region: 'se' });
  assert.equal(o.kr(39), '39 kr');
  assert.equal(o.kr(49.5), '49.50 kr');
  assert.equal(s.currency(), 'kr');
  ls.prefs.set({ region: 'us' });
  assert.equal(o.kr(3.99), '$3.99');
  assert.equal(o.kr(4), '$4.00');
  assert.equal(s.currency(), '$');
  ls.prefs.set({ region: 'se' });
});

test('the 4K note is in the region\'s money, without float noise', () => {
  const store = { service: 'appletv', rent: { service: 'appletv', type: 'rent', prices: { HD: 2.99, '4K': 4.99 } } };
  ls.prefs.set({ region: 'us' });
  assert.equal(rr.fourKNote(store), '4K costs $2.00 more here');
  store.buy = { service: 'appletv', type: 'buy', prices: { HD: 9.99, '4K': 14.99 } };
  assert.equal(rr.fourKNote(store), '4K costs $2.00–$5.00 more here');
  ls.prefs.set({ region: 'se' });
  assert.equal(rr.fourKNote({ rent: { service: 'appletv', type: 'rent', prices: { HD: 39, '4K': 49 } } }), '4K costs 10 kr more here');
});

test('the credit names the sources whose prices a live title shows', () => {
  const base = { id: 'movie:1', offers: [{ service: 'appletv', type: 'rent', prices: { HD: 39 } }] };
  assert.equal(o.attribution({ ...base, priceSources: ['Apple', 'Watchmode'] }), 'Availability: JustWatch · Prices: Apple / Watchmode');
  assert.equal(o.attribution({ ...base, priceSources: [] }), 'Availability: JustWatch');
});

// ---- Filters that read details ----------------------------------------------------------------------------------------

const facts = { isSeen: () => false, included: (t) => t.in === true, rentable: (t) => t.rent === true };
const defs = f.filterDefs('movie', facts);
const def = (id) => defs.find((d) => d.id === id);

test('Availability: included only, or included and rentals', () => {
  const a = def('availability');
  assert.ok(a.test({ in: false, rent: true }, 0));
  assert.ok(!a.test({ in: false, rent: true }, 1));
  assert.ok(a.test({ in: false, rent: true }, 2));
  assert.ok(!a.test({ in: false, rent: false }, 2), 'a title with no offers (details not loaded) doesn\'t pass');
});

test('Length: a title whose runtime isn\'t known yet doesn\'t pass', () => {
  const l = def('runtime');
  assert.ok(l.test({}, 0));
  assert.ok(!l.test({}, 2));
  assert.ok(l.test({ runtime: 95 }, 2));
  assert.ok(!l.test({ runtime: 95 }, 1));
  assert.ok(!l.test({ runtime: 120 }, 2));
  assert.ok(l.test({ runtime: 149 }, 3));
});

// ---- The details loader -----------------------------------------------------------------------------------------------

function fakeNeed() {
  const loading = new Set();
  const done = new Set();
  const listeners = [];
  const started = [];
  return {
    started,
    need: (id) => {
      if (done.has(id)) return { phase: 'ready' };
      if (!loading.has(id)) {
        loading.add(id);
        started.push(id);
      }
      return { phase: 'loading' };
    },
    on: (fn) => listeners.push(fn),
    finish: (id) => {
      loading.delete(id);
      done.add(id);
      listeners.forEach((fn) => fn());
    },
  };
}

test('details load a few at a time, each title once', () => {
  const n = fakeNeed();
  const p = pf.createPrefetch(n.need, n.on, 2, 60);
  const ids = ['a', 'b', 'c', 'd', 'e'];
  p.ask(ids);
  assert.deepEqual(n.started, ['a', 'b']);
  assert.equal(p.waiting(ids), 5);
  n.finish('a');
  assert.deepEqual(n.started, ['a', 'b', 'c']);
  p.ask(ids);
  assert.deepEqual(n.started, ['a', 'b', 'c'], 'asking again doesn\'t queue them again');
  ['b', 'c', 'd', 'e'].forEach((id) => n.finish(id));
  assert.deepEqual(n.started, ['a', 'b', 'c', 'd', 'e']);
  assert.equal(p.waiting(ids), 0);
});

test('a list is loaded only up to the cap', () => {
  const n = fakeNeed();
  const p = pf.createPrefetch(n.need, n.on, 100, 3);
  const ids = ['a', 'b', 'c', 'd', 'e'];
  p.ask(ids);
  assert.deepEqual(n.started, ['a', 'b', 'c']);
  assert.equal(p.waiting(ids), 3);
  ['a', 'b', 'c'].forEach((id) => n.finish(id));
  p.ask(ids);
  assert.deepEqual(n.started, ['a', 'b', 'c'], 'a redraw asking again doesn\'t reach the next titles');
});
