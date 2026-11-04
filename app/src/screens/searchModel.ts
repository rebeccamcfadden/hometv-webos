// Search's rules without the page: what a query finds, what the filter chips keep, and what's left offline. From
// design_preview's screens/search.ts (render()); kept apart so the tests run them in Node.
import type { Hit, SearchResults } from '@hometv/core/fuzzy.ts';
import type { Title } from '@hometv/core/types.ts';
import { TITLES } from '../data/catalog';
import { isOwnIncluded } from '../data/offers';
import { search, titlesInGenre } from '../data/search';

export type Filter = 'all' | 'movie' | 'show' | 'person' | 'included';

export const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['movie', 'Movies'],
  ['show', 'TV shows'],
  ['person', 'People'],
  ['included', 'Included only'],
];
export const BROWSE_GENRES = ['Sci-fi', 'Drama', 'Comedy', 'Documentary', 'Animation', 'Thriller'];
/** The on-screen keyboard, as design_preview draws it: six rows of six, then Space, delete and Clear. */
export const KEY_ROWS = ['abcdef', 'ghijkl', 'mnopqr', 'stuvwx', 'yz1234', '567890'];
/** What a keyboard paired with the TV (or the remote's number keys) may type. */
export const TYPEABLE = /^[a-z0-9 \-:'’&.!?]$/i;

/** No leading spaces, no double spaces. */
export const tidyQuery = (q: string) => q.replace(/^\s+/, '').replace(/\s{2,}/g, ' ');

/**
 * The titles saved on the TV, which Search still finds offline: those on My list and the household's lists (the mock
 * Household and Friends until TMDB's lists come), and the ones viewed.
 */
export function savedIds(myList: string[], viewed: string[]): Set<string> {
  const mine = new Set(myList);
  const ids = TITLES.filter((t) => mine.has(t.id) || t.lists.indexOf('household') >= 0 || t.lists.indexOf('friends') >= 0).map((t) => t.id);
  return new Set(ids.concat(viewed));
}

export interface Outcome {
  res: SearchResults | null;
  /**
   * Anything to show: titles, people, or the titles of a genre that matched well. design_preview counts only titles
   * and people, so a genre alone ("drama", from Browse by genre) said "No matches"; here it shows that genre's titles.
   */
  hasMatches: boolean;
}

/** The titles of the genre the query matched well (score over 60), past those that matched by name. */
function genreTitles(res: SearchResults): Hit[] {
  const genreHit = res.genres[0];
  if (!genreHit || genreHit.match.score <= 60) return [];
  const matched = (t: Title) => res.titles.some((x) => x.title === t);
  return titlesInGenre(genreHit.label)
    .filter((t) => !matched(t))
    .map((t) => ({ kind: 'title', label: t.name, tag: '', match: { score: 0, indices: [] }, title: t }));
}

/** A query's results. Offline, only saved titles: no people, no genres (they need the internet). */
export function runSearch(query: string, offline: boolean, saved: Set<string>): Outcome {
  let res = query ? search(query) : null;
  if (res && offline) {
    const keep = (x: Hit) => x.kind === 'title' && saved.has(x.title!.id);
    res = { titles: res.titles.filter(keep), people: [], genres: [], suggestions: res.suggestions.filter(keep) };
  }
  return { res, hasMatches: !!res && (res.titles.length > 0 || res.people.length > 0 || genreTitles(res).length > 0) };
}

/** One base letter per character, lower case, as @hometv/core's fuzzy matching folds them. */
const fold = (s: string) =>
  s
    .toLowerCase()
    .split('')
    .map((c) => c.normalize('NFD')[0])
    .join('');

/**
 * The full results under a filter chip: the matching titles, then the genre's titles, then people. A query that is
 * a genre's name ("drama") puts the genre's titles first (the Java launcher's SearchIndex, genreFirst).
 */
export function resultItems(res: SearchResults, filter: Filter, query = ''): Hit[] {
  const genre = genreTitles(res);
  const exact = genre.length > 0 && fold(query).replace(/\s+/g, ' ').trim() === fold(res.genres[0].label);
  const all = exact ? genre.concat(res.titles, res.people) : res.titles.concat(genre, res.people);
  return all.filter((x) => {
    if (filter === 'all') return true;
    if (filter === 'person') return x.kind === 'person';
    if (x.kind === 'person') return false;
    if (filter === 'included') return isOwnIncluded(x.title!);
    return x.title!.kind === filter;
  });
}

export const filterLabel = (f: Filter) => FILTERS.filter((x) => x[0] === f)[0][1];
