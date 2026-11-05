// Watchmode, ported from the Android launcher's WatchmodePrices: rent and buy prices for a TMDB title in the region,
// asked by TMDB id with the household's key in an X-API-Key header. Watchmode gives no currency; a price is in the
// region's own. Stores are matched by name; one the app doesn't know is dropped.
import type { PriceRegion, PriceTitle, StorePrice } from './types';
import { amountOf, qualityOf } from './types';
import { storeForName } from './stores';

export const ID = 'watchmode';
export const STATUS = 'https://api.watchmode.com/v1/status/';

export const url = (t: PriceTitle, r: PriceRegion): string =>
  `https://api.watchmode.com/v1/title/${t.kind === 'movie' ? 'movie' : 'tv'}-${t.tmdbId}/sources/?regions=${r.code}`;

export const headers = (key: string): Record<string, string> => ({ 'X-API-Key': key.trim() });

/** The rent and buy prices in the region; a source without a price, in another region or at an unknown store is skipped. A missing quality counts as HD. Throws on text that isn't JSON. */
export function parse(text: string | null, r: PriceRegion): StorePrice[] {
  if (!text) return [];
  const list: unknown = JSON.parse(text);
  if (!Array.isArray(list)) return [];
  const out: StorePrice[] = [];
  for (const s of list as Record<string, unknown>[]) {
    if (!s || typeof s !== 'object' || String(s.region || '').toUpperCase() !== r.code) continue;
    const type = s.type === 'rent' ? 'rent' : s.type === 'buy' ? 'buy' : null;
    const amount = amountOf(s.price);
    const store = storeForName(s.name);
    if (!type || amount === null || !store) continue;
    out.push({ store, type, quality: qualityOf(s.format) || 'HD', amount, currency: r.currency, season: 0, source: 'watchmode' });
  }
  return out;
}
