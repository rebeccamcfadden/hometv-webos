// The TV Utilities folder in All apps (design_preview's core/tvUtilities.ts, F35 b, decided 2026-11-02: on for every TV,
// no switch): the apps the TV came with that aren't watch apps. Hold OK moves an app in or out by hand, and that
// choice wins; it is kept in localStorage under `hometv-utility-moves`.
//
// On Samsung the rule can't be the Android one (package names and the system image): Samsung's app list says neither
// where an app came from nor who made it, and AeroTizen's inventory already leaves the firmware's own parts out. So
// the stand-in is by name: Samsung's own apps and the usual extras a Samsung comes with, unless they are for watching
// or listening. Doubtful until it is checked on real TVs (W4's report, rule 1). Pure, so tests run it in Node.

import type { KeyValueStore } from './homeRow';

export type Moved = 'in' | 'out';

export interface AppFacts {
  name: string;
  /** A Home tile app (apps.ts) or another app people watch or listen in. */
  watch: boolean;
  moved?: Moved;
}

/** Apps people watch, listen or shop in, by the start of their name on a Samsung: never in the folder by the rule. */
const WATCH_NAMES =
  /^(netflix|youtube|prime video|amazon|disney|max\b|hbo|apple (tv|music)|hulu|peacock|paramount|spotify|plex|tubi|pluto|samsung tv plus|rakuten|dazn|viaplay|svt|tv4|crunchyroll|mubi|britbox|stremio|jellyfin|kodi|twitch|bbc|itvx|channel 4|my5|now\b|discovery|skyshowtime|tidal|deezer|curiosity|sling|fubo|philo|vudu|fandango|google tv)/i;

/** Samsung's own apps and the extras a Samsung comes with, by the start of their name. */
const SAMSUNG_OWN =
  /^(samsung|smartthings|gallery|art store|universal guide|e-manual|internet|web browser|bixby|alexa|google assistant|game bar|gaming hub|workout|ambient|media|apps\b|app store)/i;

export const isWatchApp = (name: string) => WATCH_NAMES.test(name.trim());

export function isTvUtility(a: AppFacts): boolean {
  if (a.moved) return a.moved === 'in';
  if (a.watch || isWatchApp(a.name)) return false;
  return SAMSUNG_OWN.test(a.name.trim());
}

export const UTILITY_MOVES_KEY = 'hometv-utility-moves';

export function loadMoves(storage: KeyValueStore | null): Record<string, Moved> {
  try {
    const raw = storage && storage.getItem(UTILITY_MOVES_KEY);
    const saved = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    const out: Record<string, Moved> = {};
    if (saved && typeof saved === 'object') for (const k of Object.keys(saved)) if (saved[k] === 'in' || saved[k] === 'out') out[k] = saved[k] as Moved;
    return out;
  } catch (e) {
    return {};
  }
}

/**
 * Moves an app in or out by hand. Only a move against the rule is kept, so an app moved back where the rule puts it
 * follows the rule again.
 */
export function moveApp(moves: Record<string, Moved>, id: string, facts: AppFacts, to: Moved): Record<string, Moved> {
  const out: Record<string, Moved> = {};
  for (const k of Object.keys(moves)) if (k !== id) out[k] = moves[k];
  if (isTvUtility({ name: facts.name, watch: facts.watch }) !== (to === 'in')) out[id] = to;
  return out;
}

export function saveMoves(storage: KeyValueStore | null, moves: Record<string, Moved>): void {
  try {
    if (storage) storage.setItem(UTILITY_MOVES_KEY, JSON.stringify(moves));
  } catch (e) {
    // The choice lasts until the page reloads.
  }
}
