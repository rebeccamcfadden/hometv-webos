// Search's rules (app/src/screens/searchModel.ts): what a query finds in TMDB's answer, the filter chips, a genre typed
// in full, and offline with only the saved titles. The answers are made up here in TMDB's shape; no network.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './ts-module.mjs';
import { TITLES } from './fixtures/sample-catalog.ts';

const m = await loadTs('screens/searchModel.ts');
const labels = (hits) => hits.map((x) => x.label);
const title = (name) => TITLES.filter((t) => t.name === name)[0];
const by = (names) => names.map(title);

// What TMDB would answer for a query: the titles and people it found, in its order.
const found = (names, people = []) => ({ titles: by(names), people, extra: [] });
const person = (name, id, known = []) => ({ id, name, role: '', photo: '/p.jpg', known });
const noGenre = () => [];

const run = (query, answer, genre = noGenre) => m.runSearch(query, { found: answer, saved: [], genre });
const items = (out, query, filter = 'all', genre = noGenre) => (out.res ? m.resultItems(out.res, filter, query, genre) : []);

test('an empty query finds nothing and shows the browse page', () => {
  const out = run('', found(['Arrival']));
  assert.equal(out.res, null);
  assert.equal(out.hasMatches, false);
});

test('online, the results are TMDB’s titles in TMDB’s order, with the query’s letters marked', () => {
  const out = run('arvl', found(['Moon', 'Arrival']));
  assert.equal(out.hasMatches, true);
  assert.deepEqual(labels(items(out, 'arvl')), ['Moon', 'Arrival']);
  const arrival = items(out, 'arvl')[1];
  assert.equal(arrival.tag, 'Movie');
  assert.ok(arrival.match.indices.length > 0, 'the matching letters are marked');
  assert.equal(items(out, 'arvl')[0].match.indices.length, 0, 'a name that does not match the letters is left plain');
  assert.equal(out.res.suggestions[0].label, 'Moon');
});

test('people carry TMDB’s id and photo, and a Person tag', () => {
  const out = run('amy', found(['Arrival'], [person('Amy Adams', 9273, ['Arrival'])]));
  const p = items(out, 'amy').filter((x) => x.kind === 'person')[0];
  assert.equal(p.label, 'Amy Adams');
  assert.equal(p.person, 9273);
  assert.equal(p.photo, '/p.jpg');
  assert.equal(p.tag, 'Person');
  assert.deepEqual(p.titles.map((t) => t.name), ['Arrival']);
});

test('the filter chips keep movies, shows or people', () => {
  const out = run('a', found(['Arrival', 'Severance', 'Moon'], [person('Amy Adams', 1)]));
  assert.ok(items(out, 'a', 'person').every((x) => x.kind === 'person') && items(out, 'a', 'person').length === 1);
  assert.deepEqual(labels(items(out, 'a', 'movie')), ['Arrival', 'Moon']);
  assert.deepEqual(labels(items(out, 'a', 'show')), ['Severance']);
  assert.equal(items(out, 'a', 'all').length, 4);
  assert.equal(m.filterLabel('show'), 'TV shows');
});

test('a genre typed in full lists its titles first, from the genre’s popular titles, and counts as a match', () => {
  const popular = by(['Arrival', 'Moon']);
  const genre = (name) => (name === 'Sci-fi' ? popular : []);
  const out = run('sci-fi', found([]), genre);
  assert.equal(out.res.titles.length, 0);
  assert.equal(out.hasMatches, true);
  assert.deepEqual(labels(items(out, 'sci-fi', 'all', genre)), ['Arrival', 'Moon']);
  for (const g of m.BROWSE_GENRES) assert.equal(run(g.toLowerCase(), found([]), () => popular).hasMatches, true, g);
});

test('a genre with no titles arrived yet is not a match (the answer is still on its way)', () => {
  assert.equal(run('sci-fi', found([]), noGenre).hasMatches, false);
});

test('a genre’s titles come before titles named like the query only when the query is the genre’s name', () => {
  const genre = () => by(['Arrival', 'Moon']);
  const out = run('sci-fi', found(['Knives Out']), genre);
  assert.equal(items(out, 'sci-fi ', 'all', genre)[0].label !== 'Knives Out', true);
  assert.equal(items(out, 'Sci-fi ', 'all', genre).pop().kind, 'title');
  const partial = run('sci', found(['Knives Out']), genre);
  assert.equal(items(partial, 'sci', 'all', genre)[0].label, 'Knives Out');
});

test('a title TMDB already returned is not listed twice under its genre', () => {
  const genre = () => by(['Arrival', 'Moon']);
  const out = run('sci-fi', found(['Moon']), genre);
  assert.deepEqual(labels(items(out, 'sci-fi', 'all', genre)).sort(), ['Arrival', 'Moon']);
});

test('nothing matches when TMDB found nothing and the query is no genre', () => {
  const out = run('zzzz', found([]));
  assert.equal(out.hasMatches, false);
  assert.deepEqual(items(out, 'zzzz'), []);
});

test('offline, or with no answer, only the saved titles are found: no people, no genres', () => {
  const saved = by(['Arrival', 'Dune: Part Two']);
  const out = m.runSearch('arr', { found: null, saved, genre: noGenre });
  assert.deepEqual(labels(out.res.titles), ['Arrival']);
  assert.deepEqual(out.res.people, []);
  assert.deepEqual(out.res.genres, []);
  assert.ok(out.res.suggestions.every((x) => x.kind === 'title'));
  assert.equal(out.hasMatches, true);
  assert.equal(m.runSearch('arr', { found: null, saved: [], genre: noGenre }).hasMatches, false);
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
