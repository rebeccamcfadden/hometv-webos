// A pretend TMDB account service for the account tests (tests/account-*.test.mjs): answers the calls account/api.ts
// builds, from lists held in memory, and records each call with the bearer token it came with. No network. The tokens
// are made-up strings, so a test can check that none of them reaches the screen.

export const FAKE = {
  appKey: 'fake.app.read-token',
  requestToken: 'fake-request-token-123',
  accessToken: 'fake-access-token-456',
  accountObjectId: 'fake-object-id',
  sessionId: 'fake-session-id-789',
  accountId: 42,
  username: 'household',
};

const ok = (o) => ({ status: 200, body: JSON.stringify(o) });
const fail = (status, code, message = 'no') => ({ status, body: JSON.stringify({ success: false, status_code: code, status_message: message }) });

export function fakeTmdb(init = {}) {
  const t = {
    approved: false,
    calls: [],
    /** null: answer; 'offline': no answer (send resolves null); a reply object: that reply for every call. */
    mode: null,
    watchlist: { movie: [], tv: [] },
    favorites: { movie: [], tv: [] },
    lists: [],
    nextListId: 9000,
    ...init,
  };
  const page = (ids, kind, p, extra = {}) => {
    const per = 20;
    const slice = ids.slice((p - 1) * per, p * per);
    return ok({ page: p, total_pages: Math.max(1, Math.ceil(ids.length / per)), results: slice.map((n) => ({ id: n, ...(kind ? {} : { media_type: n.type }) })), ...extra });
  };
  t.answer = (c, bearer) => {
    t.calls.push({ method: c.method, url: c.url, auth: c.auth, bearer, body: c.body });
    if (t.mode === 'offline') return null;
    if (t.mode) return t.mode;
    const u = new URL(c.url);
    const p = u.pathname;
    const body = c.body ? JSON.parse(c.body) : {};
    const n = parseInt(u.searchParams.get('page') || '1', 10);
    if (c.method === 'POST' && p === '/4/auth/request_token') return ok({ success: true, request_token: FAKE.requestToken });
    if (c.method === 'POST' && p === '/4/auth/access_token') {
      if (!t.approved) return fail(401, 41, 'not approved');
      return ok({ success: true, access_token: FAKE.accessToken, account_id: FAKE.accountObjectId });
    }
    if (c.method === 'POST' && p === '/3/authentication/session/convert/4') return ok({ success: true, session_id: FAKE.sessionId });
    if (c.method === 'GET' && p === '/3/account') return ok({ id: FAKE.accountId, username: FAKE.username });
    if (c.method === 'DELETE' && (p === '/4/auth/access_token' || p === '/3/authentication/session')) return ok({ success: true });
    let m = p.match(/^\/4\/account\/[^/]+\/(movie|tv)\/(watchlist|favorites)$/);
    if (m && c.method === 'GET') return page(t[m[2] === 'watchlist' ? 'watchlist' : 'favorites'][m[1]], m[1], n);
    if (/^\/4\/account\/[^/]+\/lists$/.test(p)) return ok({ page: 1, total_pages: 1, results: t.lists.map((l) => ({ id: l.id, name: l.name, public: 0, number_of_items: l.items.length })) });
    if (c.method === 'POST' && p === '/4/list') {
      const l = { id: t.nextListId++, name: body.name, items: [] };
      t.lists.push(l);
      return { status: 201, body: JSON.stringify({ success: true, id: l.id }) };
    }
    m = p.match(/^\/4\/list\/(\d+)$/);
    if (m) {
      const l = t.lists.find((x) => x.id === +m[1]);
      if (!l) return fail(404, 34);
      return ok({ page: 1, total_pages: 1, name: l.name, results: l.items.map((id) => ({ id: +id.split(':')[1], media_type: id.split(':')[0] })) });
    }
    m = p.match(/^\/4\/list\/(\d+)\/items$/);
    if (m) {
      const l = t.lists.find((x) => x.id === +m[1]);
      for (const it of body.items) {
        const id = `${it.media_type}:${it.media_id}`;
        l.items = l.items.filter((x) => x !== id);
        if (c.method === 'POST') l.items.push(id);
      }
      return ok({ success: true });
    }
    m = p.match(/^\/3\/account\/\d+\/(watchlist|favorite)$/);
    if (m && c.method === 'POST') {
      if (u.searchParams.get('session_id') !== FAKE.sessionId) return fail(401, 3);
      const which = m[1] === 'watchlist' ? 'watchlist' : 'favorites';
      const arr = t[which][body.media_type];
      const i = arr.indexOf(body.media_id);
      if (i >= 0) arr.splice(i, 1);
      if (body[m[1]]) arr.push(body.media_id);
      return { status: 201, body: JSON.stringify({ success: true, status_code: 1 }) };
    }
    return fail(404, 34, 'not found');
  };
  return t;
}

/** A fake clock and timers: `advance(ms)` runs the timers that fall due, in order, letting promises settle between. */
export function fakeClock(start = 1_000_000) {
  let now = start;
  let seq = 1;
  const timers = new Map();
  const flush = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  };
  const clock = {
    now: () => now,
    setTimer: (fn, ms) => {
      const id = seq++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    flush,
    async advance(ms) {
      const end = now + ms;
      await flush();
      for (;;) {
        let next = null;
        for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t];
        if (!next) break;
        timers.delete(next[0]);
        now = Math.max(now, next[1].at);
        next[1].fn();
        await flush();
      }
      now = end;
      await flush();
    },
  };
  return clock;
}

/** The household's lists, as data/store.ts keeps them, without a page. */
export function fakeLists(init = {}) {
  const sets = { myList: [...(init.myList || [])], seen: [...(init.seen || [])], favorites: [...(init.favorites || [])] };
  const hooks = [];
  return {
    sets,
    lists: () => ({ myList: [...sets.myList], seen: [...sets.seen], favorites: [...sets.favorites] }),
    applySynced(l) {
      for (const k of Object.keys(l)) sets[k] = [...l[k]];
    },
    onChange(fn) {
      hooks.push(fn);
      return () => hooks.splice(hooks.indexOf(fn), 1);
    },
    toggle(list, id) {
      const i = sets[list].indexOf(id);
      if (i >= 0) sets[list].splice(i, 1);
      else sets[list].push(id);
      hooks.forEach((fn) => fn(list, id, i < 0));
    },
  };
}

export function memoryKv() {
  const m = new Map();
  return { map: m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
