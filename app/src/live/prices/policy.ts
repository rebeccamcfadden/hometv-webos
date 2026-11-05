// When to ask the price sources and Wikidata again, and how much of each keyed source's quota may be spent, as pure
// logic: the Android launcher's PriceCachePolicy (the project lead's policy, 2026-10-30, no paid plans ever).
//  - Prices are kept 7 days, Wikidata's ids a month; after a failure (offline, a 5xx) a title waits an hour.
//  - Watchmode first (most Swedish stores), Movie of the Night only when Watchmode had no price or its budget is spent,
//    iTunes for the Apple TV Store when neither priced it.
//  - Each keyed source follows its server's own count (Quota, synced from every reply's headers) and stops short of the
//    quota: Watchmode at 2,300 credits of 2,500, Movie of the Night at 900 requests of 1,000. What is left is spread over
//    the days to the server's reset; background work may use half of a day's share, an opened title page all of it.
import type { StorePrice, Trigger } from './types';

export const HOUR = 3600000;
export const DAY = 24 * HOUR;
export const PRICE_TTL = 7 * DAY;
export const DEEP_LINK_TTL = 30 * DAY;
export const FAILURE_RETRY = HOUR;

export const WATCHMODE_STOP = 2300;
export const WATCHMODE_MARGIN = 200;
export const MOTN_STOP = 900;
export const MOTN_MARGIN = 100;

const WATCHMODE = 'watchmode';
const MOTN = 'streamingavailability';

/** Where a source stops spending this period: the fixed stop, lowered when the server grants less; 0 for a keyless source. */
export function stopAt(source: string, granted: number): number {
  if (source === WATCHMODE) return granted > 0 ? Math.max(0, Math.min(WATCHMODE_STOP, granted - WATCHMODE_MARGIN)) : WATCHMODE_STOP;
  if (source === MOTN) return granted > 0 ? Math.max(0, Math.min(MOTN_STOP, granted - MOTN_MARGIN)) : MOTN_STOP;
  return 0;
}

/** What one request costs against a source's budget: Watchmode charges 2 credits for a TMDB-id lookup. */
export const requestCost = (source: string): number => (source === WATCHMODE ? 2 : 1);

/** The least time between two requests to a keyless source: Apple asks for at most about 20 a minute. */
export const minIntervalMs = (source: string): number => (source === 'itunes' ? 3000 : source === 'wikidata' ? 1000 : 0);

/** Whether an answer fetched at `fetchedAt` (0 for never) is still good at `now`. */
export const fresh = (fetchedAt: number, now: number, ttl: number): boolean => fetchedAt > 0 && now >= fetchedAt && now - fetchedAt < ttl;

/** Whether iTunes is still worth asking after the keyed sources answered. */
export const needsItunes = (found: StorePrice[]): boolean => !found.some((p) => p.store === 'appletv');

const day = (now: number): string => {
  const d = new Date(now);
  return `${d.getFullYear()}-${('0' + (d.getMonth() + 1)).slice(-2)}-${('0' + d.getDate()).slice(-2)}`;
};

/** A month on, as Java's plusMonths does it: the day of the month clamps to the new month's last day. */
function monthLater(ms: number): number {
  const d = new Date(ms);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0)).getUTCDate();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
}

/** The reset after one that has passed: a month on, as often as needed to be after now. */
function nextReset(reset: number, now: number): number {
  let r = reset;
  while (r <= now) r = monthLater(r);
  return r;
}

const endOfMonth = (now: number): number => {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
};

function header(headers: Record<string, string>, name: string): string | null {
  for (const k of Object.keys(headers)) if (k.toLowerCase() === name) return headers[k];
  return null;
}

function number(headers: Record<string, string>, name: string): number | null {
  const v = header(headers, name);
  return v !== null && /^\s*-?\d+\s*$/.test(v) ? parseInt(v, 10) : null;
}

/** "2026-11-01T00:00:00Z", or seconds since 1970, as epoch ms; 0 for anything else. */
function instant(v: string | null): number {
  if (!v) return 0;
  if (/^\s*\d+\s*$/.test(v)) return parseInt(v, 10) * 1000;
  const t = Date.parse(v.trim());
  return isNaN(t) ? 0 : t;
}

/**
 * One keyed source's quota as its server last told it, plus what was spent since: the server's monthly grant, the count
 * used, when the count goes back to 0, and today's spending for the daily allowance. Synced from the headers of every reply
 * (when the page may read them), so a reinstall that forgot the count can't overspend once the server has answered. Movie of
 * the Night says when it resets (X-Quota-Reset); Watchmode doesn't, so its period is taken to run a month from first use and
 * is corrected whenever its count drops. Kept as a short string (encode).
 */
export class Quota {
  granted = 0;
  used = 0;
  /** When the server's count resets (epoch ms), 0 when not known yet. */
  resetAt = 0;
  /** When a reply's headers last told the count, 0 for never. */
  syncedAt = 0;
  day = '';
  dayUsed = 0;

  constructor(readonly source: string) {}

  /** "granted|used|resetAt|syncedAt|day|dayUsed". */
  encode(): string {
    return [this.granted, this.used, this.resetAt, this.syncedAt, this.day, this.dayUsed].join('|');
  }

  /** A quota from encode, or a fresh one when the text is missing or broken. */
  static decode(source: string, s: string | null): Quota {
    const q = new Quota(source);
    if (!s) return q;
    const p = s.split('|');
    const n = p.slice(0, 4).concat([p[5]]).map((x) => (/^-?\d+$/.test(x) ? parseInt(x, 10) : NaN));
    if (p.length !== 6 || n.some((x) => isNaN(x)) || (p[4] && !/^\d{4}-\d\d-\d\d$/.test(p[4]))) return new Quota(source);
    q.granted = n[0];
    q.used = n[1];
    q.resetAt = n[2];
    q.syncedAt = n[3];
    q.day = p[4];
    q.dayUsed = n[4];
    return q;
  }

  /** A new period once the reset has passed, and a new day once the date has moved on. */
  roll(now: number): void {
    if (this.resetAt > 0 && now >= this.resetAt) {
      this.used = 0;
      this.resetAt = nextReset(this.resetAt, now);
    }
    const today = day(now);
    if (today !== this.day) {
      this.day = today;
      this.dayUsed = 0;
    }
  }

  /** Counts a request sent now; the server's count, when its reply says it, then replaces `used`. */
  record(cost: number, now: number): void {
    this.roll(now);
    if (this.resetAt === 0 && this.source === WATCHMODE) this.resetAt = monthLater(now);
    this.used += cost;
    this.dayUsed += cost;
  }

  /** Takes the server's count from a reply's headers (names in any case). A Watchmode count that dropped means its period started again. */
  sync(headers: Record<string, string> | null, now: number): void {
    if (!headers) return;
    let g: number | null;
    let u: number | null;
    if (this.source === WATCHMODE) {
      g = number(headers, 'x-account-quota');
      u = number(headers, 'x-account-quota-used');
      if (u !== null && (u < this.used - 2 || this.resetAt === 0)) this.resetAt = monthLater(now);
    } else {
      g = number(headers, 'x-quota-granted');
      u = number(headers, 'x-quota-used');
      const reset = instant(header(headers, 'x-quota-reset'));
      if (reset > 0) this.resetAt = reset;
    }
    if (g !== null) this.granted = g;
    if (u !== null) {
      this.used = u;
      this.syncedAt = now;
    }
  }

  /** Where this source stops spending this period. */
  stop(): number {
    return stopAt(this.source, this.granted);
  }

  /** Today's share of what is left below the stop, over the days left to the reset (today included). */
  dailyAllowance(now: number): number {
    this.roll(now);
    const end = this.resetAt > 0 ? this.resetAt : endOfMonth(now);
    const daysLeft = Math.max(1, Math.floor((end - now + DAY - 1) / DAY));
    return Math.max(0, Math.floor((this.stop() - (this.used - this.dayUsed)) / daysLeft));
  }

  isKeyed(): boolean {
    return this.source === WATCHMODE || this.source === MOTN;
  }

  /** Whether a request costing `cost` may go out now: a keyless source always; a keyed one only below its stop, and within today's allowance (half of it for background work). */
  allowed(cost: number, trigger: Trigger, now: number): boolean {
    if (!this.isKeyed()) return true;
    const allowance = this.dailyAllowance(now);
    if (this.used + cost > this.stop()) return false;
    const cap = trigger === 'background' ? Math.floor(allowance / 2) : allowance;
    return this.dayUsed + cost <= cap;
  }
}
