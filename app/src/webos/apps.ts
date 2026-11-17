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

/**
 * Apps HomeTV knows by LG id, for a TV that won't list its apps to a Developer Mode app (listLaunchPoints is denied:
 * the 2026-11-17 call, webOS 10.3.2). Ids from LG_APP_IDS and from that TV's own list as the laptop check read it;
 * several ids for one app where LG's differ by year, newest first (only the first installed one shows). Swedish
 * services (SVT Play, TV4 Play, Viaplay) aren't here: their LG ids aren't known yet.
 */
export const KNOWN_APPS: LaunchPoint[] = [
  { id: 'netflix', title: 'Netflix' },
  { id: 'youtube.leanback.v4', title: 'YouTube' },
  { id: 'com.webos.app.youtube', title: 'YouTube' },
  { id: 'amazon', title: 'Prime Video' },
  { id: 'com.disney.disneyplus-prod', title: 'Disney+' },
  { id: 'com.wbd.stream', title: 'HBO Max' },
  { id: 'com.hbo.hbomax', title: 'HBO Max' },
  { id: 'com.apple.appletv', title: 'Apple TV' },
  { id: 'com.apple.appletv.web', title: 'Apple TV' },
  { id: 'hulu', title: 'Hulu' },
  { id: 'com.cbs-all-access.webapp.prod', title: 'Paramount+' },
  { id: 'com.peacock.tv', title: 'Peacock' },
  { id: 'com.peacocktv.peacock', title: 'Peacock' },
  { id: 'youtube.leanback.ytv.v1', title: 'YouTube TV' },
  { id: 'cdp-30', title: 'Plex' },
  { id: 'com.tubitv.ott.tubi', title: 'Tubi' },
  { id: 'com.plutotv.app', title: 'Pluto TV' },
  { id: 'com.webos.app.lgchannels', title: 'LG Channels' },
  { id: 'com.lgtvod.us.app', title: 'LG Movies & TV' },
  { id: 'spotify-beehive', title: 'Spotify' },
  { id: 'spotify', title: 'Spotify' },
  { id: 'pandora.lgerp.app', title: 'Pandora' },
  { id: 'com.webos.app.livetv', title: 'Live TV' },
  { id: 'com.webos.app.mediadiscovery', title: 'Media Player' },
  { id: 'com.webos.app.browser', title: 'Web Browser' },
  { id: 'com.webos.app.discovery', title: 'Apps' },
];

/** One reply of luna://com.webos.applicationManager/getAppLoadStatus: { returnValue, exist }. */
export interface LoadStatus {
  returnValue?: boolean;
  exist?: boolean;
}

/**
 * The known apps on this TV from getAppLoadStatus's replies (same order as `known`), one per title. `checked` is false
 * when the TV answered none of them: then every known app is offered, unchecked (opening one that isn't there says so).
 */
export function pickKnown(known: LaunchPoint[], replies: LoadStatus[]): { apps: LaunchPoint[]; checked: boolean } {
  const checked = replies.some((r) => !!r && r.returnValue !== false && typeof r.exist === 'boolean');
  const out: LaunchPoint[] = [];
  known.forEach((a, i) => {
    const r = replies[i];
    const there = checked ? !!r && r.returnValue !== false && r.exist === true : true;
    if (there && !out.some((x) => x.title === a.title)) out.push(a);
  });
  return { apps: out, checked };
}

const NETFLIX_TITLE = /netflix\.com\/(?:[a-z-]+\/)?(?:title|watch)\/(\d+)/i;

/**
 * Netflix's old title form is unproven (works for some TVs, not others: research.md section 1), so it is off. A TV call
 * turns it on by setting localStorage `hometv.netflix-old-link` to "1" in the page; until the TV says it opens the
 * title, Netflix opens on its home.
 */
export function netflixOldLink(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('hometv.netflix-old-link') === '1';
  } catch (e) {
    return false;
  }
}

/**
 * The launch params for a title link (hometv-tizen's OpenPlan 'link': a web link and/or YouTube's `v=<id>` payload).
 * YouTube: contentId `v=<id>` (works, research.md). Netflix: only behind `netflixOld` (netflixOldLink(), off by
 * default): its old catalogue form, built from the title's number. Others: LG's `contentTarget` with the web link
 * (untested; most apps ignore it, and the app then opens on its home).
 */
export function titleParams(key: string, url: string | null, payload: string, netflixOld: boolean = netflixOldLink()): Record<string, string> | null {
  if (key === 'youtube') {
    const v = /(?:^|[?&])v=([\w-]{6,})/.exec(payload) || (url ? /[?&]v=([\w-]{6,})/.exec(url) : null);
    return v ? { contentId: 'v=' + v[1] } : null;
  }
  if (key === 'netflix') {
    const m = url ? NETFLIX_TITLE.exec(url) : null;
    return netflixOld && m ? { contentId: `m=http://api.netflix.com/catalog/titles/movies/${m[1]}&source_type=4` } : null;
  }
  return url ? { contentTarget: url } : null;
}
