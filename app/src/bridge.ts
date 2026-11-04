// Where the TV's functions come from (docs/platform.md in hometv-tizen; this is the LG copy, same exports):
// - **app**: HomeTV as its own LG app (Developer Mode or Homebrew Channel), or mounted over LG's Home when rooted
//   (root/). The page has PalmServiceBridge: LG's app manager (Luna) lists the apps with their icons and opens them,
//   with a title's launch params where the app takes one (webos/apps.ts).
// - **preview**: a browser on a PC; the page still works and says so.
// Samsung's 'tv' and 'fake-tv' (a TizenBrew module asking its service) have no LG twin: HomeTV is always its own app.

import { HOME_APPS, keyForName } from './apps';
import { recordError } from './errors';
import { pageChecks } from './pageChecks';
import type { OpenPlan } from './titleLinks';
import { platform } from './platform';
import { luna, lunaError, onWebOS } from './webos/luna';
import { findApp, guessId, titleParams, type LaunchPoint } from './webos/apps';

export const SERVICE = 'http://127.0.0.1:8766';

export type Mode = 'app' | 'tv' | 'fake-tv' | 'preview';

export interface AppInfo {
  key: string;
  name: string;
  /** null when the TV won't list its apps. */
  installed: boolean | null;
}

/** A key for any installed app, not only Home's known ones: "app:" and the TV's own app id. */
export const APP_PREFIX = 'app:';

/** An app on the TV, for All apps. */
export interface TvApp {
  /** The TV's own app id. */
  id: string;
  name: string;
  /** The Home tile it is (apps.ts), when it is one of those. */
  key: string | null;
}

export interface Result {
  at: string;
  check: string;
  ok: boolean;
  detail: unknown;
}

/** One of LG's launch points (luna://com.webos.applicationManager/listLaunchPoints): the parts HomeTV uses. */
export interface LgLaunchPoint extends LaunchPoint {
  icon?: string;
  largeIcon?: string;
  mediumLargeIcon?: string;
}

const APP_MANAGER = 'luna://com.webos.applicationManager';
/** HomeTV's own apps: never listed as apps to open. */
const OWN_IDS = ['com.hometv.app', 'com.hometv.checks'];

let mode: Mode = 'preview';
let problem = '';
let all: LgLaunchPoint[] | null = null;
let loading: Promise<LgLaunchPoint[] | null> | null = null;
const previewLog: Result[] = [];
let toast: (text: string) => void = () => {};

/** The TV's apps, once per start (again after a failed try). null when the TV won't list them. */
function loadApps(): Promise<LgLaunchPoint[] | null> {
  if (all) return Promise.resolve(all);
  if (!loading) {
    loading = luna(APP_MANAGER + '/listLaunchPoints', {}).then((r) => {
      loading = null;
      const list = r.launchPoints as LgLaunchPoint[] | undefined;
      if (!r.returnValue || !Array.isArray(list)) {
        problem = 'the TV didn’t list its apps: ' + lunaError(r);
        return null;
      }
      problem = '';
      all = list.filter((a) => a && a.id && OWN_IDS.indexOf(a.id) < 0);
      return all;
    });
  }
  return loading;
}

/**
 * The installed app for a Home tile (LG's ids first, then by name), or "app:" and its id (All apps, Home's row). An
 * app that isn't on Home's row (a store's, from the title page) is found by `name`.
 */
function installedFor(key: string, name?: string): LgLaunchPoint | null {
  if (!all) return null;
  if (key.indexOf(APP_PREFIX) === 0) {
    const id = key.slice(APP_PREFIX.length);
    return all.filter((a) => a.id === id)[0] || null;
  }
  const tile = HOME_APPS.filter((a) => a.key === key)[0];
  return (findApp(all, key, (tile && tile.name) || name) as LgLaunchPoint | null) || all.filter((a) => keyForName(a.title) === key)[0] || null;
}

/** The id to open: the installed app's; when the TV wouldn't list its apps, the first known id (or the "app:" id). */
function idFor(key: string, name?: string): string | null {
  const app = installedFor(key, name);
  if (app) return app.id;
  if (all) return null;
  return key.indexOf(APP_PREFIX) === 0 ? key.slice(APP_PREFIX.length) : guessId(key);
}

/** Opens an app, with launch params when given. '' when the TV took it, else its error. */
async function open(id: string, params?: Record<string, string> | null): Promise<string> {
  const r = await luna(APP_MANAGER + '/launch', params ? { id, params } : { id }, 15000);
  return r.returnValue ? '' : lunaError(r);
}

/** Opens an app by Home key or "app:" id, with the toast on a refusal; the callers write the error log. */
async function launchApp(key: string, name?: string): Promise<{ ok: boolean; id: string | null; error?: string }> {
  if (mode === 'preview') return { ok: true, id: null };
  await loadApps();
  const id = idFor(key, name);
  if (!id) return { ok: false, id: null, error: 'not on this TV' };
  const error = await open(id);
  if (error) toast(`The TV didn’t open it (${error}).`);
  return error ? { ok: false, id, error } : { ok: true, id };
}

export const bridge = {
  /** Keys, buttons, names, online state and the key page's TV side (platform.ts, docs/platform.md). */
  platform,
  mode: () => mode,
  /** Why the TV's functions weren't found, for the screen (empty when they were). */
  problem: () => problem,
  /** The TV's addresses a service reported: none on LG (platform.keyPages.address() asks the TV). */
  addresses: (): string[] => [],
  /** How many apps the TV listed. */
  appCount: () => (all ? all.length : 0),

  /** HomeTV's toast, for the bridge's own messages (an app the TV wouldn't open). */
  setToast(fn: (text: string) => void) {
    toast = fn;
  },

  /** 'app' on an LG TV, else 'preview'. `tries` is Samsung's (its service may start late); LG answers at once. */
  async connect(tries = 4): Promise<Mode> {
    void tries;
    mode = onWebOS() ? 'app' : 'preview';
    problem = '';
    return mode;
  },

  async apps(): Promise<AppInfo[] | null> {
    if (mode !== 'app') return null;
    if (!(await loadApps())) return null;
    return HOME_APPS.map((t) => ({ key: t.key, name: t.name, installed: !!installedFor(t.key) }));
  },

  /** The TV's own id for a Home row entry (App info): "app:" entries carry it; Home's tiles have it once the TV listed its apps. */
  appId(key: string): string | null {
    if (key.indexOf(APP_PREFIX) === 0) return key.slice(APP_PREFIX.length);
    const app = mode === 'app' ? installedFor(key) : null;
    return app ? app.id : null;
  },

  /** The TV's own artwork for a tile, best first: LG's large icon, then the smaller ones. */
  artwork(key: string): string[] {
    const app = mode === 'app' ? installedFor(key) : null;
    if (!app) return [];
    const urls = [app.largeIcon, app.mediumLargeIcon, app.icon];
    return urls.filter((u, i): u is string => !!u && urls.indexOf(u) === i);
  },

  /** Every app a person would open on the TV, by name, for All apps. null when the TV won't list them. */
  async installedApps(): Promise<TvApp[] | null> {
    if (mode !== 'app') return null;
    const list = await loadApps();
    return list ? list.map((a) => ({ id: a.id, name: a.title, key: keyForName(a.title) })) : null;
  },

  /** Opens an app: a Home key, or "app:" and the TV's id. `name` finds an app that isn't on Home's row. */
  async launch(key: string, name?: string): Promise<{ ok: boolean; id: string | null; error?: string }> {
    const r = await launchApp(key, name);
    if (!r.ok) recordError('launch_failed', { app: key, reason: r.error, mode });
    return r;
  },

  /**
   * Opens a title (titleLinks.ts, openPlan): the app with the title's launch params where LG's app takes them
   * (webos/apps.ts titleParams: YouTube's video, Netflix's title); if the TV refuses that, the app on its home.
   * `linked` says whether the title's params went.
   */
  async openTitle(plan: OpenPlan): Promise<{ ok: boolean; id: string | null; linked: boolean; error?: string }> {
    if (plan.how === 'link' && mode === 'app') {
      await loadApps();
      const id = idFor(plan.app.key, plan.app.name);
      if (!id) return { ok: false, id: null, linked: false, error: 'not on this TV' };
      const params = titleParams(plan.app.key, plan.url, plan.payload);
      if (params && !(await open(id, params))) return { ok: true, id, linked: true };
    }
    const r = await launchApp(plan.app.key, plan.app.name);
    if (!r.ok) recordError('title_failed', { app: plan.app.key, reason: r.error, mode });
    return { ok: r.ok, id: r.id, linked: false, error: r.error };
  },

  async check(name: string, params: Record<string, unknown> = {}): Promise<Result> {
    if (mode === 'app') {
      await loadApps();
      return pageChecks.run(name, params, (key) => idFor(key));
    }
    const r = { at: new Date().toISOString(), check: name, ok: false, detail: { error: 'preview: no TV' } };
    previewLog.push(r);
    return r;
  },

  async results(): Promise<Result[]> {
    return mode === 'app' ? pageChecks.results() : previewLog.slice();
  },
};
