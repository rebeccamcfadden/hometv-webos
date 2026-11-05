// TEMPORARY copy of hometv-launcher's design_preview/src/core/store.ts at 2bf3c2d: the household's own state that the
// title page's buttons and Search change (My list, Seen, Favorites, recent searches, recently viewed), until it has a
// home on Samsung (TMDB's lists once the account is shared). Changes: its own storage key; Set spread written out;
// blocked or full storage keeps changes for this visit only; reset() doesn't reload the page; it starts empty, with no
// sample titles, and keeps titles by their live ids (`movie:603`, `tv:1396`).

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
  myList: [],
  seen: [],
  favorites: [],
  recent: [],
  viewed: [],
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
/** The household's lists by their account names (account/sync.ts): what a change is recorded under. */
export type ListName = 'myList' | 'seen' | 'favorites';
const changeHooks: ((list: ListName, id: string, present: boolean) => void)[] = [];

function toggle(set: Set<string>, id: string, list: ListName): boolean {
  if (set.has(id)) set.delete(id);
  else set.add(id);
  save();
  const present = set.has(id);
  changeHooks.slice().forEach((fn) => fn(list, id, present));
  listeners.slice().forEach((fn) => fn());
  return present;
}

export const store = {
  inMyList: (id: string) => myList.has(id),
  isSeen: (id: string) => seen.has(id),
  isFavorite: (id: string) => favorites.has(id),
  toggleMyList: (id: string) => toggle(myList, id, 'myList'),
  toggleSeen: (id: string) => toggle(seen, id, 'seen'),
  toggleFavorite: (id: string) => toggle(favorites, id, 'favorites'),
  myListIds: () => ids(myList),
  seenIds: () => ids(seen),
  favoriteIds: () => ids(favorites),
  /** The three lists, for the account sync. */
  lists: (): Record<ListName, string[]> => ({ myList: ids(myList), seen: ids(seen), favorites: ids(favorites) }),
  /** The lists as merged with the account (account/account.ts); a list left out stays as it is. Not a change to record. */
  applySynced(lists: Partial<Record<ListName, string[]>>) {
    if (lists.myList) myList = new Set(lists.myList);
    if (lists.seen) seen = new Set(lists.seen);
    if (lists.favorites) favorites = new Set(lists.favorites);
    save();
    listeners.slice().forEach((fn) => fn());
  },
  /** Calls `fn` with each change made on the TV (a title put on a list or taken off); returns a function that stops it. */
  onChange(fn: (list: ListName, id: string, present: boolean) => void): () => void {
    changeHooks.push(fn);
    return () => {
      const i = changeHooks.indexOf(fn);
      if (i >= 0) changeHooks.splice(i, 1);
    };
  },
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
