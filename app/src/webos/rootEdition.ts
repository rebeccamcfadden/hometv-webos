// The rooted edition's light ways back (docs/root-plan.md, The way back), HomeTV's side. Its service does the work, as
// root, through root/undo-home.sh (service/service.js: rootState, useLgHome).
// - Level 0, the way out: Home pressed three times within two seconds puts LG's Home back until the next restart. Only
//   while HomeTV is LG's Home (mounted over it, so the page's own id is LG Home's): each Home press then launches this
//   page again, which webOS tells it with `webOSRelaunch`. The idea is Razdva122's launcher's (no code taken).
//   UNCHECKED on a real TV: that webOS 25 relaunches the page on every press (a question for the first TV run).
// - Level 1, "Use LG's Home" (Settings): LG's Home for good from the next restart; HomeTV stays an app, root stays.

import { luna, lunaError, onWebOS } from './luna';

const SERVICE = 'luna://com.hometv.app.service';
export const LG_HOME = 'com.webos.app.home';
/** Three presses, the first and the last within two seconds. */
export const PRESSES = 3;
export const WITHIN_MS = 2000;

export interface RootState {
  /** root/ is on the TV. */
  edition: boolean;
  /** Its start-up hook is linked: HomeTV becomes Home at each start. */
  hooked: boolean;
  /** "Use LG's Home" is chosen. */
  chosen: boolean;
}

type WebOSWindow = { webOSSystem?: { identifier?: string }; PalmSystem?: { identifier?: string } };

/** The page's own app id as webOS gives it ("com.webos.app.home" when mounted over LG's Home); "" off a TV. */
export function pageAppId(w: unknown = typeof window !== 'undefined' ? window : null): string {
  const x = w as WebOSWindow | null;
  const sys = x && (x.webOSSystem || x.PalmSystem);
  const id = sys && typeof sys.identifier === 'string' ? sys.identifier : '';
  return id.split(' ')[0];
}

/** HomeTV is LG's Home right now: the root edition, mounted. */
export const isLgHome = (w?: unknown): boolean => pageAppId(w) === LG_HOME;

/** Counts Home presses; `onTrigger` once for three within WITHIN_MS, then it starts counting again. */
export function homePresses(onTrigger: () => void, now: () => number = Date.now) {
  let times: number[] = [];
  return {
    press(): boolean {
      const t = now();
      times = times.filter((x) => t - x <= WITHIN_MS).concat(t);
      if (times.length < PRESSES) return false;
      times = [];
      onTrigger();
      return true;
    },
  };
}

/** What the service sees, or null when it doesn't answer (not a TV, not the root edition's service). */
export async function readRootState(): Promise<RootState | null> {
  if (!onWebOS()) return null;
  const r = await luna(SERVICE + '/rootState', {}, 5000);
  if (!r.returnValue) return null;
  return { edition: !!r.edition, hooked: !!r.hooked, chosen: !!r.chosen };
}

/** Asks the service for LG's Home: '' when it took it, else why not. */
export async function useLgHome(mode: 'temp' | 'at-restart'): Promise<string> {
  if (!onWebOS()) return 'not on a webOS TV';
  const r = await luna(SERVICE + '/useLgHome', { mode }, mode === 'temp' ? 5000 : 20000);
  return r.returnValue ? '' : lunaError(r);
}

let state: RootState | null = null;
let listeners: (() => void)[] = [];

export const rootEdition = {
  /** The state read at the start (or after a change); null until then, or when the service can't say. */
  get: (): RootState | null => state,
  /** Settings shows "Use LG's Home" on the root edition only: while HomeTV is LG's Home, or root/ is on the TV. */
  shows: (): boolean => isLgHome() || !!(state && state.edition),
  async refresh(): Promise<RootState | null> {
    state = await readRootState();
    listeners.slice().forEach((fn) => fn());
    return state;
  },
  on(fn: () => void): () => void {
    listeners.push(fn);
    return () => {
      listeners = listeners.filter((x) => x !== fn);
    };
  },
};

export const LEVEL0_TEXT = 'Press Home three times within two seconds: LG’s Home comes back until the next restart.';
export const RESTART_TEXT = 'Unplug the TV from the wall, wait 30 seconds and plug it back in (the power button isn’t a restart).';

/**
 * Level 0: while HomeTV is LG's Home, three Home presses ask the service for LG's Home until the next restart. `toast`
 * says what happens. Nothing off a TV or when HomeTV runs as its own app.
 */
export function startWayOut(toast: (text: string, bad?: boolean) => void): void {
  if (!onWebOS() || !isLgHome() || typeof document === 'undefined') return;
  const presses = homePresses(() => {
    toast('LG’s Home until the next restart…');
    void useLgHome('temp').then((why) => {
      if (why) toast(`LG’s Home didn’t come back (${why}). ${RESTART_TEXT}`, true);
    });
  });
  document.addEventListener('webOSRelaunch', () => presses.press());
}
