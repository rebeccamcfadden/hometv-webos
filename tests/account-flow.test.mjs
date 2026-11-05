// Signing the TV in to TMDB (app/src/account/): the flow with a fake clock and a pretend TMDB (approve, deny, a code that
// runs out, Back), the session kept and cleared, signing out revoking on TMDB, and no token in anything the screen shows.
// No network: tests/fake-tmdb-account.mjs answers every call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './ts-module.mjs';
import { FAKE, fakeClock, fakeLists, fakeTmdb, memoryKv } from './fake-tmdb-account.mjs';

const m = await loadTs({ flow: 'account/flow.ts', api: 'account/api.ts', session: 'account/session.ts', account: 'account/account.ts', view: 'account/view.ts', ledger: 'account/ledger.ts' });
const { SignInFlow, POLL, TOKEN_LIFETIME } = m.flow;

const reply = (status, o) => ({ status, body: JSON.stringify(o) });
const tokens = [FAKE.appKey, FAKE.requestToken, FAKE.accessToken, FAKE.sessionId, FAKE.accountObjectId];

/** Runs the flow against the pretend TMDB from `now` until it settles or `until`; returns the clock. */
function drive(flow, tmdb, now, until, visible = true) {
  while (now <= until) {
    const c = flow.due(now, visible);
    if (c) {
      const r = tmdb.answer(c, 'x');
      if (r) flow.onReply(c, r, now);
      else flow.onError(c, now);
      continue;
    }
    const at = flow.nextAt();
    if (at === Infinity || at > until) break;
    now = Math.max(now + 1, at);
  }
  return now;
}

test('approve: request token, polls every 5 s while waiting, then session and account', () => {
  const tmdb = fakeTmdb();
  const f = new SignInFlow(null);
  assert.equal(f.phase(), 'signedOut');
  f.start(0);
  let now = drive(f, tmdb, 0, 12_000);
  assert.equal(f.phase(), 'waiting');
  assert.equal(f.approveUrl(), m.api.APPROVE + FAKE.requestToken);
  const polls = tmdb.calls.filter((c) => c.url.endsWith('/4/auth/access_token'));
  assert.equal(polls.length, 2, 'polled at 5 s and 10 s');
  assert.ok(f.nextAt() - now <= POLL);
  tmdb.approved = true;
  now = drive(f, tmdb, now, now + POLL);
  assert.equal(f.phase(), 'signedIn');
  assert.deepEqual(f.session(), { accessToken: FAKE.accessToken, accountObjectId: FAKE.accountObjectId, sessionId: FAKE.sessionId, accountId: FAKE.accountId, username: FAKE.username });
  assert.equal(f.approveUrl(), null);
  assert.equal(f.nextAt(), Infinity);
});

test('no polling while the screen is hidden, except to finish an approved sign-in', () => {
  const tmdb = fakeTmdb();
  const f = new SignInFlow(null);
  f.start(0);
  assert.equal(f.due(0, false), null);
  drive(f, tmdb, 0, 0);
  assert.equal(f.phase(), 'waiting');
  assert.equal(f.due(POLL, false), null);
  tmdb.approved = true;
  const c = f.due(POLL, true);
  f.onReply(c, tmdb.answer(c), POLL);
  assert.equal(f.phase(), 'finishing');
  assert.ok(f.runsHidden());
  drive(f, tmdb, POLL, POLL + 1000, false);
  assert.equal(f.phase(), 'signedIn');
});

test('deny: TMDB refuses the code, the flow fails with nothing saved', () => {
  const f = new SignInFlow(null);
  f.start(0);
  let c = f.due(0, true);
  f.onReply(c, reply(200, { success: true, request_token: FAKE.requestToken }), 0);
  c = f.due(POLL, true);
  f.onReply(c, reply(401, { success: false, status_code: 7, status_message: 'Invalid API key' }), POLL);
  assert.equal(f.phase(), 'failed');
  assert.equal(f.failure(), 'rejected');
  assert.equal(f.session(), null);
  assert.equal(f.approveUrl(), null);
  f.start(POLL);
  assert.equal(f.phase(), 'requesting', 'Try again asks for a new code');
});

test('timeout: a code that is never approved expires after 15 minutes', () => {
  const tmdb = fakeTmdb();
  const f = new SignInFlow(null);
  f.start(0);
  drive(f, tmdb, 0, TOKEN_LIFETIME + 1000);
  assert.equal(f.phase(), 'expired');
  assert.equal(f.approveUrl(), null);
  const polls = tmdb.calls.filter((c) => c.url.endsWith('/4/auth/access_token')).length;
  assert.ok(polls >= 170 && polls <= 181, `about one poll every 5 s (${polls})`);
});

test('cancel: Back drops the code, and a late answer is ignored', () => {
  const f = new SignInFlow(null);
  f.start(0);
  const c = f.due(0, true);
  f.cancel();
  assert.equal(f.phase(), 'signedOut');
  f.onReply(c, reply(200, { success: true, request_token: FAKE.requestToken }), 10);
  assert.equal(f.phase(), 'signedOut');
  assert.equal(f.approveUrl(), null);
});

test('network failures back off; while waiting they keep trying until the code runs out', () => {
  const f = new SignInFlow(null);
  f.start(0);
  let c = f.due(0, true);
  f.onError(c, 0);
  assert.equal(f.phase(), 'requesting');
  assert.equal(f.nextAt(), POLL);
  c = f.due(POLL, true);
  f.onError(c, POLL);
  assert.equal(f.nextAt(), POLL + 2 * POLL);
  c = f.due(3 * POLL, true);
  f.onError(c, 3 * POLL);
  assert.equal(f.phase(), 'failed', 'gives up asking for a code after two retries');
  assert.equal(f.failure(), 'retry');
});

test('a saved session signs in at once; signing out returns the revoke calls and forgets it', () => {
  const s = { accessToken: FAKE.accessToken, accountObjectId: FAKE.accountObjectId, sessionId: FAKE.sessionId, accountId: FAKE.accountId, username: 'u' };
  const f = new SignInFlow(s);
  assert.equal(f.phase(), 'signedIn');
  const calls = f.signOut();
  assert.deepEqual(
    calls.map((c) => `${c.method} ${new URL(c.url).pathname}`),
    ['DELETE /4/auth/access_token', 'DELETE /3/authentication/session'],
  );
  assert.equal(f.phase(), 'signedOut');
  assert.equal(f.session(), null);
  assert.equal(new SignInFlow({ ...s, sessionId: '' }).phase(), 'signedOut', 'an incomplete session is not signed in');
});

test('the session store keeps the session on the TV and clears it', () => {
  const kv = memoryKv();
  const store = new m.session.SessionStore(kv);
  assert.equal(store.load(), null);
  const s = { accessToken: FAKE.accessToken, accountObjectId: FAKE.accountObjectId, sessionId: FAKE.sessionId, accountId: FAKE.accountId, username: 'u' };
  store.save(s);
  assert.deepEqual(store.load(), s);
  assert.deepEqual([...kv.map.keys()], [m.session.SESSION_KEY]);
  store.clear();
  assert.equal(store.load(), null);
  assert.equal(kv.map.size, 0);
  kv.setItem(m.session.SESSION_KEY, '{not json');
  assert.equal(store.load(), null);
});

test('describe() hides the session id', () => {
  const c = m.api.setOnAccount(1, FAKE.sessionId, 'myList', 'movie:5', true);
  assert.ok(!m.api.describe(c).includes(FAKE.sessionId));
});

function driver(opts = {}) {
  const clock = fakeClock();
  const tmdb = opts.tmdb || fakeTmdb();
  const kv = opts.kv || memoryKv();
  const lists = opts.lists || fakeLists();
  let visible = true;
  const a = m.account.createAccounts({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    send: (c, bearer) => Promise.resolve(tmdb.answer(c, bearer)),
    appKey: () => Promise.resolve(opts.key === undefined ? FAKE.appKey : opts.key),
    kv,
    lists,
    visible: () => visible,
  });
  return { a, clock, tmdb, kv, lists, setVisible: (v) => (visible = v) };
}

async function signIn(t) {
  t.a.showing(true);
  await t.a.start();
  await t.clock.advance(POLL * 2);
  assert.equal(t.a.state().phase, 'waiting');
  t.tmdb.approved = true;
  await t.clock.advance(POLL);
  assert.equal(t.a.state().phase, 'signedIn');
}

test('driver: sign in with the right bearer on each call, saves the session, signs out on TMDB and clears it', async () => {
  const t = driver();
  await signIn(t);
  assert.equal(t.a.state().username, FAKE.username);
  assert.ok(t.kv.getItem(m.session.SESSION_KEY));
  for (const c of t.tmdb.calls) assert.equal(c.bearer, c.auth === 'app' ? FAKE.appKey : FAKE.accessToken, `${c.method} ${c.url}`);
  t.a.showing(false);
  t.tmdb.calls.length = 0;
  await t.a.signOut();
  assert.equal(t.a.state().phase, 'signedOut');
  assert.equal(t.kv.getItem(m.session.SESSION_KEY), null);
  assert.deepEqual(
    t.tmdb.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`),
    ['DELETE /4/auth/access_token', 'DELETE /3/authentication/session'],
  );
  for (const [k, v] of t.kv.map) for (const tok of [FAKE.accessToken, FAKE.sessionId]) assert.ok(!v.includes(tok), `${k} still holds a token`);
  t.a.stop();
});

test('driver: polls only while the screen shows; Back cancels', async () => {
  const t = driver();
  t.a.showing(true);
  await t.a.start();
  await t.clock.advance(1);
  assert.equal(t.a.state().phase, 'waiting');
  t.a.showing(false);
  const n = t.tmdb.calls.length;
  await t.clock.advance(60_000);
  assert.equal(t.tmdb.calls.length, n, 'no calls while hidden');
  t.a.cancel();
  t.a.showing(true);
  await t.clock.advance(60_000);
  assert.equal(t.a.state().phase, 'signedOut');
  assert.equal(t.tmdb.calls.length, n);
  t.a.stop();
});

test('driver: the short API key cannot sign in; the screen says the read token is needed', async () => {
  const t = driver({ key: 'shortv3key' });
  t.a.showing(true);
  await t.a.start();
  await t.clock.advance(10_000);
  assert.equal(t.a.state().phase, 'signedOut');
  assert.equal(t.a.state().needsToken, true);
  assert.equal(t.tmdb.calls.length, 0);
  assert.match(m.view.view(t.a.state()).lines.join(' '), /Read Access Token/);
  t.a.stop();
});

test('no token or session id in any text the screen shows, in every state', async () => {
  const shown = [];
  const t = driver();
  const look = () => {
    for (const confirming of [false, true]) {
      const v = m.view.view(t.a.state(), confirming);
      shown.push([v.heading, v.address, ...v.lines, ...v.buttons.map((b) => b.label)].join('\n'));
    }
  };
  t.a.on(look);
  look();
  await signIn(t);
  await t.clock.advance(1000);
  look();
  t.lists.toggle('myList', 'movie:5');
  look();
  await t.a.signOut();
  look();
  for (const phase of ['requesting', 'waiting', 'finishing', 'expired', 'failed']) {
    const v = m.view.view({ ...t.a.state(), phase, approveUrl: m.api.approveUrl(FAKE.requestToken), remaining: 60_000, failure: 'retry' });
    shown.push([v.heading, v.address, ...v.lines].join('\n'));
    if (phase === 'waiting') assert.equal(v.qr, m.api.approveUrl(FAKE.requestToken), 'only the QR holds the code');
  }
  assert.ok(shown.length > 10);
  for (const text of shown) for (const tok of tokens) assert.ok(!text.includes(tok), `"${text}" shows a token`);
  t.a.stop();
});

test('v0 holds no account code: only v1.ts imports it, and the keys page reaches it through the routes', async () => {
  const fs = await import('node:fs');
  const read = (p) => fs.readFileSync(new URL('../app/src/' + p, import.meta.url), 'utf8');
  assert.doesNotMatch(read('screens/keys.ts'), /from '(\.\/account|\.\.\/account\/)/);
  assert.doesNotMatch(read('main.ts'), /account/);
  assert.match(read('v1.ts'), /routes\.account = showAccount/);
  assert.doesNotMatch(read('v1-off.ts'), /account/);
});
