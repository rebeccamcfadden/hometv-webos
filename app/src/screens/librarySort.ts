// The Sort button's orders on Movies and TV Shows, ported from design_preview's screens/librarySort.ts (F4, the
// project lead, 2026-11-01; the Android launcher's LibrarySort.java follows the same rules). Every order but A–Z falls
// back to A–Z between titles it ranks the same, and puts the titles it can't rank (no year, no score, on no list it
// knows the order of) last, in A–Z. Pure: no DOM, no storage, so tests/library.test.mjs runs it in Node.
// Change for Chromium 56: no Unicode property escapes (\p{M}, \p{L}, Chromium 64) in sortName.

import type { Title } from '@hometv/core/types.ts';

export type SortId = 'list' | 'az' | 'recent' | 'newest' | 'oldest' | 'rated';

export const SORTS: { id: SortId; label: string; short: string }[] = [
  { id: 'list', label: 'As ranked by TMDB', short: 'TMDB order' },
  { id: 'az', label: 'Alphabetical (A–Z)', short: 'A–Z' },
  { id: 'recent', label: 'Recently added to my lists', short: 'Recently added' },
  { id: 'newest', label: 'Newest release first', short: 'Newest' },
  { id: 'oldest', label: 'Oldest release first', short: 'Oldest' },
  { id: 'rated', label: 'Highest rated', short: 'Highest rated' },
];

/** The orders a list offers: "Recently added" only on My list, TMDB's own order only on TMDB's lists. */
export const sortsFor = (mine: boolean) => SORTS.filter((s) => (mine ? s.id !== 'list' : s.id !== 'recent'));
/** The order a list opens in. */
export const defaultSort = (mine: boolean): SortId => (mine ? 'recent' : 'list');

/** Combining marks left by NFD (accents): the blocks Latin, Greek and Cyrillic titles use. */
const MARKS = /[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]+/g;

/** A letter or digit in any script, as near as Chromium 56 can tell without \p{L} and \p{N}. */
function isLetterOrDigit(c: string): boolean {
  if (c >= '0' && c <= '9') return true;
  if (c.toLowerCase() !== c.toUpperCase()) return true;
  const code = c.charCodeAt(0);
  // Scripts without case (Hebrew, Arabic, Indic, Thai, kana, CJK, Hangul…); not general or CJK punctuation, symbols,
  // surrogates (emoji) or variation selectors.
  return (code >= 0x0590 && code < 0x2000) || (code >= 0x3040 && code <= 0xd7ff) || (code >= 0xf900 && code <= 0xfdff) || (code >= 0xff10 && code <= 0xff19);
}

/** What A–Z compares: no leading "The", "A" or "An", no accents or case, from the first letter or digit. */
export function sortName(name: string): string {
  const s = name.normalize('NFD').replace(MARKS, '');
  let i = 0;
  while (i < s.length && !isLetterOrDigit(s[i])) i++;
  return s
    .slice(i)
    .trim()
    .replace(/^(the|an|a)\s+(?=\S)/i, '')
    .toLowerCase();
}

const cmp = <T>(a: T, b: T) => (a < b ? -1 : a > b ? 1 : 0);
const byName = (a: Title, b: Title) => cmp(sortName(a.name), sortName(b.name)) || cmp(a.name, b.name) || cmp(a.id, b.id);
/** A known value first; two unknown the same. */
const known = (a: boolean, b: boolean) => (a === b ? 0 : a ? -1 : 1);

/**
 * Ranks for "Recently added" from the lists' ids, each oldest first, in chip order (0 is newest): every list's last
 * title before any list's second-to-last, the earlier chip's first; a title on two lists takes its better place. No
 * list says when a title was added, so its place on the list stands in.
 */
export function recentRanks(orders: string[][]): Map<string, number> {
  const best = new Map<string, [number, number]>();
  orders.forEach((ids, li) =>
    ids.forEach((id, i) => {
      const place: [number, number] = [ids.length - 1 - i, li];
      const was = best.get(id);
      if (!was || place[0] < was[0] || (place[0] === was[0] && place[1] < was[1])) best.set(id, place);
    }),
  );
  const all = Array.from(best.entries()).sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1]);
  const out = new Map<string, number>();
  all.forEach(([id], i) => out.set(id, i));
  return out;
}

export function sortTitles(titles: Title[], sort: SortId, recent?: Map<string, number>): Title[] {
  const out = titles.slice();
  switch (sort) {
    case 'list':
      return out;
    case 'recent':
      return out.sort((a, b) => {
        const ra = recent ? recent.get(a.id) : undefined;
        const rb = recent ? recent.get(b.id) : undefined;
        return known(ra !== undefined, rb !== undefined) || (ra !== undefined && rb !== undefined ? ra - rb : 0) || byName(a, b);
      });
    case 'newest':
    case 'oldest': {
      const dir = sort === 'newest' ? -1 : 1;
      return out.sort((a, b) => known(a.year > 0, b.year > 0) || (a.year > 0 && b.year > 0 ? dir * (a.year - b.year) : 0) || byName(a, b));
    }
    case 'rated':
      return out.sort((a, b) => known(a.score > 0, b.score > 0) || (a.score > 0 && b.score > 0 ? b.score - a.score : 0) || byName(a, b));
    default:
      return out.sort(byName);
  }
}
