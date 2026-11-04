// The household's lists as Movies and TV Shows show them: My list, then one chip per imported watchlist. Ported from
// design_preview's core/lists.ts in its state before any TMDB sign-in, where the mock Household and Friends lists
// stand in. TEMPORARY: Samsung has no TMDB account yet; when it does, the signed-in lists (by their TMDB names, in the
// account's order, "Show" ticked in Choose lists, at most CHIP_CAP chips) replace MOCK here.

import type { Title } from '@hometv/core/types.ts';
import { store } from './store';

export interface ShownList {
  /** 'my', or the mock 'household' / 'friends' (a TMDB list id once signed in). */
  id: string;
  name: string;
  has: (t: Title) => boolean;
}

const MY: ShownList = { id: 'my', name: 'My list', has: (t) => store.inMyList(t.id) };
const MOCK: ShownList[] = [
  { id: 'household', name: 'Household', has: (t) => t.lists.indexOf('household') >= 0 },
  { id: 'friends', name: 'Friends', has: (t) => t.lists.indexOf('friends') >= 0 },
];

/** At most this many imported lists get a chip (the project lead, 2026-10-31); more are still in All lists. */
export const CHIP_CAP = 6;

export const lists = {
  my: MY,
  /** Every shown list after My list. */
  imported: (): ShownList[] => MOCK,
  /** My list, then the imported lists that get a chip. */
  all: (): ShownList[] => [MY].concat(lists.imported().slice(0, CHIP_CAP)),
  byId: (id: string): ShownList | undefined => lists.all().filter((l) => l.id === id)[0],
  /** On My list or any shown list: what All lists holds. */
  saved: (t: Title) => [MY].concat(lists.imported()).some((l) => l.has(t)),
  /** My list and every shown list, for the scope line ("3 imported watchlists"). */
  watchlists: () => 1 + lists.imported().length,
  /** "My list, Household & Friends"; past four, "My list, Household & 4 more". */
  names(): string {
    const n = [MY].concat(lists.imported()).map((l) => l.name);
    if (n.length > 4) return `${n[0]}, ${n[1]} & ${n.length - 2} more`;
    return n.length < 2 ? n.join('') : `${n.slice(0, -1).join(', ')} & ${n[n.length - 1]}`;
  },
  /** A list's titles in the order they were added, oldest first, for Sort's "Recently added". */
  order(id: string, pool: Title[]): string[] {
    if (id === 'my') return store.myListIds();
    const l = lists.imported().filter((x) => x.id === id)[0];
    // The mock lists know no order: the catalogue's.
    return l ? pool.filter(l.has).map((t) => t.id) : [];
  },
};
