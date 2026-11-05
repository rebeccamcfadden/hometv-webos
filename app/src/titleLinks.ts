// Which Samsung app a service opens in, and how a title opens there. A store sells inside its subscription's app
// (@hometv/core's appName: Amazon Video in Prime Video, the Apple TV Store in Apple TV), and Samsung knows a few apps
// by another key than the shared package (apps.ts: appletvplus is appletv). docs/research.md, section 1 and the
// emulator notes, has what is known about opening a title rather than the app.
import { appName, SERVICES } from '@hometv/core/services.ts';
import type { ServiceId, Title } from '@hometv/core/types.ts';
import { SAMSUNG_KEY } from './apps';

export interface SamsungApp {
  /** The key bridge.launch and the service know the app by. */
  key: string;
  /** The app's name, which finds it in the TV's own list (AeroTizen's inventory) when it isn't on Home's row. */
  name: string;
}

export function samsungApp(service: ServiceId): SamsungApp {
  const name = appName(service);
  const ids = Object.keys(SERVICES) as ServiceId[];
  const own = ids.filter((id) => !SERVICES[id].store && SERVICES[id].name === name)[0] || service;
  return { key: SAMSUNG_KEY[own] || own, name };
}

/** A title's link in one service: its web link, and the data its Samsung app takes (YouTube's `v=<video id>`). */
export interface TitleLink {
  url?: string;
  payload?: string;
}

export type OpenPlan =
  | { how: 'app'; app: SamsungApp }
  /** An app control (`operation/view`) with the web link, if any, and PAYLOAD; the app opens plainly if it's refused. */
  | { how: 'link'; app: SamsungApp; url: string | null; payload: string };

/**
 * How a title opens: YouTube takes the video as PAYLOAD with no link (AeroTizen's fireplace tile, tested on a TV by
 * its author); another service gets its web link, the first of the three untested candidates in research.md; with
 * no link, the app opens on its home.
 */
export function openPlan(service: ServiceId, link?: TitleLink): OpenPlan {
  const app = samsungApp(service);
  if (link && app.key === 'youtube' && link.payload) return { how: 'link', app, url: null, payload: link.payload };
  if (link && link.url && app.key !== 'youtube') return { how: 'link', app, url: link.url, payload: link.payload || '' };
  return { how: 'app', app };
}

/**
 * Title links by title id and service. Empty: TMDB gives no service's own title ids. They come with prices in M2 and
 * the Java's DeepLinks in @hometv/core (docs/shared-package.md).
 */
const LINKS: Record<string, Partial<Record<ServiceId, TitleLink>>> = {};

export const linkFor = (t: Title, service: ServiceId): TitleLink | undefined => (LINKS[t.id] || {})[service];
