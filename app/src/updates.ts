// Settings › Updates, Settings' About value and Home's update notice: what they say, from the installed app's loader
// (page updates: app/loader/boot.js, update.js) and, on the rooted edition, HomeTV's service (the app and its root
// scripts: service/update.js, update-apply.js). As Android's launcher (design_preview's core/updates.ts at 2bf3c2d):
// Check for updates looks at most once a day while Home shows, nothing is downloaded before Install update, and Home's
// notice shows once per version. A page update shows when HomeTV starts again; a new app needs root (HomeTV's service
// installs it) or, in Developer Mode, the laptop. Pure, for tests.

import type { KeyValueStore } from './homeRow';
import type { PageUpdates } from './platform';

/** The version Home's notice was last shown for: once per version. */
export const NOTICED_KEY = 'hometv-update-noticed';

/** The service's look (updateCheck): the app and root scripts on offer, on the root edition. */
export interface RootUpdates {
  /** The app was built with an update address and keys. */
  on: boolean;
  installed: string;
  available: string | null;
  /** The newest version, which failed to start here before: not offered again. */
  failedBefore: string | null;
  refused: string;
  error: string;
  /** The service runs as root on the root edition: it can install the app. */
  root: boolean;
}

/** The last root update (service updateStatus). */
export interface RootUpdateRecord {
  version: string;
  state: 'downloading' | 'installing' | 'done' | 'rolled back' | 'refused' | 'failed';
  note: string;
  from?: string;
  at?: number;
}

export interface Offer {
  /** "app": the .ipk and root scripts, through the service; "page": a page update. */
  kind: 'app' | 'page';
  version: string;
}

/** What Install update installs: the app first (it brings its own page), else a page; null when nothing is on offer. */
export function offerOf(page: PageUpdates | null, root: RootUpdates | null): Offer | null {
  if (root && root.root && root.available) return { kind: 'app', version: root.available };
  if (page && page.available && !page.next) return { kind: 'page', version: page.available };
  return null;
}

/** Settings' About row: the version, or that a newer one is ready or on offer. */
export function aboutValue(s: PageUpdates | null, fallback: string): string {
  if (s && s.next) return `${s.next} ready`;
  if (s && s.available) return `${s.available} available`;
  return (s && s.page) || fallback || '';
}

/** Settings › Updates' value in the list. */
export function updatesValue(page: PageUpdates | null, root: RootUpdates | null): string {
  const o = offerOf(page, root);
  if (o) return `${o.version} available`;
  if (page && page.next) return 'Restart to finish';
  if (page && page.on && !page.checkOn) return 'Off';
  return '';
}

/** The pane's first line: where updates stand. `ago` says how long ago a time was ("5 minutes ago"). */
export function updateLine(page: PageUpdates | null, root: RootUpdates | null, ago: (ms: number) => string): string {
  const o = offerOf(page, root);
  if (!page && !(root && root.on)) return 'This copy of HomeTV isn’t the installed LG app, so it updates from the computer it runs from.';
  if (!(page && page.on) && !(root && root.on)) return 'Updates from the TV are off in this build: HomeTV updates when it’s installed again from the laptop.';
  if (page && page.next) return `Version ${page.next} is downloaded and checked. It shows when HomeTV starts again; your settings stay.`;
  if (o && o.kind === 'app') {
    return `HomeTV ${o.version} is available: the app and its start-up scripts. Install update downloads it, checks its signature, and puts it in; if it doesn’t start within 40 seconds, this version comes back.`;
  }
  if (o) return `HomeTV ${o.version} is available. Install update downloads it, checks its signature, and HomeTV starts again with it.`;
  if (page && page.checkedAt && page.failed) return `Couldn’t check for updates (no internet?) · tried ${ago(page.checkedAt)}`;
  if (page && page.checkedAt) return `Up to date · checked ${ago(page.checkedAt)}`;
  return 'Not checked yet. Check for updates looks once a day while Home shows; nothing is downloaded until you press Install update.';
}

/**
 * A newer app that this TV can't install by itself (Developer Mode: the page can't install apps), or one that failed
 * here before; null when there's nothing to say.
 */
export function appLine(page: PageUpdates | null, root: RootUpdates | null): string | null {
  if (root && root.root && root.failedBefore && !root.available) {
    return `HomeTV ${root.failedBefore} didn’t start on this TV, so it isn’t offered again. The next version will be.`;
  }
  if (root && root.root) return null;
  const v = page && page.appNewer;
  if (!v) return null;
  return `A new HomeTV app (${v}) is out. On this TV it goes on from the laptop, with Dev Manager, as the first time; page updates keep coming meanwhile.`;
}

/** What the last root update did, in plain words; null with none. */
export function rootStatusLine(r: RootUpdateRecord | null): string | null {
  if (!r) return null;
  const v = r.version;
  if (!v) return r.state === 'refused' ? `The update wasn’t installed: ${r.note}. Nothing changed.` : null;
  switch (r.state) {
    case 'downloading':
      return `Downloading HomeTV ${v} and checking its signature…`;
    case 'installing':
      return `Installing HomeTV ${v}… The screen may go dark for a moment. If it doesn’t start within 40 seconds, the previous version comes back by itself.`;
    case 'done':
      return `HomeTV ${v} is installed.`;
    case 'rolled back':
      return `HomeTV ${v} didn’t start, so ${r.from || 'the previous version'} is back. ${v} won’t be offered again.`;
    case 'refused':
      return `HomeTV ${v} wasn’t installed: ${r.note}. Nothing changed.`;
    case 'failed':
      return `Couldn’t download HomeTV ${v} (${r.note}). Nothing changed; try again later.`;
    default:
      return null;
  }
}

/** Home's notice: `version` the first time Home shows with it on offer, else null; marks it shown. */
export function takeNotice(storage: KeyValueStore | null, version: string | null): string | null {
  if (!version) return null;
  try {
    if (storage && storage.getItem(NOTICED_KEY) === version) return null;
    if (storage) storage.setItem(NOTICED_KEY, version);
  } catch (e) {
    // Blocked storage: shown each start it's on offer, which is still only once per start.
  }
  return version;
}

/** The root edition's daily look (from Home's notice), kept across starts as the loader's is. */
export const ROOT_LOOKED_KEY = 'hometv.rootUpdates.at';
export const DAY_MS = 24 * 3600000;

/** Due when Check for updates is on and a day has passed since the last look; marks this one. */
export function rootLookDue(storage: KeyValueStore | null, checkOn: boolean, now: number): boolean {
  if (!checkOn) return false;
  try {
    const at = Number((storage && storage.getItem(ROOT_LOOKED_KEY)) || 0) || 0;
    if (at && now >= at && now - at < DAY_MS) return false;
    if (storage) storage.setItem(ROOT_LOOKED_KEY, String(now));
  } catch (e) {
    // Blocked storage: a look each start, still at most once a start.
  }
  return true;
}
