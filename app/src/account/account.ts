// The TMDB account on this TV (the Android launcher's Accounts, sign-in and sync parts): runs the sign-in flow while its
// screen shows, keeps the session on the TV, records each change to My list, Seen and Favorites once the TV follows an
// account, and syncs them (SyncPlan's rules: a full sync when a list page shows and the last one is 10 minutes old, the
// queued changes 5 seconds after a change, both only while the page is visible). Signing out revokes the token and
// session on TMDB best-effort and forgets them here; the lists stay on the TV.
//
// No token is logged or put in anything a screen shows: `state()` holds the phase, the approve link (its request token
// is the one the person must scan), the account name and counts. Only v1 builds import this (v1.ts).

import { type Call, type Reply, type SyncList, APPROVE_SHORT } from './api';
import { SignInFlow, type Phase } from './flow';
import { LEDGER_KEY, SyncLedger, prepare } from './ledger';
import { type Problem } from './parse';
import { type KeyValue, type Session, SessionStore } from './session';
import { sync } from './sync';

/** A full sync when the last is older than this. */
export const STALE = 10 * 60_000;
/** Changes go up this long after the last one. */
export const DEBOUNCE = 5_000;

export interface Lists {
  lists(): Record<SyncList, string[]>;
  applySynced(lists: Partial<Record<SyncList, string[]>>): void;
  onChange(fn: (list: SyncList, id: string, present: boolean) => void): () => void;
}

export interface Deps {
  now(): number;
  setTimer(fn: () => void, ms: number): number;
  clearTimer(id: number): void;
  /** Sends a call with this bearer token; null when nothing answered. */
  send(c: Call, bearer: string): Promise<Reply | null>;
  /** The household's TMDB key from the API keys page ("" when none). */
  appKey(): Promise<string>;
  kv: KeyValue | null;
  lists: Lists;
  /** Whether the page is on screen (network use only then). */
  visible(): boolean;
}

export interface AccountState {
  phase: Phase;
  /** Sign-in needs TMDB's API Read Access Token on the API keys page (the v4 flow); false while unknown. */
  needsToken: boolean;
  /** The link the QR code holds, while waiting. */
  approveUrl: string | null;
  approveShort: string;
  /** Milliseconds the code has left, while waiting. */
  remaining: number;
  username: string;
  failure: Problem | null;
  syncing: boolean;
  /** Changes waiting to go up. */
  queued: number;
  /** The last sync's result in words, "" before one. */
  lastSync: string;
  /** The TV follows an account (signed in now, or before: changes are recorded). */
  follows: boolean;
}

/** The household's TMDB key is a v4 read token (it has dots), which TMDB's sign-in needs. */
const isToken = (key: string) => key.indexOf('.') >= 0;

export function createAccounts(d: Deps) {
  const store = new SessionStore(d.kv);
  let flow = new SignInFlow(store.load());
  const ledger = SyncLedger.fromJson(read(LEDGER_KEY));
  const listeners: (() => void)[] = [];
  let showing = false;
  let timer = 0;
  let key = '';
  let keyKnown = false;
  let syncing = false;
  let again: 'full' | 'push' | null = null;
  let lastFull = 0;
  let pushTimer = 0;
  let lastSync = '';
  /** The changes made on the TV while a sync runs, in order. */
  let during: { list: SyncList; id: string; present: boolean }[] = [];

  function read(k: string): string | null {
    try {
      return d.kv ? d.kv.getItem(k) : null;
    } catch (e) {
      return null;
    }
  }
  function saveLedger() {
    try {
      if (d.kv) d.kv.setItem(LEDGER_KEY, ledger.toJson());
    } catch (e) {
      // Full storage: the queue holds until the app restarts.
    }
  }
  const emit = () => listeners.slice().forEach((fn) => fn());

  async function refreshKey(): Promise<string> {
    try {
      key = (await d.appKey()) || '';
    } catch (e) {
      key = '';
    }
    keyKnown = true;
    return key;
  }

  const bearerFor = (c: Call) => (c.auth === 'user' ? (flow.session() || ({} as Session)).accessToken || '' : key);

  // ---- Sign-in -----------------------------------------------------------------------------------------------------

  const flowVisible = () => showing && d.visible();

  function pump() {
    if (timer) d.clearTimer(timer);
    timer = 0;
    const now = d.now();
    const before = flow.phase();
    const c = flow.due(now, flowVisible());
    if (c) {
      const f = flow;
      d.send(c, bearerFor(c)).then(
        (r) => {
          if (f !== flow) return;
          if (r) flow.onReply(c, r, d.now());
          else flow.onError(c, d.now());
          after();
        },
        () => {
          if (f !== flow) return;
          flow.onError(c, d.now());
          after();
        },
      );
    }
    if (flow.phase() !== before) emit();
    schedule();
  }

  function schedule() {
    if (timer) d.clearTimer(timer);
    timer = 0;
    if (!flowVisible() && !flow.runsHidden()) return;
    const at = flow.nextAt();
    if (at === Infinity) return;
    timer = d.setTimer(pump, Math.max(0, at - d.now()));
  }

  function after() {
    const s = flow.session();
    if (s && flow.phase() === 'signedIn') {
      store.save(s);
      prepare(ledger, s.accountObjectId, d.lists.lists(), d.now());
      saveLedger();
      lastFull = 0;
      requestSync('full');
    }
    emit();
    pump();
  }

  // ---- Sync ------------------------------------------------------------------------------------------------------

  function requestSync(kind: 'full' | 'push') {
    const s = flow.session();
    if (!s || !d.visible()) return;
    if (syncing) {
      if (again !== 'full') again = kind;
      return;
    }
    void runSync(s, kind === 'full');
  }

  async function runSync(s: Session, pull: boolean) {
    syncing = true;
    during = [];
    emit();
    const started = d.now();
    try {
      if (!isToken(await refreshKey())) {
        lastSync = 'Add TMDB’s API Read Access Token on the API keys page to sync.';
        return;
      }
      if (ledger.account() !== s.accountObjectId) prepare(ledger, s.accountObjectId, d.lists.lists(), started);
      const result = await sync((c) => d.send(c, bearerFor(c)), s, ledger, d.lists.lists(), started, pull);
      if (flow.session() !== s) return;
      if (pull) lastFull = started;
      const lists = result.lists;
      // Changes made on the TV while the sync ran win over what it read, even those this sync already sent.
      for (const c of during) {
        const out = lists[c.list];
        if (!out) continue;
        const i = out.indexOf(c.id);
        if (c.present && i < 0) out.push(c.id);
        if (!c.present && i >= 0) out.splice(i, 1);
      }
      if (Object.keys(lists).length) d.lists.applySynced(lists);
      if (result.signedOut) {
        dropSession();
        lastSync = 'TMDB signed this TV out. Sign in again to keep the lists in step.';
      } else {
        lastSync = result.problems.length ? 'Some changes didn’t reach TMDB yet; they’ll go up later.' : 'In step with TMDB.';
      }
    } catch (e) {
      lastSync = 'Can’t reach TMDB. The changes wait on this TV.';
    } finally {
      saveLedger();
      syncing = false;
      emit();
      const next = again;
      again = null;
      if (next && flow.session()) requestSync(next);
    }
  }

  function dropSession() {
    flow.signOut();
    store.clear();
    flow = new SignInFlow(null);
  }

  const offChange = d.lists.onChange((list, id, present) => {
    if (syncing) during.push({ list, id, present });
    if (!ledger.account()) return;
    ledger.record(list, id, present, d.now());
    saveLedger();
    emit();
    if (!flow.session()) return;
    if (pushTimer) d.clearTimer(pushTimer);
    pushTimer = d.setTimer(() => {
      pushTimer = 0;
      requestSync('push');
    }, DEBOUNCE);
  });

  return {
    state(): AccountState {
      const s = flow.session();
      const now = d.now();
      return {
        phase: flow.phase(),
        needsToken: keyKnown && !isToken(key),
        approveUrl: flow.approveUrl(),
        approveShort: APPROVE_SHORT,
        remaining: flow.remaining(now),
        username: s ? s.username : '',
        failure: flow.failure(),
        syncing,
        queued: ledger.pending().length,
        lastSync,
        follows: !!ledger.account(),
      };
    },
    /** The sign-in screen shows (true) or went away (false): polling happens only while it shows. */
    showing(on: boolean) {
      showing = on;
      if (on) void refreshKey().then(() => emit());
      pump();
    },
    /** Asks TMDB for a code to scan. */
    async start() {
      if (!isToken(await refreshKey())) {
        emit();
        return;
      }
      flow.start(d.now());
      emit();
      pump();
    },
    /** Back: drops a code that wasn't approved. */
    cancel() {
      flow.cancel();
      emit();
      pump();
    },
    /** Signs out: TMDB revokes the token and session (best-effort), the TV forgets them; the lists stay. */
    async signOut() {
      const calls = flow.signOut();
      store.clear();
      flow = new SignInFlow(null);
      lastSync = '';
      emit();
      await refreshKey();
      for (const c of calls) {
        try {
          await d.send(c, key);
        } catch (e) {
          // Best-effort: the token expires on TMDB's side anyway.
        }
      }
    },
    /** A list page showed: a full sync when the last is old, else the queued changes. */
    shown() {
      if (!flow.session()) return;
      requestSync(d.now() - lastFull >= STALE ? 'full' : 'push');
    },
    /** The network came back, or the page became visible. */
    resume() {
      pump();
      if (flow.session() && ledger.pending().length) requestSync('push');
    },
    on(fn: () => void): () => void {
      listeners.push(fn);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    /** Tests: stops listening to the lists and the timers. */
    stop() {
      offChange();
      if (timer) d.clearTimer(timer);
      if (pushTimer) d.clearTimer(pushTimer);
    },
  };
}

export type Accounts = ReturnType<typeof createAccounts>;
