// The data-source seam (app/src/live/source.ts): what a screen reads, with a fake client in place of the network.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './ts-module.mjs';

const { s, tm } = await loadTs({ s: 'live/source.ts', tm: 'live/tmdb.ts' });

const title = (id, extra = {}) => ({ id, name: `T${id}`, kind: 'movie', year: 2000, genres: [], offers: [], lists: [], poster: null, detailed: false, similar: [], ...extra });
const ok = (value) => Promise.resolve({ value, status: 'ok' });
const fail = (status) => Promise.resolve({ value: null, status });
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A client whose answers a test sets; every call is counted. */
function fake(answers = {}) {
  const calls = [];
  const ask = (name, fallback) => (...args) => {
    calls.push([name, ...args]);
    const a = answers[name];
    return a ? (typeof a === 'function' ? a(...args) : a) : fallback;
  };
  return {
    calls,
    answers,
    client: {
      list: ask('list', ok([])),
      details: ask('details', fail('error')),
      season: ask('season', fail('error')),
      person: ask('person', fail('error')),
      genre: ask('genre', ok([])),
      search: ask('search', ok({ titles: [], people: [], extra: [] })),
      forgetFailures: ask('forgetFailures', undefined),
    },
  };
}

test('a list is loading at first, then ready with its titles; two pages, asked once', async () => {
  const f = fake({ list: (kind, def, page) => ok([title(`${page}a`), title(`${page}b`)]) });
  const src = s.createSource(f.client, () => 'key');
  const first = src.list('movie', 'trending');
  assert.equal(first.phase, 'loading');
  assert.deepEqual(first.value, []);
  let heard = 0;
  src.on(() => heard++);
  await tick();
  const v = src.list('movie', 'trending');
  assert.equal(v.phase, 'ready');
  assert.deepEqual(v.value.map((x) => x.id), ['1a', '1b', '2a', '2b']);
  assert.equal(heard, 1);
  assert.equal(f.calls.filter((c) => c[0] === 'list').length, s.PAGES);
  src.list('movie', 'trending');
  assert.equal(f.calls.filter((c) => c[0] === 'list').length, s.PAGES, 'not asked again');
  assert.equal(src.title('1b').name, 'T1b', 'a title in a list can be read by id');
});

test('a list shows its first page even when the second failed; an empty list is ready', async () => {
  const f = fake({ list: (kind, def, page) => (page === 1 ? ok([title('x')]) : fail('error')) });
  const src = s.createSource(f.client, () => 'key');
  src.list('movie', 'trending');
  await tick();
  assert.deepEqual(src.list('movie', 'trending').value.map((x) => x.id), ['x']);
  assert.equal(src.list('movie', 'no-such-list').phase === 'loading', true);
  await tick();
  assert.equal(src.list('movie', 'no-such-list').phase, 'ready');
});

test('without a key the phase is nokey, with nothing to show', async () => {
  const f = fake({ list: fail('nokey') });
  let key = '';
  const src = s.createSource(f.client, () => key);
  assert.equal(src.hasKey(), false);
  src.list('movie', 'trending');
  await tick();
  assert.equal(src.list('movie', 'trending').phase, 'nokey');
  assert.deepEqual(src.list('movie', 'trending').value, []);
});

test('setKey forgets what was shown and asks again, and an answer to the old key is ignored', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  let key = 'old';
  const f = fake({ list: (kind, def, page) => (key === 'old' ? gate.then(() => ({ value: [title('old')], status: 'ok' })) : ok([title('new')])) });
  const src = s.createSource(f.client, () => key);
  src.list('movie', 'trending');
  key = 'new';
  src.setKey('new');
  assert.equal(src.list('movie', 'trending').phase, 'loading', 'asked again');
  release();
  await tick();
  await tick();
  const v = src.list('movie', 'trending');
  assert.equal(v.phase, 'ready');
  assert.deepEqual(v.value.map((x) => x.id), ['new']);
});

test('retry asks again what is offline or failed, and leaves what is fine alone', async () => {
  let online = false;
  const f = fake({
    list: (kind, def) => (def.id === 'trending' ? ok([title('t')]) : online ? ok([title('p')]) : fail('offline')),
  });
  const src = s.createSource(f.client, () => 'key');
  const ids = tm.listsFor('movie').map((l) => l.id);
  const other = ids.filter((i) => i !== 'trending')[0];
  src.list('movie', 'trending');
  src.list('movie', other);
  await tick();
  assert.equal(src.list('movie', other).phase, 'offline');
  const before = f.calls.length;
  online = true;
  src.retry();
  assert.equal(src.list('movie', 'trending').phase, 'ready');
  src.list('movie', other);
  await tick();
  assert.equal(src.list('movie', other).phase, 'ready');
  assert.equal(f.calls.slice(before).filter((c) => c[1] === 'movie' && c[2].id === 'trending').length, 0, 'the good list was not asked again');
});

test('a summary seen later never replaces details already loaded', async () => {
  const detailed = title('d', { detailed: true, overview: 'the full story' });
  const f = fake({ details: ok(detailed), list: ok([title('d')]) });
  const src = s.createSource(f.client, () => 'key');
  src.list('movie', 'trending');
  await tick();
  assert.equal(src.title('d').detailed, false);
  assert.equal(src.need('d').phase, 'loading');
  assert.equal(src.need('d').value.id, 'd', 'the summary shows meanwhile');
  await tick();
  assert.equal(src.title('d').detailed, true);
  src.list('movie', 'popular');
  src.search('t');
  await tick();
  assert.equal(src.title('d').detailed, true);
  assert.equal(src.need('d').phase, 'ready');
  assert.equal(f.calls.filter((c) => c[0] === 'details').length, 1);
});

test('search: an empty query is ready and empty; a query keeps its hits for the title pages', async () => {
  const f = fake({ search: ok({ titles: [title('s1')], people: [{ id: 5, name: 'Someone', photo: null, known: [] }], extra: [title('s2')] }) });
  const src = s.createSource(f.client, () => 'key');
  assert.equal(src.search('  ').phase, 'ready');
  assert.equal(f.calls.length, 0, 'an empty query is not asked');
  assert.equal(src.search('Some').phase, 'loading');
  await tick();
  const v = src.search('some');
  assert.equal(v.phase, 'ready', 'the same query in another case is the same search');
  assert.equal(v.value.people[0].id, 5);
  assert.equal(src.title('s2').id, 's2', 'the titles a person is known for are remembered too');
  assert.equal(f.calls.filter((c) => c[0] === 'search').length, 1);
});

test('a genre interleaves movies and shows, each in its own order, and works with only one kind', async () => {
  const f = fake({ genre: (kind) => ok([title(`${kind}1`), title(`${kind}2`), ...(kind === 'movie' ? [title('movie3')] : [])]) });
  const src = s.createSource(f.client, () => 'key');
  src.genre('Drama');
  await tick();
  assert.deepEqual(src.genre('Drama').value.map((x) => x.id), ['movie1', 'show1', 'movie2', 'show2', 'movie3']);
  const g = fake({ genre: (kind) => (kind === 'movie' ? ok([title('m')]) : fail('offline')) });
  const only = s.createSource(g.client, () => 'key');
  only.genre('Drama');
  await tick();
  assert.deepEqual(only.genre('Drama').value.map((x) => x.id), ['m']);
  assert.equal(only.genre('Drama').phase, 'ready');
});

test('person and season loads report their phase', async () => {
  const f = fake({ person: ok({ person: { id: 1, name: 'P' }, titles: [title('k')] }), season: fail('offline') });
  const src = s.createSource(f.client, () => 'key');
  src.person(1);
  src.season('9', 1);
  await tick();
  assert.equal(src.person(1).phase, 'ready');
  assert.equal(src.title('k').id, 'k');
  assert.equal(src.season('9', 1).phase, 'offline');
  assert.equal(src.season('9', 1).value, undefined);
});

test('on() stops when its returned function is called', async () => {
  const f = fake({ list: ok([title('a')]) });
  const src = s.createSource(f.client, () => 'key');
  let heard = 0;
  const off = src.on(() => heard++);
  off();
  src.list('movie', 'trending');
  await tick();
  assert.equal(heard, 0);
});
