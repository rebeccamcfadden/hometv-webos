// The TMDB client: one request layer over an injected network, key, region, clock and cache, so it runs the same on a TV
// and in a test with no network. A request is served from the cache while it is fresh; otherwise the network is asked and
// the parsed answer saved. When the network is off or fails, the last answer is served (stale) rather than nothing, and a
// failed address is not asked again for a minute (the launcher's CachedHttp policy). The key is sent in a header (a v4 read
// token) or as api_key (a v3 key); it is never part of a cache key.
import type { Kind } from '@hometv/core/types.ts';
import type { Cache } from './cache';
import * as parse from './parse';
import { API, detailsReq, discoverReq, genreId, listReq, parseId, personReq, searchReq, seasonReq } from './tmdb';
import type { ListDef, Req } from './tmdb';
import type { Credits, Found, LiveSeason, LiveTitle } from './types';

export interface Deps {
  /** The body of a GET, or null when it failed (net.getText's contract). */
  get(url: string, headers: Record<string, string>): Promise<string | null>;
  /** The TMDB key the household entered, or "" when there is none. */
  key(): string;
  /** "SE" or "US". */
  region(): string;
  online(): boolean;
  now(): number;
  cache: Cache;
}

export type Status = 'ok' | 'stale' | 'nokey' | 'offline' | 'error';

export interface Result<T> {
  value: T | null;
  status: Status;
}

/** A search answer: titles and people, and the titles the people are known for (they are not results themselves). */
export interface Searched extends Found {
  extra: LiveTitle[];
}

/** A failed address waits this long before it is asked again. */
export const RETRY_AFTER = 60 * 1000;
/** The longest answer taken: a details page with credits and providers runs to a few hundred KB. */
export const MAX_CHARS = 1500000;
export const TIMEOUT = 12000;

/** A v4 read token is a JWT (it has dots); a v3 key is 32 hex digits. */
export const isToken = (key: string) => key.indexOf('.') >= 0;

export function authed(url: string, key: string): { url: string; headers: Record<string, string> } {
  if (isToken(key)) return { url, headers: { Authorization: `Bearer ${key}` } };
  return { url: `${url}${url.indexOf('?') < 0 ? '?' : '&'}api_key=${encodeURIComponent(key)}`, headers: {} };
}

export interface Client {
  list(kind: Kind, list: ListDef, page: number): Promise<Result<LiveTitle[]>>;
  details(id: string): Promise<Result<LiveTitle>>;
  season(id: string, n: number, fallbackRuntime: number): Promise<Result<LiveSeason>>;
  person(n: number): Promise<Result<Credits>>;
  /** The popular titles of a genre of this kind; an empty answer when the kind has no such genre. */
  genre(kind: Kind, name: string): Promise<Result<LiveTitle[]>>;
  search(query: string): Promise<Result<Searched>>;
  /** The minute's wait after a failed address ends now (the network came back, or the household asked to try again). */
  forgetFailures(): void;
}

export function createClient(deps: Deps): Client {
  const failed: Record<string, number> = {};
  const inflight: Record<string, Promise<Result<unknown>> | undefined> = {};

  function fetchJson(req: Req, key: string): Promise<unknown | null> {
    const a = authed(API + req.path, key);
    return deps.get(a.url, a.headers).then((body) => {
      if (body === null) return null;
      try {
        return JSON.parse(body);
      } catch (e) {
        return null;
      }
    });
  }

  function request<T>(req: Req, cacheKey: string, map: (json: any) => T): Promise<Result<T>> {
    const cached = deps.cache.get<T>(cacheKey);
    if (cached && cached.fresh) return Promise.resolve({ value: cached.value, status: 'ok' });
    const stale = (status: Status): Result<T> => (cached ? { value: cached.value, status: 'stale' } : { value: null, status });
    const key = deps.key();
    if (!key) return Promise.resolve(stale('nokey'));
    if (!deps.online()) return Promise.resolve(stale('offline'));
    const lastFail = failed[cacheKey];
    if (lastFail !== undefined && deps.now() - lastFail < RETRY_AFTER) return Promise.resolve(stale('error'));
    if (inflight[cacheKey]) return inflight[cacheKey] as Promise<Result<T>>;
    const p = fetchJson(req, key).then((json): Result<T> => {
      delete inflight[cacheKey];
      if (json === null) {
        failed[cacheKey] = deps.now();
        return stale('error');
      }
      delete failed[cacheKey];
      const value = map(json);
      deps.cache.put(cacheKey, value, req.ttl);
      return { value, status: 'ok' };
    });
    inflight[cacheKey] = p;
    return p;
  }

  const region = () => deps.region().toUpperCase();

  return {
    forgetFailures() {
      for (const k of Object.keys(failed)) delete failed[k];
    },

    list(kind, list, page) {
      const r = region();
      const req = listReq(list, kind, page, r);
      return request(req, `${kind === 'movie' && list.id !== 'trending' ? r : ''}${req.path}`, (j) => parse.listItems(j, kind));
    },

    details(id) {
      const p = parseId(id);
      if (!p) return Promise.resolve({ value: null, status: 'error' });
      const r = region();
      const req = detailsReq(p.kind, p.n);
      return request(req, `${r}|${req.path}`, (j) => parse.details(j, p.kind, r));
    },

    season(id, n, fallbackRuntime) {
      const p = parseId(id);
      if (!p || p.kind !== 'show') return Promise.resolve({ value: null, status: 'error' });
      const req = seasonReq(p.n, n);
      return request(req, req.path, (j) => parse.season(j, fallbackRuntime));
    },

    person(n) {
      const req = personReq(n);
      return request(req, req.path, (j) => parse.credits(j));
    },

    genre(kind, name) {
      const id = genreId(kind, name);
      if (id === null) return Promise.resolve({ value: [], status: 'ok' });
      const r = region();
      const req = discoverReq(kind, id, r);
      return request(req, `${kind === 'movie' ? r : ''}${req.path}`, (j) => parse.listItems(j, kind));
    },

    search(query) {
      const req = searchReq(query);
      if (!query.trim()) return Promise.resolve({ value: { titles: [], people: [], extra: [] }, status: 'ok' });
      return request(req, req.path, (j): Searched => {
        const s = parse.search(j);
        const extra: LiveTitle[] = [];
        for (const k of Object.keys(s.known)) for (const t of s.known[Number(k)]) extra.push(t);
        return { titles: s.titles, people: s.people, extra };
      });
    },
  };
}

