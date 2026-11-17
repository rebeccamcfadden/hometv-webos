// Keeps the downloaded backdrops on the TV (IndexedDB, as the page loader keeps its pages): each picture is fetched once
// from the launcher repo's backdrops and read from here after, offline too. A few are kept, the oldest dropped first.
// Nothing here blocks Home: every call resolves, to null when there is no storage or no picture.

const DB = 'hometv-backdrops';
const STORE = 'pics';
const KEEP = 24;
const FETCH_MS = 30000;

interface Row {
  src: string;
  blob: Blob;
  at: number;
}

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'src' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

/** A kept picture, or null. */
export function getKept(src: string): Promise<Blob | null> {
  return open().then(
    (db) =>
      new Promise<Blob | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(src);
          req.onsuccess = () => {
            db.close();
            resolve(req.result ? (req.result as Row).blob : null);
          };
          req.onerror = () => {
            db.close();
            resolve(null);
          };
        } catch (e) {
          resolve(null);
        }
      }),
  );
}

/** Keeps a picture, and drops the oldest beyond KEEP. */
export function keep(src: string, blob: Blob): Promise<void> {
  return open().then(
    (db) =>
      new Promise<void>((resolve) => {
        if (!db) return resolve();
        try {
          const tx = db.transaction(STORE, 'readwrite');
          const store = tx.objectStore(STORE);
          store.put({ src, blob, at: Date.now() } as Row);
          const all = store.getAll ? store.getAll() : null;
          if (all)
            all.onsuccess = () => {
              const rows = (all.result as Row[]).sort((a, b) => a.at - b.at);
              rows.slice(0, Math.max(0, rows.length - KEEP)).forEach((r) => store.delete(r.src));
            };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = tx.onabort = () => {
            db.close();
            resolve();
          };
        } catch (e) {
          resolve();
        }
      }),
  );
}

/** Downloads a picture; null when the network or the server says no. */
export function download(src: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', src);
      xhr.responseType = 'blob';
      xhr.timeout = FETCH_MS;
      xhr.onload = () => resolve(xhr.status === 200 && xhr.response && xhr.response.size > 0 ? (xhr.response as Blob) : null);
      xhr.onerror = xhr.ontimeout = xhr.onabort = () => resolve(null);
      xhr.send();
    } catch (e) {
      resolve(null);
    }
  });
}

/** The picture from the TV's own copy, else downloaded once and kept; null when neither works. */
export function backdropBlob(src: string): Promise<Blob | null> {
  return getKept(src).then((blob) => {
    if (blob) return blob;
    return download(src).then((got) => {
      if (got) void keep(src, got);
      return got;
    });
  });
}
