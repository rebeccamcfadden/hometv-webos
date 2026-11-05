// The lists Movies and TV Shows show as chips: TMDB's browse lists for the kind (Trending, Popular, Top rated, and Now
// playing or On the air), then the household's own: My list, Favorites and Seen (kept on this TV, data/store.ts, and
// following the TMDB account once signed in, account/).
import type { Kind } from '@hometv/core/types.ts';
import { listsFor } from '../live/tmdb';

export interface ShownList {
  /** 'my', 'fav', 'seen', or a TMDB list id from live/tmdb.ts. */
  id: string;
  name: string;
}

export const MY_LIST = 'my';
export const FAVORITES_LIST = 'fav';
export const SEEN_LIST = 'seen';
/** The household's own lists (data/store.ts), which follow the TMDB account once signed in (account/). */
export const HOUSEHOLD_LISTS = [MY_LIST, FAVORITES_LIST, SEEN_LIST];
/** The chip the page opens on. */
export const FIRST_LIST = 'trending';

export const lists = {
  /** TMDB's lists that exist for the kind, then My list, Favorites and Seen. */
  all: (kind: Kind): ShownList[] =>
    listsFor(kind)
      .map((l) => ({ id: l.id, name: l.name }))
      .concat([
        { id: MY_LIST, name: 'My list' },
        { id: FAVORITES_LIST, name: 'Favorites' },
        { id: SEEN_LIST, name: 'Seen' },
      ]),
  byId: (kind: Kind, id: string): ShownList | undefined => lists.all(kind).filter((l) => l.id === id)[0],
};
