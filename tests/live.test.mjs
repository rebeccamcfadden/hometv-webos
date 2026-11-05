// The live catalogue (app/src/live/): TMDB's addresses and vocabularies, its answers mapped to the screens' titles
// (hand-written answers in tests/fixtures, the shapes TMDB sends; no key, no network), the answer cache with its
// time to live, stale answers offline and size cap, and the client's key, region and retry rules. `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadTs } from './ts-module.mjs';

const { t, p, c, k } = await loadTs({ t: 'live/tmdb.ts', p: 'live/parse.ts', c: 'live/cache.ts', k: 'live/client.ts' });
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8'));
const MOVIE = fixture('tmdb-movie.json');
const TV = fixture('tmdb-tv.json');
const SEARCH = fixture('tmdb-search.json');
const PERSON = fixture('tmdb-person.json');
const SEASON = fixture('tmdb-season.json');

// ---- Addresses ------------------------------------------------------------------------------------------------------

test('ids are TMDB\'s kind and number', () => {
  assert.equal(t.titleId('movie', 603), 'movie:603');
  assert.equal(t.titleId('show', 1396), 'tv:1396');
  assert.deepEqual(t.parseId('tv:1396'), { kind: 'show', n: 1396 });
  assert.equal(t.parseId('person:1'), null);
  assert.equal(t.parseId('movie:abc'), null);
});

test('requests are the launcher\'s endpoints, and never carry a key', () => {
  assert.equal(t.detailsReq('movie', 603).path, '/movie/603?append_to_response=credits,release_dates,videos,recommendations,similar,watch/providers&language=en-US');
  assert.equal(t.detailsReq('show', 1396).path, '/tv/1396?append_to_response=credits,content_ratings,videos,recommendations,similar,watch/providers&language=en-US');
  assert.equal(t.seasonReq(1396, 2).path, '/tv/1396/season/2?language=en-US');
  assert.equal(t.personReq(500).path, '/person/500?append_to_response=combined_credits&language=en-US');
  assert.equal(t.searchReq('  The Matrix ').path, '/search/multi?query=the%20matrix&include_adult=false&language=en-US&page=1');
  const [trending, popular, , now, air] = t.LISTS;
  assert.equal(t.listReq(popular, 'movie', 2, 'se').path, '/movie/popular?language=en-US&page=2&region=SE');
  assert.equal(t.listReq(trending, 'movie', 1, 'SE').path, '/trending/movie/week?language=en-US&page=1');
  assert.equal(t.listReq(popular, 'show', 1, 'SE').path, '/tv/popular?language=en-US&page=1');
  assert.equal(t.listReq(now, 'movie', 1, 'US').path, '/movie/now_playing?language=en-US&page=1&region=US');
  assert.equal(t.listReq(air, 'show', 1, 'US').path, '/tv/on_the_air?language=en-US&page=1');
});

test('Movies and TV Shows each get the rows that exist for them', () => {
  assert.deepEqual(t.listsFor('movie').map((l) => l.name), ['Trending', 'Popular', 'Top rated', 'Now playing']);
  assert.deepEqual(t.listsFor('show').map((l) => l.name), ['Trending', 'Popular', 'Top rated', 'On the air']);
});

test('images are small sizes on image.tmdb.org, and only for a path TMDB would send', () => {
  assert.equal(t.imageUrl('/abc.jpg', t.POSTER_SIZE), 'https://image.tmdb.org/t/p/w342/abc.jpg');
  assert.equal(t.imageUrl('/abc.jpg', t.BACKDROP_SIZE), 'https://image.tmdb.org/t/p/w780/abc.jpg');
  assert.equal(t.imageUrl(null, 'w342'), null);
  assert.equal(t.imageUrl('https://evil.example/x.jpg', 'w342'), null);
  assert.equal(t.imageUrl('/../x', 'w342'), null);
});

test('genres, ratings and services are the launcher\'s words', () => {
  assert.deepEqual(t.genreNames('show', [10765, 18, 10765, 5]), ['Sci-fi', 'Fantasy', 'Drama']);
  assert.deepEqual(t.genreNames('movie', [878, 12]), ['Sci-fi', 'Adventure']);
  assert.equal(t.tidyRating('pg 13'), 'PG-13');
  assert.equal(t.tidyRating('Not Rated'), 'NR');
  assert.equal(t.tidyRating('TV-Y7-FV'), 'TV-Y7');
  assert.equal(t.tidyRating('15'), '');
  assert.equal(t.serviceFor(76, 'flatrate'), 'viaplay');
  assert.equal(t.serviceFor(76, 'rent'), 'viaplaystore');
  assert.equal(t.serviceFor(123456, 'flatrate'), null);
  assert.equal(t.regionCode(null), 'SE');
  assert.equal(t.regionCode('us'), 'US');
});

// ---- Mapping --------------------------------------------------------------------------------------------------------

test('a movie\'s details become the screens\' Title', () => {
  const m = p.details(MOVIE, 'movie', 'SE');
  assert.equal(m.id, 'movie:603');
  assert.equal(m.kind, 'movie');
  assert.equal(m.name, 'The Fixture');
  assert.equal(m.year, 1999);
  assert.equal(m.runtime, 136);
  assert.equal(m.score, 8.3);
  assert.equal(m.rating, 'R');
  assert.deepEqual(m.genres, ['Action', 'Sci-fi']);
  assert.equal(m.art, '/bd603.jpg');
  assert.equal(m.poster, '/po603.jpg');
  assert.equal(m.trailer, 'official123');
  assert.equal(m.detailed, true);
  assert.deepEqual(m.cast.map((x) => [x.name, x.role, x.id]), [['Actor One', 'Hero', 6384], ['Actor Two', 'Actor', 2975]]);
  assert.deepEqual(m.crew.map((x) => [x.name, x.role]), [['Director One', 'Director'], ['Writer One', 'Writer']]);
  assert.deepEqual(m.similar, ['movie:604']);
});

test('where to watch is the region\'s providers, in priority order, without prices', () => {
  const se = p.details(MOVIE, 'movie', 'SE').offers;
  assert.deepEqual(se.map((o) => `${o.service}:${o.type}`), ['disney:sub', 'netflix:sub', 'youtube:free', 'viaplaystore:rent', 'appletv:rent', 'appletv:buy']);
  assert.ok(se.every((o) => o.prices === undefined));
  assert.deepEqual(p.details(MOVIE, 'movie', 'US').offers.map((o) => `${o.service}:${o.type}`), ['max:sub']);
  assert.deepEqual(p.details(MOVIE, 'movie', 'DE').offers, []);
});

test('a show\'s details have seasons without the specials, a runtime, its US rating and its creators', () => {
  const s = p.details(TV, 'show', 'SE');
  assert.equal(s.id, 'tv:1396');
  assert.equal(s.kind, 'show');
  assert.equal(s.name, 'The Series');
  assert.equal(s.year, 2008);
  assert.equal(s.rating, 'TV-MA');
  assert.equal(s.episodeRuntime, 46);
  assert.deepEqual(s.genres, ['Drama', 'Sci-fi', 'Fantasy']);
  assert.deepEqual(s.seasons.map((x) => [x.n, x.count, x.episodes.length]), [[1, 7, 0], [3, 13, 0]]);
  assert.deepEqual(s.next, { season: 1, episode: 1 });
  assert.deepEqual(s.crew.map((x) => [x.name, x.role]), [['Creator One', 'Creator']]);
  assert.equal(s.trailer, null);
  assert.deepEqual(s.similar, ['tv:1399']);
});

test('a season has its episodes, named and timed', () => {
  const s = p.season(SEASON, 45);
  assert.equal(s.n, 1);
  assert.deepEqual(s.episodes, [{ n: 1, name: 'Pilot', runtime: 58 }, { n: 2, name: 'Episode 2', runtime: 45 }, { n: 3, name: 'Third', runtime: 45 }]);
});

test('a list item keeps what a card shows; adult items, people and nameless items are not titles', () => {
  const x = p.summary({ id: 5, title: 'Card', release_date: '2020-02-02', genre_ids: [35], vote_average: 6.66, poster_path: '/p.jpg', backdrop_path: '/b.jpg', overview: 'o' }, 'movie');
  assert.deepEqual([x.id, x.name, x.year, x.genres, x.score, x.poster, x.art, x.synopsis, x.detailed], ['movie:5', 'Card', 2020, ['Comedy'], 6.7, '/p.jpg', '/b.jpg', 'o', false]);
  assert.equal(p.summary({ id: 6, title: 'A', adult: true }, 'movie'), null);
  assert.equal(p.summary({ id: 7, title: '' }, 'movie'), null);
  assert.equal(p.summary({ id: 8, media_type: 'person', name: 'P' }, 'movie'), null);
  assert.equal(p.summary({ id: 9, name: 'No kind' }, null), null);
  assert.equal(p.summary({ id: 10, title: 'Bad art', poster_path: 'javascript:x' }, 'movie').poster, null);
  assert.deepEqual(p.summaries([{ id: 1, title: 'A' }, { id: 1, title: 'A' }, { id: 2, title: 'B' }], 'movie').map((y) => y.id), ['movie:1', 'movie:2']);
});

test('nothing missing throws: an empty answer is an empty title', () => {
  const m = p.details({ id: 1 }, 'movie', 'SE');
  assert.equal(m.name, '');
  assert.deepEqual([m.genres, m.cast, m.crew, m.offers, m.similar], [[], [], [], [], []]);
  assert.deepEqual(p.listItems(null, 'movie'), []);
  assert.deepEqual(p.search({}), { titles: [], people: [], known: {} });
});

test('search keeps titles with artwork and people with a photo, and what each person is known for', () => {
  const f = p.search(SEARCH);
  assert.deepEqual(f.titles.map((x) => x.id), ['movie:11', 'tv:12']);
  assert.deepEqual(f.people.map((x) => [x.id, x.name, x.known]), [[500, 'Star Person', ['movie:21']]]);
  assert.deepEqual(f.known[500].map((x) => x.name), ['Known Film']);
});

test('a person\'s page lists their best-known titles, most voted first', () => {
  const r = p.credits(PERSON);
  assert.equal(r.person.name, 'Star Person');
  assert.equal(r.person.photo, '/p500.jpg');
  assert.deepEqual(r.titles.map((x) => x.id), ['movie:32', 'movie:35', 'movie:31']);
});

// ---- Cache ------------------------------------------------------------------------------------------------------------

const memory = () => {
  const data = {};
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, v) => { data[key] = String(v); },
    removeItem: (key) => { delete data[key]; },
  };
};
const clock = (start = 1000000) => {
  const c0 = { at: start, now: () => c0.at };
  return c0;
};

test('an answer is fresh for its time to live, then stale; it is still served', () => {
  const clk = clock();
  const cache = c.createCache(memory(), clk.now);
  cache.put('a', { n: 1 }, 1000);
  assert.deepEqual(cache.get('a'), { value: { n: 1 }, fresh: true });
  clk.at += 1000;
  assert.deepEqual(cache.get('a'), { value: { n: 1 }, fresh: false });
  clk.at += c.MAX_AGE;
  assert.equal(cache.get('a'), null);
});

test('the cache survives a restart: a new cache over the same storage sees the old answers', () => {
  const clk = clock();
  const store = memory();
  c.createCache(store, clk.now).put('a', [1, 2], 5000);
  assert.deepEqual(c.createCache(store, clk.now).get('a'), { value: [1, 2], fresh: true });
});

test('the size cap drops the oldest answers first', () => {
  const clk = clock();
  const store = memory();
  const cache = c.createCache(store, clk.now, 300);
  for (const key of ['a', 'b', 'c', 'd']) {
    cache.put(key, 'x'.repeat(80), 1e6);
    clk.at += 10;
  }
  assert.equal(cache.get('a'), null);
  assert.ok(cache.get('d'));
  assert.ok(cache.size() <= 300);
  cache.put('huge', 'y'.repeat(400), 1e6);
  assert.equal(cache.get('huge'), null);
});

test('a full browser store makes room instead of failing', () => {
  const clk = clock();
  const store = memory();
  const real = store.setItem;
  let full = true;
  store.setItem = (key, v) => {
    if (full && Object.keys(store.data).length >= 3) { full = false; throw new Error('QuotaExceededError'); }
    real(key, v);
  };
  const cache = c.createCache(store, clk.now);
  for (const key of ['a', 'b', 'c']) cache.put(key, key, 1e6);
  assert.deepEqual(cache.get('c').value, 'c');
});

test('broken saved data is ignored, and no storage means no cache but no error', () => {
  const store = memory();
  store.data['hometv-live-v1:index'] = '{not json';
  const cache = c.createCache(store, () => 1);
  assert.equal(cache.get('a'), null);
  cache.put('a', 1, 10);
  store.data['hometv-live-v1:a'] = '{broken';
  assert.equal(cache.get('a'), null);
  const none = c.createCache(null, () => 1);
  none.put('a', 1, 10);
  assert.equal(none.get('a'), null);
});

// ---- Client -----------------------------------------------------------------------------------------------------------

const rig = (answers = {}, over = {}) => {
  const log = [];
  const clk = clock();
  const state = { key: 'aaa.bbb.ccc', region: 'SE', online: true, body: null, ...over };
  const deps = {
    get: async (url, headers) => {
      log.push({ url, headers });
      const hit = Object.keys(answers).find((a) => url.indexOf(a) >= 0);
      return state.body !== null ? state.body : hit ? JSON.stringify(answers[hit]) : null;
    },
    key: () => state.key,
    region: () => state.region,
    online: () => state.online,
    now: clk.now,
    cache: c.createCache(memory(), clk.now),
  };
  return { client: k.createClient(deps), log, clk, state, deps };
};

test('a v4 token goes in the Authorization header, a v3 key in api_key, and neither in the cache', async () => {
  const a = rig({ '/movie/603': MOVIE });
  await a.client.details('movie:603');
  assert.equal(a.log[0].url, `https://api.themoviedb.org/3${t.detailsReq('movie', 603).path}`);
  assert.deepEqual(a.log[0].headers, { Authorization: 'Bearer aaa.bbb.ccc' });
  const b = rig({ '/movie/603': MOVIE }, { key: 'v3keyv3key' });
  await b.client.details('movie:603');
  assert.ok(b.log[0].url.endsWith('&api_key=v3keyv3key'));
  assert.deepEqual(b.log[0].headers, {});
  assert.ok(!JSON.stringify(b.deps.cache.get(`SE|${t.detailsReq('movie', 603).path}`)).includes('v3keyv3key'));
});

test('a fresh answer is not asked for again; a stale one is asked again', async () => {
  const a = rig({ '/movie/603': MOVIE });
  const first = await a.client.details('movie:603');
  assert.equal(first.status, 'ok');
  assert.equal(first.value.name, 'The Fixture');
  await a.client.details('movie:603');
  assert.equal(a.log.length, 1);
  a.clk.at += t.TTL.title + 1;
  await a.client.details('movie:603');
  assert.equal(a.log.length, 2);
});

test('the region is part of a title\'s answer: another region asks again', async () => {
  const a = rig({ '/movie/603': MOVIE });
  const se = await a.client.details('movie:603');
  a.state.region = 'US';
  const us = await a.client.details('movie:603');
  assert.equal(a.log.length, 2);
  assert.notDeepEqual(se.value.offers, us.value.offers);
});

test('offline, the last answer shows as stale and nothing is asked', async () => {
  const a = rig({ '/movie/603': MOVIE });
  await a.client.details('movie:603');
  a.clk.at += t.TTL.title + 1;
  a.state.online = false;
  const r = await a.client.details('movie:603');
  assert.equal(r.status, 'stale');
  assert.equal(r.value.name, 'The Fixture');
  assert.equal(a.log.length, 1);
  assert.deepEqual(await a.client.details('movie:1'), { value: null, status: 'offline' });
});

test('forgetFailures lets a failed address be asked again at once', async () => {
  const a = rig({ '/movie/603': MOVIE });
  a.state.body = 'not json';
  assert.equal((await a.client.details('movie:603')).status, 'error');
  assert.equal((await a.client.details('movie:603')).status, 'error');
  assert.equal(a.log.length, 1);
  a.client.forgetFailures();
  a.state.body = null;
  assert.equal((await a.client.details('movie:603')).status, 'ok');
  assert.equal(a.log.length, 2);
});

test('a failed request gives the stale answer, and is not retried for a minute', async () => {
  const a = rig({ '/movie/603': MOVIE });
  await a.client.details('movie:603');
  a.clk.at += t.TTL.title + 1;
  a.state.body = 'not json';
  const r = await a.client.details('movie:603');
  assert.equal(r.status, 'stale');
  assert.equal(a.log.length, 2);
  await a.client.details('movie:603');
  assert.equal(a.log.length, 2);
  a.clk.at += k.RETRY_AFTER;
  a.state.body = null;
  await a.client.details('movie:603');
  assert.equal(a.log.length, 3);
  const none = await a.client.details('movie:9');
  assert.deepEqual(none, { value: null, status: 'error' });
});

test('without a key nothing is asked, and the cached catalogue still shows', async () => {
  const a = rig({ '/movie/603': MOVIE });
  await a.client.details('movie:603');
  a.clk.at += t.TTL.title + 1;
  a.state.key = '';
  assert.equal((await a.client.details('movie:603')).status, 'stale');
  assert.deepEqual(await a.client.details('movie:1'), { value: null, status: 'nokey' });
  assert.equal(a.log.length, 1);
});

test('lists, seasons, people and search come back mapped', async () => {
  const a = rig({
    '/movie/popular': { results: [{ id: 1, title: 'One', poster_path: '/1.jpg' }] },
    '/season/1': SEASON,
    '/person/500': PERSON,
    '/search/multi': SEARCH,
  });
  const popular = t.LISTS[1];
  assert.deepEqual((await a.client.list('movie', popular, 1)).value.map((x) => x.id), ['movie:1']);
  assert.equal((await a.client.season('tv:1396', 1, 45)).value.episodes.length, 3);
  assert.equal((await a.client.person(500)).value.titles.length, 3);
  const s = (await a.client.search('Star')).value;
  assert.deepEqual([s.titles.length, s.people.length, s.extra.map((x) => x.id)], [2, 1, ['movie:21']]);
  assert.deepEqual(await a.client.season('movie:603', 1, 0), { value: null, status: 'error' });
  assert.equal(a.log.length, 4);
});

test('an empty search asks nothing', async () => {
  const a = rig();
  assert.deepEqual((await a.client.search('   ')).value, { titles: [], people: [], extra: [] });
  assert.equal(a.log.length, 0);
});

test('a genre is discovered by its id: well voted, popular first, the region for movies only', () => {
  assert.equal(t.genreId('movie', 'Sci-fi'), 878);
  assert.equal(t.genreId('show', 'Sci-fi'), 10765, 'TV’s combined Sci-Fi & Fantasy');
  assert.equal(t.genreId('movie', 'Soap'), null);
  const m = t.discoverReq('movie', 878, 'se').path;
  assert.equal(m, '/discover/movie?with_genres=878&sort_by=popularity.desc&vote_count.gte=200&include_adult=false&language=en-US&region=SE&page=1');
  assert.ok(!t.discoverReq('show', 10765, 'se').path.includes('region='));
  assert.ok(!/api_key|Bearer/.test(m));
});

