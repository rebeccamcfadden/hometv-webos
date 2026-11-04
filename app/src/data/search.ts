// Search over the mock catalogue (TEMPORARY until the catalogue comes from TMDB): the matching is @hometv/core's, as in
// design_preview's core/fuzzy.ts.
import { createSearch } from '@hometv/core/fuzzy.ts';
import { GENRES, TITLES } from './catalog';

export const { search, titlesForPerson, titlesInGenre } = createSearch(TITLES, GENRES);
