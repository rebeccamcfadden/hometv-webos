// The price lookups, ported from the Android launcher's PriceLookup, PriceBook and PriceCachePolicy.needsLookup. A title
// page (or a visible row) asks `want`; the title is queued (queue.ts) and one worker, one lookup at a time, asks Watchmode,
// Movie of the Night when Watchmode had no price, and iTunes (by Wikidata's ids) when nobody priced the Apple TV Store.
// The result is kept per title in the cache: prices a week (policy.ts), Wikidata's ids a month, a failure an hour. Nothing
// is asked for a whole catalogue, nothing without a key except iTunes, and a failed run keeps the prices it had. The
// listeners hear of each finished title. Not ported: the Movie of the Night change feed (stale marks), deep links.
import type { Cache } from '../cache';
import type { Reply } from '../../netReply';
import type { Kind } from '@hometv/core/types.ts';
import { createHttp } from './http';
import type { LedgerStore } from './http';
import * as itunes from './itunes';
import * as motn from './motn';
import { DAY, DEEP_LINK_TTL, FAILURE_RETRY, PRICE_TTL, fresh, needsItunes } from './policy';
import { PriceQueue } from './queue';
import { OverBudget } from './types';
import type { PriceRegion, PriceTitle, StorePrice, Trigger } from './types';
import * as watchmode from './watchmode';
import * as wikidata from './wikidata';

export interface PriceKeys {
  watchmode: string;
  motn: string;
}

export interface BookDeps {
  send(url: string, headers: Record<string, string>): Promise<Reply | null>;
  now(): number;
  sleep(ms: number): Promise<void>;
  cache: Cache;
  ledger: LedgerStore | null;
  keys(): PriceKeys;
  region(): PriceRegion;
  online(): boolean;
}

/** What the last lookup of a title found. */
export interface Entry {
  /** Which keyed sources were set when it ran ("w", "m", "wm" or ""), so a key typed later asks again. */
  keys: string;
  /** Apple's ids from Wikidata; null until asked. */
  ids: string[] | null;
  idsAt: number;
  prices: StorePrice[];
  pricedAt: number;
  failedAt: number;
  /** A row's lookup was stopped by a budget: a title page may still ask. */
  listBlocked: boolean;
}

export interface Want {
  /** `movie:603` or `tv:1396`. */
  id: string;
  kind: Kind;
  name: string;
  year: number;
}

const tmdbIdOf = (id: string): number => parseInt(id.slice(id.indexOf(':') + 1), 10) || 0;
const sig = (k: PriceKeys): string => (k.watchmode.trim() ? 'w' : '') + (k.motn.trim() ? 'm' : '');
const MEMORY = 200;

/** Whether `want` should look the title up: no entry, an entry a week old, or a failed one an hour old (a title page may retry a row's budget block at once). */
export function needsLookup(e: Entry | null, keys: string, preview: boolean, now: number): boolean {
  if (!e) return true;
  if (e.keys !== keys) return true;
  if (fresh(e.pricedAt, now, PRICE_TTL)) return false;
  if (e.failedAt > 0 && now - e.failedAt < FAILURE_RETRY) return preview && e.listBlocked;
  return true;
}

export interface Book {
  /** Asks for the title's prices when they aren't known and fresh; the answer arrives through `on`. */
  want(t: Want, trigger: Trigger): void;
  /** What is known of the title now, without asking. */
  entry(id: string): Entry | null;
  on(fn: (id: string) => void): void;
  /** Titles waiting or running. */
  pending(): number;
}

export function createBook(d: BookDeps): Book {
  const http = createHttp(d);
  const queue = new PriceQueue();
  const listeners: ((id: string) => void)[] = [];
  const mem: Record<string, Entry> = {};
  let memCount = 0;
  let running: string | null = null;
  let draining = false;

  const keyOf = (id: string): string => `pe:${d.region().code}:${id}`;

  const load = (id: string): Entry | null => {
    const k = keyOf(id);
    if (mem[k]) return mem[k];
    const hit = d.cache.get<Entry>(k);
    if (!hit || !hit.value || !Array.isArray(hit.value.prices)) return null;
    return remember(k, hit.value);
  };
  const remember = (k: string, e: Entry): Entry => {
    if (memCount >= MEMORY) {
      for (const x of Object.keys(mem)) delete mem[x];
      memCount = 0;
    }
    if (!mem[k]) memCount++;
    return (mem[k] = e);
  };

  async function lookup(job: { id: string; kind: Kind; name: string; year: number; trigger: Trigger }, old: Entry | null): Promise<Entry> {
    const now = d.now();
    const region = d.region();
    const k = d.keys();
    const title: PriceTitle = { tmdbId: tmdbIdOf(job.id), kind: job.kind, name: job.name, year: job.year, itunesIds: old && old.ids ? old.ids : [] };
    let found: StorePrice[] = [];
    let blocked = false;
    let keyedFailed = false;
    let keyedOk = false;

    const keyedSource = async (call: () => Promise<StorePrice[]>): Promise<void> => {
      try {
        found = await call();
        keyedOk = true;
      } catch (e) {
        if (e instanceof OverBudget) blocked = true;
        else keyedFailed = true;
      }
    };
    if (k.watchmode.trim()) {
      await keyedSource(async () => watchmode.parse(await http.request(watchmode.ID, job.trigger, watchmode.url(title, region), watchmode.headers(k.watchmode)), region));
    }
    if (!found.length && k.motn.trim()) {
      await keyedSource(async () => motn.parse(await http.request(motn.ID, job.trigger, motn.url(title, region), motn.headers(k.motn)), region));
    }
    if (keyedOk) blocked = false;
    let pricesOk = keyedOk || (!blocked && !keyedFailed);

    let ids = old ? old.ids : null;
    let idsAt = old ? old.idsAt : 0;
    let idsOk = true;
    let apple: StorePrice[] = [];
    if (needsItunes(found)) {
      if (ids === null || !fresh(idsAt, now, DEEP_LINK_TTL)) {
        try {
          ids = wikidata.itunesIds(await http.request(wikidata.ID, job.trigger, wikidata.url(job.kind, title.tmdbId), {}), job.kind);
          idsAt = d.now();
          title.itunesIds = ids;
        } catch (e) {
          idsOk = false;
        }
      }
      try {
        apple = await itunes.prices(title, region, (u) => http.request(itunes.ID, job.trigger, u, {}));
      } catch (e) {
        pricesOk = false;
      }
    }

    const all = found.concat(apple);
    const keepOld = !(pricesOk || blocked || all.length > 0);
    return {
      keys: sig(k),
      ids,
      idsAt,
      prices: keepOld && old ? old.prices : all,
      pricedAt: pricesOk ? d.now() : old ? old.pricedAt : 0,
      failedAt: !idsOk || !pricesOk ? d.now() : 0,
      listBlocked: blocked && job.trigger === 'background',
    };
  }

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      for (let job = queue.poll(); job; job = queue.poll()) {
        running = job.id;
        const old = load(job.id);
        let e: Entry | null = null;
        try {
          e = await lookup(job, old);
        } catch (err) {
          e = null;
        }
        if (e) {
          const key = keyOf(job.id);
          remember(key, e);
          d.cache.put(key, e, DAY * 30);
        }
        running = null;
        for (const fn of listeners) fn(job.id);
      }
    } finally {
      running = null;
      draining = false;
    }
  }

  return {
    want(t, trigger) {
      if (t.id === running) return;
      const preview = trigger === 'preview';
      if (!needsLookup(load(t.id), sig(d.keys()), preview, d.now())) return;
      if (!d.online()) return;
      if (!queue.add(t.id, t.kind, t.name, t.year, true, trigger) && preview) queue.boost(t.id, true);
      void drain();
    },
    entry: load,
    on(fn) {
      listeners.push(fn);
    },
    pending: () => queue.size() + (running ? 1 : 0),
  };
}
