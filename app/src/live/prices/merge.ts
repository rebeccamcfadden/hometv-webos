// The Android launcher's OfferMerge: TMDB's watch providers are the base (what is where, by type, in TMDB's order), and
// the price sources' prices go onto its rent and buy offers by store. Prices in another currency than the region's are
// ignored (they would be shown as the wrong money); each store/type keeps the cheapest price per picture quality. A store
// that a source priced but TMDB didn't list is appended after TMDB's offers.
import type { Offer, Quality } from '@hometv/core/types.ts';
import type { PriceRegion, PriceSourceId, StorePrice } from './types';

export const SOURCE_NAME: Record<PriceSourceId, string> = {
  itunes: 'Apple',
  watchmode: 'Watchmode',
  streamingavailability: 'Movie of the Night',
};
const CREDIT_ORDER: PriceSourceId[] = ['itunes', 'watchmode', 'streamingavailability'];

export interface Merged {
  offers: Offer[];
  /** The names of the sources whose price is shown, in a fixed order. */
  sources: string[];
}

interface Priced {
  store: StorePrice['store'];
  type: 'rent' | 'buy';
  prices: Partial<Record<Quality, number>>;
  from: Partial<Record<Quality, PriceSourceId>>;
  seasonal: boolean;
}

/** Merges `prices` (any sources, any order) onto the unpriced `base` offers for the region. */
export function merge(base: Offer[], prices: StorePrice[], region: PriceRegion): Merged {
  const priced: Record<string, Priced> = {};
  const order: string[] = [];
  for (const p of prices) {
    if (p.currency !== region.currency) continue;
    const key = `${p.store}|${p.type}`;
    let e = priced[key];
    if (!e) {
      e = priced[key] = { store: p.store, type: p.type, prices: {}, from: {}, seasonal: false };
      order.push(key);
    }
    const have = e.prices[p.quality];
    if (have === undefined || p.amount < have) {
      e.prices[p.quality] = p.amount;
      e.from[p.quality] = p.source;
    }
    if (p.season > 0) e.seasonal = true;
  }

  const used: Record<string, true> = {};
  const credited: Record<string, true> = {};
  const take = (key: string): Priced | null => {
    const e = priced[key];
    if (!e || used[key]) return null;
    used[key] = true;
    for (const q of Object.keys(e.from) as Quality[]) credited[e.from[q] as string] = true;
    return e;
  };

  const offers: Offer[] = [];
  const seen: Record<string, true> = {};
  for (const o of base) {
    const k = `${o.service}|${o.type}`;
    if (seen[k]) continue;
    seen[k] = true;
    const e = o.type === 'rent' || o.type === 'buy' ? take(k) : null;
    offers.push(e ? { ...o, prices: e.prices, ...(e.seasonal ? { seasonal: true } : {}) } : o);
  }
  for (const k of order) {
    const e = take(k);
    if (e) offers.push({ service: e.store, type: e.type, prices: e.prices, ...(e.seasonal ? { seasonal: true } : {}) });
  }
  return { offers, sources: CREDIT_ORDER.filter((s) => credited[s]).map((s) => SOURCE_NAME[s]) };
}
