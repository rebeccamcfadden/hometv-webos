// Search's rules (app/src/screens/searchModel.ts) on the mock catalogue: what a query finds, the filter chips, a genre
// typed in full, and offline with only the saved titles.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './ts-module.mjs';

const m = await loadTs('screens/searchModel.ts');
const labels = (hits) => hits.map((x) => x.label);
const find = (q, filter = 'all') => {
  const out = m.runSearch(q, false, new Set());
  return { ...out, items: out.res ? m.resultItems(out.res, filter, q) : [] };
};

test('an empty query finds nothing and shows the browse page', () => {
  const r = find('');
  assert.equal(r.res, null);
  assert.equal(r.hasMatches, false);
});

test('a few letters in order find the title, best first (arvl → Arrival)', () => {
  const r = find('arvl');
  assert.equal(r.hasMatches, true);
  assert.equal(r.items[0].label, 'Arrival');
  assert.equal(r.res.suggestions[0].label, 'Arrival');
});

test('a typo still finds the title', () => {
  assert.equal(find('arrivsl').items[0].label, 'Arrival');
});

test('the filter chips keep movies, shows or people', () => {
  const all = find('amy');
  assert.ok(all.items.some((x) => x.kind === 'person') && all.items.some((x) => x.kind === 'title'));
  assert.ok(find('amy', 'person').items.every((x) => x.kind === 'person'));
  assert.ok(find('a', 'movie').items.every((x) => x.kind === 'title' && x.title.kind === 'movie'));
  assert.ok(find('a', 'show').items.every((x) => x.kind === 'title' && x.title.kind === 'show'));
  assert.ok(find('a', 'show').items.length > 0);
});

test('Included only keeps titles on the household’s services (one region: Sweden’s first ticks)', () => {
  const inc = labels(find('a', 'included').items);
  assert.ok(inc.includes('Arrival'), 'Prime Video is ticked');
  const moon = labels(find('moon', 'included').items);
  assert.ok(labels(find('moon').items).includes('Moon'));
  assert.ok(!moon.includes('Moon'), 'Moon is rent only');
  assert.ok(moon.includes('Killers of the Flower Moon'), 'on Apple TV, ticked');
  assert.ok(labels(find('the arrival').items).includes('The Arrival'));
  assert.ok(!labels(find('the arrival', 'included').items).includes('The Arrival'), 'rent only, in a store with no price');
});

test('a genre typed in full lists its titles first, and counts as a match', () => {
  const r = find('sci-fi');
  assert.equal(r.res.titles.length, 0);
  assert.equal(r.hasMatches, true);
  assert.ok(r.items.length > 5);
  assert.ok(r.items.every((x) => x.kind === 'title' && x.title.genres.includes('Sci-fi')));
  for (const g of m.BROWSE_GENRES) assert.equal(find(g.toLowerCase()).hasMatches, true, g);
});

test('a genre’s titles come before titles named like the query only when the query is the genre’s name', () => {
  // A title matched by name and a genre that matched well, as one search could return them.
  const named = m.runSearch('knives', false, new Set()).res.titles[0];
  const genre = m.runSearch('sci-fi', false, new Set()).res.genres[0];
  assert.equal(named.label, 'Knives Out');
  const res = { titles: [named], people: [], genres: [genre], suggestions: [] };
  const exact = m.resultItems(res, 'all', 'Sci-fi ');
  assert.notEqual(exact[0].label, 'Knives Out');
  assert.equal(exact[exact.length - 1].label, 'Knives Out');
  const partial = m.resultItems(res, 'all', 'sci');
  assert.equal(partial[0].label, 'Knives Out');
  assert.equal(partial.length, exact.length);
});

test('titles named like the query come before a genre that matched less well', () => {
  const r = find('sci');
  const firstGenreOnly = r.items.findIndex((x) => x.match.indices.length === 0);
  const named = r.items.findIndex((x) => x.kind === 'title' && x.match.indices.length > 0);
  assert.ok(named >= 0 && (firstGenreOnly < 0 || named < firstGenreOnly));
});

test('nothing matches a query of letters no title, person or genre has', () => {
  const r = find('zzzz');
  assert.equal(r.hasMatches, false);
  assert.deepEqual(r.items, []);
});

test('offline, only saved titles are found: no people, no genres', () => {
  const saved = m.savedIds(['arrival'], ['dune']);
  assert.ok(saved.has('arrival') && saved.has('dune'));
  const r = m.runSearch('ar', true, saved);
  assert.ok(r.res.titles.every((x) => saved.has(x.title.id)));
  assert.ok(labels(r.res.titles).includes('Arrival'));
  assert.deepEqual(r.res.people, []);
  assert.deepEqual(r.res.genres, []);
  assert.ok(r.res.suggestions.every((x) => x.kind === 'title' && saved.has(x.title.id)));
  assert.equal(m.runSearch('ar', true, new Set()).hasMatches, false);
});

test('the household lists count as saved (the mock Household and Friends)', () => {
  const saved = m.savedIds([], []);
  assert.ok(saved.size > 0);
});

test('typing is tidied: no leading spaces, no double spaces', () => {
  assert.equal(m.tidyQuery('  dune  part'), 'dune part');
  assert.ok(m.TYPEABLE.test('a') && m.TYPEABLE.test('7') && m.TYPEABLE.test(' '));
  assert.ok(!m.TYPEABLE.test('é') && !m.TYPEABLE.test('Enter'));
});

test('the on-screen keyboard has every letter and digit once', () => {
  const keys = m.KEY_ROWS.join('');
  assert.equal(keys.length, 36);
  for (const c of 'abcdefghijklmnopqrstuvwxyz0123456789') assert.equal(keys.split(c).length - 1, 1, c);
});
