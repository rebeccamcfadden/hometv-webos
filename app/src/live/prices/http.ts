// The one door to the price sources' servers, ported from the Android launcher's CachedHttp (the caching itself lives in
// book.ts, per title): before a request it syncs a Watchmode quota (once a day, free of credits), refuses one the quota
// doesn't allow (OverBudget), and paces the keyless sources to the minimum interval; after a reply it charges the cost
// and takes the server's own count from the headers. The ledger of each keyed source's quota is kept apart from the
// cache, since the cache may evict it.
import type { Reply } from '../../netReply';
import { DAY, Quota, minIntervalMs, requestCost } from './policy';
import { STATUS } from './watchmode';
import { OverBudget } from './types';
import type { Trigger } from './types';

export interface LedgerStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export interface HttpDeps {
  send(url: string, headers: Record<string, string>): Promise<Reply | null>;
  now(): number;
  sleep(ms: number): Promise<void>;
  ledger: LedgerStore | null;
}

export interface PriceHttp {
  /** The answer's text for a 200, null for a 404 ("not known"); throws OverBudget, or an Error when the request failed. */
  request(source: string, trigger: Trigger, url: string, headers: Record<string, string>): Promise<string | null>;
  quota(source: string): Quota;
}

const LEDGER = 'hometv-prices-v1:quota:';

export function createHttp(d: HttpDeps): PriceHttp {
  const quotas: Record<string, Quota> = {};
  const lastSent: Record<string, number> = {};
  let lastStatus = 0;

  const quota = (source: string): Quota => {
    if (quotas[source]) return quotas[source];
    let raw: string | null = null;
    try {
      raw = d.ledger ? d.ledger.getItem(LEDGER + source) : null;
    } catch (e) {
      raw = null;
    }
    return (quotas[source] = Quota.decode(source, raw));
  };
  const save = (q: Quota) => {
    try {
      if (d.ledger) d.ledger.setItem(LEDGER + q.source, q.encode());
    } catch (e) {
      // The count stays in memory.
    }
  };

  return {
    quota,

    async request(source, trigger, url, headers) {
      const q = quota(source);
      const keyed = q.isKeyed();
      if (keyed) {
        if (source === 'watchmode' && d.now() - q.syncedAt > DAY && d.now() - lastStatus > DAY) {
          lastStatus = d.now();
          const s = await d.send(STATUS, headers);
          if (s) {
            q.sync(s.headers, d.now());
            save(q);
          }
        }
        q.roll(d.now());
        if (!q.allowed(requestCost(source), trigger, d.now())) throw new OverBudget(source);
      }
      const wait = (lastSent[source] || 0) + minIntervalMs(source) - d.now();
      if (wait > 0) await d.sleep(wait);
      lastSent[source] = d.now();
      const r = await d.send(url, headers);
      if (!r) throw new Error(`${source}: no answer`);
      if (keyed) {
        q.record(requestCost(source), d.now());
        q.sync(r.headers, d.now());
        save(q);
      }
      if (r.code === 200) return r.body;
      if (r.code === 404) return null;
      throw new Error(`${source}: HTTP ${r.code}`);
    },
  };
}
