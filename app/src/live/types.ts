// The live catalogue's types: the screens' own Title, Person and Season (@hometv/core/types.ts) with what TMDB adds.
// A LiveTitle is a Title: the screens that take a Title take it unchanged.
import type { Person, Season, Title } from '@hometv/core/types.ts';

export interface LivePerson extends Person {
  /** TMDB's person id; 0 when unknown. */
  id: number;
  /** TMDB profile_path ("/abc.jpg"), or null. */
  photo: string | null;
}

export interface LiveSeason extends Season {
  /** TMDB's episode_count; `episodes` stays empty until the season itself is loaded. */
  count: number;
}

export interface LiveTitle extends Title {
  /** `movie:603` or `tv:1396`: TMDB's kind and id. */
  id: string;
  /** TMDB poster_path ("/abc.jpg"), or null. */
  poster: string | null;
  /** The YouTube id of the trailer, or null. */
  trailer: string | null;
  /** From a details answer (runtime or seasons, rating, cast, where to watch), not only a list's summary. */
  detailed: boolean;
  /** Ids of More like this: TMDB's recommendations, else its similar titles. */
  similar: string[];
  /** A show's typical episode length in minutes, 0 when unknown. */
  episodeRuntime: number;
  /** `art` is the backdrop_path ("/abc.jpg") or "". */
  cast: LivePerson[];
  crew: LivePerson[];
  seasons?: LiveSeason[];
  /** The price sources whose prices the offers show ("Apple", "Watchmode"); set by live/live.ts once prices arrive. */
  priceSources?: string[];
}

/** A person found by Search, with what they are known for. */
export interface LiveFoundPerson extends LivePerson {
  known: string[];
}

export interface Found {
  titles: LiveTitle[];
  people: LiveFoundPerson[];
}

/** A person page: the person and their best-known titles. */
export interface Credits {
  person: LivePerson;
  titles: LiveTitle[];
}
