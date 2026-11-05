// The TMDB account calls, built but not sent (the Android launcher's TmdbAccountApi and AccountHttp): sign-in is TMDB's
// v4 flow, whose access token reads the watchlist and favourites and reads and writes the account's lists; that token is
// then turned into a v3 session id, which the watchlist and favourite writes still need. A call names which token goes in
// its Authorization header (`auth`) instead of holding it, so a call can be shown in a test failure without leaking a
// token. Account calls are never cached: the answers are the household's own lists, and v3 writes carry the session id
// in the URL. Titles are "movie:123" and "tv:456", the catalogue's ids. Pure, tested (tests/account-*.test.mjs).

export const BASE = 'https://api.themoviedb.org';
/** Where the person approves the request token, on their phone through the QR code. */
export const APPROVE = 'https://www.themoviedb.org/auth/access?request_token=';
/** The approve page without its code, for the screen to name (the link itself is too long to type). */
export const APPROVE_SHORT = 'themoviedb.org/auth/access';
/** Pages read at most from one account list: 20 titles a page. */
export const MAX_PAGES = 50;

export type Method = 'GET' | 'POST' | 'DELETE';
/** Which bearer token a call sends: the household's TMDB read token (the key page's), or the signed-in account's. */
export type Auth = 'app' | 'user';

export interface Call {
  method: Method;
  url: string;
  auth: Auth;
  /** JSON, or null for none. */
  body: string | null;
}

/** An answer: the HTTP status and the body as text. */
export interface Reply {
  status: number;
  body: string;
}

/** The household's lists that follow the account both ways: the watchlist, the favourites, and a private list for Seen. */
export type SyncList = 'myList' | 'favorites' | 'seen';
export const SYNC_LISTS: SyncList[] = ['myList', 'favorites', 'seen'];
/** Whether it is one of the account's own lists (a TMDB list id), rather than the watchlist or favourites. */
export const isCustomList = (l: SyncList) => l === 'seen';

/** TMDB keeps movies and shows apart in the watchlist and favourites. */
export const KINDS: ('movie' | 'tv')[] = ['movie', 'tv'];

/** The method and URL with any session id hidden; the body is left out, as it can hold a token. */
export const describe = (c: Call) => `${c.method} ${c.url.replace(/session_id=[^&]*/g, 'session_id=…')} (${c.auth})`;

// ---- Title ids ---------------------------------------------------------------------------------------------------

/** The TMDB number in a title id, or 0. */
export function number(id: string | null | undefined): number {
  const colon = id ? id.indexOf(':') : -1;
  if (colon < 0) return 0;
  const digits = (id as string).slice(colon + 1);
  return /^\d{1,9}$/.test(digits) ? parseInt(digits, 10) : 0;
}

/** "movie" or "tv" for a title id, or null when it is not a TMDB id. */
export function mediaType(id: string | null | undefined): 'movie' | 'tv' | null {
  if (!id) return null;
  if (id.indexOf('movie:') === 0 && number(id) > 0) return 'movie';
  if (id.indexOf('tv:') === 0 && number(id) > 0) return 'tv';
  return null;
}

/** The title id for a TMDB media type and number, or null for anything but a movie or a show. */
export function titleId(type: unknown, n: unknown): string | null {
  if (typeof n !== 'number' || !(n > 0) || n > 999999999 || Math.floor(n) !== n) return null;
  if (type === 'movie') return `movie:${n}`;
  if (type === 'tv') return `tv:${n}`;
  return null;
}

const enc = (s: string | null | undefined) => encodeURIComponent(s == null ? '' : s);
const call = (method: Method, path: string, auth: Auth, body: unknown): Call => ({
  method,
  url: BASE + path,
  auth,
  body: body === undefined ? null : JSON.stringify(body),
});
const get = (path: string): Call => call('GET', path, 'user', undefined);

// ---- Sign-in -----------------------------------------------------------------------------------------------------

/** Step 1: a request token for the person to approve. */
export const requestToken = (): Call => call('POST', '/4/auth/request_token', 'app', {});
/** Step 2: the page the QR code opens. */
export const approveUrl = (token: string) => APPROVE + enc(token);
/** Step 3, polled while the code shows: the account's access token once the request token is approved. */
export const accessToken = (token: string): Call => call('POST', '/4/auth/access_token', 'app', { request_token: token });
/** Step 4: a v3 session id from the access token, for the watchlist and favourite writes. */
export const session = (access: string): Call => call('POST', '/3/authentication/session/convert/4', 'app', { access_token: access });
/** Step 5: the v3 account, for its number and name. */
export const account = (sessionId: string): Call => ({ method: 'GET', url: `${BASE}/3/account?session_id=${enc(sessionId)}`, auth: 'app', body: null });
/** Signing out: the access token is revoked. */
export const logout = (access: string): Call => call('DELETE', '/4/auth/access_token', 'app', { access_token: access });
/** Signing out: the v3 session is deleted. */
export const deleteSession = (sessionId: string): Call => call('DELETE', '/3/authentication/session', 'app', { session_id: sessionId });

// ---- Reading -----------------------------------------------------------------------------------------------------

/** A page of the watchlist (My list) or the favourites, oldest first so new titles land at the end. */
export function accountPage(accountObjectId: string, list: SyncList, kind: 'movie' | 'tv', page: number): Call {
  if (isCustomList(list)) throw new Error(`${list} is a TMDB list; use listPage`);
  const which = list === 'myList' ? 'watchlist' : 'favorites';
  return get(`/4/account/${enc(accountObjectId)}/${kind}/${which}?page=${page}&sort_by=created_at.asc`);
}

/** A page of the account's own lists, private ones included. */
export const accountLists = (accountObjectId: string, page: number): Call => get(`/4/account/${enc(accountObjectId)}/lists?page=${page}`);

/** A page of a TMDB list's titles, with the account's token (its private lists too). */
export const listPage = (listId: number, page: number): Call => get(`/4/list/${listId}?page=${page}`);

// ---- Writing -----------------------------------------------------------------------------------------------------

/** A private list, for Seen. */
export const createList = (name: string): Call => call('POST', '/4/list', 'user', { name, description: '', iso_639_1: 'en', public: false });

function requireType(id: string): 'movie' | 'tv' {
  const t = mediaType(id);
  if (!t) throw new Error(`not a TMDB title id: ${id}`);
  return t;
}

/** Adds a title to the watchlist or the favourites, or takes it off. */
export function setOnAccount(accountId: number, sessionId: string, list: SyncList, id: string, on: boolean): Call {
  if (isCustomList(list)) throw new Error(`${list} is a TMDB list; use listItems`);
  const which = list === 'myList' ? 'watchlist' : 'favorite';
  const body: Record<string, unknown> = { media_type: requireType(id), media_id: number(id) };
  body[which] = on;
  return { method: 'POST', url: `${BASE}/3/account/${accountId}/${which}?session_id=${enc(sessionId)}`, auth: 'app', body: JSON.stringify(body) };
}

/** Adds titles to a TMDB list, or removes them. */
export const listItems = (listId: number, ids: string[], add: boolean): Call =>
  call(add ? 'POST' : 'DELETE', `/4/list/${listId}/items`, 'user', { items: ids.map((id) => ({ media_type: requireType(id), media_id: number(id) })) });
