// TMDB's addresses and vocabularies, ported from the Android launcher (TmdbApi, GenreMap, Certifications,
// WatchProviders): what to ask, how long an answer keeps, and the launcher's words for genres, ratings and services.
// Platform-free and pure; the key never appears here.
import type { Kind, OfferType, ServiceId } from '@hometv/core/types.ts';

export const API = 'https://api.themoviedb.org/3';
export const IMAGES = 'https://image.tmdb.org/t/p/';
export const LANGUAGE = 'en-US';

const HOUR = 60 * 60 * 1000;
/** How long an answer is fresh (the launcher's CachedHttp policy): a search an hour, lists three, a title twelve, the rest a week. */
export const TTL = { search: HOUR, list: 3 * HOUR, title: 12 * HOUR, other: 7 * 24 * HOUR };

/** Small sizes for a TV with 1 GB: posters w342, backdrops w780, faces w185. */
export const POSTER_SIZE = 'w342';
export const BACKDROP_SIZE = 'w780';
export const PROFILE_SIZE = 'w185';

/** An image path TMDB sends ("/abc.jpg"); anything else is not one. */
export const isImagePath = (p: unknown): p is string => typeof p === 'string' && /^\/[A-Za-z0-9_.-]+$/.test(p);

export const imageUrl = (path: string | null | undefined, size: string): string | null =>
  isImagePath(path) ? `${IMAGES}${size}${path}` : null;

// ---- Ids ---------------------------------------------------------------------------------------------------------

/** `movie:603` or `tv:1396`. */
export const titleId = (kind: Kind, n: number) => `${kind === 'movie' ? 'movie' : 'tv'}:${n}`;

export function parseId(id: string): { kind: Kind; n: number } | null {
  const m = /^(movie|tv):(\d{1,9})$/.exec(id);
  return m ? { kind: m[1] === 'movie' ? 'movie' : 'show', n: parseInt(m[2], 10) } : null;
}

const seg = (kind: Kind) => (kind === 'movie' ? 'movie' : 'tv');

// ---- Requests: a path with its query, and how long the answer keeps ------------------------------------------------------

export interface Req {
  /** Path and query, without the key and the host; also the cache key. */
  path: string;
  ttl: number;
}

const q = (params: [string, string | number][]) => params.map((p) => `${p[0]}=${encodeURIComponent(String(p[1]))}`).join('&');
const lang: [string, string] = ['language', LANGUAGE];

/** /movie/{id} with credits, release dates, videos, recommendations, similar and watch providers appended. */
export function detailsReq(kind: Kind, n: number): Req {
  const extra = kind === 'movie' ? 'credits,release_dates,videos,recommendations,similar,watch/providers' : 'credits,content_ratings,videos,recommendations,similar,watch/providers';
  // The commas and the slash stay as TMDB writes them.
  return { path: `/${seg(kind)}/${n}?append_to_response=${extra}&${q([lang])}`, ttl: TTL.title };
}

export const seasonReq = (n: number, season: number): Req => ({ path: `/tv/${n}/season/${season}?${q([lang])}`, ttl: TTL.other });

export const personReq = (n: number): Req => ({ path: `/person/${n}?append_to_response=combined_credits&${q([lang])}`, ttl: TTL.other });

export const searchReq = (query: string): Req => ({
  path: `/search/multi?${q([['query', query.trim().toLowerCase()], ['include_adult', 'false'], lang, ['page', 1]])}`,
  ttl: TTL.search,
});

/** The rows of Movies and TV Shows (chips), each a TMDB list. */
export interface ListDef {
  id: string;
  name: string;
  /** Path of the list for each kind that has it. */
  path: Partial<Record<Kind, string>>;
}

export const LISTS: ListDef[] = [
  { id: 'trending', name: 'Trending', path: { movie: '/trending/movie/week', show: '/trending/tv/week' } },
  { id: 'popular', name: 'Popular', path: { movie: '/movie/popular', show: '/tv/popular' } },
  { id: 'top', name: 'Top rated', path: { movie: '/movie/top_rated', show: '/tv/top_rated' } },
  { id: 'now', name: 'Now playing', path: { movie: '/movie/now_playing' } },
  { id: 'air', name: 'On the air', path: { show: '/tv/on_the_air' } },
];

export const listsFor = (kind: Kind): ListDef[] => LISTS.filter((l) => !!l.path[kind]);

/** One page of a list; a movie list is for the region's cinemas and releases. */
export function listReq(list: ListDef, kind: Kind, page: number, region: string): Req {
  const params: [string, string | number][] = [lang, ['page', page]];
  if (kind === 'movie' && list.id !== 'trending') params.push(['region', region.toUpperCase()]);
  return { path: `${list.path[kind]}?${q(params)}`, ttl: TTL.list };
}

// ---- Genres, in the launcher's words (GenreMap) ----------------------------------------------------------------------

const MOVIE_GENRES: Record<number, string[]> = {
  28: ['Action'], 12: ['Adventure'], 16: ['Animation'], 35: ['Comedy'], 80: ['Crime'], 99: ['Documentary'], 18: ['Drama'],
  10751: ['Family'], 14: ['Fantasy'], 36: ['History'], 27: ['Horror'], 10402: ['Music'], 9648: ['Mystery'], 10749: ['Romance'],
  878: ['Sci-fi'], 10770: ['TV Movie'], 53: ['Thriller'], 10752: ['War'], 37: ['Western'],
};
// TMDB's combined TV genres split in two: "Sci-Fi & Fantasy" is Sci-fi and Fantasy.
const TV_GENRES: Record<number, string[]> = {
  10759: ['Action', 'Adventure'], 16: ['Animation'], 35: ['Comedy'], 80: ['Crime'], 99: ['Documentary'], 18: ['Drama'],
  10751: ['Family'], 10762: ['Kids'], 9648: ['Mystery'], 10763: ['News'], 10764: ['Reality'], 10765: ['Sci-fi', 'Fantasy'],
  10766: ['Soap'], 10767: ['Talk'], 10768: ['War', 'Politics'], 37: ['Western'],
};

/** The launcher's names for TMDB genre ids, in TMDB's order, without repeats; unknown ids are skipped. */
export function genreNames(kind: Kind, ids: number[]): string[] {
  const table = kind === 'movie' ? MOVIE_GENRES : TV_GENRES;
  const out: string[] = [];
  for (const id of ids) for (const n of table[id] || []) if (out.indexOf(n) < 0) out.push(n);
  return out;
}

/** TMDB's genre id for one of the launcher's genre names, for discover; null when the kind has no such genre alone. */
export function genreId(kind: Kind, name: string): number | null {
  const table = kind === 'movie' ? MOVIE_GENRES : TV_GENRES;
  for (const k of Object.keys(table)) if (table[Number(k)].length === 1 && table[Number(k)][0] === name) return Number(k);
  // TV's combined genres ("Action & Adventure") discover under their own id for either name.
  for (const k of Object.keys(table)) if (table[Number(k)].indexOf(name) >= 0) return Number(k);
  return null;
}

/** The popular titles of a genre, as the launcher's discover does: well voted, for the region's cinemas when a movie. */
export function discoverReq(kind: Kind, genre: number, region: string): Req {
  const params: [string, string | number][] = [['with_genres', genre], ['sort_by', 'popularity.desc'], ['vote_count.gte', 200], ['include_adult', 'false'], lang];
  if (kind === 'movie') params.push(['region', region.toUpperCase()]);
  params.push(['page', 1]);
  return { path: `/discover/${seg(kind)}?${q(params)}`, ttl: TTL.list };
}

/** Every genre name a kind of title can have, sorted. */
export function allGenres(kind: Kind): string[] {
  const table = kind === 'movie' ? MOVIE_GENRES : TV_GENRES;
  const out: string[] = [];
  for (const k of Object.keys(table)) for (const n of table[Number(k)]) if (out.indexOf(n) < 0) out.push(n);
  return out.sort();
}

/** Movies and shows together, sorted. */
export const ALL_GENRES: string[] = allGenres('movie')
  .concat(allGenres('show'))
  .filter((g, i, a) => a.indexOf(g) === i)
  .sort();

// ---- Ratings (Certifications): the US scale the screens speak --------------------------------------------------------

const MOVIE_RATINGS = ['G', 'PG', 'PG-13', 'R', 'NC-17'];
const TV_RATINGS = ['TV-Y', 'TV-Y7', 'TV-G', 'TV-PG', 'TV-14', 'TV-MA'];

/** A certification as the screens show it; "" for anything that is not on the US scales. */
export function tidyRating(cert: unknown): string {
  if (typeof cert !== 'string') return '';
  const c = cert.trim().toUpperCase().replace(/ /g, '-');
  if (c === 'NR' || c === 'NOT-RATED' || c === 'UNRATED') return 'NR';
  if (c === 'TV-Y7-FV') return 'TV-Y7';
  return MOVIE_RATINGS.indexOf(c) >= 0 || TV_RATINGS.indexOf(c) >= 0 ? c : '';
}

/** A movie's rating from its US release dates: the theatrical release's (type 3), else the first that has one. */
export function movieRating(dates: { type: number; certification: string }[]): string {
  let first = '';
  for (const d of dates) {
    const c = tidyRating(d.certification);
    if (!c) continue;
    if (d.type === 3) return c;
    if (!first) first = c;
  }
  return first;
}

// ---- Where to watch (WatchProviders): TMDB's providers as the screens' services ------------------------------------------

/**
 * TMDB provider id -> the screens' ServiceId, for the services Title.offers can name today. Others (Hulu, SVT Play,
 * Paramount+ and the rest) are left out until the screens' service list grows. A provider that both streams and sells
 * (Viaplay) is a different service in each (viaplay, viaplaystore).
 */
const PROVIDERS: Record<number, [ServiceId, ServiceId?]> = {
  8: ['netflix'], 175: ['netflix'], 1796: ['netflix'],
  119: ['prime'], 9: ['prime'],
  337: ['disney'],
  1899: ['max'], 384: ['max'],
  350: ['appletvplus'],
  2: ['appletv'],
  3: ['googletv'],
  192: ['youtube'],
  10: ['amazonvideo'],
  76: ['viaplay', 'viaplaystore'],
  426: ['sfanytime'],
  35: ['rakuten'],
  7: ['fandango'], 332: ['fandango'],
};

/** The service for a provider in a list ("flatrate", "free", "ads", "rent", "buy"), or null for one the screens don't know. */
export function serviceFor(providerId: number, list: string): ServiceId | null {
  const p = PROVIDERS[providerId];
  if (!p) return null;
  return list === 'rent' || list === 'buy' ? p[1] || p[0] : p[0];
}

export const offerTypeOf = (list: string): OfferType | null =>
  list === 'flatrate' ? 'sub' : list === 'free' || list === 'ads' ? 'free' : list === 'rent' ? 'rent' : list === 'buy' ? 'buy' : null;

/** The region's two letters, upper case: the household's choice in Settings (Sweden by default). */
export const regionCode = (region: string | null | undefined): string => (region === 'us' ? 'US' : 'SE');
