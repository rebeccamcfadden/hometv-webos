// A title's poster on TMDB's image server, at a size for a card about 270 px wide on the 1920 px stage. Titles carry the
// poster_path the live catalogue got with them (live/types.ts); one without a poster, or whose poster won't load, gets
// `is-missing` and the screen shows its name.
import type { Title } from '@hometv/core/types.ts';
import { imageUrl, POSTER_SIZE } from '../live/tmdb';
import type { LiveTitle } from '../live/types';

export const posterUrl = (t: Title): string | null => imageUrl((t as LiveTitle).poster, POSTER_SIZE);
