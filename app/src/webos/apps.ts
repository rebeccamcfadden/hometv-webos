// Which LG app a Home tile opens, and how a title opens there. Pure functions (no page, no TV), so tests run on a PC.
// App ids: docs/research.md section 1 (PyWebOSTV, homebridge-webos-tv, Home Assistant's list, LG-TV-HA-Home-Launcher);
// several ids per app where LG's differ by year or rebrand, newest first. Keys are the ones hometv-tizen's apps.ts and
// titleLinks.ts use (appletvplus is `appletv` there), so the copied screens need no change.

export const LG_APP_IDS: Record<string, string[]> = {
  netflix: ['netflix'],
  youtube: ['youtube.leanback.v4', 'com.webos.app.youtube'],
  prime: ['amazon'],
  disney: ['com.disney.disneyplus-prod'],
  max: ['com.wbd.stream', 'com.hbo.hbomax'],
  appletv: ['com.apple.appletv', 'com.apple.appletv.web'],
  appletvplus: ['com.apple.appletv', 'com.apple.appletv.web'],
  spotify: ['spotify-beehive', 'spotify'],
  hulu: ['hulu'],
  paramount: ['com.cbs-all-access.webapp.prod'],
  plex: ['cdp-30'],
};

export interface LaunchPoint {
  id: string;
  title: string;
}

/**
 * The installed app for a key: a known id first, else the first app whose title starts with the name (case aside),
 * as hometv-tizen's bridge finds apps in AeroTizen's list. Null when it isn't on the TV.
 */
export function findApp(apps: LaunchPoint[], key: string, name?: string): LaunchPoint | null {
  const ids = LG_APP_IDS[key] || [];
  for (const id of ids) {
    const hit = apps.filter((a) => a.id === id)[0];
    if (hit) return hit;
  }
  if (!name) return null;
  const want = name.toLowerCase();
  return (
    apps.filter((a) => {
      const t = a.title.toLowerCase();
      return t.indexOf(want) === 0 || (key === 'max' && t === 'max');
    })[0] || null
  );
}

/** The id to try when the TV wouldn't list its apps: the first known one. */
export const guessId = (key: string): string | null => (LG_APP_IDS[key] || [])[0] || null;

const NETFLIX_TITLE = /netflix\.com\/(?:[a-z-]+\/)?(?:title|watch)\/(\d+)/i;

/**
 * The launch params for a title link (hometv-tizen's OpenPlan 'link': a web link and/or YouTube's `v=<id>` payload).
 * YouTube: contentId `v=<id>` (works, research.md). Netflix: its old catalogue form, built from the title's number
 * (works on some TVs). Others: LG's `contentTarget` with the web link (untested; most apps ignore it).
 */
export function titleParams(key: string, url: string | null, payload: string): Record<string, string> | null {
  if (key === 'youtube') {
    const v = /(?:^|[?&])v=([\w-]{6,})/.exec(payload) || (url ? /[?&]v=([\w-]{6,})/.exec(url) : null);
    return v ? { contentId: 'v=' + v[1] } : null;
  }
  if (key === 'netflix' && url) {
    const m = NETFLIX_TITLE.exec(url);
    return m ? { contentId: `m=http://api.netflix.com/catalog/titles/movies/${m[1]}&source_type=4` } : { contentTarget: url };
  }
  return url ? { contentTarget: url } : null;
}
