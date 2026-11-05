// Search's rules without the page: what a query finds, what the filter chips keep, and what's left offline. From
// design_preview's screens/search.ts (render()); kept apart so the tests run them in Node. Online the results are
// TMDB's, in TMDB's order, with the names highlighted by @hometv/core's fuzzy matching; offline (or while the answer is
// on its way) they are the titles saved on the TV, matched by the same fuzzy rules.
import { createSearch, fuzzyMatch, type Hit, type SearchResults } from '@hometv/core/fuzzy.ts';
import type { Title } from '@hometv/core/types.ts';
import type { Searched } from '../live/client';
import { ALL_GENRES } from '../live/tmdb';

/** A person's hit carries TMDB's person id, so the person page can load them. */
export interface LiveHit extends Hit {
  person?: number;
  photo?: string | null;
}

export type Filter = 'all' | 'movie' | 'show' | 'person';

export const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['movie', 'Movies'],
  ['show', 'TV shows'],
  ['person', 'People'],
];
export const BROWSE_GENRES = ['Sci-fi', 'Drama', 'Comedy', 'Documentary', 'Animation', 'Thriller'];
/** The on-screen keyboard, as design_preview draws it: six rows of six, then Space, delete and Clear. */
export const KEY_ROWS = ['abcdef', 'ghijkl', 'mnopqr', 'stuvwx', 'yz1234', '567890'];
/** What a keyboard paired with the TV (or the remote's number keys) may type. */
export const TYPEABLE = /^[a-z0-9 \-:'’&.!?]$/i;

/** No leading spaces, no double spaces. */
export const tidyQuery = (q: string) => q.replace(/^\s+/, '').replace(/\s{2,}/g, ' ');

/** What a search reads: TMDB's answer to the query when there is one, the titles saved on the TV, and a genre's titles. */
export interface Sources {
  /** TMDB's answer for the query; null while it loads, offline, or without a key. */
  found: Searched | null;
  /** The titles saved on the TV (My list, recently viewed), which Search still finds offline. */
  saved: Title[];
  /** The popular titles of a genre, as far as they have arrived. */
  genre(name: string): Title[];
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
function genreTitles(res: SearchResults, genre: Sources['genre']): Hit[] {
  const genreHit = res.genres[0];
  if (!genreHit || genreHit.match.score <= 60) return [];
  const matched = (t: Title) => res.titles.some((x) => x.title!.id === t.id);
  return genre(genreHit.label)
    .filter((t) => !matched(t))
    .map((t) => ({ kind: 'title', label: t.name, tag: '', match: { score: 0, indices: [] }, title: t }));
}

/** TMDB's titles and people, in its order, with the query's letters marked in each name. */
function fromTmdb(query: string, found: Searched): SearchResults {
  const mark = (name: string) => fuzzyMatch(query, name) || { score: 0, indices: [] };
  const titles: Hit[] = found.titles.map((t) => ({ kind: 'title', label: t.name, tag: t.kind === 'movie' ? 'Movie' : 'TV show', match: mark(t.name), title: t }));
  const people: LiveHit[] = found.people.map((p) => ({
    kind: 'person',
    label: p.name,
    tag: 'Person',
    match: mark(p.name),
    // Their best-known titles that came with the answer; the page loads the rest.
    titles: found.titles.filter((t) => p.known.indexOf(t.name) >= 0),
    person: p.id,
    photo: p.photo,
  }));
  const genres = createSearch([], ALL_GENRES).search(query).genres;
  return { titles, people, genres, suggestions: titles.slice(0, 4).concat(people.slice(0, 2), genres.slice(0, 1)) };
}

/** The saved titles that match: no people, no genres (they need the internet). */
function fromSaved(query: string, saved: Title[]): SearchResults {
  const res = createSearch(saved, []).search(query);
  const keep = (x: Hit) => x.kind === 'title';
  return { titles: res.titles, people: [], genres: [], suggestions: res.suggestions.filter(keep) };
}

/** A query's results: TMDB's when it has answered, else the titles saved on the TV. */
export function runSearch(query: string, src: Sources): Outcome {
  if (!query) return { res: null, hasMatches: false };
  const res = src.found ? fromTmdb(query, src.found) : fromSaved(query, src.saved);
  return { res, hasMatches: res.titles.length > 0 || res.people.length > 0 || genreTitles(res, src.genre).length > 0 };
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
export function resultItems(res: SearchResults, filter: Filter, query: string, genre: Sources['genre']): Hit[] {
  const genreHits = genreTitles(res, genre);
  const exact = genreHits.length > 0 && fold(query).replace(/\s+/g, ' ').trim() === fold(res.genres[0].label);
  const all = exact ? genreHits.concat(res.titles, res.people) : res.titles.concat(genreHits, res.people);
  return all.filter((x) => {
    if (filter === 'all') return true;
    if (filter === 'person') return x.kind === 'person';
    if (x.kind === 'person') return false;
    return x.title!.kind === filter;
  });
}

export const filterLabel = (f: Filter) => FILTERS.filter((x) => x[0] === f)[0][1];
