// The live catalogue as the screens use it: the source (live/source.ts) wired to the page's network, storage, region and
// the household's TMDB key. The key is read from the key page's private file (bridge.platform.keyPages.tmdbKey) when the
// screens start and again whenever one of them comes back to the front, so a key sent from the phone shows at once.
// Only v1 builds import this (features.ts): v0 has no screen that reads it.
//
// Prices (live/prices/): a title page asks `wantPrices`, and the price book looks the title up in the keyed sources
// (Watchmode, Movie of the Night) and Apple's store, one at a time and within their quotas. What it finds is laid over
// the title's TMDB offers here, so every screen that reads `title`/`need` shows the merged ones.
import { bridge } from '../bridge';
import { HOME_APPS } from '../apps';
import { pickServices, settings } from '../data/settings';
import { pageStorage, prefs } from '../launcherSettings';
import { getText } from '../net';
import { getReply } from '../netReply';
import { createCache } from './cache';
import { createClient, MAX_CHARS, TIMEOUT } from './client';
import { installedPicks } from './installed';
import { createPrefetch } from './prefetch';
import { createBook } from './prices/book';
import { merge } from './prices/merge';
import { regionFor } from './prices/types';
import { createSource } from './source';
import { regionCode } from './tmdb';
import type { LiveTitle } from './types';

let key = '';
let read = false;
let region = regionCode(prefs.get().region);

let priceKeys = { watchmode: '', motn: '' };
const cache = createCache(pageStorage(), () => Date.now());

const client = createClient({
  get: (url, headers) => getText(url, TIMEOUT, MAX_CHARS, headers),
  key: () => key,
  region: () => region,
  online: () => bridge.platform.online(),
  now: () => Date.now(),
  cache,
});

const source = createSource(client, () => key);
const listeners: (() => void)[] = [];

const book = createBook({
  send: (url, headers) => getReply(url, headers, TIMEOUT, MAX_CHARS),
  now: () => Date.now(),
  sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  cache,
  ledger: pageStorage(),
  keys: () => priceKeys,
  region: () => regionFor(region),
  online: () => bridge.platform.online(),
});
book.on(() => listeners.slice().forEach((fn) => fn()));

/** A detailed title with the prices found for it laid over its offers; the same object while neither changes. */
const laid: Record<string, { base: LiveTitle; prices: unknown; region: string; out: LiveTitle }> = {};
function priced(t: LiveTitle | undefined): LiveTitle | undefined {
  if (!t || !t.detailed) return t;
  const e = book.entry(t.id);
  if (!e || !e.prices.length) return t;
  const m = laid[t.id];
  if (m && m.base === t && m.prices === e.prices && m.region === region) return m.out;
  const r = merge(t.offers, e.prices, regionFor(region));
  const out: LiveTitle = { ...t, offers: r.offers, priceSources: r.sources };
  laid[t.id] = { base: t, prices: e.prices, region, out };
  return out;
}

/** The apps installed on the TV tick the streaming services they are, so "included" means a service the household has. */
function tickInstalled(): void {
  const idOfKey: Record<string, string> = {};
  for (const a of HOME_APPS) idOfKey[a.key] = a.id;
  bridge
    .installedApps()
    .then((apps) => {
      if (apps && apps.length) settings.set({ services: installedPicks(apps, pickServices(), idOfKey) });
    })
    .catch(() => undefined);
}

const prefetch = createPrefetch(
  (id) => source.need(id),
  (fn) => source.on(fn),
);

/** Reads the key and the region again; a changed one sends every screen back for its data. */
function checkKey(): void {
  const r = regionCode(prefs.get().region);
  if (r !== region) {
    region = r;
    source.setKey(key);
    // The other region starts from its own default ticks (settings.ts); the installed apps tick them again.
    tickInstalled();
  }
  bridge.platform.keyPages
    .priceKeys()
    .then((k) => {
      priceKeys = k;
    })
    .catch(() => undefined);
  bridge.platform.keyPages
    .tmdbKey()
    .then((k) => {
      const first = !read;
      read = true;
      if (k === key && !first) return;
      key = k;
      source.setKey(k);
    })
    .catch(() => undefined);
}

checkKey();
tickInstalled();
window.addEventListener('online', () => source.retry());

export const live = {
  ...source,
  title: (id: string) => priced(source.title(id)),
  need: (id: string) => {
    const v = source.need(id);
    return v.value ? { ...v, value: priced(v.value) } : v;
  },
  on: (fn: () => void) => {
    listeners.push(fn);
    const off = source.on(fn);
    return () => {
      off();
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  },
  /** A title page opened: look up its prices (a week's cache answers at once). Never waits; `on` hears the answer. */
  wantPrices(t: Pick<LiveTitle, 'id' | 'kind' | 'name' | 'year'>): void {
    book.want({ id: t.id, kind: t.kind, name: t.name, year: t.year }, 'preview');
  },
  /** Loads the details of these titles (a few at a time) for the filters that need runtime and where to watch. */
  prefetch: (ids: string[]) => prefetch.ask(ids),
  prefetching: (ids: string[]) => prefetch.waiting(ids),
  /** True until the key has been read, so a screen doesn't flash "Add a TMDB key" while it is. */
  hasKey: () => !read || !!key,
  checkKey,
};
