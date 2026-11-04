// The LG side of the bridge (docs/platform.md in hometv-tizen): what differs between TV platforms and isn't the app
// list or opening apps. Screens and the shell never call LG's objects themselves; they use `bridge.platform`.
// Same shape as hometv-tizen's platform.ts.

import type { Key } from './shell/app';
import { luna, onWebOS } from './webos/luna';

/** The remote's keys the shell understands, by keyCode: LG's remote (webOS TV key codes) and a PC keyboard. */
const KEYS: Record<number, Key> = {
  37: 'left',
  38: 'up',
  39: 'right',
  40: 'down',
  13: 'ok',
  461: 'back', // Back on LG's remote (appinfo.json disableBackHistoryAPI, so it reaches the page)
  27: 'back', // Esc
  8: 'back', // Backspace
};

/** The remote's other buttons by name, as keyCodes. LG's remotes send the colours to every app, no sign-up needed. */
const BUTTONS = {
  red: 403,
  green: 404,
  yellow: 405,
  blue: 406,
  /** Not on every LG remote (the Magic Remote has none); the screens have another way. */
  info: 457,
};
export type Button = keyof typeof BUTTONS;

/** HomeTV's background service (service/): the key page, and the heartbeat root/watchdog.sh waits for. */
const SERVICE = 'luna://com.hometv.app.service';
/** How often the page tells the service it's alive while it shows. The watchdog allows a minute (root/watchdog.sh). */
const HEARTBEAT_MS = 10000;
let heartbeat: number | null = null;

function beat(): void {
  if (typeof document !== 'undefined' && document.hidden) return;
  luna(SERVICE + '/alive', {}, 5000);
}

export const platform = {
  /** Shown to people: "LG", in "LG app", the checks and reports. */
  brand: 'LG',
  /** The TV's software, for the checks screen: "webOS 25". */
  os: 'webOS',
  keys: KEYS,
  buttons: BUTTONS,

  /** Samsung needs buttons registered; LG sends them all. Kept so the screens stay the same. */
  registerButtons(names: (Button | 'digits')[]): void {
    void names;
  },

  /** false only when the TV says it's offline. */
  online: (): boolean => navigator.onLine !== false,

  /**
   * The page works: tells the installed app's loader (app/loader/boot.js), which then keeps this page as the good one
   * and looks for a newer signed one ten seconds later (docs/updates.md); and tells HomeTV's service it's alive now and
   * every 10 s while it shows, so the rooted edition's watchdog (root/watchdog.sh) knows HomeTV, not a blank screen,
   * is LG's Home.
   */
  started(): void {
    const boot = (window as unknown as { HomeTVBoot?: { started?(): void } }).HomeTVBoot;
    try {
      if (boot && boot.started) boot.started();
    } catch (e) {
      // The loader's trouble never stops Home or the heartbeat.
    }
    if (!onWebOS() || heartbeat !== null) return;
    beat();
    heartbeat = window.setInterval(beat, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', beat);
  },

  /** The key page's TV side (screens/keys.ts): where its service runs and how the screen talks to it. */
  keyPages: {
    /** On a real TV (only the TV's port is tried), or a PC. */
    onTv: (): boolean => onWebOS(),
    /** Starts the service if it isn't running yet: any call starts an LG service. */
    start(): void {
      if (onWebOS()) luna(SERVICE + '/start', {}, 5000);
    },
    /**
     * The screen's token: on the TV from HomeTV's service, which gives it only to HomeTV's own page (it checks the
     * caller); on a PC (`npm run dev`) from the dev server. "" when it can't be read.
     */
    token(): Promise<string> {
      if (!onWebOS()) {
        return new Promise((resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', '/__hometv/pages-token');
          xhr.timeout = 1500;
          xhr.onload = () => resolve(xhr.status === 200 ? xhr.responseText.trim() : '');
          xhr.onerror = xhr.ontimeout = () => resolve('');
          xhr.send();
        });
      }
      return luna(SERVICE + '/token', {}, 5000).then((r) => (r.returnValue && typeof r.token === 'string' ? r.token : ''));
    },
    /** The TV's own address on the home network (Wi-Fi, then wired). "" when unknown. */
    address(): Promise<string> {
      if (!onWebOS()) return Promise.resolve('');
      return luna('luna://com.webos.service.connectionmanager/getStatus', {}, 3000).then((r) => {
        const pick = (k: string) => {
          const n = r[k] as { state?: string; ipAddress?: string } | undefined;
          return n && n.state === 'connected' && n.ipAddress ? n.ipAddress : '';
        };
        return pick('wifi') || pick('wired');
      });
    },
  },
};
