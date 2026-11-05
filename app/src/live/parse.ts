// TMDB's answers as the screens' titles, seasons and people, ported from the launcher's TmdbParse: a list item becomes a
// summary title, a details page a detailed one (runtime or seasons, US rating, cast and crew, trailer, where to watch in
// the region), a season its episodes, a person their best-known titles. Missing fields give empty values, never an
// exception. Pure; unit-tested with hand-written answers (tests/live.test.mjs).
import type { Kind, Offer } from '@hometv/core/types.ts';
import type { Credits, Found, LiveFoundPerson, LivePerson, LiveSeason, LiveTitle } from './types';
import { genreNames, isImagePath, movieRating, offerTypeOf, serviceFor, tidyRating, titleId } from './tmdb';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = Record<string, any>;

/** How many of the cast and the crew a title keeps. */
export const CAST_MAX = 15;
export const CREW_MAX = 6;
/** How many titles a person page lists. */
export const KNOWN_FOR_MAX = 30;

/** Talk shows, news and reality TV: a person's appearances there are not what they are known for. */
const NOT_KNOWN_FOR = [10767, 10763, 10764];

const obj = (o: J | null | undefined, k: string): J | null => (o && typeof o[k] === 'object' && o[k] !== null && !Array.isArray(o[k]) ? o[k] : null);
const arr = (o: J | null | undefined, k: string): J[] => (o && Array.isArray(o[k]) ? o[k].filter((x: unknown) => typeof x === 'object' && x !== null) : []);
const str = (o: J | null | undefined, k: string): string => (o && typeof o[k] === 'string' ? o[k] : '');
const num = (o: J | null | undefined, k: string): number => (o && typeof o[k] === 'number' && isFinite(o[k]) ? o[k] : 0);
const path = (o: J | null | undefined, k: string): string | null => (o && isImagePath(o[k]) ? o[k] : null);
const ints = (a: unknown): number[] => (Array.isArray(a) ? a.filter((x) => typeof x === 'number') : []);

// ---- Pieces -----------------------------------------------------------------------------------------------------------

function kindOf(mediaType: string, hint: Kind | null): Kind | null {
  if (mediaType === 'movie') return 'movie';
  if (mediaType === 'tv') return 'show';
  return mediaType === '' ? hint : null;
}

function nameOf(o: J, kind: Kind): string {
  return str(o, kind === 'movie' ? 'title' : 'name') || str(o, kind === 'movie' ? 'original_title' : 'original_name');
}

/** "2016-11-10" gives 2016; anything else 0. */
export function yearOf(date: string): number {
  return /^\d{4}/.test(date) ? parseInt(date.slice(0, 4), 10) : 0;
}

/** TMDB's average vote, to one decimal as the screens show it. */
const scoreOf = (o: J): number => {
  const v = num(o, 'vote_average');
  return v < 0 ? 0 : Math.round(v * 10) / 10;
};

const person = (o: J | null, role: string): LivePerson | null => {
  const name = str(o, 'name');
  return o && name ? { name, role, id: num(o, 'id'), photo: path(o, 'profile_path') } : null;
};

function blank(id: string, kind: Kind, name: string): LiveTitle {
  return {
    id, kind, name, year: 0, genres: [], rating: '', score: 0, synopsis: '', art: '', offers: [], lists: [], cast: [], crew: [],
    poster: null, trailer: null, detailed: false, similar: [], episodeRuntime: 0,
  };
}

// ---- Titles -----------------------------------------------------------------------------------------------------------

/** A title from a list (search, discover, recommendations, credits): its kind from media_type, else the hint; null for a person or anything else. */
export function summary(o: J | null, hint: Kind | null): LiveTitle | null {
  if (!o) return null;
  const kind = kindOf(str(o, 'media_type'), hint);
  const n = num(o, 'id');
  if (!kind || n <= 0 || o.adult === true) return null;
  const name = nameOf(o, kind);
  if (!name) return null;
  const t = blank(titleId(kind, n), kind, name);
  t.year = yearOf(str(o, kind === 'movie' ? 'release_date' : 'first_air_date'));
  t.genres = genreNames(kind, ints(o.genre_ids));
  t.score = scoreOf(o);
  t.synopsis = str(o, 'overview');
  t.art = path(o, 'backdrop_path') || '';
  t.poster = path(o, 'poster_path');
  return t;
}

/** The summaries of a list answer's results, in TMDB's order, without repeats. */
export function summaries(results: J[], hint: Kind | null): LiveTitle[] {
  const seen: Record<string, true> = {};
  const out: LiveTitle[] = [];
  for (const r of results) {
    const t = summary(r, hint);
    if (t && !seen[t.id]) {
      seen[t.id] = true;
      out.push(t);
    }
  }
  return out;
}

/** The titles of a list answer ({results: [...]}) for a kind. */
export const listItems = (o: J | null, kind: Kind): LiveTitle[] => summaries(arr(o, 'results'), kind);

/** Where a details page (watch/providers appended, every country) says the title can be watched in the region, as offers without prices. */
export function availability(details: J, region: string): Offer[] {
  const r = obj(obj(obj(details, 'watch/providers'), 'results'), region.toUpperCase());
  const out: Offer[] = [];
  if (!r) return out;
  const seen: Record<string, true> = {};
  for (const list of ['flatrate', 'free', 'ads', 'rent', 'buy']) {
    const items = arr(r, list)
      .map((p, i) => ({ p, i }))
      .sort((a, b) => (num(a.p, 'display_priority') || 1e9) - (num(b.p, 'display_priority') || 1e9) || a.i - b.i);
    const type = offerTypeOf(list);
    for (const x of items) {
      const service = type ? serviceFor(num(x.p, 'provider_id'), list) : null;
      if (!service || !type || seen[`${service}|${type}`]) continue;
      seen[`${service}|${type}`] = true;
      out.push({ service, type });
    }
  }
  return out;
}

/** The YouTube id of the title's trailer: an official one first, else any; null when there is none. */
export function trailerOf(videos: J | null): string | null {
  let any: string | null = null;
  for (const v of arr(videos, 'results')) {
    if (str(v, 'site') !== 'YouTube' || str(v, 'type') !== 'Trailer') continue;
    const key = str(v, 'key');
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(key)) continue;
    if (v.official === true) return key;
    if (!any) any = key;
  }
  return any;
}

function cast(credits: J | null): LivePerson[] {
  const out: LivePerson[] = [];
  for (const c of arr(credits, 'cast')) {
    if (out.length >= CAST_MAX) break;
    const p = person(c, str(c, 'character') || 'Actor');
    if (p) out.push(p);
  }
  return out;
}

/** The jobs a movie's crew shows, in this order: who directed it, wrote it, filmed it and scored it. */
const JOBS: [string, string][] = [
  ['Director', 'Director'], ['Screenplay', 'Writer'], ['Writer', 'Writer'], ['Novel', 'Novel'],
  ['Director of Photography', 'Cinematography'], ['Original Music Composer', 'Music'],
];

function crew(credits: J | null, kind: Kind): LivePerson[] {
  const out: LivePerson[] = [];
  // A show's credits list its producers and writers by series; only a movie's say who did each job.
  if (kind !== 'movie') return out;
  const a = arr(credits, 'crew');
  for (const job of JOBS) {
    for (const c of a) {
      if (str(c, 'job') !== job[0]) continue;
      const p = person(c, job[1]);
      if (p) out.push(p);
    }
  }
  return out;
}

function dedupe(people: LivePerson[], max: number): LivePerson[] {
  const out: LivePerson[] = [];
  for (const p of people) {
    if (!out.some((q) => q.name === p.name && q.role === p.role)) out.push(p);
    if (out.length === max) break;
  }
  return out;
}

function seasons(list: J[]): LiveSeason[] {
  const out: LiveSeason[] = [];
  for (const s of list) {
    const n = num(s, 'season_number');
    const count = num(s, 'episode_count');
    // Season 0 is TMDB's "Specials"; the screens' shows start at 1.
    if (n > 0 && count > 0) out.push({ n, count, episodes: [] });
  }
  return out;
}

/** A show's typical episode length: TMDB's episode_run_time averaged, else its last or next episode's. */
export function episodeRuntime(o: J): number {
  const runs = ints(o.episode_run_time).filter((r) => r > 0);
  if (runs.length) return Math.round(runs.reduce((a, b) => a + b, 0) / runs.length);
  for (const k of ['last_episode_to_air', 'next_episode_to_air']) {
    const r = num(obj(o, k), 'runtime');
    if (r > 0) return r;
  }
  return 0;
}

function usOf(o: J | null): J | null {
  return arr(o, 'results').filter((r) => r.iso_3166_1 === 'US')[0] || null;
}

const movieCert = (releaseDates: J | null): string =>
  movieRating(arr(usOf(releaseDates), 'release_dates').map((d) => ({ type: num(d, 'type'), certification: str(d, 'certification') })));

const tvCert = (contentRatings: J | null): string => tidyRating(str(usOf(contentRatings), 'rating'));

/** More like this: the recommendations, or the similar titles when there are none. */
export function similarTo(details: J, kind: Kind): LiveTitle[] {
  const rec = summaries(arr(obj(details, 'recommendations'), 'results'), kind);
  return rec.length ? rec : summaries(arr(obj(details, 'similar'), 'results'), kind);
}

/** A details answer (/movie/{id} or /tv/{id}, with credits, ratings, videos and watch providers appended), with the region's offers. */
export function details(o: J, kind: Kind, region: string): LiveTitle {
  const t = blank(titleId(kind, num(o, 'id')), kind, nameOf(o, kind));
  t.year = yearOf(str(o, kind === 'movie' ? 'release_date' : 'first_air_date'));
  t.genres = genreNames(kind, arr(o, 'genres').map((g) => num(g, 'id')));
  t.score = scoreOf(o);
  t.synopsis = str(o, 'overview');
  t.art = path(o, 'backdrop_path') || '';
  t.poster = path(o, 'poster_path');
  t.trailer = trailerOf(obj(o, 'videos'));
  const credits = obj(o, 'credits');
  t.cast = cast(credits);
  let people: LivePerson[] = [];
  if (kind === 'movie') {
    t.runtime = Math.max(0, num(o, 'runtime'));
    t.rating = movieCert(obj(o, 'release_dates'));
  } else {
    t.rating = tvCert(obj(o, 'content_ratings'));
    t.episodeRuntime = episodeRuntime(o);
    t.seasons = seasons(arr(o, 'seasons'));
    if (t.seasons.length) t.next = { season: t.seasons[0].n, episode: 1 };
    for (const c of arr(o, 'created_by')) {
      const p = person(c, 'Creator');
      if (p) people.push(p);
    }
  }
  people = people.concat(crew(credits, kind));
  t.crew = dedupe(people, CREW_MAX);
  t.offers = availability(o, region);
  t.similar = similarTo(o, kind).map((x) => x.id);
  t.detailed = true;
  return t;
}

/** /tv/{id}/season/{n}: the season with its episodes; an episode without a runtime gets the show's. */
export function season(o: J, fallbackRuntime: number): LiveSeason {
  const episodes = arr(o, 'episodes').map((e, i) => {
    const n = num(e, 'episode_number') || i + 1;
    const runtime = num(e, 'runtime');
    return { n, name: str(e, 'name') || `Episode ${n}`, runtime: runtime > 0 ? runtime : fallbackRuntime };
  });
  return { n: num(o, 'season_number'), count: episodes.length, episodes };
}

// ---- People and search ------------------------------------------------------------------------------------------------

/**
 * /search/multi: the titles and people, in TMDB's order, and what each person is known for. A title without artwork and
 * a person without a photo are left out: TMDB lists many namesakes and stubs, and those are the ones a card could only
 * show blank.
 */
export function search(o: J): Found & { known: Record<number, LiveTitle[]> } {
  const titles: LiveTitle[] = [];
  const people: LiveFoundPerson[] = [];
  const known: Record<number, LiveTitle[]> = {};
  for (const r of arr(o, 'results')) {
    if (str(r, 'media_type') === 'person') {
      const p = person(r, str(r, 'known_for_department'));
      if (!p || !p.photo || r.adult === true) continue;
      const k = summaries(arr(r, 'known_for'), null);
      known[p.id] = k;
      people.push({ ...p, known: k.map((x) => x.id) });
      continue;
    }
    const t = summary(r, null);
    if (t && (t.poster || t.art)) titles.push(t);
  }
  return { titles, people, known };
}

function isKnownFor(c: J): boolean {
  if (ints(c.genre_ids).some((g) => NOT_KNOWN_FOR.indexOf(g) >= 0)) return false;
  const who = str(c, 'character').trim().toLowerCase();
  return !(who.indexOf('self') === 0 || who.indexOf('himself') === 0 || who.indexOf('herself') === 0);
}

/** /person/{id} with combined_credits: the person with their photo, and up to 30 titles they are known for, most voted first, leaving out talk shows, news, reality TV and appearances as themselves. */
export function credits(o: J): Credits {
  const p = person(o, '') || { name: '', role: '', id: num(o, 'id'), photo: null };
  const combined = obj(o, 'combined_credits');
  const items = arr(combined, 'cast').concat(arr(combined, 'crew')).filter(isKnownFor);
  // Stable, so equal votes keep TMDB's order (cast before crew).
  const ranked = items.map((c, i) => ({ c, i })).sort((a, b) => num(b.c, 'vote_count') - num(a.c, 'vote_count') || a.i - b.i);
  const out: LiveTitle[] = [];
  for (const x of ranked) {
    const t = summary(x.c, null);
    if (t && !out.some((y) => y.id === t.id)) out.push(t);
    if (out.length === KNOWN_FOR_MAX) break;
  }
  return { person: p, titles: out };
}
