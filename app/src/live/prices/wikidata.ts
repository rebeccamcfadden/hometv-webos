// Wikidata's ids for a title, by its TMDB id (P4947 for a movie, P4983 for a show): the iTunes ids iTunes is looked up by (P6398
// for a movie, P6381 for a show's seasons), from one SPARQL query to query.wikidata.org. Ported from the Android launcher's
// WikidataIds, keeping only the ids prices need (title links come later). Kept a month: Wikidata gains ids slowly. No key.
import type { Kind } from '@hometv/core/types.ts';

export const ID = 'wikidata';
const ENDPOINT = 'https://query.wikidata.org/sparql';
const ITUNES = { movie: 'P6398', show: 'P6381' };

/** The SPARQL query: the item with that TMDB id and its iTunes ids joined with "|". */
export const query = (kind: Kind, tmdbId: number): string => {
  const p = kind === 'movie' ? ITUNES.movie : ITUNES.show;
  return `SELECT ?item (GROUP_CONCAT(DISTINCT ?v${p};separator="|") AS ?${p}) WHERE { ?item wdt:${kind === 'movie' ? 'P4947' : 'P4983'} "${tmdbId}" . OPTIONAL { ?item wdt:${p} ?v${p} . } } GROUP BY ?item`;
};

export const url = (kind: Kind, tmdbId: number): string => `${ENDPOINT}?format=json&query=${encodeURIComponent(query(kind, tmdbId))}`;

/** The iTunes ids from a SPARQL JSON answer: the first item's, in Wikidata's order; empty for no answer or no ids. Throws on text that isn't JSON. */
export function itunesIds(text: string | null, kind: Kind): string[] {
  if (!text) return [];
  const rows = ((JSON.parse(text) as { results?: { bindings?: Record<string, { value?: unknown }>[] } } | null) || {}).results;
  const row = rows && rows.bindings && rows.bindings[0];
  const cell = row && row[kind === 'movie' ? ITUNES.movie : ITUNES.show];
  const joined = cell && typeof cell.value === 'string' ? cell.value : '';
  return joined.split('|').map((v) => v.trim()).filter(Boolean);
}
