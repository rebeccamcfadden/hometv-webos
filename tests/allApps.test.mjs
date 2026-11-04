// All apps' logic, run as TypeScript by Node: Home's row as All apps changes it (homeRow.ts, localStorage
// `hometv-home-row`) and the TV Utilities folder's rule and hand moves (tvUtilities.ts). The service's full app list and
// opening an app by id are in service.test.mjs. `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { HOME_ROW_KEY, loadRow, onRow, saveRow, toggleOnRow } from '../app/src/homeRow.ts';
import { isTvUtility, loadMoves, moveApp, saveMoves, UTILITY_MOVES_KEY } from '../app/src/tvUtilities.ts';

/** localStorage's two calls, over a Map. */
const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), raw: m };
};
const DEFAULT = [
  { id: 'netflix', name: 'Netflix' },
  { id: 'youtube', name: 'YouTube' },
];

test('the row is the default until All apps changes it, then what was saved', () => {
  const s = memory();
  assert.deepEqual(loadRow(s, DEFAULT, 7), DEFAULT);
  const row = toggleOnRow(loadRow(s, DEFAULT, 7), { id: 'app:FakeTwtch1.Twitch', name: 'Twitch' }, 7);
  assert.equal(row.result, 'added');
  saveRow(s, row.row);
  assert.deepEqual(JSON.parse(s.raw.get(HOME_ROW_KEY)), DEFAULT.concat([{ id: 'app:FakeTwtch1.Twitch', name: 'Twitch' }]));
  assert.deepEqual(
    loadRow(s, DEFAULT, 7).map((e) => e.id),
    ['netflix', 'youtube', 'app:FakeTwtch1.Twitch'],
  );
});

test('Remove from Home takes it off; an empty row stays empty', () => {
  const s = memory();
  let row = toggleOnRow(DEFAULT, { id: 'netflix', name: 'Netflix' }, 7);
  assert.equal(row.result, 'removed');
  row = toggleOnRow(row.row, { id: 'youtube', name: 'YouTube' }, 7);
  saveRow(s, row.row);
  assert.deepEqual(loadRow(s, DEFAULT, 7), []);
  assert.equal(onRow(DEFAULT, 'youtube'), true);
  assert.equal(onRow(row.row, 'youtube'), false);
});

test('a full row refuses another app and keeps its order', () => {
  const full = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ id: `app:${n}`, name: `App ${n}` }));
  const r = toggleOnRow(full, { id: 'app:8', name: 'App 8' }, 7);
  assert.equal(r.result, 'full');
  assert.equal(r.row, full);
});

test('a broken or odd saved row falls back to the default, drops bad entries and repeats, and is cut to size', () => {
  const s = memory();
  s.setItem(HOME_ROW_KEY, '{not json');
  assert.deepEqual(loadRow(s, DEFAULT, 7), DEFAULT);
  s.setItem(HOME_ROW_KEY, JSON.stringify({ apps: [] }));
  assert.deepEqual(loadRow(s, DEFAULT, 7), DEFAULT);
  s.setItem(HOME_ROW_KEY, JSON.stringify([{ id: 'a', name: 'A' }, { id: 'a', name: 'A again' }, { id: 3 }, null, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }]));
  assert.deepEqual(loadRow(s, DEFAULT, 2), [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
  ]);
  assert.deepEqual(loadRow(null, DEFAULT, 7), DEFAULT, 'no storage at all');
  const throwing = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };
  assert.deepEqual(loadRow(throwing, DEFAULT, 7), DEFAULT);
  assert.doesNotThrow(() => saveRow(throwing, DEFAULT));
});

test('TV Utilities: Samsung’s own apps go in, watch apps and the household’s apps stay out', () => {
  assert.equal(isTvUtility({ name: 'SmartThings', watch: false }), true);
  assert.equal(isTvUtility({ name: 'Gallery', watch: false }), true);
  assert.equal(isTvUtility({ name: 'Samsung Health', watch: false }), true);
  assert.equal(isTvUtility({ name: 'Internet', watch: false }), true);
  assert.equal(isTvUtility({ name: 'Samsung TV Plus', watch: false }), false, 'a watch app the TV came with');
  assert.equal(isTvUtility({ name: 'Netflix', watch: true }), false);
  assert.equal(isTvUtility({ name: 'Twitch', watch: false }), false);
  assert.equal(isTvUtility({ name: 'Kodi', watch: false }), false);
  assert.equal(isTvUtility({ name: 'TizenBrew', watch: false }), false);
});

test('a hand move wins, and only a move against the rule is kept', () => {
  const s = memory();
  let moves = loadMoves(s);
  assert.deepEqual(moves, {});
  moves = moveApp(moves, 'tw', { name: 'Twitch', watch: false }, 'in');
  moves = moveApp(moves, 'st', { name: 'SmartThings', watch: false }, 'out');
  assert.deepEqual(moves, { tw: 'in', st: 'out' });
  assert.equal(isTvUtility({ name: 'Twitch', watch: false, moved: moves.tw }), true);
  assert.equal(isTvUtility({ name: 'SmartThings', watch: false, moved: moves.st }), false);
  // Moved back where the rule puts it: the rule again, nothing kept.
  moves = moveApp(moves, 'tw', { name: 'Twitch', watch: false }, 'out');
  assert.deepEqual(moves, { st: 'out' });
  saveMoves(s, moves);
  assert.deepEqual(JSON.parse(s.raw.get(UTILITY_MOVES_KEY)), { st: 'out' });
  assert.deepEqual(loadMoves(s), { st: 'out' });
  s.setItem(UTILITY_MOVES_KEY, JSON.stringify({ a: 'in', b: 'sideways', c: 3 }));
  assert.deepEqual(loadMoves(s), { a: 'in' }, 'odd values are dropped');
  s.setItem(UTILITY_MOVES_KEY, 'nope');
  assert.deepEqual(loadMoves(s), {});
});

test('an installed app is a Home tile only by that tile’s name: YouTube Kids is not YouTube', async () => {
  const { loadTs } = await import('./ts-module.mjs');
  const { keyForName } = await loadTs('apps.ts');
  assert.equal(keyForName('YouTube'), 'youtube');
  assert.equal(keyForName('YouTube Kids'), null);
  assert.equal(keyForName('Spotify - Music and Podcasts'), 'spotify');
  assert.equal(keyForName('Max'), 'max');
  assert.equal(keyForName('HBO Max'), 'max');
  assert.equal(keyForName('Apple TV'), 'appletv');
  assert.equal(keyForName('Prime Video'), 'prime');
  assert.equal(keyForName('Twitch'), null);
});
