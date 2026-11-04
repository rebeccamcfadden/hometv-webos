// TEMPORARY copy of hometv-launcher's design_preview/src/core/store.ts at 2bf3c2d: the household's own state that the
// title page's buttons and Search change (My list, Seen, Favorites, recent searches, recently viewed), until it has a
// home on Samsung (TMDB's lists once the account is shared). Changes: its own storage key; Set spread written out;
// blocked or full storage keeps changes for this visit only; reset() doesn't reload the page.
import { TITLES } from './catalog';

interface Persisted {
  myList: string[];
  seen: string[];
  favorites: string[];
  recent: string[];
  viewed: string[];
}

const KEY = 'hometv-household-v1';
/** Recent searches kept, newest first: four fit the Search panel above the keyboard. */
const MAX_RECENT = 4;

const defaults = (): Persisted => ({
  myList: TITLES.filter((t) => t.lists.indexOf('my') >= 0).map((t) => t.id),
  seen: ['knives-out', 'budapest'],
  favorites: ['arrival'],
  recent: ['dune', 'amy adams', 'sci-fi', 'carnival row'],
  viewed: ['arrival', 'dune', 'past-lives', 'coda', 'moon', 'severance'],
});

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults(), ...(JSON.parse(raw) as Partial<Persisted>) };
  } catch (e) {
    // Corrupt or blocked storage: start fresh.
  }
  return defaults();
}

let data = load();
data.recent = data.recent.slice(0, MAX_RECENT);
let myList = new Set(data.myList);
let seen = new Set(data.seen);
let favorites = new Set(data.favorites);

const ids = (s: Set<string>) => Array.from(s);

function save() {
  const out: Persisted = { myList: ids(myList), seen: ids(seen), favorites: ids(favorites), recent: data.recent, viewed: data.viewed };
  try {
    localStorage.setItem(KEY, JSON.stringify(out));
  } catch (e) {
    // Blocked or full storage: the change holds for this visit.
  }
}

const listeners: (() => void)[] = [];

function toggle(set: Set<string>, id: string): boolean {
  if (set.has(id)) set.delete(id);
  else set.add(id);
  save();
  listeners.slice().forEach((fn) => fn());
  return set.has(id);
}

export const store = {
  inMyList: (id: string) => myList.has(id),
  isSeen: (id: string) => seen.has(id),
  isFavorite: (id: string) => favorites.has(id),
  toggleMyList: (id: string) => toggle(myList, id),
  toggleSeen: (id: string) => toggle(seen, id),
  toggleFavorite: (id: string) => toggle(favorites, id),
  myListIds: () => ids(myList),
  recent: () => data.recent,
  viewed: () => data.viewed,
  pushRecent(q: string) {
    const v = q.trim().toLowerCase();
    if (!v) return;
    data.recent = [v].concat(data.recent.filter((r) => r !== v)).slice(0, MAX_RECENT);
    save();
  },
  pushViewed(id: string) {
    data.viewed = [id].concat(data.viewed.filter((r) => r !== id)).slice(0, 10);
    save();
  },
  /** Forgets everything (tests, and a later Reset in settings). */
  reset() {
    try {
      localStorage.removeItem(KEY);
    } catch (e) {
      // Blocked storage: the defaults still apply for this visit.
    }
    data = defaults();
    myList = new Set(data.myList);
    seen = new Set(data.seen);
    favorites = new Set(data.favorites);
    listeners.slice().forEach((fn) => fn());
  },
  /** Calls `fn` after My list, Seen or Favorites changes; returns a function that stops it. */
  on(fn: () => void): () => void {
    listeners.push(fn);
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  },
};
