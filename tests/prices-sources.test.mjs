// The price sources' requests and answers (app/src/live/prices/): the URL and headers each source is asked with, and what a
// hand-written minimal answer maps to. No network, no keys.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './ts-module.mjs';

const { w, m, i, wd, mt, st, ty } = await loadTs({
  w: 'live/prices/watchmode.ts',
  m: 'live/prices/motn.ts',
  i: 'live/prices/itunes.ts',
  wd: 'live/prices/wikidata.ts',
  mt: 'live/prices/match.ts',
  st: 'live/prices/stores.ts',
  ty: 'live/prices/types.ts',
});

const SE = ty.REGIONS.SE;
const US = ty.REGIONS.US;
const movie = { tmdbId: 603, kind: 'movie', name: 'The Matrix', year: 1999, itunesIds: [] };
const show = { tmdbId: 1396, kind: 'show', name: 'Succession', year: 2018, itunesIds: [] };

test('the region follows the TMDB code, Sweden for anything else', () => {
  assert.equal(ty.regionFor('US').currency, 'USD');
  assert.equal(ty.regionFor('SE').country, 'se');
  assert.equal(ty.regionFor('DE').code, 'SE');
});

test('stores are matched by the names the sources use, and an unknown one is dropped', () => {
  assert.equal(st.storeForName('Apple iTunes'), 'appletv');
  assert.equal(st.storeForName('Google Play Movies & TV'), 'googletv');
  assert.equal(st.storeForName('Prime Video'), 'amazonvideo');
  assert.equal(st.storeForName('Vudu'), 'fandango');
  assert.equal(st.storeForName('Some Store'), null);
  assert.equal(st.storeForName(7), null);
});

test('Watchmode: asked by TMDB id and region, with the key in X-API-Key', () => {
  assert.equal(w.url(movie, SE), 'https://api.watchmode.com/v1/title/movie-603/sources/?regions=SE');
  assert.equal(w.url(show, US), 'https://api.watchmode.com/v1/title/tv-1396/sources/?regions=US');
  assert.deepEqual(w.headers(' k '), { 'X-API-Key': 'k' });
});

test('Watchmode: rent and buy prices in the region at known stores; the region\'s currency; HD when no format', () => {
  const text = JSON.stringify([
    { name: 'Apple TV', type: 'rent', region: 'SE', format: 'HD', price: 39 },
    { name: 'Apple TV', type: 'buy', region: 'SE', format: '4K', price: 99.5 },
    { name: 'Viaplay', type: 'rent', region: 'se', price: 29 },
    { name: 'Netflix', type: 'sub', region: 'SE' },
    { name: 'Google Play', type: 'buy', region: 'US', price: 10 },
    { name: 'Unknown Store', type: 'rent', region: 'SE', price: 5 },
    { name: 'YouTube', type: 'rent', region: 'SE', price: 0 },
  ]);
  const got = w.parse(text, SE);
  assert.deepEqual(
    got.map((p) => [p.store, p.type, p.quality, p.amount, p.currency, p.season, p.source]),
    [
      ['appletv', 'rent', 'HD', 39, 'SEK', 0, 'watchmode'],
      ['appletv', 'buy', '4K', 99.5, 'SEK', 0, 'watchmode'],
      ['viaplaystore', 'rent', 'HD', 29, 'SEK', 0, 'watchmode'],
    ],
  );
});

test('Watchmode: no answer or an empty list is no prices; text that is not JSON throws', () => {
  assert.deepEqual(w.parse(null, SE), []);
  assert.deepEqual(w.parse('[]', SE), []);
  assert.deepEqual(w.parse('{}', SE), []);
  assert.throws(() => w.parse('<html>', SE));
});

test('Movie of the Night: movie and show URLs (a show by season), key in X-API-Key', () => {
  assert.equal(m.url(movie, SE), 'https://api.movieofthenight.com/v4/shows/movie/603?country=se');
  assert.equal(m.url(show, US), 'https://api.movieofthenight.com/v4/shows/tv/1396?country=us&series_granularity=season');
  assert.deepEqual(m.headers('abc'), { 'X-API-Key': 'abc' });
});

test('Movie of the Night: options with prices, seasons numbered from their title, add-ons skipped', () => {
  const text = JSON.stringify({
    streamingOptions: {
      se: [
        { service: { id: 'apple', name: 'Apple TV' }, type: 'rent', quality: 'uhd', price: { amount: '49.00', currency: 'sek' } },
        { service: { id: 'prime', name: 'Prime Video' }, type: 'buy', price: { amount: '99', currency: 'SEK' } },
        { service: { id: 'netflix', name: 'Netflix' }, type: 'subscription' },
        { service: { id: 'viaplay', name: 'Viaplay' }, type: 'rent', price: { amount: '20', currency: 'SEK' }, addon: { id: 'x' } },
      ],
      us: [{ service: { id: 'prime', name: 'Prime Video' }, type: 'buy', price: { amount: '9.99', currency: 'USD' } }],
    },
    seasons: [
      { title: 'Season 2', streamingOptions: { se: [{ service: { id: 'x', name: 'Google Play' }, type: 'buy', quality: 'hd', price: { amount: '149', currency: 'SEK' } }] } },
      { title: 'Specials', streamingOptions: { se: [{ service: { id: 'x', name: 'YouTube' }, type: 'buy', price: { amount: '20', currency: 'SEK' } }] } },
    ],
  });
  const got = m.parse(text, SE).map((p) => [p.store, p.type, p.quality, p.amount, p.currency, p.season, p.source]);
  assert.deepEqual(got, [
    ['appletv', 'rent', '4K', 49, 'SEK', 0, 'streamingavailability'],
    ['amazonvideo', 'buy', 'HD', 99, 'SEK', 0, 'streamingavailability'],
    ['googletv', 'buy', 'HD', 149, 'SEK', 2, 'streamingavailability'],
    ['youtube', 'buy', 'HD', 20, 'SEK', 2, 'streamingavailability'],
  ]);
  assert.equal(m.parse(text, US).length, 1);
  assert.deepEqual(m.parse(null, SE), []);
  assert.throws(() => m.parse('nope', SE));
});

test('iTunes: a lookup by its ids (valid and once each), else a search by name', () => {
  assert.equal(i.lookupUrl(movie, SE), null);
  assert.equal(i.lookupUrl({ ...movie, itunesIds: ['123', '123', '0', 'abc', '45'] }, SE), 'https://itunes.apple.com/lookup?id=123,45&country=se');
  assert.equal(i.searchUrl(movie, SE), 'https://itunes.apple.com/search?term=The%20Matrix&country=se&media=movie&entity=movie&limit=10');
  assert.equal(i.searchUrl(show, US), 'https://itunes.apple.com/search?term=Succession&country=us&media=tvShow&entity=tvSeason&limit=25');
});

const feature = (over) => ({ kind: 'feature-movie', trackName: 'The Matrix', releaseDate: '1999-03-31T07:00:00Z', currency: 'SEK', trackRentalPrice: 29, trackHdRentalPrice: 39, trackPrice: 79, trackHdPrice: 99, ...over });

test('iTunes: a movie\'s rent and buy prices in SD and HD from the currency of the answer', () => {
  const got = i.parseMovies(JSON.stringify({ results: [feature()] }), movie, false);
  assert.deepEqual(
    got.map((p) => [p.store, p.type, p.quality, p.amount, p.currency, p.source]),
    [
      ['appletv', 'rent', 'SD', 29, 'SEK', 'itunes'],
      ['appletv', 'rent', 'HD', 39, 'SEK', 'itunes'],
      ['appletv', 'buy', 'SD', 79, 'SEK', 'itunes'],
      ['appletv', 'buy', 'HD', 99, 'SEK', 'itunes'],
    ],
  );
});

test('iTunes: the same year beats a year either side; another name or kind is no match, unless asked by id', () => {
  const near = feature({ trackName: 'The Matrix', releaseDate: '2000-01-01T00:00:00Z', trackHdPrice: 1 });
  const exact = feature({ releaseDate: '1999-03-31T07:00:00Z', trackHdPrice: 99 });
  const text = JSON.stringify({ results: [near, exact, feature({ kind: 'song' }), feature({ trackName: 'Other', trackHdPrice: 7 })] });
  assert.equal(i.parseMovies(text, movie, false).find((p) => p.type === 'buy' && p.quality === 'HD').amount, 99);
  assert.deepEqual(i.parseMovies(JSON.stringify({ results: [feature({ trackName: 'Matrix, The (Local)' })] }), movie, false), []);
  assert.equal(i.parseMovies(JSON.stringify({ results: [feature({ trackName: 'Matrix, The (Local)' })] }), movie, true).length, 4);
  assert.deepEqual(i.parseMovies(JSON.stringify({ results: [feature({ releaseDate: '2010-01-01T00:00:00Z' })] }), movie, true), []);
  assert.deepEqual(i.parseMovies(null, movie, false), []);
});

test('iTunes: a show\'s seasons are bought, matched by name and numbered from the collection name', () => {
  const season = (name, n, extra = {}) => ({ collectionType: 'TV Season', collectionName: name, releaseDate: `${2017 + n}-06-01T00:00:00Z`, currency: 'SEK', collectionPrice: 100 + n, collectionHdPrice: 150 + n, ...extra });
  const text = JSON.stringify({
    results: [season('Succession, Season 1', 1), season('Succession: Säsong 2', 2), season('Succession (Season 2)', 2, { collectionPrice: 1 }), season('Another Show, Season 1', 1), season('Succession', 1)],
  });
  const got = i.parseSeasons(text, show).map((p) => [p.type, p.quality, p.amount, p.season]);
  assert.deepEqual(got, [['buy', 'SD', 101, 1], ['buy', 'HD', 151, 1], ['buy', 'SD', 102, 2], ['buy', 'HD', 152, 2]]);
});

test('iTunes: ids first, the search only when they find nothing', async () => {
  const asked = [];
  const text = JSON.stringify({ results: [feature()] });
  const get = (answers) => async (url) => {
    asked.push(url);
    return answers.shift();
  };
  const withIds = { ...movie, itunesIds: ['12'] };
  asked.length = 0;
  assert.equal((await i.prices(withIds, SE, get([text]))).length, 4);
  assert.equal(asked.length, 1);
  asked.length = 0;
  assert.equal((await i.prices(withIds, SE, get([JSON.stringify({ results: [] }), text]))).length, 4);
  assert.deepEqual(asked.map((u) => u.split('?')[0].split('/').pop()), ['lookup', 'search']);
  asked.length = 0;
  await assert.rejects(i.prices(movie, SE, async () => { throw new Error('down'); }));
});

test('Wikidata: the query asks for the item with the TMDB id and its iTunes ids; the first row\'s ids are read', () => {
  assert.match(wd.query('movie', 603), /wdt:P4947 "603"/);
  assert.match(wd.query('movie', 603), /P6398/);
  assert.match(wd.query('show', 1396), /wdt:P4983 "1396"/);
  assert.match(wd.url('movie', 603), /^https:\/\/query\.wikidata\.org\/sparql\?format=json&query=/);
  const text = JSON.stringify({ results: { bindings: [{ item: { value: 'q1' }, P6398: { value: '111|222| ' } }] } });
  assert.deepEqual(wd.itunesIds(text, 'movie'), ['111', '222']);
  assert.deepEqual(wd.itunesIds(text, 'show'), []);
  assert.deepEqual(wd.itunesIds(JSON.stringify({ results: { bindings: [] } }), 'movie'), []);
  assert.deepEqual(wd.itunesIds(null, 'movie'), []);
  assert.throws(() => wd.itunesIds('x', 'movie'));
});

test('title matching: names are compared without accents, case, punctuation, a leading article or a year', () => {
  assert.equal(mt.normalise('The Lord of the Rings: The Return of the King (2003)'), 'lord of the rings the return of the king');
  assert.equal(mt.normalise('Amélie & Co.'), 'amelie and co');
  assert.equal(mt.sameName('Se7en', 'SE7EN'), true);
  assert.equal(mt.sameName('', ''), false);
  assert.deepEqual(mt.season('Succession - Säsong 3'), { show: 'Succession', season: 3 });
  assert.equal(mt.season('Succession'), null);
  assert.equal(mt.yearOf('2016-12-02T08:00:00Z'), 2016);
  assert.equal(mt.yearOf(undefined), 0);
});
