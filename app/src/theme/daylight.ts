// The part of the day a Seasonal theme's picture shows (F22), from design_preview's core/daylight.ts at 2bf3c2d, as the launcher's DayPhase: dawn from 40 minutes before
// sunrise to 50 after, sunset from 50 minutes before sunset to 40 after, day and night in between. Sunrise and sunset
// come from the sunrise equation at the Weather place (the TV's time zone and a mid latitude until one is chosen), worked out offline. Both functions
// read one sorted timeline of edges across neighbouring dates, so a window that crosses midnight (in the browser's
// time zone) is still read right and the next edge is always in the future.

export type Phase = 'dawn' | 'day' | 'sunset' | 'night';

export const PHASES: Phase[] = ['dawn', 'day', 'sunset', 'night'];
export const PHASE_LABELS: Record<Phase, string> = { dawn: 'Dawn', day: 'Day', sunset: 'Sunset', night: 'Night' };

/** Where the sun is read: the Weather place, or before one is chosen the TV's own time zone at a mid latitude. */
export interface Site {
  lat: number;
  lon: number;
}
export const siteFromZone = (d: Date = new Date()): Site => ({ lat: 50, lon: -d.getTimezoneOffset() / 4 });
let LAT = 50;
let LON = 0;
/** The place the sun is read at from now on (Settings › Weather's, or the time zone's). */
export function setSite(s: Site) {
  LAT = s.lat;
  LON = s.lon;
}
const MIN = 60_000;
const DAY_MS = 86_400_000;
const rad = (d: number) => (d * Math.PI) / 180;
const norm = (d: number) => ((d % 360) + 360) % 360;

interface Edge {
  at: number;
  starts: Phase;
}

const cycleIndex = (ms: number) => ms / DAY_MS + 2440587.5 - 2451545.0 + 0.0008 + LON / 360;

/** Solar cycle n at the place: transit, sunrise and sunset (ms); or the transit and 'up' or 'down' (as DayPhase.cycle). */
function cycle(n: number): { transit: number; rise?: number; set?: number; polar?: 'up' | 'down' } {
  const jStar = n - LON / 360;
  const m = norm(357.5291 + 0.98560028 * jStar);
  const mr = rad(m);
  const c = 1.9148 * Math.sin(mr) + 0.02 * Math.sin(2 * mr) + 0.0003 * Math.sin(3 * mr);
  const lambda = rad(norm(m + c + 180 + 102.9372));
  const transitJ = 2451545.0 + jStar + 0.0053 * Math.sin(mr) - 0.0069 * Math.sin(2 * lambda);
  const ms = (j: number) => (j - 2440587.5) * DAY_MS;
  const sinDec = Math.sin(lambda) * Math.sin(rad(23.4397));
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosW = (Math.sin(rad(-0.833)) - Math.sin(rad(LAT)) * sinDec) / (Math.cos(rad(LAT)) * cosDec);
  if (cosW < -1) return { transit: ms(transitJ), polar: 'up' };
  if (cosW > 1) return { transit: ms(transitJ), polar: 'down' };
  const w = Math.acos(cosW) / (2 * Math.PI);
  return { transit: ms(transitJ), rise: ms(transitJ - w), set: ms(transitJ + w) };
}

/**
 * The edges from the day before `d` to two days after, in time order. They come from every solar cycle at the place
 * over that span (counted in UTC), so the browser's time zone and its daylight-saving changes never skip or repeat
 * one. A polar cycle is one edge at the midnight of the local date it falls on, and no other edge falls inside that
 * date; a sunset that runs into the next dawn hands straight over to it halfway between the two (as DayPhase.edges).
 */
function timeline(d: Date): Edge[] {
  const out: Edge[] = [];
  const polar: [number, number][] = [];
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime();
  const to = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 3).getTime();
  for (let n = Math.floor(cycleIndex(from)) - 1; n <= Math.ceil(cycleIndex(to)) + 1; n++) {
    const c = cycle(n);
    if (c.polar) {
      const t = new Date(c.transit);
      const start = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
      if (polar.some(([a]) => a === start)) continue;
      polar.push([start, new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1).getTime()]);
      out.push({ at: start, starts: c.polar === 'up' ? 'day' : 'night' });
      continue;
    }
    const rise = c.rise as number, set = c.set as number;
    const e = [rise - 40 * MIN, rise + 50 * MIN, set - 50 * MIN, set + 40 * MIN];
    if (e[1] > e[2]) e[1] = e[2] = (rise + set) / 2;
    PHASES.forEach((p, k) => out.push({ at: e[k], starts: p }));
  }
  const sorted = out.filter((e) => !polar.some(([a, b]) => e.at > a && e.at < b)).sort((a, b) => a.at - b.at);
  const kept: Edge[] = [];
  for (const e of sorted) {
    const last = kept[kept.length - 1];
    if (last && last.starts === 'dawn' && e.starts === 'night') {
      kept[kept.length - 1] = { at: (last.at + e.at) / 2, starts: 'dawn' };
      continue;
    }
    if (last && last.starts === e.starts) continue;
    kept.push(e);
  }
  return kept;
}

/** The phase started by the last edge at or before the moment. */
export function phaseAt(d: Date): Phase {
  const t = d.getTime();
  let phase: Phase = 'night';
  for (const e of timeline(d)) {
    if (e.at > t) break;
    phase = e.starts;
  }
  return phase;
}

/** Milliseconds until the part of the day next changes: the first edge strictly after the moment. */
export function msToNextPhase(d: Date): number {
  const t = d.getTime();
  for (const e of timeline(d)) if (e.at > t) return e.at - t;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - t;
}
