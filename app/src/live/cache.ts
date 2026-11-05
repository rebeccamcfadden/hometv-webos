// A small answer cache over localStorage, so the last catalogue still shows offline and Home never waits on the network
// (the launcher's CachedHttp). Each answer is saved with its time and how long it stays fresh; a stale answer is kept
// and served when the network fails, until the size cap or its age pushes it out. The cap counts characters (UTF-16
// units, which is what localStorage's quota counts) and drops the oldest first. Platform-free: the storage is injected.

export interface Storage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export interface Hit<T> {
  value: T;
  /** Still within its time to live. */
  fresh: boolean;
}

/** About 1M characters: room for a few hundred titles, and a fraction of a TV's 5 MB quota. */
export const CAP = 1000000;
/** A stale answer older than this is not worth showing. */
export const MAX_AGE = 30 * 24 * 60 * 60 * 1000;

const PREFIX = 'hometv-live-v1:';
const INDEX = `${PREFIX}index`;

/** key -> [saved at, time to live, size]. */
type Index = Record<string, [number, number, number]>;

export interface Cache {
  get<T>(key: string): Hit<T> | null;
  put(key: string, value: unknown, ttl: number): void;
  clear(): void;
  /** Characters in use. */
  size(): number;
}

export function createCache(store: Storage | null, now: () => number, cap = CAP): Cache {
  let index: Index | null = null;

  const load = (): Index => {
    if (index) return index;
    index = {};
    try {
      const raw = store && store.getItem(INDEX);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object') index = parsed;
    } catch (e) {
      index = {};
    }
    return index as Index;
  };
  const save = () => {
    try {
      if (store) store.setItem(INDEX, JSON.stringify(load()));
    } catch (e) {
      // A full store leaves the index in memory only; the next put evicts and tries again.
    }
  };
  const drop = (key: string) => {
    delete load()[key];
    try {
      if (store) store.removeItem(PREFIX + key);
    } catch (e) {
      // Nothing to do.
    }
  };
  const total = () => {
    let n = 0;
    const ix = load();
    for (const k of Object.keys(ix)) n += ix[k][2] + k.length;
    return n;
  };
  /** Drops the oldest answers until `room` more characters fit under the cap. */
  const evict = (room: number) => {
    const ix = load();
    const keys = Object.keys(ix).sort((a, b) => ix[a][0] - ix[b][0]);
    let n = total();
    for (const k of keys) {
      if (n + room <= cap) break;
      n -= ix[k][2] + k.length;
      drop(k);
    }
  };

  return {
    get<T>(key: string): Hit<T> | null {
      const e = load()[key];
      if (!store || !e) return null;
      if (now() - e[0] > MAX_AGE) {
        drop(key);
        save();
        return null;
      }
      try {
        const raw = store.getItem(PREFIX + key);
        if (raw === null) {
          drop(key);
          return null;
        }
        return { value: JSON.parse(raw) as T, fresh: now() - e[0] < e[1] };
      } catch (e2) {
        drop(key);
        return null;
      }
    },

    put(key, value, ttl) {
      if (!store) return;
      let raw: string;
      try {
        raw = JSON.stringify(value);
      } catch (e) {
        return;
      }
      if (raw.length + key.length > cap) return;
      evict(raw.length + key.length);
      const write = () => {
        store.setItem(PREFIX + key, raw);
        load()[key] = [now(), ttl, raw.length];
        save();
      };
      try {
        write();
      } catch (e) {
        // The browser's quota is smaller than the cap: make room and try once more.
        evict(cap);
        try {
          write();
        } catch (e2) {
          delete load()[key];
        }
      }
    },

    clear() {
      for (const k of Object.keys(load())) drop(k);
      index = {};
      save();
    },

    size: total,
  };
}
