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
  load(): Promise<Record<string, string> | null>;
  save(settings: Record<string, string>): Promise<boolean>;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

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
 * When this store has no first run done and the service's copy has: the copy written into the store; true means start
 * the page again so every screen reads it. `once` (the session's store) holds the mark that stops a second time.
 */
export async function restoreIfEmpty(store: Store | null, copy: SettingsCopy, once: Store | null): Promise<boolean> {
  if (!store || store.getItem('hometv-setup-done')) return false;
  if (once && once.getItem(RESTORED_MARK)) return false;
  let saved: Record<string, string> | null = null;
  try {
    saved = await copy.load();
  } catch (e) {
    saved = null;
  }
  if (!saved || typeof saved['hometv-setup-done'] !== 'string') return false;
  try {
    for (const k of KEEP) if (typeof saved[k] === 'string') store.setItem(k, saved[k]);
    if (once) once.setItem(RESTORED_MARK, '1');
  } catch (e) {
    return false;
  }
  return true;
}

/** Sends the settings now and whenever they change (looked at every `everyMs`); returns a function that stops it. */
export function startKeeping(store: Store | null, copy: SettingsCopy, everyMs = 60000, timers = { set: setInterval, clear: clearInterval }): () => void {
  let last = '';
  let busy = false;
  const look = async () => {
    const s = snapshot(store);
    // only once first run is done: an empty store must never write over the household's copy
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
