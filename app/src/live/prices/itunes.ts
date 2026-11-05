// Apple's iTunes Store, ported from the Android launcher's ItunesPrices: no key, prices for the Apple TV Store. A title is
// looked up by the iTunes ids Wikidata keeps (several per film, one per storefront: the region's answers; a show's seasons
// have their own), and only without an answer searched for by name and year (match.ts). Apple prices rentals and purchases
// in SD and HD, HD including 4K where Apple has it. Seasons are bought, never rented. Apple asks for no more than about 20
// requests a minute (policy.ts). Since late 2025 the search finds no movies, so a movie needs Wikidata's ids.
import { movieScore, season, seasonMatches, yearOf } from './match';
import type { PriceRegion, PriceTitle, StorePrice } from './types';
import { amountOf } from './types';
import type { Quality } from '@hometv/core/types.ts';

export const ID = 'itunes';
const BASE = 'https://itunes.apple.com/';

/** The lookup for the title's iTunes ids in the region's store, or null when it has none. */
export function lookupUrl(t: PriceTitle, r: PriceRegion): string | null {
  const ids: string[] = [];
  for (const id of t.itunesIds) if (/^[1-9]\d{0,11}$/.test(id) && ids.indexOf(id) < 0) ids.push(id);
  return ids.length ? `${BASE}lookup?id=${ids.join(',')}&country=${r.country}` : null;
}

/** The search by name in the region's store: movies, or a show's seasons. */
export const searchUrl = (t: PriceTitle, r: PriceRegion): string =>
  `${BASE}search?term=${encodeURIComponent(t.name)}&country=${r.country}${t.kind === 'movie' ? '&media=movie&entity=movie&limit=10' : '&media=tvShow&entity=tvSeason&limit=25'}`;

type Obj = Record<string, unknown>;

function results(text: string | null): Obj[] {
  if (!text) return [];
  const r = (JSON.parse(text) as Obj | null)?.results;
  return Array.isArray(r) ? (r as Obj[]).filter((x) => x && typeof x === 'object') : [];
}

function add(out: StorePrice[], r: Obj, field: string, type: 'rent' | 'buy', quality: Quality, season: number): void {
  const amount = amountOf(r[field]);
  const currency = typeof r.currency === 'string' ? r.currency.toUpperCase() : '';
  if (amount !== null && currency) out.push({ store: 'appletv', type, quality, amount, currency, season, source: 'itunes' });
}

/** The best-matching movie's prices (the same year beats a year either side, then the first); empty when none matches. `byId` for a lookup answer. */
export function parseMovies(text: string | null, t: PriceTitle, byId: boolean): StorePrice[] {
  let best: Obj | null = null;
  let bestScore = -1;
  for (const r of results(text)) {
    if (r.kind !== 'feature-movie') continue;
    const score = movieScore(t, String(r.trackName || ''), yearOf(r.releaseDate), byId);
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  const out: StorePrice[] = [];
  if (!best) return out;
  add(out, best, 'trackRentalPrice', 'rent', 'SD', 0);
  add(out, best, 'trackHdRentalPrice', 'rent', 'HD', 0);
  add(out, best, 'trackPrice', 'buy', 'SD', 0);
  add(out, best, 'trackHdPrice', 'buy', 'HD', 0);
  return out;
}

/** Every matching season's purchase prices (Apple rents no seasons), by season number. */
export function parseSeasons(text: string | null, t: PriceTitle): StorePrice[] {
  const out: StorePrice[] = [];
  const seen: number[] = [];
  for (const r of results(text)) {
    if (r.collectionType !== 'TV Season') continue;
    const s = season(r.collectionName);
    if (!s || !seasonMatches(t, s, yearOf(r.releaseDate)) || seen.indexOf(s.season) >= 0) continue;
    seen.push(s.season);
    add(out, r, 'collectionPrice', 'buy', 'SD', s.season);
    add(out, r, 'collectionHdPrice', 'buy', 'HD', s.season);
  }
  return out;
}

/** The title's Apple prices: by its ids, then by search when the ids find nothing. `get` returns the answer's text or null for "not found", and throws when the request fails. */
export async function prices(t: PriceTitle, r: PriceRegion, get: (url: string) => Promise<string | null>): Promise<StorePrice[]> {
  const movie = t.kind === 'movie';
  const lookup = lookupUrl(t, r);
  if (lookup) {
    const found = movie ? parseMovies(await get(lookup), t, true) : parseSeasons(await get(lookup), t);
    if (found.length) return found;
  }
  const searched = await get(searchUrl(t, r));
  return movie ? parseMovies(searched, t, false) : parseSeasons(searched, t);
}
