// The words of Home's top bar (design_preview's screens/home.ts at 2bf3c2d): the greeting, the date and the time, from
// the TV's wall clock (bridge.platform.clock()). English, as design_preview writes them; written out here rather than
// with toLocaleDateString, whose names and time zone vary between TV engines. Pure, for tests.

import type { WallClock } from './platform';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const greeting = (hours: number) => (hours < 12 ? 'Good morning' : hours < 18 ? 'Good afternoon' : 'Good evening');

/** "Wednesday, November 4". */
export const dateLine = (c: WallClock) => `${WEEKDAYS[c.weekday]}, ${MONTHS[c.month]} ${c.date}`;

const two = (n: number) => ('0' + n).slice(-2);

/** "9:41" and "PM" on a 12-hour clock; "21:41" and "" on a 24-hour one. */
export function timeParts(hours: number, minutes: number, hour24: boolean): { time: string; ampm: string } {
  if (hour24) return { time: `${two(hours)}:${two(minutes)}`, ampm: '' };
  const h = hours % 12 === 0 ? 12 : hours % 12;
  return { time: `${h}:${two(minutes)}`, ampm: hours < 12 ? 'AM' : 'PM' };
}

/**
 * A 24-hour clock when the TV shows one; when it can't say, the region's habit (Sweden 24-hour), and otherwise the
 * design's 12-hour clock.
 */
export const use24 = (tv: boolean | null, region: 'se' | 'us' | null) => (tv !== null ? tv : region === 'se');

/**
 * "just now", "25 minutes ago", "3 hours ago", "2 days ago", for "Offline · updated …": how long ago rather than a time
 * of day, so the page's time zone doesn't matter.
 */
export function ago(thenMs: number, nowMs: number): string {
  const min = Math.floor(Math.max(0, nowMs - thenMs) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return min === 1 ? '1 minute ago' : `${min} minutes ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr === 1 ? '1 hour ago' : `${hr} hours ago`;
  const d = Math.floor(hr / 24);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}
