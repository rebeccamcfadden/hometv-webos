// Updates as Samsung has them, for Settings › About and Home's update notice: the parts of design_preview's
// core/updates.ts at 2bf3c2d that apply. On Samsung a new page is a signed download (docs/page-updates.md): the loader
// checks shortly after Home shows and every 12 hours, downloads and checks a newer page by itself, and shows it at the
// next start. So there is no Install button and no Android prompt: About says where it stands, and Home's notice says
// once per version that a newer page is ready. A new app still comes from the laptop. Pure, for tests.

import type { KeyValueStore } from './homeRow';
import type { PageUpdates } from './platform';

/** The version Home's notice was last shown for: once per version. */
export const NOTICED_KEY = 'hometv-update-noticed';

/** Settings' About row: the version, or that a newer one is ready. */
export function aboutValue(s: PageUpdates | null, fallback: string): string {
  if (s && s.next) return `${s.next} ready`;
  return (s && s.page) || fallback || '';
}

/** About's line under Updates; `ago` says how long ago a time was ("5 minutes ago"). */
export function updateLine(s: PageUpdates | null, ago: (ms: number) => string): string {
  if (!s) return 'This copy of HomeTV isn’t the installed Samsung app, so it updates from the computer it runs from.';
  if (!s.on) return 'Updates without the laptop are off in this build: HomeTV updates when it’s installed again from the laptop.';
  if (s.next) return `Version ${s.next} is downloaded and checked. It shows the next time HomeTV starts; your settings stay.`;
  if (s.checkedAt && s.failed) return `Couldn’t check for updates (no internet?) · tried ${ago(s.checkedAt)} · tries again in 12 hours`;
  if (s.checkedAt) return `Up to date · checked ${ago(s.checkedAt)}`;
  return 'Looks for a newer version shortly after Home shows, then every 12 hours. Nothing else is sent.';
}

/** Home's notice: the newer version's number the first time Home shows with it ready, else null; marks it shown. */
export function takeNotice(storage: KeyValueStore | null, s: PageUpdates | null): string | null {
  if (!s || !s.next) return null;
  try {
    if (storage && storage.getItem(NOTICED_KEY) === s.next) return null;
    if (storage) storage.setItem(NOTICED_KEY, s.next);
  } catch (e) {
    // Blocked storage: shown each start it's ready, which is still only once per start.
  }
  return s.next;
}
