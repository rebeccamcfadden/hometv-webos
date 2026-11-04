// The LG side of the bridge (docs/platform.md in hometv-tizen): what differs between TV platforms and isn't the app
// list or opening apps. Screens and the shell never call LG's objects themselves; they use `bridge.platform`.
// Same shape as hometv-tizen's platform.ts.

import type { Key } from './shell/app';
import { luna, lunaError, lunaSubscribe, onWebOS, type LunaReply } from './webos/luna';

/** The TV's wall clock (platform.clock()): month 0-11, weekday 0 (Sunday) to 6, as Date has them. */
export interface WallClock {
  year: number;
  month: number;
  date: number;
  weekday: number;
  hours: number;
  minutes: number;
  /** The TV shows a 24-hour clock; null when it can't say. */
  hour24: boolean | null;
}

/** Page updates as Settings › About shows them (platform.pageUpdates()). */
export interface PageUpdates {
  /** The app's version. */
  app: string;
  /** The page shown. */
  page: string;
  /** The app was built with an update address and keys, so it checks. */
  on: boolean;
  /** A newer page downloaded and checked: it shows at the next start. */
  next: string | null;
  /** The last check this start, epoch ms; null before the first. */
  checkedAt: number | null;
  failed: boolean;
}

/** How the TV is connected: Wi-Fi, a cable, not at all, or it won't say (a PC, no webOS). */
export type NetKind = 'wifi' | 'ethernet' | 'none' | 'unknown';

export interface NetState {
  kind: NetKind;
  /** Wi-Fi signal from 0 to 1, when the TV says. */
  signal: number | null;
  /** The Wi-Fi network's name, when the TV says. Shown on the TV only: never logged or reported. */
  name: string;
  /** false only when the TV says it's offline. */
  online: boolean;
}

/** One of the TV's inputs, for the nav's Inputs menu. */
export interface TvInput {
  /** LG's input id, "HDMI_2": stable for a port. */
  id: string;
  kind: 'hdmi' | 'av' | 'tv';
  /** The port: "HDMI 2", "AV 1", "Live TV". */
  port: string;
  /** The device's name when the TV knows it (HDMI-CEC, or a name the household gave the port), else "". */
  device: string;
  connected: boolean;
  /** What the TV shows now. */
  active: boolean;
  /** The TV's own record (LG's input entry, with its app id), handed back to show(). */
  raw: unknown;
}

/** The TV's own settings pages the nav's menus point to. */
export type TvPage = 'main' | 'network' | 'picture' | 'sound' | 'inputs';

/** Where each page is in LG's webOS 25 menus, for when HomeTV can't open it (older TVs differ a little). */
const SETTINGS_WHERE: Record<TvPage, string> = {
  main: 'Press the Settings (gear) button on the remote, then All Settings.',
  network: 'Press the Settings (gear) button, then All Settings › Connection › Network (on older TVs: General › Network).',
  picture: 'Press the Settings (gear) button, then All Settings › Picture.',
  sound: 'Press the Settings (gear) button, then All Settings › Sound.',
  inputs: 'Press the Input button on the remote if it has one, or open LG’s Home dashboard and pick the input there.',
};

/**
 * LG's own Settings app. Unchecked on a real TV: no page ids are known to open a given page, so every page opens its
 * main screen. Fill this in when a TV shows which `target` values the app takes.
 */
const SETTINGS_APP = 'com.palm.app.settings';
const SETTINGS_TARGETS: Partial<Record<TvPage, string>> = {};

/** Luna's services the new members read (all unchecked on a real TV; see docs/platform-lg.md). */
const CONNECTION = 'luna://com.webos.service.connectionmanager/getStatus';
const INPUT_STATUS = 'luna://com.webos.service.eim/getAllInputStatus';
const SYSTEM_PROPERTY = 'luna://com.webos.service.tv.systemproperty/getSystemInfo';
const APP_LAUNCH = 'luna://com.webos.applicationManager/launch';
/** Live TV's app id on webOS: eim lists only the ports, so Live TV is added to the list by hand. */
const LIVE_TV_APP = 'com.webos.app.livetv';

/** The TV software's version, read once through Luna (osVersion() is synchronous, so the first call only starts it). */
let sdkVersion: string | null = null;
let sdkAsked = false;
function askSdkVersion(): void {
  if (sdkAsked || !onWebOS()) return;
  sdkAsked = true;
  luna(SYSTEM_PROPERTY, { keys: ['sdkVersion'] }, 5000).then((r) => {
    const v = r.returnValue && typeof r.sdkVersion === 'string' ? r.sdkVersion.trim() : '';
    sdkVersion = /^\d{1,2}(\.\d{1,2}){0,3}$/.test(v) ? v : '';
  });
}

const PORT_NAMES: Record<string, string> = { HDMI: 'HDMI', COMP: 'Component', COMPONENT: 'Component', SVIDEO: 'S-Video', SCART: 'SCART', PC: 'PC', DVI: 'DVI', AV: 'AV', RGB: 'RGB' };

/** LG's input record (an entry of eim's `devices`), as far as HomeTV reads it. */
interface EimDevice {
  id?: unknown;
  label?: unknown;
  connected?: unknown;
  appId?: unknown;
  activeInput?: unknown;
}

/** A device's name from LG's `label`, or "" for placeholders ("HDMI 2", "Unknown device"). */
export function lgDeviceName(label: unknown, port: string): string {
  if (typeof label !== 'string') return '';
  const name = label.replace(/\s+/g, ' ').trim();
  const ordinary = name.toLowerCase().replace(/[_.-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!ordinary || ordinary === port.toLowerCase()) return '';
  if (/^(?:hdmi|av|component|comp|scart|pc|dvi|rgb|s video|svideo|input(?: hdmi)?|unknown(?: device)?|unrecognized(?: device)?|no device|not connected|disconnected)(?: \d+)?$/.test(ordinary)) return '';
  return name.slice(0, 40);
}

/** The Inputs menu's list from eim's getAllInputStatus: one entry per port, HDMI first, connected first, Live TV last. */
export function inputsFrom(reply: LunaReply | null): TvInput[] {
  const devices = reply && Array.isArray(reply.devices) ? (reply.devices as EimDevice[]) : [];
  const list: TvInput[] = [];
  for (const d of devices) {
    if (!d || typeof d.id !== 'string' || typeof d.appId !== 'string' || !d.appId) continue;
    const m = /^([A-Za-z]+)[_ -]?(\d+)?/.exec(d.id);
    if (!m) continue;
    const type = m[1].toUpperCase();
    const num = Number(m[2]) || 1;
    const kind: TvInput['kind'] = type === 'HDMI' ? 'hdmi' : 'av';
    const port = `${PORT_NAMES[type] || m[1]} ${num}`;
    list.push({ id: d.id, kind, port, device: lgDeviceName(d.label, port), connected: d.connected === true, active: d.activeInput === true, raw: d });
  }
  const rank = (i: TvInput) => (i.kind === 'hdmi' ? 0 : 1);
  list.sort((a, b) => rank(a) - rank(b) || Number(b.connected) - Number(a.connected) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  list.push({ id: 'TV_1', kind: 'tv', port: 'Live TV', device: '', connected: true, active: false, raw: { id: 'TV_1', appId: LIVE_TV_APP } });
  return list;
}

/** What getStatus gives for one interface (wifi, wired), as far as HomeTV reads it. */
interface Iface {
  state?: unknown;
  ssid?: unknown;
  signalLevel?: unknown;
  signalBars?: unknown;
}

/** Wi-Fi signal 0-1 from LG's signalLevel (0-100) or signalBars (0-5); null for anything else. */
function signalFrom(w: Iface): number | null {
  const level = w.signalLevel;
  if (typeof level === 'number' && isFinite(level) && level >= 0 && level <= 100) return level / 100;
  const bars = w.signalBars;
  if (typeof bars === 'number' && isFinite(bars) && bars >= 0 && bars <= 5) return bars / 5;
  return null;
}

/** The connection from connectionmanager's getStatus. 'unknown' when the TV's answer isn't one. */
export function netFrom(r: LunaReply): NetState {
  const browserOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
  const unknown: NetState = { kind: browserOnline ? 'unknown' : 'none', signal: null, name: '', online: browserOnline };
  if (!r.returnValue) return unknown;
  const wifi = r.wifi as Iface | undefined;
  const wired = r.wired as Iface | undefined;
  const online = r.isInternetConnectionAvailable !== false && browserOnline;
  if (wifi && wifi.state === 'connected') {
    return { kind: 'wifi', signal: signalFrom(wifi), name: typeof wifi.ssid === 'string' ? wifi.ssid.slice(0, 64) : '', online };
  }
  if (wired && wired.state === 'connected') return { kind: 'ethernet', signal: null, name: '', online };
  if (wifi || wired) return { kind: 'none', signal: null, name: '', online: false };
  return unknown;
}

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
  /** Who this platform's side is built on, for Settings › About. */
  credits: 'Built on webosbrew’s Homebrew Channel (MIT) for the rooted edition, and lasharor’s cleanyourtv-WebOS (MIT) for its root scripts.',
  keys: KEYS,
  buttons: BUTTONS,

  /** Samsung needs buttons registered; LG sends them all. Kept so the screens stay the same. */
  registerButtons(names: (Button | 'digits')[]): void {
    void names;
  },

  /** false only when the TV says it's offline. */
  online: (): boolean => navigator.onLine !== false,

  /** The TV software's version ("10.0"), for the problem report; "" when unknown or not read yet (see askSdkVersion). */
  osVersion(): string {
    askSdkVersion();
    return sdkVersion || '';
  },

  /**
   * How the TV is connected (the nav's Wi-Fi icon and menu): connectionmanager's getStatus (wifi: name and signal,
   * wired). Outside webOS: 'unknown', or 'none' when the browser says it's offline. Unchecked on a real TV.
   */
  network(): Promise<NetState> {
    askSdkVersion();
    if (!onWebOS()) return Promise.resolve(netFrom({ returnValue: false }));
    return luna(CONNECTION, {}, 3000).then(netFrom);
  },

  /** Calls `fn` when the connection changes (getStatus's subscription, and the browser's online and offline). */
  onNetworkChange(fn: () => void): () => void {
    window.addEventListener('online', fn);
    window.addEventListener('offline', fn);
    let first = true;
    // The subscription answers at once with the state now; only the later answers are changes.
    const stop = lunaSubscribe(CONNECTION, {}, () => {
      if (first) first = false;
      else fn();
    });
    return () => {
      window.removeEventListener('online', fn);
      window.removeEventListener('offline', fn);
      stop();
    };
  },

  /**
   * The TV's inputs (the nav's Inputs menu) from eim's getAllInputStatus, with Live TV added last. UNCHECKED on a real
   * TV: the reply's shape (`devices` with id, label, connected, appId) is from LG's own apps, not seen here.
   */
  inputs: {
    /** The inputs, or null when the TV won't list them (a PC, or eim refusing). */
    list(): Promise<TvInput[] | null> {
      if (!onWebOS()) return Promise.resolve(null);
      return luna(INPUT_STATUS, {}, 3000).then((r) => (r.returnValue ? inputsFrom(r) : null));
    },
    /**
     * Shows an input: opens LG's app for it (com.webos.app.hdmi1 and the like), so HomeTV leaves: 'left'. 'preview'
     * without the TV, else why it failed.
     */
    show(input: TvInput): Promise<string> {
      if (!onWebOS()) return Promise.resolve('preview');
      const appId = input.raw && typeof (input.raw as EimDevice).appId === 'string' ? ((input.raw as EimDevice).appId as string) : '';
      if (!appId) return Promise.resolve('this TV didn’t say how to open it');
      return luna(APP_LAUNCH, { id: appId }, 6000).then((r) => (r.returnValue ? 'left' : lunaError(r)));
    },
    /** Nothing to hide: an input is a separate app, so HomeTV is already gone. */
    leave(): void {},
    /** Calls `fn` when something is plugged in or out (eim's subscription); returns a function that stops it. */
    onChange(fn: () => void): () => void {
      let first = true;
      return lunaSubscribe(INPUT_STATUS, {}, () => {
        if (first) first = false;
        else fn();
      });
    },
  },

  /**
   * Opens the TV's own settings: true when LG's Settings app took the launch. A page's own `target` goes along where
   * one is known (SETTINGS_TARGETS, none yet); otherwise the app opens on its main screen.
   */
  openTvSettings(page: TvPage): Promise<boolean> {
    if (!onWebOS()) return Promise.resolve(false);
    const target = SETTINGS_TARGETS[page];
    const params = target ? { id: SETTINGS_APP, params: { target } } : { id: SETTINGS_APP };
    return luna(APP_LAUNCH, params, 5000).then((r) => !!r.returnValue);
  },

  /** Where a settings page is on this TV, in plain words, for when openTvSettings can't open it. */
  settingsWhere: (page: TvPage): string => SETTINGS_WHERE[page],

  /**
   * The TV's clock. LG's pages follow the TV's time zone, so the page's Date is the wall clock. 24-hour or not is
   * `null` (unknown): no Luna read for it is known yet.
   */
  clock(): WallClock {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth(), date: d.getDate(), weekday: d.getDay(), hours: d.getHours(), minutes: d.getMinutes(), hour24: null };
  },

  /**
   * Page updates for Settings › About, from the installed app's loader (app/loader/boot.js status(), as on Samsung).
   * Null without the loader (a preview, the Simulator without the loader).
   */
  pageUpdates(): PageUpdates | null {
    type BootStatus = { shell?: string; page?: string; updates?: string; next?: string | null; lastCheck?: { at: string; result?: string } };
    const boot = (window as unknown as { HomeTVBoot?: { status?(): BootStatus } }).HomeTVBoot;
    if (!boot || !boot.status) return null;
    try {
      const s = boot.status();
      return {
        app: String(s.shell || ''),
        page: String(s.page || ''),
        on: !!s.updates && s.updates !== 'off',
        next: s.next || null,
        checkedAt: s.lastCheck ? Date.parse(s.lastCheck.at) || null : null,
        failed: !!s.lastCheck && /^failed/.test(s.lastCheck.result || ''),
      };
    } catch (e) {
      return null;
    }
  },

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
    // Luna is async, osVersion() isn't: read it now so the problem report has it.
    platform.osVersion();
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
