// One sync of the household's lists with the TMDB account (the Android launcher's AccountSync, without the shown lists):
// finds the account's private "Seen" list (making it the first time), reads My list (the watchlist), Favorites and Seen,
// merges each with the TV's (merge.ts), and sends the queued changes. A reply that says the account no longer accepts
// the session ends the sync as signed out; the queue is kept for the next sign-in. Async over a `send` the driver gives
// (account/http.ts on a TV, a fake in the tests). Pure, tested.

import * as api from './api';
import { type Call, type Reply, type SyncList, SYNC_LISTS, isCustomList, KINDS, MAX_PAGES } from './api';
import { Failure } from './parse';
import * as parse from './parse';
import { type SyncLedger } from './ledger';
import { merge } from './merge';
import { type Session } from './session';

/** Sends a call; null when nothing answered (the network). */
export type Send = (c: Call) => Promise<Reply | null>;

/** The name of the account's list that holds Seen, made private when it isn't there. */
export const SEEN_LIST = 'Seen';

export interface SyncResult {
  /** The lists as the TV should now show them; only the lists that were read. */
  lists: Partial<Record<SyncList, string[]>>;
  /** TMDB no longer accepts the session: sign in again. */
  signedOut: boolean;
  sent: number;
  queued: number;
  /** What went wrong, for a status line; never holds a token. */
  problems: string[];
}

class SignedOut {}

/** The id of the list with that name, case-insensitively; the lowest id when two share it; 0 for none. */
export function resolve(name: string, lists: parse.ListInfo[]): number {
  const want = name.trim().toLowerCase();
  let id = 0;
  for (const l of lists) if (l.name.trim().toLowerCase() === want && (id === 0 || l.id < id)) id = l.id;
  return id;
}

export async function sync(send: Send, session: Session, ledger: SyncLedger, local: Record<SyncList, string[]>, now: number, pull: boolean, createSeen = true): Promise<SyncResult> {
  if (session.accountObjectId !== ledger.account()) throw new Error("the ledger is another account's; prepare it first");
  const problems: string[] = [];
  const lists: Partial<Record<SyncList, string[]>> = {};
  let sent = 0;
  let signedOut = false;

  const note = (f: Failure, what: string) => problems.push(`${what}: ${f.problem}${f.code ? ` (${f.code})` : ''}`);

  const call = async (c: Call): Promise<Reply> => {
    const r = await send(c);
    if (!r) throw Failure.network();
    if (r.status < 200 || r.status >= 300) {
      const f = parse.failure(r);
      if (f.problem === 'signedOut' || f.problem === 'notApproved' || f.problem === 'expired') throw new SignedOut();
      throw f;
    }
    return r;
  };

  const accountLists = async (): Promise<parse.ListInfo[] | null> => {
    const out: parse.ListInfo[] = [];
    try {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const p = parse.lists(await call(api.accountLists(session.accountObjectId, page)));
        out.push(...p.lists);
        if (page >= p.totalPages) break;
      }
    } catch (e) {
      if (!(e instanceof Failure)) throw e;
      note(e, "the account's lists");
      return null;
    }
    return out;
  };

  const findSeen = async () => {
    if (ledger.listId('seen') > 0 && !pull) return;
    const mine = await accountLists();
    if (!mine) return;
    let id = resolve(SEEN_LIST, mine);
    if (id === 0 && createSeen) {
      try {
        id = parse.createdList(await call(api.createList(SEEN_LIST)));
      } catch (e) {
        if (!(e instanceof Failure)) throw e;
        note(e, `making the list "${SEEN_LIST}"`);
      }
    }
    ledger.setListId('seen', id);
  };

  const read = async (list: SyncList): Promise<string[] | null> => {
    const out: string[] = [];
    const addAll = (ids: string[]) => ids.forEach((id) => out.indexOf(id) < 0 && out.push(id));
    try {
      if (isCustomList(list)) {
        const id = ledger.listId(list);
        if (!id) return null;
        for (let page = 1; page <= MAX_PAGES; page++) {
          const p = parse.page(await call(api.listPage(id, page)), null);
          addAll(p.ids);
          if (page >= p.totalPages) break;
        }
      } else {
        for (const kind of KINDS) {
          for (let page = 1; page <= MAX_PAGES; page++) {
            const p = parse.page(await call(api.accountPage(session.accountObjectId, list, kind, page)), kind);
            addAll(p.ids);
            if (page >= p.totalPages) break;
          }
        }
      }
    } catch (e) {
      if (!(e instanceof Failure)) throw e;
      note(e, list);
      if (isCustomList(list) && e.problem === 'rejected') ledger.setListId(list, 0);
      return null;
    }
    return out;
  };

  const push = async () => {
    for (const op of ledger.due(now)) {
      let c: Call;
      if (op.list === 'seen') {
        const id = ledger.listId('seen');
        if (!id) continue;
        c = api.listItems(id, [op.id], op.present);
      } else {
        c = api.setOnAccount(session.accountId, session.sessionId, op.list, op.id, op.present);
      }
      try {
        parse.done(await call(c));
        ledger.pushed(op);
        sent++;
      } catch (e) {
        if (!(e instanceof Failure)) throw e;
        note(e, `${op.present ? '+' : '-'}${op.list} ${op.id}`);
        if (e.problem === 'retry') {
          ledger.retry(op, now);
          break;
        }
        ledger.drop(op);
      }
    }
  };

  try {
    if (pull || ledger.due(now).some((op) => op.list === 'seen')) await findSeen();
    if (pull) {
      for (const list of SYNC_LISTS) {
        const remote = await read(list);
        if (!remote) continue;
        const m = merge(local[list] || [], ledger.base(list), ledger.pulledAt(list), remote, ledger.pending(list));
        ledger.keepOnly(list, m.keep);
        ledger.setBase(list, remote, now);
        lists[list] = m.local;
      }
    }
    await push();
  } catch (e) {
    if (!(e instanceof SignedOut)) throw e;
    signedOut = true;
    problems.push('TMDB no longer accepts the session');
  }
  return { lists, signedOut, sent, queued: ledger.pending().length, problems };
}
