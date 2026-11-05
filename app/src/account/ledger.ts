// What the TV owes the account and what it last saw there (the Android launcher's SyncLedger and SeedPolicy): the
// account the lists follow, each list as last read from TMDB (its base, for telling who changed what), the Seen list's
// TMDB id, and the changes made on the TV that TMDB hasn't taken yet. A change waits here while offline and goes up on
// the next sync; one TMDB refuses is dropped, one that met a network problem waits longer each time. Holds no token: the
// account is its v4 id. Saved as JSON in the page's storage. Pure, tested (tests/account-lists.test.mjs).

import { type SyncList, SYNC_LISTS, mediaType } from './api';

export const RETRY_FIRST = 30_000;
export const RETRY_MAX = 60 * 60_000;
export const MAX_PENDING = 500;
export const LEDGER_KEY = 'hometv-tmdb-sync-v1';

/** A change made on the TV: a title put on a list (present) or taken off. */
export interface Op {
  list: SyncList;
  id: string;
  present: boolean;
  /** When it was made. */
  at: number;
  attempts: number;
  /** Not sent again before this (after a network problem). */
  notBefore: number;
}

export const opDue = (op: Op, now: number) => now >= op.notBefore;

export function retryDelay(attempts: number): number {
  let d = RETRY_FIRST;
  for (let i = 1; i < attempts && d < RETRY_MAX; i++) d *= 2;
  return Math.min(d, RETRY_MAX);
}

export class SyncLedger {
  private acct = '';
  private bases: Partial<Record<SyncList, string[]>> = {};
  private pulled: Partial<Record<SyncList, number>> = {};
  private listIds: Partial<Record<SyncList, number>> = {};
  private ops: Op[] = [];

  /** The account's v4 id the lists follow, or "" when the TV has never been signed in. */
  account(): string {
    return this.acct;
  }

  /** Starts over for an account. */
  reset(accountObjectId: string): void {
    this.acct = accountObjectId || '';
    this.bases = {};
    this.pulled = {};
    this.listIds = {};
    this.ops = [];
  }

  /** A change made on the TV; the newest change to a title wins, and ids that aren't TMDB titles are left out. */
  record(list: SyncList, id: string, present: boolean, now: number): void {
    if (SYNC_LISTS.indexOf(list) < 0 || !mediaType(id)) return;
    for (const op of this.ops) if (op.list === list && op.id === id && op.at > now) return;
    this.ops = this.ops.filter((op) => !(op.list === list && op.id === id));
    this.ops.push({ list, id, present, at: now, attempts: 0, notBefore: 0 });
    while (this.ops.length > MAX_PENDING) this.ops.shift();
  }

  pending(list?: SyncList): Op[] {
    return this.ops.filter((op) => !list || op.list === list);
  }

  due(now: number): Op[] {
    return this.ops.filter((op) => opDue(op, now));
  }

  /** TMDB took a change: it leaves the queue and joins the base. */
  pushed(op: Op): void {
    const i = this.ops.indexOf(op);
    if (i < 0) return;
    this.ops.splice(i, 1);
    const base = this.bases[op.list];
    if (!base) return;
    const j = base.indexOf(op.id);
    if (j >= 0) base.splice(j, 1);
    if (op.present) base.push(op.id);
  }

  /** A network problem: the change waits longer. */
  retry(op: Op, now: number): void {
    const i = this.ops.indexOf(op);
    if (i < 0) return;
    const attempts = op.attempts + 1;
    this.ops[i] = { list: op.list, id: op.id, present: op.present, at: op.at, attempts, notBefore: now + retryDelay(attempts) };
  }

  drop(op: Op): void {
    const i = this.ops.indexOf(op);
    if (i >= 0) this.ops.splice(i, 1);
  }

  /** After a merge: only the changes it kept stay queued for that list. */
  keepOnly(list: SyncList, kept: Op[]): void {
    this.ops = this.ops.filter((op) => op.list !== list || kept.indexOf(op) >= 0);
  }

  base(list: SyncList): string[] | null {
    const b = this.bases[list];
    return b ? b.slice() : null;
  }
  pulledAt(list: SyncList): number {
    return this.pulled[list] || 0;
  }
  setBase(list: SyncList, ids: string[], at: number): void {
    this.bases[list] = ids.slice();
    this.pulled[list] = at;
  }
  listId(list: SyncList): number {
    return this.listIds[list] || 0;
  }
  setListId(list: SyncList, id: number): void {
    if (id > 0) this.listIds[list] = id;
    else delete this.listIds[list];
  }

  toJson(): string {
    const bases: Record<string, { at: number; ids: string[] }> = {};
    for (const l of SYNC_LISTS) {
      const b = this.bases[l];
      if (b) bases[l] = { at: this.pulledAt(l), ids: b };
    }
    return JSON.stringify({ account: this.acct, bases, lists: this.listIds, pending: this.ops });
  }

  static fromJson(json: string | null | undefined): SyncLedger {
    const l = new SyncLedger();
    if (!json || !json.trim()) return l;
    try {
      const o = JSON.parse(json);
      l.acct = typeof o.account === 'string' ? o.account : '';
      const b = o.bases || {};
      for (const list of SYNC_LISTS) {
        const e = b[list];
        if (!e || typeof e !== 'object') continue;
        l.setBase(list, strings(e.ids), typeof e.at === 'number' ? e.at : 0);
      }
      const ids = o.lists || {};
      for (const list of SYNC_LISTS) l.setListId(list, typeof ids[list] === 'number' ? ids[list] : 0);
      if (Array.isArray(o.pending)) {
        for (const e of o.pending) {
          if (!e || SYNC_LISTS.indexOf(e.list) < 0 || typeof e.id !== 'string' || !mediaType(e.id) || typeof e.present !== 'boolean' || typeof e.at !== 'number') continue;
          l.ops.push({ list: e.list, id: e.id, present: e.present, at: e.at, attempts: typeof e.attempts === 'number' ? e.attempts : 0, notBefore: typeof e.notBefore === 'number' ? e.notBefore : 0 });
        }
      }
      return l;
    } catch (e) {
      return new SyncLedger();
    }
  }
}

function strings(a: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(a)) return out;
  for (const s of a) if (typeof s === 'string' && mediaType(s) && out.indexOf(s) < 0) out.push(s);
  return out;
}

/**
 * The first sync after signing in. The same account as last time: carry on, the queue goes up. Another account: start
 * over and take that account's lists, as the Android launcher does. A TV that was never signed in (this app's lists were
 * local only): start the ledger for the account and queue the TV's titles as additions, so the household's lists are
 * merged into the account rather than replaced by it.
 */
export type FirstSync = 'continue' | 'adopt' | 'merge';

export function prepare(ledger: SyncLedger, accountObjectId: string, local: Record<SyncList, string[]>, now: number): FirstSync {
  const had = ledger.account();
  if (had && had === accountObjectId) return 'continue';
  ledger.reset(accountObjectId);
  if (had) return 'adopt';
  for (const list of SYNC_LISTS) for (const id of local[list] || []) ledger.record(list, id, true, now);
  return 'merge';
}
