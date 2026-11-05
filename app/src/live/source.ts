// The data-source seam: the one thing Movies, TV Shows, Search and the title and person pages read. Everything is a
// synchronous read of what has arrived so far, with a phase, and the first read of anything starts its load; when it
// lands, listeners hear of it and the screen draws again. The screens never wait on the network, and with the answers
// cached (live/cache.ts) the last catalogue is there the moment they open, offline too. Without a TMDB key nothing is
// asked and every read says "nokey": the screens show "Add a TMDB key", never a sample.
//
// Platform-free and DOM-free; live/live.ts wires it to the TV.
import type { Kind } from '@hometv/core/types.ts';
import type { Client, Result, Searched } from './client';
import { listsFor } from './tmdb';
import type { Credits, LiveSeason, LiveTitle } from './types';

/** Where a read stands: loading, loaded (possibly an old answer), or why there is none. */
export type Phase = 'loading' | 'ready' | 'nokey' | 'offline' | 'error';

export interface View<T> {
  phase: Phase;
  value: T;
  /** The answer shown is an old one (the network is off or failed). */
  stale: boolean;
}

/** How many pages of each list (20 titles a page) a row holds. */
export const PAGES = 2;
/** Titles kept in memory; the cache behind them holds more. */
export const MEMORY = 800;

export interface Source {
  hasKey(): boolean;
  /** Calls `fn` after anything arrives or the key changes; returns a function that stops it. */
  on(fn: () => void): () => void;
  /** A list's titles for a kind (`id` from tmdb.ts LISTS); starts loading it the first time. */
  list(kind: Kind, id: string): View<LiveTitle[]>;
  /** A title seen so far (a list item, a search hit, a credit, details) or undefined. Never loads. */
  title(id: string): LiveTitle | undefined;
  /** Loads a title's details (once); `title(id)` then returns the detailed one. */
  need(id: string): View<LiveTitle | undefined>;
  /** A show's season with its episodes; starts loading it the first time. */
  season(id: string, n: number): View<LiveSeason | undefined>;
  person(n: number): View<Credits | undefined>;
  search(query: string): View<Searched>;
  /** The popular titles of a genre (movies and shows), for Search's genre results and Browse by genre. */
  genre(name: string): View<LiveTitle[]>;
  /** A new key (or none): what was shown is forgotten and asked again. */
  setKey(key: string): void;
  /** The network came back: what failed or waited for it is asked again. */
  retry(): void;
}

const EMPTY: Searched = { titles: [], people: [], extra: [] };

export function createSource(client: Client, key: () => string): Source {
  const listeners: (() => void)[] = [];
  const known = new Map<string, LiveTitle>();
  const lists: Record<string, View<LiveTitle[]>> = {};
  const details: Record<string, View<LiveTitle | undefined>> = {};
  const seasons: Record<string, View<LiveSeason | undefined>> = {};
  const people: Record<string, View<Credits | undefined>> = {};
  const searches: Record<string, View<Searched>> = {};
  const genres: Record<string, View<LiveTitle[]>> = {};
  let searchOrder: string[] = [];
  let generation = 0;

  const emit = () => listeners.slice().forEach((fn) => fn());

  const phaseOf = <T>(r: Result<T>): Phase => (r.value !== null ? 'ready' : r.status === 'nokey' ? 'nokey' : r.status === 'offline' ? 'offline' : 'error');

  /** Remembers a title; a summary never replaces details, and the oldest go when memory is full. */
  function remember(t: LiveTitle) {
    const was = known.get(t.id);
    if (was && was.detailed && !t.detailed) return;
    known.delete(t.id);
    known.set(t.id, t);
    if (known.size > MEMORY) known.delete(known.keys().next().value as string);
  }

  /** Starts a load unless one is under way or done; `done` stores the result and says whether it changed what shows. */
  function start<T>(table: Record<string, View<T>>, id: string, empty: T, load: () => Promise<Result<T>>, keep: (v: T) => void): View<T> {
    const have = table[id];
    if (have) return have;
    const loading: View<T> = { phase: 'loading', value: empty, stale: false };
    table[id] = loading;
    const gen = generation;
    load().then((r) => {
      if (gen !== generation) return;
      if (r.value !== null) keep(r.value);
      table[id] = { phase: phaseOf(r), value: r.value !== null ? r.value : empty, stale: r.status === 'stale' };
      emit();
    });
    return loading;
  }

  const empty: never[] = [];

  return {
    hasKey: () => !!key(),

    on(fn) {
      listeners.push(fn);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },

    list(kind, id) {
      const def = listsFor(kind).filter((l) => l.id === id)[0];
      return start<LiveTitle[]>(
        lists,
        `${kind}|${id}`,
        empty,
        () => {
          if (!def) return Promise.resolve({ value: [], status: 'ok' } as Result<LiveTitle[]>);
          const pages: Promise<Result<LiveTitle[]>>[] = [];
          for (let p = 1; p <= PAGES; p++) pages.push(client.list(kind, def, p));
          return Promise.all(pages).then((rs) => {
            const items: LiveTitle[] = [];
            const seen: Record<string, true> = {};
            for (const r of rs) for (const t of r.value || []) if (!seen[t.id]) ((seen[t.id] = true), items.push(t));
            const first = rs[0];
            // A list with its first page is shown even when the second failed.
            return { value: first.value !== null ? items : null, status: rs.some((r) => r.status === 'stale') ? 'stale' : first.status } as Result<LiveTitle[]>;
          });
        },
        (items) => items.forEach(remember),
      );
    },

    title: (id) => known.get(id),

    need(id) {
      const t = known.get(id);
      if (t && t.detailed) return { phase: 'ready', value: t, stale: false };
      return start<LiveTitle | undefined>(
        details,
        id,
        t,
        () => client.details(id) as Promise<Result<LiveTitle | undefined>>,
        (d) => d && remember(d),
      );
    },

    season(id, n) {
      const t = known.get(id);
      return start<LiveSeason | undefined>(
        seasons,
        `${id}|${n}`,
        undefined,
        () => client.season(id, n, t ? t.episodeRuntime : 0) as Promise<Result<LiveSeason | undefined>>,
        () => undefined,
      );
    },

    person(n) {
      return start<Credits | undefined>(
        people,
        String(n),
        undefined,
        () => client.person(n) as Promise<Result<Credits | undefined>>,
        (c) => c && c.titles.forEach(remember),
      );
    },

    genre(name) {
      return start<LiveTitle[]>(
        genres,
        name,
        empty,
        () =>
          Promise.all([client.genre('movie', name), client.genre('show', name)]).then(([m, s]) => {
            // Movies and shows take turns, each in its own popularity order.
            const items: LiveTitle[] = [];
            const a = m.value || [];
            const b = s.value || [];
            for (let i = 0; i < Math.max(a.length, b.length); i++) {
              if (a[i]) items.push(a[i]);
              if (b[i]) items.push(b[i]);
            }
            const ok = m.value !== null || s.value !== null;
            const status = m.status === 'stale' || s.status === 'stale' ? 'stale' : m.value !== null ? m.status : s.status;
            return { value: ok ? items : null, status } as Result<LiveTitle[]>;
          }),
        (items) => items.forEach(remember),
      );
    },

    search(query) {
      const q = query.trim().toLowerCase();
      if (!q) return { phase: 'ready', value: EMPTY, stale: false };
      if (!searches[q]) {
        searchOrder.push(q);
        // The last few searches stay; the cache holds the rest.
        if (searchOrder.length > 8) delete searches[searchOrder.shift() as string];
      }
      return start<Searched>(
        searches,
        q,
        EMPTY,
        () => client.search(q),
        (s) => s.titles.concat(s.extra).forEach(remember),
      );
    },

    setKey() {
      generation++;
      for (const t of [lists, details, seasons, people, searches, genres]) for (const k of Object.keys(t)) delete t[k];
      searchOrder = [];
      emit();
    },

    retry() {
      generation++;
      client.forgetFailures();
      let any = false;
      for (const t of [lists, details, seasons, people, searches, genres] as Record<string, View<unknown>>[]) {
        for (const k of Object.keys(t)) {
          if (t[k].phase === 'ready' && !t[k].stale) continue;
          delete t[k];
          any = true;
        }
      }
      if (any) emit();
    },
  };
}
