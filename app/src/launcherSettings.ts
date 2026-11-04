// HomeTV's own settings on Samsung (Settings › Weather, Region, Performance and Screensaver, and first run), kept in
// the page's localStorage under `hometv-settings-v1`, and whether first run is done (`hometv-setup-done`). Home's row
// has its own key (homeRow.ts). The shapes follow design_preview's core/settings.ts at 2bf3c2d (region, place,
// recentPlaces, unit, motion, F36's screensaverAfter and screensaverBack), with Samsung's rules: one region at a time,
// chosen by the person (decided 2026-11-04), and no region or place until one is chosen (no sample data in v0). A place
// is a real Open-Meteo place, not design_preview's mock list. Pure apart from the storage passed in, so tests run it in
// Node.

import type { KeyValueStore } from './homeRow';
import { readPlace, samePlace, type Place } from './weather/openMeteo';

export type Region = 'se' | 'us';
/** °C, °F, or the region's (°F in the United States, else °C). */
export type Unit = 'c' | 'f' | 'region';

/** Settings › Performance's Motion (the nav's Settings menu steps it too). */
export type Motion = 'full' | 'reduced' | 'off';
/** F36: minutes Home sits untouched before the clock screensaver, or off (design_preview's default). */
export type ScreensaverAfter = 'off' | '5' | '15' | '30';
/**
 * What the clock floats over. design_preview also has 'picture' (the theme's picture darkened): Midnight, v0's only
 * theme, has no picture, so v0 has the glow and black.
 */
export type ScreensaverBack = 'glow' | 'black';

export const MOTIONS: Motion[] = ['full', 'reduced', 'off'];
export const MOTION_LABELS: Record<Motion, string> = { full: 'Full', reduced: 'Reduced', off: 'Off' };
export const SCREENSAVER_AFTER: ScreensaverAfter[] = ['off', '5', '15', '30'];
export const SCREENSAVER_AFTER_LABELS: Record<ScreensaverAfter, string> = { off: 'Off', '5': '5 min', '15': '15 min', '30': '30 min' };
export const SCREENSAVER_BACKS: ScreensaverBack[] = ['glow', 'black'];
export const SCREENSAVER_BACK_LABELS: Record<ScreensaverBack, string> = { glow: 'Glow', black: 'Black' };

export const REGIONS: Region[] = ['se', 'us'];
export const REGION_LABELS: Record<Region, string> = { se: 'Sweden', us: 'United States' };

export const SETTINGS_KEY = 'hometv-settings-v1';
export const SETUP_KEY = 'hometv-setup-done';
/** Quick picks in Change city: the places chosen before the one showing. */
export const RECENT_MAX = 3;

export interface Prefs {
  /** Whose streaming services, stores and prices HomeTV shows; null until the person chooses. */
  region: Region | null;
  /** Home's weather place; null until chosen, and then Home shows no weather. */
  place: Place | null;
  /** The places chosen before it, newest first. */
  recentPlaces: Place[];
  unit: Unit;
  motion: Motion;
  /** Off until the person picks a time (design_preview's first-run value). */
  screensaverAfter: ScreensaverAfter;
  screensaverBack: ScreensaverBack;
}

export const defaults = (): Prefs => ({
  region: null,
  place: null,
  recentPlaces: [],
  unit: 'region',
  motion: 'full',
  screensaverAfter: 'off',
  screensaverBack: 'glow',
});

const oneOf = <T extends string>(list: T[], v: unknown, fallback: T): T => (list.indexOf(v as T) >= 0 ? (v as T) : fallback);

/** The settings as saved; anything unreadable falls back to its default. */
export function loadPrefs(storage: KeyValueStore | null): Prefs {
  const out = defaults();
  try {
    const raw = storage && storage.getItem(SETTINGS_KEY);
    const saved = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    if (saved && typeof saved === 'object') {
      if (saved.region === 'se' || saved.region === 'us') out.region = saved.region;
      out.place = readPlace(saved.place);
      if (Array.isArray(saved.recentPlaces)) {
        for (const x of saved.recentPlaces) {
          const p = readPlace(x);
          if (p && !samePlace(p, out.place) && !out.recentPlaces.some((q) => samePlace(p, q))) out.recentPlaces.push(p);
        }
        out.recentPlaces = out.recentPlaces.slice(0, RECENT_MAX);
      }
      if (saved.unit === 'c' || saved.unit === 'f' || saved.unit === 'region') out.unit = saved.unit;
      out.motion = oneOf(MOTIONS, saved.motion, out.motion);
      out.screensaverAfter = oneOf(SCREENSAVER_AFTER, saved.screensaverAfter, out.screensaverAfter);
      out.screensaverBack = oneOf(SCREENSAVER_BACKS, saved.screensaverBack, out.screensaverBack);
    }
  } catch (e) {
    // Blocked or corrupt storage: the defaults.
  }
  return out;
}

export function savePrefs(storage: KeyValueStore | null, p: Prefs): void {
  try {
    if (storage) storage.setItem(SETTINGS_KEY, JSON.stringify(p));
  } catch (e) {
    // The choice lasts until the page reloads.
  }
}

/** A new place: the one showing goes to the front of the quick picks (design_preview weather.ts's choose). */
export function withPlace(p: Prefs, place: Place): Partial<Prefs> {
  if (samePlace(place, p.place)) return { place };
  const recent = (p.place ? [p.place] : []).concat(p.recentPlaces).filter((q) => !samePlace(q, place));
  return { place, recentPlaces: recent.slice(0, RECENT_MAX) };
}

/** Whether temperatures show in °F. */
export const fahrenheit = (p: Prefs) => p.unit === 'f' || (p.unit === 'region' && p.region === 'us');
export const unitSymbol = (p: Prefs) => (fahrenheit(p) ? '°F' : '°C');
export const UNIT_LABELS = (p: Prefs): Record<Unit, string> => ({
  c: '°C',
  f: '°F',
  region: `Region’s (${p.region === 'us' ? '°F' : '°C'})`,
});

export function setupDone(storage: KeyValueStore | null): boolean {
  try {
    return !!storage && storage.getItem(SETUP_KEY) === '1';
  } catch (e) {
    // Blocked storage: first run shows each start rather than never; it can be skipped.
    return false;
  }
}

export function markSetupDone(storage: KeyValueStore | null): void {
  try {
    if (storage) storage.setItem(SETUP_KEY, '1');
  } catch (e) {
    // Shows again next start.
  }
}

/** The live settings: read once, saved at every change, with listeners for the screens that show them. */
export function createPrefs(storage: KeyValueStore | null) {
  let data = loadPrefs(storage);
  let listeners: (() => void)[] = [];
  return {
    get: (): Readonly<Prefs> => data,
    set(patch: Partial<Prefs>) {
      const next: Prefs = {
        region: data.region,
        place: data.place,
        recentPlaces: data.recentPlaces,
        unit: data.unit,
        motion: data.motion,
        screensaverAfter: data.screensaverAfter,
        screensaverBack: data.screensaverBack,
      };
      for (const k of Object.keys(patch) as (keyof Prefs)[]) (next as unknown as Record<string, unknown>)[k] = patch[k];
      data = next;
      savePrefs(storage, data);
      listeners.slice().forEach((fn) => fn());
    },
    /** Calls `fn` on every change; returns a function that stops it. */
    on(fn: () => void): () => void {
      listeners.push(fn);
      return () => {
        listeners = listeners.filter((x) => x !== fn);
      };
    },
  };
}

export type PrefsStore = ReturnType<typeof createPrefs>;

export function pageStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch (e) {
    return null;
  }
}

/** The page's settings. */
export const prefs = createPrefs(pageStorage());
