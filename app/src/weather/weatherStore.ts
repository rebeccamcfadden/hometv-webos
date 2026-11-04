// Home's weather from Open-Meteo (no key), for the place and unit chosen in Settings: TEMPORARY port of the Android
// launcher's WeatherStore.java (hometv-launcher 2bf3c2d, launcher/app/src/main/java/com/hometv/launcher/), until
// weather is shared. The last good answer is kept in localStorage (`hometv-weather-v1`) and shown at once; Home asks
// for a fresh one when it comes into view, and now and then while it stays, but only when the answer is over 30
// minutes old. Nothing waits on the network: offline, Home shows the saved answer, or no weather at all when there has
// never been one. Changes: localStorage instead of a file; the request, clock, storage and online state are passed in,
// so tests run it in Node.

import type { KeyValueStore } from '../homeRow';
import { parseForecast, type Forecast } from './openMeteo';

export const WEATHER_CACHE_KEY = 'hometv-weather-v1';
export const MAX_AGE_MS = 30 * 60 * 1000;
/** A failed fetch (offline) isn't tried again sooner than this, however often Home comes back. */
export const RETRY_MS = 2 * 60 * 1000;

export interface WeatherDeps {
  storage: KeyValueStore | null;
  /** The answer's text, or null (offline, refused, too slow). */
  get(url: string): Promise<string | null>;
  now(): number;
  /** false only when the TV says it's offline. */
  online(): boolean;
}

export interface Shown {
  forecast: Forecast;
  /** When it was fetched, in epoch ms ("Offline · updated 19:52"). */
  fetchedAt: number;
}

export function createWeather(deps: WeatherDeps) {
  let query: string | null = null;
  let shown: Shown | null = null;
  let triedAt = 0;
  let fetching: string | null = null;
  let listeners: (() => void)[] = [];
  const tell = () => listeners.slice().forEach((fn) => fn());

  function readCache(q: string): Shown | null {
    try {
      const raw = deps.storage && deps.storage.getItem(WEATHER_CACHE_KEY);
      const c = raw ? (JSON.parse(raw) as { query?: unknown; fetched?: unknown; data?: unknown }) : null;
      if (!c || c.query !== q || typeof c.data !== 'string' || typeof c.fetched !== 'number') return null;
      const forecast = parseForecast(c.data);
      return forecast ? { forecast, fetchedAt: c.fetched } : null;
    } catch (e) {
      return null;
    }
  }

  function writeCache(q: string, data: string, fetched: number) {
    try {
      if (deps.storage) deps.storage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ query: q, fetched, data }));
    } catch (e) {
      // Full or blocked storage: the answer lasts until the page reloads.
    }
  }

  const api = {
    /** The forecast request for the chosen place and unit (openMeteo.forecastUrl), or null without a place. */
    use(q: string | null) {
      if (q === query) return;
      query = q;
      triedAt = 0;
      shown = q ? readCache(q) : null;
      tell();
    },
    current: (): Shown | null => shown,
    /** Fetches a fresh answer when the one shown is stale, unless one failed a moment ago or the TV is offline. */
    refresh() {
      const q = query;
      if (!q || fetching === q) return;
      const now = deps.now();
      const fresh = !!shown && now >= shown.fetchedAt && now - shown.fetchedAt < MAX_AGE_MS;
      if (fresh || (triedAt && now >= triedAt && now - triedAt < RETRY_MS) || !deps.online()) return;
      fetching = q;
      triedAt = now;
      deps.get(q).then((text) => {
        if (fetching === q) fetching = null;
        // The place or unit changed meanwhile: that request's answer isn't wanted, and the new one may be asked for.
        if (q !== query) return api.refresh();
        const forecast = text ? parseForecast(text) : null;
        if (!forecast || !text) return;
        const at = deps.now();
        writeCache(q, text, at);
        shown = { forecast, fetchedAt: at };
        tell();
      });
    },
    /** The network came back: try now rather than after the retry pause. */
    retry() {
      triedAt = 0;
      api.refresh();
    },
    /** Calls `fn` when the weather shown changes; returns a function that stops it. */
    on(fn: () => void): () => void {
      listeners.push(fn);
      return () => {
        listeners = listeners.filter((x) => x !== fn);
      };
    },
  };
  return api;
}

export type WeatherStore = ReturnType<typeof createWeather>;
