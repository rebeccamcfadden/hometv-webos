// What the price sources share, ported from the Android launcher's Region, StorePrice and PriceTitle. Platform-free and
// DOM-free, like everything under live/.
import type { Kind, Quality, ServiceId } from '@hometv/core/types.ts';

export type SourceId = 'itunes' | 'watchmode' | 'streamingavailability' | 'wikidata';
export type PriceSourceId = Exclude<SourceId, 'wikidata'>;

/** The country prices are asked for: `code` is TMDB's and Watchmode's name for it, `country` iTunes' and Movie of the Night's. */
export interface PriceRegion {
  code: 'SE' | 'US';
  country: 'se' | 'us';
  currency: 'SEK' | 'USD';
}

export const REGIONS: Record<'SE' | 'US', PriceRegion> = {
  SE: { code: 'SE', country: 'se', currency: 'SEK' },
  US: { code: 'US', country: 'us', currency: 'USD' },
};

/** The region for a TMDB region code (tmdb.ts regionCode), Sweden for anything else. */
export const regionFor = (code: string): PriceRegion => (code === 'US' ? REGIONS.US : REGIONS.SE);

/** One store's price for one picture quality, from one source. `season` is 0 for the title itself. */
export interface StorePrice {
  store: ServiceId;
  type: 'rent' | 'buy';
  quality: Quality;
  /** Major units (39 for 39 kr, 3.99 for $3.99), rounded to two decimals. */
  amount: number;
  currency: string;
  season: number;
  source: PriceSourceId;
}

/** The title a source is asked about. */
export interface PriceTitle {
  tmdbId: number;
  kind: Kind;
  name: string;
  /** Release year, 0 when unknown. */
  year: number;
  /** Apple's ids for it from Wikidata (a movie's, or a show's seasons'). */
  itunesIds: string[];
}

/** Why a lookup is wanted: a title page that opened, or a row that is showing. */
export type Trigger = 'preview' | 'background';

/** A source that is out of its budget: the caller tries another source, or none. */
export class OverBudget extends Error {
  constructor(source: string) {
    super(`${source}: over budget`);
  }
}

/** The price in major units from a source's number or text, rounded to the cent; null when it isn't a positive amount. */
export function amountOf(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.trim()) : NaN;
  if (!isFinite(n) || n <= 0) return null;
  const r = Math.round(n * 100) / 100;
  return r > 0 ? r : null;
}

/** Lowercase letters and digits only: "Google Play Movies & TV" becomes "googleplaymoviestv". */
export const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** From a source's own word: "sd", "HD", "4K", "uhd", "qhd" (Movie of the Night's 1440p, sold as HD); null for anything else. */
export function qualityOf(s: unknown): Quality | null {
  switch (typeof s === 'string' ? s.trim().toUpperCase() : '') {
    case 'SD':
      return 'SD';
    case 'HD':
    case 'QHD':
    case 'FHD':
      return 'HD';
    case '4K':
    case 'UHD':
      return '4K';
    default:
      return null;
  }
}
