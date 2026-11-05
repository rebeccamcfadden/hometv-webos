// My list, Favorites and Seen following a TMDB account (app/src/account/): the change queue, the merge of the TV's lists
// with TMDB's, the first sign-in, changes made offline going up later, and TMDB signing the TV out. No network: the
// pretend TMDB in tests/fake-tmdb-account.mjs holds the account's lists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './ts-module.mjs';
import { FAKE, fakeClock, fakeLists, fakeTmdb, memoryKv } from './fake-tmdb-account.mjs';

const m = await loadTs({ ledger: 'account/ledger.ts', merge: 'account/merge.ts', sync: 'account/sync.ts', account: 'account/account.ts', flow: 'account/flow.ts', session: 'account/session.ts' });
const { SyncLedger, prepare, retryDelay, RETRY_FIRST, LEDGER_KEY } = m.ledger;
const { merge } = m.merge;

const SESSION = { accessToken: FAKE.accessToken, accountObjectId: FAKE.accountObjectId, sessionId: FAKE.sessionId, accountId: FAKE.accountId, username: 'u' };
const op = (id, present, at, list = 'myList') => ({ list, id, present, at, attempts: 0, notBefore: 0 });

test('the ledger keeps the newest change per title, skips ids that are not TMDB titles, and survives JSON', () => {
  const l = new SyncLedger();
  l.reset('acct');
  l.record('myList', 'movie:1', true, 10);
  l.record('myList', 'movie:1', false, 20);
  l.record('myList', 'movie:1', true, 15);
  l.record('seen', 'local:abc', true, 30);
  l.record('favorites', 'tv:2', true, 40);
  assert.deepEqual(
    l.pending().map((o) => [o.list, o.id, o.present]),
    [
      ['myList', 'movie:1', false],
      ['favorites', 'tv:2', true],
    ],
  );
  l.setBase('myList', ['movie:9'], 50);
  l.setListId('seen', 77);
  const back = SyncLedger.fromJson(l.toJson());
  assert.equal(back.account(), 'acct');
  assert.deepEqual(back.pending(), l.pending());
  assert.deepEqual(back.base('myList'), ['movie:9']);
  assert.equal(back.pulledAt('myList'), 50);
  assert.equal(back.listId('seen'), 77);
  assert.equal(SyncLedger.fromJson('{broken').account(), '');
});

test('a change that fails waits longer each time', () => {
  const l = new SyncLedger();
  l.reset('a');
  l.record('myList', 'movie:1', true, 0);
  l.retry(l.pending()[0], 100);
  assert.equal(l.pending()[0].notBefore, 100 + RETRY_FIRST);
  assert.equal(l.due(100).length, 0);
  assert.equal(l.due(100 + RETRY_FIRST).length, 1);
  assert.ok(retryDelay(2) === 2 * RETRY_FIRST && retryDelay(100) === 60 * 60_000);
});

test('merge: untouched titles take TMDB state; a TV change wins unless TMDB changed the title after it', () => {
  // TMDB added movie:3; the TV removed movie:1 after the last read; nobody touched movie:2.
  let r = merge(['movie:1', 'movie:2'], ['movie:1', 'movie:2'], 100, ['movie:1', 'movie:2', 'movie:3'], [op('movie:1', false, 150)]);
  assert.deepEqual(r.local, ['movie:2', 'movie:3']);
  assert.deepEqual(r.keep.map((o) => o.id), ['movie:1']);
  // TMDB removed movie:4 since the read, and the TV's add of it is older than the read: TMDB wins, nothing to send.
  r = merge(['movie:4'], ['movie:4'], 100, [], [op('movie:4', true, 50)]);
  assert.deepEqual(r.local, []);
  assert.deepEqual(r.keep, []);
  // The same, but the TV's change came after the read: the TV wins.
  r = merge(['movie:4'], ['movie:4'], 100, [], [op('movie:4', true, 150)]);
  assert.deepEqual(r.local, ['movie:4']);
  assert.equal(r.keep.length, 1);
  // A change TMDB already has is not sent again.
  r = merge([], [], 100, ['tv:5'], [op('tv:5', true, 150)]);
  assert.deepEqual(r.local, ['tv:5']);
  assert.deepEqual(r.keep, []);
});

test('first sign-in: a TV that never followed an account merges its lists up; another account is adopted', () => {
  const l = new SyncLedger();
  const local = { myList: ['movie:1'], favorites: ['tv:2'], seen: ['movie:3', 'local:x'] };
  assert.equal(prepare(l, 'A', local, 5), 'merge');
  assert.deepEqual(l.pending().map((o) => `${o.list} ${o.id} ${o.present}`), ['myList movie:1 true', 'favorites tv:2 true', 'seen movie:3 true']);
  assert.equal(prepare(l, 'A', local, 6), 'continue');
  assert.equal(l.pending().length, 3);
  assert.equal(prepare(l, 'B', local, 7), 'adopt');
  assert.equal(l.account(), 'B');
  assert.equal(l.pending().length, 0);
});

test('sync: reads the three lists, makes the private Seen list once, merges and sends the queued changes', async () => {
  const tmdb = fakeTmdb({ watchlist: { movie: [10], tv: [] }, favorites: { movie: [], tv: [20] } });
  const send = (c) => Promise.resolve(tmdb.answer(c, 'x'));
  const l = new SyncLedger();
  const local = { myList: ['movie:1'], favorites: [], seen: ['movie:3'] };
  prepare(l, FAKE.accountObjectId, local, 0);
  const r = await m.sync.sync(send, SESSION, l, local, 1000, true);
  assert.equal(r.signedOut, false);
  assert.deepEqual(r.lists.myList.slice().sort(), ['movie:1', 'movie:10']);
  assert.deepEqual(r.lists.favorites, ['tv:20']);
  assert.deepEqual(r.lists.seen, ['movie:3']);
  assert.deepEqual(tmdb.watchlist.movie.slice().sort(), [1, 10]);
  assert.equal(tmdb.lists.length, 1);
  assert.equal(tmdb.lists[0].name, 'Seen');
  assert.deepEqual(tmdb.lists[0].items, ['movie:3']);
  assert.equal(l.pending().length, 0);
  // Again: the Seen list is found, not made twice.
  await m.sync.sync(send, SESSION, l, r.lists, 2000, true);
  assert.equal(tmdb.lists.length, 1);
  assert.equal(m.sync.resolve(' seen ', [{ id: 9, name: 'Seen' }, { id: 4, name: 'SEEN' }]), 4);
});

test('offline: changes stay queued with a retry time, then go up when TMDB answers again', async () => {
  const tmdb = fakeTmdb();
  const send = (c) => Promise.resolve(tmdb.answer(c, 'x'));
  const l = new SyncLedger();
  prepare(l, FAKE.accountObjectId, { myList: [], favorites: [], seen: [] }, 0);
  await m.sync.sync(send, SESSION, l, { myList: [], favorites: [], seen: [] }, 10, true);
  l.record('myList', 'movie:7', true, 100);
  l.record('favorites', 'tv:8', true, 101);
  tmdb.mode = 'offline';
  const r = await m.sync.sync(send, SESSION, l, { myList: ['movie:7'], favorites: ['tv:8'], seen: [] }, 200, false);
  assert.equal(r.signedOut, false);
  assert.equal(l.pending().length, 2);
  // The first failure stops the push (no hammering a dead network); that change waits before its next try.
  assert.ok(l.pending().some((o) => o.notBefore > 200));
  assert.equal(l.due(200).length, 1);
  tmdb.mode = null;
  const later = Math.max(...l.pending().map((o) => o.notBefore));
  await m.sync.sync(send, SESSION, l, { myList: ['movie:7'], favorites: ['tv:8'], seen: [] }, later, false);
  assert.equal(l.pending().length, 0);
  assert.deepEqual(tmdb.watchlist.movie, [7]);
  assert.deepEqual(tmdb.favorites.tv, [8]);
});

test('TMDB signing the TV out (session revoked) is reported, and the changes stay queued', async () => {
  const tmdb = fakeTmdb();
  const send = (c) => Promise.resolve(tmdb.answer(c, 'x'));
  const l = new SyncLedger();
  prepare(l, FAKE.accountObjectId, { myList: ['movie:1'], favorites: [], seen: [] }, 0);
  tmdb.mode = { status: 401, body: JSON.stringify({ success: false, status_code: 3, status_message: 'no' }) };
  const r = await m.sync.sync(send, SESSION, l, { myList: ['movie:1'], favorites: [], seen: [] }, 10, true);
  assert.equal(r.signedOut, true);
  assert.equal(l.pending().length, 1);
});

function driver(lists, kv = memoryKv()) {
  const clock = fakeClock();
  const tmdb = fakeTmdb({ watchlist: { movie: [10], tv: [] } });
  let visible = true;
  const a = m.account.createAccounts({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    send: (c, bearer) => Promise.resolve(tmdb.answer(c, bearer)),
    appKey: () => Promise.resolve(FAKE.appKey),
    kv,
    lists,
    visible: () => visible,
  });
  return { a, clock, tmdb, kv, setVisible: (v) => (visible = v) };
}

test('driver: signing in merges the local lists with the account; a later toggle goes up after the debounce', async () => {
  const lists = fakeLists({ myList: ['movie:1'], seen: ['tv:3'] });
  const t = driver(lists);
  lists.toggle('favorites', 'movie:99');
  assert.equal(t.a.state().queued, 0, 'not following an account: nothing is recorded');
  t.a.showing(true);
  await t.a.start();
  await t.clock.advance(1);
  t.tmdb.approved = true;
  await t.clock.advance(m.flow.POLL + 1);
  assert.equal(t.a.state().phase, 'signedIn');
  await t.clock.advance(1000);
  assert.deepEqual(lists.sets.myList.slice().sort(), ['movie:1', 'movie:10']);
  assert.deepEqual(t.tmdb.watchlist.movie.slice().sort(), [1, 10]);
  assert.deepEqual(t.tmdb.favorites.movie, [99]);
  assert.deepEqual(t.tmdb.lists[0].items, ['tv:3']);
  assert.equal(t.a.state().queued, 0);
  lists.toggle('myList', 'movie:10');
  assert.equal(t.a.state().queued, 1, 'optimistic: the TV shows it at once, the change is queued');
  await t.clock.advance(m.account.DEBOUNCE + 100);
  assert.deepEqual(t.tmdb.watchlist.movie, [1]);
  assert.equal(t.a.state().queued, 0);
  // Offline: the change waits on the TV (and in storage) and goes up when the network is back.
  t.tmdb.mode = 'offline';
  lists.toggle('seen', 'movie:5');
  await t.clock.advance(m.account.DEBOUNCE + 100);
  assert.equal(t.a.state().queued, 1);
  assert.match(t.kv.getItem(LEDGER_KEY), /movie:5/);
  t.tmdb.mode = null;
  await t.clock.advance(RETRY_FIRST);
  t.a.resume();
  await t.clock.advance(100);
  assert.equal(t.a.state().queued, 0);
  assert.deepEqual(t.tmdb.lists[0].items.slice().sort(), ['movie:5', 'tv:3']);
  // Signing out keeps the lists on the TV.
  await t.a.signOut();
  assert.deepEqual(lists.sets.myList, ['movie:1']);
  t.a.stop();
});

test('driver: TMDB revoking the session signs the TV out and keeps the lists', async () => {
  const lists = fakeLists({ myList: ['movie:1'] });
  const kv = memoryKv();
  kv.setItem(m.session.SESSION_KEY, JSON.stringify(SESSION));
  const t = driver(lists, kv);
  assert.equal(t.a.state().phase, 'signedIn');
  t.tmdb.mode = { status: 401, body: JSON.stringify({ success: false, status_code: 3, status_message: 'no' }) };
  t.a.shown();
  await t.clock.advance(100);
  assert.equal(t.a.state().phase, 'signedOut');
  assert.equal(kv.getItem(m.session.SESSION_KEY), null);
  assert.deepEqual(lists.sets.myList, ['movie:1']);
  t.a.stop();
});

test('driver: a title added while a sync is running stays on the TV, even when the same sync sends it', async () => {
  const lists = fakeLists({ myList: ['movie:1'] });
  const kv = memoryKv();
  kv.setItem(m.session.SESSION_KEY, JSON.stringify(SESSION));
  const clock = fakeClock();
  const tmdb = fakeTmdb({ watchlist: { movie: [10], tv: [] } });
  let release = null;
  const gate = new Promise((r) => (release = r));
  const a = m.account.createAccounts({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    send: async (c, bearer) => {
      if (c.url.includes('/movie/favorites')) await gate;
      return tmdb.answer(c, bearer);
    },
    appKey: () => Promise.resolve(FAKE.appKey),
    kv,
    lists,
    visible: () => true,
  });
  a.shown();
  await clock.advance(100);
  assert.equal(a.state().syncing, true, 'held at the favourites read');
  lists.toggle('myList', 'movie:50');
  release();
  await clock.advance(100);
  assert.equal(a.state().syncing, false);
  assert.deepEqual(tmdb.watchlist.movie.slice().sort((x, y) => x - y), [1, 10, 50], 'the same sync sent it');
  assert.deepEqual(lists.sets.myList.slice().sort(), ['movie:1', 'movie:10', 'movie:50']);
  a.stop();
});
