// Movies and TV Shows' logic, run as TypeScript by Node (type stripping): the Sort orders (librarySort.ts), the
// filters (filterDefs.ts) and D-pad moves in the poster grid (shell/grid.ts). `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { recentRanks, sortName, sortTitles, SORTS } from '../app/src/screens/librarySort.ts';
import { activeCount, applyFilters, cycleFilter, defaultFilters, filterDefs, summary } from '../app/src/screens/filterDefs.ts';
import { gridMove } from '../app/src/shell/grid.ts';
import { TITLES } from '../app/src/data/catalog.ts';

const t = (id, name, year = 2000, score = 7) => ({ id, name, year, score, kind: 'movie', genres: [], offers: [], lists: [] });
const ids = (list) => list.map((x) => x.id);

test('A–Z ignores a leading The, A or An, accents, case and leading punctuation', () => {
  assert.equal(sortName('The Bear'), 'bear');
  assert.equal(sortName('An Education'), 'education');
  assert.equal(sortName('A'), 'a');
  assert.equal(sortName('Élite'), 'elite');
  assert.equal(sortName('"Weird" Al'), 'weird" al');
  assert.equal(sortName('¡Three Amigos!'), 'three amigos!');
  assert.equal(sortName('9-1-1'), '9-1-1');
  assert.equal(sortName('東京物語'), '東京物語');
  const sorted = sortTitles([t('c', 'The Crown'), t('b', 'Blue Planet'), t('a', 'Arrival'), t('e', 'Élite')], 'az');
  assert.deepEqual(ids(sorted), ['a', 'b', 'c', 'e']);
});

test('A–Z falls back to the full name, then the id, for names that compare the same', () => {
  // "The Thing" and "Thing" both compare as "thing"; then "The Thing" < "Thing" by full name; then by id.
  assert.deepEqual(ids(sortTitles([t('1', 'Thing'), t('2', 'The Thing'), t('0', 'Thing')], 'az')), ['2', '0', '1']);
});

test('newest and oldest put titles with no year last, in A–Z, and break ties by name', () => {
  const list = [t('x', 'Zed', 2020), t('n', 'No year', 0), t('a', 'Alpha', 2020), t('o', 'Old', 1990), t('m', 'Also no year', 0)];
  assert.deepEqual(ids(sortTitles(list, 'newest')), ['a', 'x', 'o', 'm', 'n']);
  assert.deepEqual(ids(sortTitles(list, 'oldest')), ['o', 'a', 'x', 'm', 'n']);
});

test('highest rated puts unscored titles last', () => {
  const list = [t('a', 'A', 2000, 7.1), t('b', 'B', 2000, 0), t('c', 'C', 2000, 8.4), t('d', 'D', 2000, 7.1)];
  assert.deepEqual(ids(sortTitles(list, 'rated')), ['c', 'a', 'd', 'b']);
});

test('recently added: each list’s last title first, the earlier chip first, a title on two lists takes its better place', () => {
  const ranks = recentRanks([
    ['m1', 'm2', 'm3'],
    ['h1', 'm2', 'h2'],
  ]);
  // Last of each list (m3, h2), then second-to-last (m2 from both: its better place is rank 1 on either), then the rest.
  assert.deepEqual(Array.from(ranks.keys()), ['m3', 'h2', 'm2', 'm1', 'h1']);
  const list = [t('m1', 'Q'), t('x', 'Not on a list'), t('h2', 'R'), t('m3', 'S')];
  assert.deepEqual(ids(sortTitles(list, 'recent', ranks)), ['m3', 'h2', 'm1', 'x']);
  assert.deepEqual(ids(sortTitles(list, 'recent')), ['x', 'm1', 'h2', 'm3'], 'with no ranks it is A–Z');
});

test('sorting leaves the input as it was', () => {
  const list = [t('b', 'B'), t('a', 'A')];
  sortTitles(list, 'az');
  assert.deepEqual(ids(list), ['b', 'a']);
  assert.equal(SORTS[0].id, 'az');
});

const facts = (seen = []) => ({
  isSeen: (id) => seen.includes(id),
  included: (x) => x.offers.some((o) => o.type === 'sub' || o.type === 'free'),
  rentable: (x) => x.offers.some((o) => o.type === 'rent'),
});

test('Movies have a Length filter and movie-only genres; TV Shows don’t', () => {
  const movies = filterDefs('movie', facts());
  const shows = filterDefs('show', facts());
  assert.deepEqual(movies.map((d) => d.id), ['availability', 'score', 'genre', 'runtime', 'watch']);
  assert.deepEqual(shows.map((d) => d.id), ['availability', 'score', 'genre', 'watch']);
  const genre = (defs) => defs.filter((d) => d.id === 'genre')[0].options;
  assert.ok(genre(movies).includes('Horror'));
  assert.ok(!genre(shows).includes('Horror'));
  assert.equal(genre(shows)[0], 'All genres');
});

test('filters combine, count and summarise; no filter keeps everything', () => {
  const defs = filterDefs('movie', facts(['arrival']));
  const movies = TITLES.filter((x) => x.kind === 'movie');
  const state = defaultFilters();
  assert.equal(applyFilters(defs, state, movies).length, movies.length);
  assert.equal(activeCount(defs, state), 0);
  assert.equal(summary(defs, state), '');

  state.score = 2; // 8.0 and above
  state.runtime = 2; // under 2 hours
  const shown = applyFilters(defs, state, movies);
  assert.ok(shown.length > 0);
  assert.ok(shown.every((x) => x.score >= 8 && x.runtime < 120));
  assert.equal(activeCount(defs, state), 2);
  assert.equal(summary(defs, state), 'Review 8.0+ · Under 2h');

  state.score = 0;
  state.runtime = 0;
  state.watch = 2; // seen only
  assert.deepEqual(ids(applyFilters(defs, state, movies)), ['arrival']);
  state.watch = 1; // unwatched only
  assert.ok(!ids(applyFilters(defs, state, movies)).includes('arrival'));
});

test('availability: included only, or included plus rentals', () => {
  const defs = filterDefs('movie', facts());
  const sub = { ...t('s', 'S'), offers: [{ service: 'netflix', type: 'sub' }] };
  const rent = { ...t('r', 'R'), offers: [{ service: 'appletv', type: 'rent' }] };
  const buy = { ...t('b', 'B'), offers: [{ service: 'appletv', type: 'buy' }] };
  assert.deepEqual(ids(applyFilters(defs, { availability: 1 }, [sub, rent, buy])), ['s']);
  assert.deepEqual(ids(applyFilters(defs, { availability: 2 }, [sub, rent, buy])), ['s', 'r']);
});

test('← and → step a filter round its options', () => {
  const def = filterDefs('show', facts()).filter((d) => d.id === 'score')[0];
  const state = {};
  cycleFilter(def, state, -1);
  assert.equal(state.score, 2);
  cycleFilter(def, state, 1);
  assert.equal(state.score, 0);
});

test('grid moves: rows of eight, no wrapping, a short last row, leaving at the edges', () => {
  // 20 items, 8 to a row: rows 0–7, 8–15, 16–19.
  assert.equal(gridMove(0, 20, 8, 'right'), 1);
  assert.equal(gridMove(7, 20, 8, 'right'), null, 'no wrap at a row’s end');
  assert.equal(gridMove(8, 20, 8, 'left'), null, 'no wrap at a row’s start');
  assert.equal(gridMove(19, 20, 8, 'right'), null, 'the last item');
  assert.equal(gridMove(3, 20, 8, 'up'), null, 'Up from the first row leaves the grid');
  assert.equal(gridMove(11, 20, 8, 'up'), 3);
  assert.equal(gridMove(3, 20, 8, 'down'), 11);
  assert.equal(gridMove(14, 20, 8, 'down'), 19, 'Down onto a shorter row lands on its last item');
  assert.equal(gridMove(10, 20, 8, 'down'), 18);
  assert.equal(gridMove(18, 20, 8, 'down'), null, 'Down from the last row');
  assert.equal(gridMove(0, 1, 8, 'down'), null);
  assert.equal(gridMove(0, 0, 8, 'down'), null, 'an empty grid');
  assert.equal(gridMove(5, 6, 6, 'down'), null, 'one full row');
});
