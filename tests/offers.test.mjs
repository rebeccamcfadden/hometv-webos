// The offers on Samsung's one-region path (decided 2026-11-04): app/src/data/offers.ts with the Samsung
// settings stand-in (Sweden, design_preview's first ticks), as Search, the title page, its rent dialog and the cards
// use them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './ts-module.mjs';

// One bundle, so the offers read the same settings the test changes.
const { o, s, c, rent } = await loadTs({ o: 'data/offers.ts', s: 'data/settings.ts', c: '../../tests/fixtures/sample-catalog.ts', rent: 'screens/rentRules.ts' });
const t = c.getTitle;
test.afterEach(() => s.settings.reset());

test('one region: Sweden’s services and stores, in kronor', () => {
  assert.equal(s.currency(), 'kr');
  const ids = s.pickServices().map((x) => x.id);
  assert.ok(ids.includes('svtplay') && !ids.includes('hulu'), 'Sweden’s list, not the US one');
  assert.deepEqual(
    s.pickStores().map((x) => x.id),
    ['appletv', 'amazonvideo', 'viaplaystore', 'sfanytime', 'rakuten'],
  );
  assert.deepEqual(s.settings.get().services, ['netflix', 'prime', 'disney', 'max', 'appletvplus', 'viaplay', 'svtplay', 'tv4play']);
});

test('the card line and pill offer: included first, else the cheapest rental across the stores', () => {
  assert.equal(o.cardLine(t('arrival')), 'Prime Video · Included');
  assert.equal(o.cardLine(t('microcosmos')), 'YouTube · Free');
  assert.equal(o.cardLine(t('moon')), 'Rent from 39 kr · 4 stores');
  assert.equal(o.cardLine(t('daredevil')), 'Buy a season from 199 kr · 2 stores');
  assert.equal(o.cardLine(t('harvey-girls')), 'Apple TV Store · Rent 29 kr');
  assert.equal(o.cardOffer(t('moon')).service, 'sfanytime');
  assert.equal(o.availability(o.cardOffer(t('arrival'))), 'Included');
  assert.equal(o.availability(o.cardOffer(t('moon'))), 'Rent 39 kr');
  assert.equal(o.availability(undefined), '');
});

test('the Watch button’s offer and label', () => {
  assert.equal(o.bestOffer(t('dune')).service, 'max');
  assert.equal(o.paidAction(o.bestOffer(t('moon'))), 'Rent on SF Anytime · 39 kr');
  assert.equal(o.isOwnIncluded(t('moon')), false);
  assert.equal(o.isOwnIncluded(t('arrival')), true);
});

test('a service not ticked is no longer Included', () => {
  s.settings.set({ services: ['netflix'] });
  assert.equal(o.isOwnIncluded(t('arrival')), false);
  assert.notEqual(o.cardLine(t('arrival')), 'Prime Video · Included');
  assert.equal(o.isOwnIncluded(t('knives-out')), true);
});

test('a store not ticked leaves its prices out everywhere', () => {
  s.settings.set({ stores: ['appletv'] });
  assert.equal(o.cardLine(t('moon')), 'Apple TV Store · Rent from 49 kr');
  assert.deepEqual(
    o.offersByService(t('moon')).map((x) => x.service),
    ['appletv'],
  );
});

test('Where to watch: included services first, then the stores cheapest first, Cheapest tagged', () => {
  const list = o.offersByService(t('moon'));
  const rents = list.map((x) => (x.rent ? o.cheapest(x.rent) : undefined)).filter((r) => r !== undefined);
  assert.deepEqual(rents, rents.slice().sort((a, b) => a - b));
  assert.equal(o.cheapestStore(list), 'sfanytime');
  const apple = list.filter((x) => x.service === 'appletv')[0];
  assert.deepEqual(o.priceLines(apple), [
    { quality: 'HD', rent: 49, buy: 149 },
    { quality: '4K', rent: 59, buy: 179 },
  ]);
});

test('a store with no price reads Rent · Buy, and the credit names the price sources', () => {
  assert.equal(o.cardLine(t('the-arrival-1996')), 'Rakuten TV · Rent');
  assert.match(o.attribution(t('moon')), /^Availability: JustWatch · Prices: /);
  assert.equal(o.attribution(t('the-arrival-1996')), 'Availability: JustWatch');
});

test('Price lookup off: rent and buy still say where, without prices', () => {
  s.settings.set({ features: { tmdb: true, prices: false } });
  assert.equal(o.paidAction(o.bestOffer(t('moon'))), 'Rent on Apple TV Store');
  assert.doesNotMatch(o.cardLine(t('moon')), /kr/);
});

test('the rent dialog: the 4K note and a cheaper store named', () => {
  const apple = o.offersByService(t('moon')).filter((x) => x.service === 'appletv')[0];
  assert.equal(rent.fourKNote(apple), '4K costs 10–30 kr more here');
  assert.equal(rent.cheaperElsewhere(t('moon'), apple), ' SF Anytime has it for 39 kr (HD).');
  const sf = o.offersByService(t('moon')).filter((x) => x.service === 'sfanytime')[0];
  assert.equal(rent.cheaperElsewhere(t('moon'), sf), '');
});
