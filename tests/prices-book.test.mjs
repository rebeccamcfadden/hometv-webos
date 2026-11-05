// The price policy, queue, merge and lookup book (app/src/live/prices/): TTLs, quota and daily allowance, the order lookups
// go in, the merge of prices onto TMDB's offers, and the book with a fake clock, fake network and in-memory storage.
// No network, no keys.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './ts-module.mjs';

const { p, q, mg, bk, ca, ty } = await loadTs({
  p: 'live/prices/policy.ts',
  q: 'live/prices/queue.ts',
  mg: 'live/prices/merge.ts',
  bk: 'live/prices/book.ts',
  ca: 'live/cache.ts',
  ty: 'live/prices/types.ts',
});

const SE = ty.REGIONS.SE;
const US = ty.REGIONS.US;
const T0 = Date.UTC(2026, 10, 5, 12, 0, 0);

test('policy: the TTLs and the stops', () => {
  assert.equal(p.PRICE_TTL, 7 * p.DAY);
  assert.equal(p.DEEP_LINK_TTL, 30 * p.DAY);
  assert.equal(p.FAILURE_RETRY, p.HOUR);
  assert.equal(p.stopAt('watchmode', 0), 2300);
  assert.equal(p.stopAt('watchmode', 2500), 2300);
  assert.equal(p.stopAt('watchmode', 1000), 800);
  assert.equal(p.stopAt('watchmode', 100), 0);
  assert.equal(p.stopAt('streamingavailability', 0), 900);
  assert.equal(p.stopAt('streamingavailability', 500), 400);
  assert.equal(p.stopAt('itunes', 0), 0);
  assert.equal(p.requestCost('watchmode'), 2);
  assert.equal(p.requestCost('streamingavailability'), 1);
  assert.equal(p.minIntervalMs('itunes'), 3000);
  assert.equal(p.minIntervalMs('wikidata'), 1000);
  assert.equal(p.minIntervalMs('watchmode'), 0);
});

test('policy: a result is fresh inside its TTL only', () => {
  assert.equal(p.fresh(T0, T0 + p.PRICE_TTL - 1, p.PRICE_TTL), true);
  assert.equal(p.fresh(T0, T0 + p.PRICE_TTL, p.PRICE_TTL), false);
  assert.equal(p.fresh(0, T0, p.PRICE_TTL), false);
});

test('quota: kept as text, and a broken text is a fresh quota', () => {
  const a = new p.Quota('watchmode');
  a.granted = 2500;
  a.used = 40;
  a.resetAt = T0;
  a.syncedAt = T0 - 5;
  a.day = '2026-11-05';
  a.dayUsed = 6;
  const b = p.Quota.decode('watchmode', a.encode());
  assert.equal(b.encode(), a.encode());
  assert.equal(p.Quota.decode('watchmode', 'junk').encode(), new p.Quota('watchmode').encode());
  assert.equal(p.Quota.decode('watchmode', null).used, 0);
});

test('quota: the server\'s headers set the count (any case), Watchmode\'s period runs a month from first use', () => {
  const wm = new p.Quota('watchmode');
  wm.record(2, T0);
  assert.equal(wm.used, 2);
  assert.ok(wm.resetAt > T0);
  wm.sync({ 'X-Account-Quota': '2500', 'x-account-quota-used': '120' }, T0);
  assert.equal(wm.granted, 2500);
  assert.equal(wm.used, 120);
  assert.equal(wm.syncedAt, T0);
  const mo = new p.Quota('streamingavailability');
  mo.sync({ 'x-quota-granted': '1000', 'x-quota-used': '10', 'x-quota-reset': '2026-12-01T00:00:00Z' }, T0);
  assert.equal(mo.granted, 1000);
  assert.equal(mo.resetAt, Date.UTC(2026, 11, 1));
  mo.sync({ 'x-quota-reset': '1796083200' }, T0);
  assert.equal(mo.resetAt, 1796083200000);
  mo.sync(null, T0);
  assert.equal(mo.used, 10);
});

test('quota: a new period resets the count, a new day the day\'s count', () => {
  const qa = new p.Quota('streamingavailability');
  qa.resetAt = T0 + p.DAY;
  qa.used = 500;
  qa.record(1, T0);
  assert.equal(qa.dayUsed, 1);
  qa.roll(T0 + p.DAY / 2 + p.DAY);
  assert.equal(qa.used, 0);
  assert.ok(qa.resetAt > T0 + p.DAY);
  assert.equal(qa.dayUsed, 0);
});

test('quota: never above the stop; a title page may spend the day\'s share, background work half of it', () => {
  const qa = new p.Quota('streamingavailability');
  qa.resetAt = T0 + 10 * p.DAY;
  assert.equal(qa.dailyAllowance(T0), 90);
  assert.equal(qa.allowed(1, 'preview', T0), true);
  qa.record(44, T0);
  assert.equal(qa.allowed(1, 'background', T0), true);
  qa.record(1, T0);
  assert.equal(qa.allowed(1, 'background', T0), false);
  assert.equal(qa.allowed(1, 'preview', T0), true);
  qa.used = 90;
  qa.dayUsed = 90;
  assert.equal(qa.allowed(1, 'preview', T0), false);
  const full = new p.Quota('streamingavailability');
  full.resetAt = T0 + 10 * p.DAY;
  full.used = 900;
  assert.equal(full.allowed(1, 'preview', T0), false);
  assert.equal(new p.Quota('itunes').allowed(1, 'background', T0), true);
});

test('queue: previews before rows, then first come first served; a title once', () => {
  const pq = new q.PriceQueue();
  assert.equal(pq.add('movie:1', 'movie', 'A', 2000, true, 'background'), true);
  assert.equal(pq.add('movie:2', 'movie', 'B', 2000, true, 'background'), true);
  assert.equal(pq.add('movie:1', 'movie', 'A', 2000, true, 'background'), false);
  assert.equal(pq.add('tv:3', 'show', 'C', 2000, true, 'preview'), true);
  assert.equal(pq.add('tv:4', 'show', 'D', 2000, true, 'preview'), true);
  assert.deepEqual([pq.poll().id, pq.poll().id, pq.poll().id, pq.poll().id, pq.poll()], ['tv:3', 'tv:4', 'movie:1', 'movie:2', null]);
});

test('queue: a title page moves a waiting row ahead (once); a missing or running title is left alone', () => {
  const pq = new q.PriceQueue();
  pq.add('movie:1', 'movie', 'A', 2000, false, 'background');
  pq.add('movie:2', 'movie', 'B', 2000, false, 'background');
  assert.equal(pq.boost('movie:2', true), true);
  assert.equal(pq.boost('movie:2', true), false);
  assert.equal(pq.boost('movie:9', true), false);
  const next = pq.poll();
  assert.equal(next.id, 'movie:2');
  assert.equal(next.trigger, 'preview');
  assert.equal(next.needPrices, true);
});

const base = [
  { service: 'netflix', type: 'sub' },
  { service: 'appletv', type: 'rent' },
  { service: 'googletv', type: 'buy' },
  { service: 'appletv', type: 'rent' },
];
const price = (store, type, quality, amount, source, extra = {}) => ({ store, type, quality, amount, currency: 'SEK', season: 0, source, ...extra });

test('merge: prices go onto TMDB\'s rent and buy offers in TMDB\'s order; the cheapest per quality wins', () => {
  const r = mg.merge(base, [
    price('appletv', 'rent', 'HD', 49, 'watchmode'),
    price('appletv', 'rent', 'HD', 39, 'itunes'),
    price('appletv', 'rent', 'SD', 29, 'itunes'),
    price('googletv', 'buy', 'HD', 99, 'watchmode'),
  ], SE);
  assert.deepEqual(r.offers.map((o) => `${o.service}:${o.type}`), ['netflix:sub', 'appletv:rent', 'googletv:buy']);
  assert.deepEqual(r.offers[1].prices, { HD: 39, SD: 29 });
  assert.deepEqual(r.offers[2].prices, { HD: 99 });
  assert.deepEqual(r.sources, ['Apple', 'Watchmode']);
  assert.equal(r.offers[0].prices, undefined);
});

test('merge: a source whose price lost is not credited; a store TMDB did not list is appended', () => {
  const r = mg.merge([{ service: 'netflix', type: 'sub' }, { service: 'appletv', type: 'rent' }], [
    price('appletv', 'rent', 'HD', 30, 'itunes'),
    price('appletv', 'rent', 'HD', 40, 'streamingavailability'),
    price('sfanytime', 'buy', 'HD', 89, 'watchmode'),
  ], SE);
  assert.deepEqual(r.offers.map((o) => `${o.service}:${o.type}`), ['netflix:sub', 'appletv:rent', 'sfanytime:buy']);
  assert.deepEqual(r.sources, ['Apple', 'Watchmode']);
});

test('merge: another currency is ignored; no prices leaves the offers as they were; a season price reads "from"', () => {
  const none = mg.merge(base, [price('appletv', 'rent', 'HD', 5, 'itunes', { currency: 'USD' })], SE);
  assert.equal(none.offers.length, 3);
  assert.equal(none.offers[1].prices, undefined);
  assert.deepEqual(none.sources, []);
  const us = mg.merge(base, [price('appletv', 'rent', 'HD', 5, 'itunes', { currency: 'USD' })], US);
  assert.deepEqual(us.offers[1].prices, { HD: 5 });
  const seasons = mg.merge([{ service: 'appletv', type: 'buy' }], [price('appletv', 'buy', 'HD', 20, 'itunes', { season: 1 }), price('appletv', 'buy', 'HD', 15, 'itunes', { season: 2 })], SE);
  assert.deepEqual(seasons.offers[0].prices, { HD: 15 });
  assert.equal(seasons.offers[0].seasonal, true);
});

// The book, with a clock the test moves, a network it answers, and storage in memory.

function memoryStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), m };
}

function harness({ keys = { watchmode: '', motn: '' }, answers = {}, region = SE, online = true } = {}) {
  let t = T0;
  const store = memoryStore();
  const sent = [];
  const slept = [];
  const h = {
    keys,
    sent,
    slept,
    store,
    advance: (ms) => void (t += ms),
    online,
    book: null,
  };
  h.book = bk.createBook({
    send: async (url, headers) => {
      sent.push({ url, headers, at: t });
      const host = new URL(url).hostname;
      const a = answers[host];
      const r = typeof a === 'function' ? a(url) : a;
      return r === undefined ? { code: 404, body: '', headers: {} } : r;
    },
    now: () => t,
    sleep: async (ms) => {
      slept.push(ms);
      t += ms;
    },
    cache: ca.createCache(store, () => t),
    ledger: store,
    keys: () => h.keys,
    region: () => region,
    online: () => h.online,
  });
  return h;
}

const done = (h, id) => new Promise((res) => h.book.on((x) => x === id && res()));
const want = { id: 'movie:603', kind: 'movie', name: 'The Matrix', year: 1999 };
const ok = (body, headers = {}) => ({ code: 200, body: typeof body === 'string' ? body : JSON.stringify(body), headers });
const wmAnswer = [{ name: 'Apple TV', type: 'rent', region: 'SE', format: 'HD', price: 39 }];
const motnAnswer = { streamingOptions: { se: [{ service: { id: 'x', name: 'Google Play' }, type: 'buy', quality: 'hd', price: { amount: '99', currency: 'SEK' } }] } };
const appleMovie = { results: [{ kind: 'feature-movie', trackName: 'The Matrix', releaseDate: '1999-03-31T00:00:00Z', currency: 'SEK', trackHdRentalPrice: 35 }] };
const wikidata = { results: { bindings: [{ P6398: { value: '111' } }] } };

test('book: with no key only iTunes is asked (ids from Wikidata first), and the prices arrive through on()', async () => {
  const h = harness({ answers: { 'query.wikidata.org': ok(wikidata), 'itunes.apple.com': ok(appleMovie) } });
  const finished = done(h, want.id);
  h.book.want(want, 'preview');
  await finished;
  assert.deepEqual(h.sent.map((s) => new URL(s.url).hostname), ['query.wikidata.org', 'itunes.apple.com']);
  assert.match(h.sent[1].url, /lookup\?id=111&country=se/);
  const e = h.book.entry(want.id);
  assert.equal(e.prices.length, 1);
  assert.equal(e.prices[0].amount, 35);
  assert.equal(h.sent.some((s) => /watchmode|movieofthenight/.test(s.url)), false);
});

test('book: Watchmode first; Movie of the Night only when Watchmode had no price; iTunes only when nobody priced Apple', async () => {
  const h = harness({ keys: { watchmode: 'wk', motn: 'mk' }, answers: { 'api.watchmode.com': (u) => (/status/.test(u) ? ok('{}') : ok(wmAnswer)), 'api.movieofthenight.com': ok(motnAnswer) } });
  const finished = done(h, want.id);
  h.book.want(want, 'preview');
  await finished;
  const hosts = h.sent.map((s) => new URL(s.url).hostname);
  assert.deepEqual(hosts, ['api.watchmode.com', 'api.watchmode.com']);
  assert.equal(h.sent[1].headers['X-API-Key'], 'wk');
  assert.equal(h.book.entry(want.id).prices[0].store, 'appletv');

  const g = harness({ keys: { watchmode: 'wk', motn: 'mk' }, answers: { 'api.watchmode.com': ok([]), 'api.movieofthenight.com': ok(motnAnswer), 'query.wikidata.org': ok(wikidata), 'itunes.apple.com': ok(appleMovie) } });
  const second = done(g, want.id);
  g.book.want(want, 'preview');
  await second;
  const names = g.sent.map((s) => new URL(s.url).hostname);
  assert.ok(names.indexOf('api.movieofthenight.com') > names.indexOf('api.watchmode.com'));
  assert.ok(names.includes('itunes.apple.com'));
  assert.deepEqual(g.book.entry(want.id).prices.map((x) => x.source).sort(), ['itunes', 'streamingavailability']);
});

test('book: a fresh title is not asked again; after a week it is; a key typed later asks again', async () => {
  const h = harness({ answers: { 'query.wikidata.org': ok(wikidata), 'itunes.apple.com': ok(appleMovie) } });
  let finished = done(h, want.id);
  h.book.want(want, 'preview');
  await finished;
  const n = h.sent.length;
  h.book.want(want, 'preview');
  h.advance(p.PRICE_TTL - 1000);
  h.book.want(want, 'background');
  assert.equal(h.book.pending(), 0);
  assert.equal(h.sent.length, n);
  h.advance(2000);
  finished = done(h, want.id);
  h.book.want(want, 'preview');
  await finished;
  assert.ok(h.sent.length > n);
  const m = h.sent.length;
  h.keys = { watchmode: 'wk', motn: '' };
  finished = done(h, want.id);
  h.book.want(want, 'preview');
  await finished;
  assert.ok(h.sent.length > m);
  assert.ok(h.sent.some((s) => /watchmode/.test(s.url)));
});

test('book: the prices outlive the page in the cache (a new book reads them without asking)', async () => {
  const h = harness({ answers: { 'query.wikidata.org': ok(wikidata), 'itunes.apple.com': ok(appleMovie) } });
  const finished = done(h, want.id);
  h.book.want(want, 'preview');
  await finished;
  const again = bk.createBook({ send: async () => assert.fail('asked'), now: () => T0 + p.DAY, sleep: async () => {}, cache: ca.createCache(h.store, () => T0 + p.DAY), ledger: h.store, keys: () => h.keys, region: () => SE, online: () => true });
  assert.equal(again.entry(want.id).prices.length, 1);
  again.want(want, 'preview');
  assert.equal(again.pending(), 0);
});

test('book: a failure is retried after an hour, not before', async () => {
  const g = harness({ answers: { 'query.wikidata.org': ok(wikidata), 'itunes.apple.com': { code: 503, body: '', headers: {} } } });
  const finished = done(g, want.id);
  g.book.want(want, 'preview');
  await finished;
  const failed = g.book.entry(want.id);
  assert.ok(failed.failedAt > 0);
  assert.equal(failed.pricedAt, 0);
  const n = g.sent.length;
  g.advance(p.FAILURE_RETRY - 1000);
  g.book.want(want, 'preview');
  assert.equal(g.book.pending(), 0);
  assert.equal(g.sent.length, n);
  g.advance(2000);
  g.book.want(want, 'preview');
  assert.equal(g.book.pending(), 1);
  await done(g, want.id);
});

test('book: iTunes and Wikidata are paced to their minimum intervals', async () => {
  const h = harness({ answers: { 'query.wikidata.org': ok(wikidata), 'itunes.apple.com': ok({ results: [] }) } });
  const finished = done(h, want.id);
  h.book.want(want, 'preview');
  await finished;
  const gaps = [];
  const itunes = h.sent.filter((s) => /itunes/.test(s.url));
  assert.equal(itunes.length, 2);
  for (let k = 1; k < itunes.length; k++) gaps.push(itunes[k].at - itunes[k - 1].at);
  assert.ok(gaps.every((g) => g >= 3000));
  assert.ok(h.slept.length >= 1);
});

test('book: a title page\'s lookup goes before the rows\' waiting ones', async () => {
  const h = harness({ answers: { 'query.wikidata.org': ok(wikidata), 'itunes.apple.com': ok(appleMovie) } });
  const order = [];
  h.book.on((id) => order.push(id));
  const t = (n) => ({ id: `movie:${n}`, kind: 'movie', name: `M${n}`, year: 2000 });
  h.book.want(t(1), 'background');
  h.book.want(t(2), 'background');
  h.book.want(t(3), 'background');
  h.book.want(t(3), 'preview');
  while (h.book.pending()) await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(order, ['movie:1', 'movie:3', 'movie:2']);
});

test('book: a keyed source over its budget is skipped for another, and a title page still asks after a row was blocked', async () => {
  const h = harness({ keys: { watchmode: 'wk', motn: '' }, answers: { 'api.watchmode.com': (u) => (/status/.test(u) ? ok('{}') : ok(wmAnswer)), 'query.wikidata.org': ok(wikidata), 'itunes.apple.com': ok(appleMovie) } });
  const spent = new p.Quota('watchmode');
  spent.used = 2300;
  spent.resetAt = T0 + 20 * p.DAY;
  spent.syncedAt = T0;
  h.store.setItem('hometv-prices-v1:quota:watchmode', spent.encode());
  let finished = done(h, want.id);
  h.book.want(want, 'background');
  await finished;
  assert.equal(h.sent.some((s) => /sources/.test(s.url)), false);
  const e = h.book.entry(want.id);
  assert.equal(e.listBlocked, true);
  assert.equal(e.prices[0].source, 'itunes');
  assert.ok(e.failedAt > 0);
  h.advance(1000);
  h.book.want(want, 'background');
  assert.equal(h.book.pending(), 0);
  h.book.want(want, 'preview');
  assert.equal(h.book.pending(), 1);
  await done(h, want.id);
});

test('book: offline asks nothing, and a title that already has its prices is not asked', () => {
  const h = harness({ online: false });
  h.book.want(want, 'preview');
  assert.equal(h.book.pending(), 0);
  assert.equal(h.sent.length, 0);
});

test('needsLookup: no entry, stale, failed within the hour, and a blocked row\'s title page', () => {
  const e = (extra) => ({ keys: '', ids: null, idsAt: 0, prices: [], pricedAt: T0, failedAt: 0, listBlocked: false, ...extra });
  assert.equal(bk.needsLookup(null, '', true, T0), true);
  assert.equal(bk.needsLookup(e(), '', true, T0 + 1000), false);
  assert.equal(bk.needsLookup(e(), '', true, T0 + p.PRICE_TTL), true);
  assert.equal(bk.needsLookup(e({ pricedAt: 0, failedAt: T0 }), '', true, T0 + 1000), false);
  assert.equal(bk.needsLookup(e({ pricedAt: 0, failedAt: T0, listBlocked: true }), '', true, T0 + 1000), true);
  assert.equal(bk.needsLookup(e({ pricedAt: 0, failedAt: T0, listBlocked: true }), '', false, T0 + 1000), false);
  assert.equal(bk.needsLookup(e(), 'w', true, T0 + 1000), true);
});
