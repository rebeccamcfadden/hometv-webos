// The rules for deciding that a store's title is the catalogue's title when the store only has names and dates
// (Apple's iTunes search), ported from the Android launcher's TitleMatch. Names match when they are equal after
// normalise; years match within one year, since a store's release date is often a later local release.
import type { PriceTitle } from './types';

/**
 * Lowercase, accents and punctuation gone, "&" read as "and", a trailing "(2014)" and a leading "The", "A" or "An" dropped:
 * "The Lord of the Rings: The Return of the King (2003)" becomes "lord of the rings the return of the king".
 */
export function normalise(s: string | null | undefined): string {
  if (!s) return '';
  let t = s.replace(/\s*[(\[]\s*(19|20)\d\d\s*[)\]]\s*$/, '');
  t = t.normalize('NFD').replace(/[\u0300-\u036f]+/g, '');
  t = t.toLowerCase().replace(/&/g, ' and ');
  t = t.replace(/[^a-z0-9\u00c0-\uffff]+/g, ' ').trim();
  return t.replace(/^(the|a|an) /, '').trim();
}

export function sameName(a: string, b: string): boolean {
  const na = normalise(a);
  return !!na && na === normalise(b);
}

/** Within one year; an unknown year (0) on either side doesn't rule a match out. */
export const yearClose = (want: number, got: number): boolean => want <= 0 || got <= 0 || Math.abs(want - got) <= 1;

/** The year of an ISO date ("2016-12-02T08:00:00Z"), or 0. */
export function yearOf(iso: unknown): number {
  const n = typeof iso === 'string' && iso.length >= 4 ? parseInt(iso.slice(0, 4), 10) : NaN;
  return isNaN(n) ? 0 : n;
}

export interface SeasonName {
  show: string;
  season: number;
}

const SEASON = /^(.*?)\s*(?:[,:\-–]\s*|\(\s*)(?:season|säsong|series|staffel|saison)\s+(\d{1,3})\s*\)?\s*$/i;

/** "Succession, Season 1", "Succession: Season 2", "Succession - Säsong 3", "Succession (Season 4)"; null for a name that names no season. */
export function season(collectionName: unknown): SeasonName | null {
  if (typeof collectionName !== 'string') return null;
  const m = SEASON.exec(collectionName.trim());
  return m && m[1] ? { show: m[1], season: parseInt(m[2], 10) } : null;
}

/**
 * How well a store's movie matches: -1 for no match, else 2 for the same year and 1 for a year either side. `byId` is for a
 * store item looked up by an id Wikidata gave: then the name may be the local one, so only the year is checked.
 */
export function movieScore(t: PriceTitle, storeName: string, storeYear: number, byId: boolean): number {
  if (!yearClose(t.year, storeYear)) return -1;
  if (!byId && !sameName(t.name, storeName)) return -1;
  return t.year <= 0 || storeYear <= 0 || t.year === storeYear ? 2 : 1;
}

/** Whether a store's season belongs to the show: the name matches and the season came out no earlier than a year before the show's first air date. */
export function seasonMatches(t: PriceTitle, s: SeasonName | null, storeYear: number): boolean {
  if (!s) return false;
  return sameName(t.name, s.show) && (t.year <= 0 || storeYear <= 0 || storeYear >= t.year - 1);
}
