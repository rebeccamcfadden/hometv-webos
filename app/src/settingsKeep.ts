// HomeTV's settings kept by its service too (service/service.js settingsSave, settingsLoad), so they outlive a page store
// that is empty: mounted over LG's Home the page runs as com.webos.app.home and the TV may give it a store of its own,
// apart from the one it has opened from its tile as com.hometv.app; an .ipk reinstall may empty it as well. The page
// sends its settings when they change, and when it starts with an empty store (no first run done) it puts the copy back
// and starts again, once. Platform-free: the store and the copy are passed in (main.ts; fakes in the tests).

/** What is kept: the household's own choices, never caches, logs or checks. */
export const KEEP = [
  'hometv-settings-v1', // Text and UI size, theme, the region and the rest of Settings
  'hometv-setup-done', // first run done
  'hometv-setup-v1-done',
  'hometv-home-row', // Home row apps
  'hometv-utility-moves',
  'hometv-weather-v1', // the weather place
  'hometv-household-v1', // the lists
  'hometv-tmdb-account-v1', // TMDB sign-in
  'hometv-tmdb-sync-v1',
  'hometv-update-noticed',
  'hometv-ssap-key',
];

/** The mark that this page start already put the copy back: never twice in a row (no restart loop). */
export const RESTORED_MARK = 'hometv-settings-restored';

export interface SettingsCopy {
  /** ok: the service answered (settings null: it holds no copy); not ok: it couldn't be asked, so nothing is known. */
  load(): Promise<{ ok: boolean; settings: Record<string, string> | null }>;
  save(settings: Record<string, string>): Promise<boolean>;
}
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function snapshot(store: Store | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!store) return out;
  for (const k of KEEP) {
    try {
      const v = store.getItem(k);
      if (typeof v === 'string') out[k] = v;
    } catch (e) {
      // unreadable: left out
    }
  }
  return out;
}

/**
 * What start-up found: 'restored' (the copy was written into an empty store: start the page again so every screen reads
 * it), 'kept' (this store has the settings; `copied` says whether the service holds a copy), 'none' (an empty store and
 * the service holds no copy: a first run), or 'unknown' (the service couldn't be asked, or the restore failed: nothing
 * may be sent this time, or an empty or older store could write over the household's copy).
 */
export type Start = { state: 'restored' | 'none' | 'unknown' } | { state: 'kept'; copied: boolean };

/**
 * Puts the service's copy back into an empty store (no first run done). `once` (the session's store) holds the mark that
 * stops a second time in one page session. A restore that fails part-way is taken out again: first run done is written
 * last, so a half-written store never counts as one with settings.
 */
export async function restoreIfEmpty(store: Store | null, copy: SettingsCopy, once: Store | null): Promise<Start> {
  if (!store) return { state: 'unknown' };
  let got: { ok: boolean; settings: Record<string, string> | null };
  try {
    got = await copy.load();
  } catch (e) {
    got = { ok: false, settings: null };
  }
  const saved = got.ok ? got.settings : null;
  const hasCopy = !!saved && typeof saved['hometv-setup-done'] === 'string';
  if (store.getItem('hometv-setup-done')) return got.ok ? { state: 'kept', copied: hasCopy } : { state: 'unknown' };
  if (!got.ok) return { state: 'unknown' };
  if (!hasCopy || !saved) return { state: 'none' };
  if (once && once.getItem(RESTORED_MARK)) return { state: 'unknown' };
  const order = KEEP.filter((k) => k !== 'hometv-setup-done').concat('hometv-setup-done');
  const written: string[] = [];
  try {
    for (const k of order) {
      if (typeof saved[k] !== 'string') continue;
      store.setItem(k, saved[k]);
      written.push(k);
    }
    if (once) once.setItem(RESTORED_MARK, '1');
  } catch (e) {
    for (const k of written) {
      try {
        (store as Storage).removeItem(k);
      } catch (x) {
        // left; first run done was never written
      }
    }
    return { state: 'unknown' };
  }
  return { state: 'restored' };
}

/**
 * Sends the settings whenever they change in this page session (looked at every `everyMs`); at once too when the service
 * holds no copy (`sendNow`). Never what the store held when it started, which may be older than the copy (two
 * identities, each with a store of its own), and never from a store without first run done. Returns a stop function.
 */
export function startKeeping(store: Store | null, copy: SettingsCopy, sendNow: boolean, everyMs = 60000, timers = { set: setInterval, clear: clearInterval }): () => void {
  let last = sendNow ? '' : JSON.stringify(snapshot(store));
  let busy = false;
  const look = async () => {
    const s = snapshot(store);
    if (busy || !s['hometv-setup-done']) return;
    const text = JSON.stringify(s);
    if (text === last) return;
    busy = true;
    try {
      if (await copy.save(s)) last = text;
    } finally {
      busy = false;
    }
  };
  void look();
  const t = timers.set(() => void look(), everyMs);
  return () => timers.clear(t);
}