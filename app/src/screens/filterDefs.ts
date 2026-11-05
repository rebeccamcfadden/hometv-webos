// The Filters drawer's filters on Movies and TV Shows, ported from design_preview's screens/filterDefs.ts. Pure: what a
// filter needs to know about a title beyond the catalogue (seen, included with the household's services, for rent)
// comes in as `facts`, so tests run it in Node and the screen passes the household's store and the offers.

import type { Kind, Title } from '@hometv/core/types.ts';
import { allGenres } from '../live/tmdb';

export interface TitleFacts {
  isSeen(id: string): boolean;
  /** Included with a service the household has, or free. */
  included(t: Title): boolean;
  /** For rent in a store. */
  rentable(t: Title): boolean;
}

export interface FilterDef {
  id: string;
  label: string;
  options: string[];
  /** Text for the summary line, per option. Index 0 is "no filter". */
  short: string[];
  kinds: Kind[];
  test(t: Title, option: number): boolean;
}

const genreOptions = (kind: Kind) => allGenres(kind);

export function filterDefs(kind: Kind, facts: TitleFacts): FilterDef[] {
  const genres = genreOptions(kind);
  const defs: FilterDef[] = [
    {
      id: 'availability',
      label: 'Availability',
      options: ['Everything', 'Included only', 'Included + rentals'],
      short: ['', 'Included only', 'Included + rentals'],
      kinds: ['movie', 'show'],
      test: (t, i) => i === 0 || (i === 1 ? facts.included(t) : facts.included(t) || facts.rentable(t)),
    },
    {
      id: 'score',
      label: 'Review score',
      options: ['Any score', '7.0 and above', '8.0 and above'],
      short: ['', 'Review 7.0+', 'Review 8.0+'],
      kinds: ['movie', 'show'],
      test: (t, i) => t.score >= [0, 7, 8][i],
    },
    {
      id: 'genre',
      label: 'Genre',
      options: ['All genres'].concat(genres),
      short: [''].concat(genres),
      kinds: ['movie', 'show'],
      test: (t, i) => i === 0 || t.genres.indexOf(genres[i - 1]) >= 0,
    },
    {
      id: 'runtime',
      label: 'Length',
      options: ['Any length', 'Under 90 minutes', 'Under 2 hours', 'Under 2½ hours'],
      short: ['', 'Under 90 min', 'Under 2h', 'Under 2½h'],
      kinds: ['movie'],
      // A title whose runtime isn't known yet (its details haven't arrived) doesn't pass.
      test: (t, i) => i === 0 || (!!t.runtime && t.runtime < [0, 90, 120, 150][i]),
    },
    {
      id: 'watch',
      label: 'Watch state',
      options: ['Seen or not', 'Unwatched only', 'Seen only'],
      short: ['', 'Unwatched', 'Seen'],
      kinds: ['movie', 'show'],
      test: (t, i) => i === 0 || (i === 1 ? !facts.isSeen(t.id) : facts.isSeen(t.id)),
    },
  ];
  return defs.filter((d) => d.kinds.indexOf(kind) >= 0);
}

export type FilterState = Record<string, number>;

/** No filter on (the project lead, 2026-11-01, F2): the page starts with none each time the TV is turned on. */
export const defaultFilters = (): FilterState => ({});

export const applyFilters = (defs: FilterDef[], state: FilterState, titles: Title[]) =>
  titles.filter((t) => defs.every((d) => d.test(t, state[d.id] || 0)));

export const activeCount = (defs: FilterDef[], state: FilterState) => defs.filter((d) => (state[d.id] || 0) !== 0).length;

export const summary = (defs: FilterDef[], state: FilterState) =>
  defs
    .map((d) => d.short[state[d.id] || 0])
    .filter(Boolean)
    .join(' · ');

/** Steps a filter's option by `step` (±1), wrapping round, as ← and → do in the drawer. */
export function cycleFilter(def: FilterDef, state: FilterState, step: number): void {
  const n = def.options.length;
  state[def.id] = ((state[def.id] || 0) + step + n) % n;
}
