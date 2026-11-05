// Reading TMDB's account answers (the Android launcher's TmdbAccountParse): the tokens, the account, pages of titles and
// lists, and what a failed call means for the code that made it. A failure is thrown as a Failure. Pure, tested.

import { type Reply, titleId } from './api';

/** What a failed call means. */
export type Problem =
  /** The network or TMDB is down or busy (5xx, 429, no answer): try again later. */
  | 'retry'
  /** The request token is not approved yet (codes 41 and 17): keep waiting. */
  | 'notApproved'
  /** The request token is too old or unknown (code 33): a new code is needed. */
  | 'expired'
  /** The account's token or session is no longer accepted (codes 3, 14, 35, 36, 37): sign in again. */
  | 'signedOut'
  /** Anything else: the call itself was wrong or refused, and repeating it won't help. */
  | 'rejected';

/** A call that failed, with TMDB's code (0 when it gave none) and HTTP status (0 when nothing answered). */
export class Failure {
  constructor(
    readonly problem: Problem,
    readonly status: number,
    readonly code: number,
    readonly message: string,
  ) {}
  /** No answer at all: the network. */
  static network(message = 'no answer') {
    return new Failure('retry', 0, 0, message);
  }
}

export const isFailure = (e: unknown): e is Failure => e instanceof Failure;

export interface Account {
  id: number;
  username: string;
}
/** One page of titles, as title ids in TMDB's order, and the list's name on a list's page ("" elsewhere). */
export interface Page {
  ids: string[];
  page: number;
  totalPages: number;
  name: string;
}
export interface ListInfo {
  id: number;
  name: string;
  isPublic: boolean;
  items: number;
}
export interface ListPage {
  lists: ListInfo[];
  page: number;
  totalPages: number;
}
/** The access token and the account's v4 id from a finished sign-in. */
export interface Access {
  accessToken: string;
  accountObjectId: string;
}

type Obj = Record<string, unknown>;

// ---- Sign-in -----------------------------------------------------------------------------------------------------

export const requestToken = (r: Reply): string => required(ok(r), 'request_token', r);

export function access(r: Reply): Access {
  const o = ok(r);
  return { accessToken: required(o, 'access_token', r), accountObjectId: required(o, 'account_id', r) };
}

export const sessionId = (r: Reply): string => required(ok(r), 'session_id', r);

export function account(r: Reply): Account {
  const o = ok(r);
  const id = int(o.id);
  if (id <= 0) throw malformed(r, 'id');
  return { id, username: text(o, 'username') };
}

// ---- Lists -------------------------------------------------------------------------------------------------------

/**
 * A page of the watchlist, the favourites or a list. `kind` is the media type when the endpoint has one kind; null reads
 * each result's own media_type, as a list's do. Results that are neither a movie nor a show are skipped.
 */
export function page(r: Reply, kind: 'movie' | 'tv' | null): Page {
  const o = ok(r);
  const ids: string[] = [];
  const results = Array.isArray(o.results) ? o.results : [];
  for (const item of results) {
    if (!item || typeof item !== 'object') continue;
    const id = titleId(kind || text(item as Obj, 'media_type'), (item as Obj).id);
    if (id && ids.indexOf(id) < 0) ids.push(id);
  }
  return { ids, page: int(o.page) || 1, totalPages: Math.max(1, int(o.total_pages) || 1), name: text(o, 'name') };
}

export function lists(r: Reply): ListPage {
  const o = ok(r);
  const out: ListInfo[] = [];
  const results = Array.isArray(o.results) ? o.results : [];
  for (const item of results) {
    if (!item || typeof item !== 'object') continue;
    const i = item as Obj;
    const id = int(i.id);
    if (id <= 0) continue;
    // v4 gives public as 0 or 1; accept a boolean too.
    const isPublic = typeof i.public === 'boolean' ? i.public : int(i.public) !== 0;
    out.push({ id, name: text(i, 'name'), isPublic, items: int(i.number_of_items) });
  }
  return { lists: out, page: int(o.page) || 1, totalPages: Math.max(1, int(o.total_pages) || 1) };
}

/** The id of a list just made. */
export function createdList(r: Reply): number {
  const id = int(ok(r).id);
  if (id <= 0) throw malformed(r, 'id');
  return id;
}

/** A write that answers only with success: the watchlist, the favourites, list items, signing out. */
export function done(r: Reply): void {
  const o = ok(r);
  // List item calls report each title; one that failed is already there or already gone, which is fine.
  if (o.success === false) throw failure(r, o);
}

// ---- Failures ----------------------------------------------------------------------------------------------------

const isOk = (r: Reply) => r.status >= 200 && r.status < 300;

/** The answer as JSON when it is a success; otherwise the failure it is. */
function ok(r: Reply): Obj {
  const o = json(r.body);
  if (!isOk(r)) throw failure(r, o);
  if (!o) throw new Failure('retry', r.status, 0, 'TMDB answered with something that is not JSON');
  return o;
}

export function failure(r: Reply, o: Obj | null = json(r.body)): Failure {
  const code = o ? int(o.status_code) : 0;
  const message = (o && text(o, 'status_message')) || `HTTP ${r.status}`;
  return new Failure(problem(r.status, code), r.status, code, message);
}

export function problem(status: number, code: number): Problem {
  switch (code) {
    case 41:
    case 17:
      return 'notApproved';
    case 33:
      return 'expired';
    case 3:
    case 14:
    case 35:
    case 36:
    case 37:
      return 'signedOut';
    case 9:
    case 11:
    case 24:
    case 25:
    case 43:
    case 46:
      return 'retry';
  }
  if (status === 429 || status >= 500 || status === 0) return 'retry';
  return 'rejected';
}

const malformed = (r: Reply, key: string) => new Failure('rejected', r.status, 0, `TMDB's answer has no ${key}`);

function required(o: Obj, key: string, r: Reply): string {
  const v = text(o, key);
  if (!v) throw malformed(r, key);
  return v;
}

function text(o: Obj, key: string): string {
  const v = o[key];
  return v == null ? '' : typeof v === 'string' ? v : String(v);
}

function int(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+$/.test(v) ? parseInt(v, 10) : 0;
  return isFinite(n) ? Math.floor(n) : 0;
}

function json(body: string | null | undefined): Obj | null {
  if (!body || !body.trim()) return null;
  try {
    const o = JSON.parse(body);
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Obj) : null;
  } catch (e) {
    return null;
  }
}
