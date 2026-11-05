// Movie of the Night (the Streaming Availability API), ported from the Android launcher's StreamingAvailabilityPrices:
// a title's streaming options with prices in the region, by TMDB id, with the household's key in an X-API-Key header. A
// show is asked for by season, since a series often has no price of its own; an option through an add-on channel is
// skipped.
import type { PriceRegion, PriceTitle, StorePrice } from './types';
import { amountOf, qualityOf } from './types';
import { storeForName } from './stores';

export const ID = 'streamingavailability';

export const url = (t: PriceTitle, r: PriceRegion): string =>
  `https://api.movieofthenight.com/v4/shows/${t.kind === 'movie' ? 'movie' : 'tv'}/${t.tmdbId}?country=${r.country}${t.kind === 'movie' ? '' : '&series_granularity=season'}`;

export const headers = (key: string): Record<string, string> => ({ 'X-API-Key': key.trim() });

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);

function options(byCountry: unknown, r: PriceRegion, season: number, out: StorePrice[]): void {
  const c = obj(byCountry);
  const list = c && c[r.country];
  if (!Array.isArray(list)) return;
  for (const raw of list) {
    const o = obj(raw);
    if (!o || o.addon) continue;
    const type = o.type === 'rent' ? 'rent' : o.type === 'buy' ? 'buy' : null;
    const price = obj(o.price);
    const service = obj(o.service);
    if (!type || !price || !service) continue;
    const store = storeForName(service.id) || storeForName(service.name);
    const amount = amountOf(price.amount);
    const currency = typeof price.currency === 'string' ? price.currency.toUpperCase() : '';
    if (!store || amount === null || !currency) continue;
    out.push({ store, type, quality: qualityOf(o.quality) || 'HD', amount, currency, season, source: 'streamingavailability' });
  }
}

/** The show's own rent and buy prices (season 0), then each season's, numbered from its title. Throws on text that isn't JSON. */
export function parse(text: string | null, r: PriceRegion): StorePrice[] {
  if (!text) return [];
  const show = obj(JSON.parse(text));
  if (!show) return [];
  const out: StorePrice[] = [];
  options(show.streamingOptions, r, 0, out);
  const seasons = Array.isArray(show.seasons) ? show.seasons : [];
  seasons.forEach((raw, i) => {
    const s = obj(raw);
    if (!s) return;
    const m = /(\d{1,3})/.exec(String(s.title || ''));
    options(s.streamingOptions, r, m ? parseInt(m[1], 10) : i + 1, out);
  });
  return out;
}
