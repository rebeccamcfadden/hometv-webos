// The heartbeat HomeTV's page sends while it shows, which the root edition's watchdog and the laptop's restart check
// read (root/watchdog.sh, /tmp/hometv-alive). First through HomeTV's service (Luna `alive`); when that fails, through
// the root edition's listener on 127.0.0.1 (root/heartbeat.js), which also notes in the TV's boot log why the call
// failed. On call #2 (2026-11-18) the heartbeat never came while HomeTV was mounted over LG's Home, though it came
// when HomeTV was opened from its tile: mounted, the page runs as LG's Home, and the bus may refuse LG's Home's call.
// After three failed calls in a row the page also keeps what went wrong in its storage, for the Checks screen: written
// when it changes (not at every beat), and dropped once the service answers the page running as the same id again.
// Platform-free: the calls and the storage are passed in (platform.ts on the TV, fakes in the tests).

import type { LunaReply } from './luna';

/** The page's storage key for the last heartbeat trouble. */
export const HEARTBEAT_KEY = 'hometv-heartbeat-v1';
/** root/heartbeat.js's address: on the TV itself only. */
export const LOOPBACK = 'http://127.0.0.1:8767/alive';
/** Failed calls to the service in a row before the trouble is kept. */
export const KEEP_AFTER = 3;

export interface HeartbeatTrouble {
  /** When it was kept (ms). */
  at: number;
  /** The id the page runs as (LG's Home when mounted over it), "" when the TV doesn't say. */
  as: string;
  /** The service call's error, as the TV gave it. */
  luna: string;
  /** The 127.0.0.1 way: "ok", or what went wrong. */
  loopback: string;
  /** The page said it was hidden. */
  hidden: boolean;
}

export interface HeartbeatDeps {
  call(): Promise<LunaReply>;
  /** A GET; the HTTP status, 0 when it failed. */
  get(url: string): Promise<number>;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  as(): string;
  hidden(): boolean;
  now(): number;
}

const short = (s: string, n = 120) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

/** One beat at a time: 'service', 'loopback', or 'none' when neither way answered. */
export function createHeartbeat(d: HeartbeatDeps): () => Promise<'service' | 'loopback' | 'none'> {
  let fails = 0;
  let busy = false;
  return async () => {
    if (busy) return 'none';
    busy = true;
    try {
      const r = await d.call();
      if (r.returnValue === true) {
        fails = 0;
        const kept = heartbeatTrouble(d.storage);
        // fixed where it went wrong (HomeTV opened from its tile instead is another case: kept for the Checks screen)
        if (kept && kept.as === short(d.as(), 60) && d.storage) {
          try {
            d.storage.removeItem(HEARTBEAT_KEY);
          } catch (e) {
            // left; harmless
          }
        }
        return 'service';
      }
      fails++;
      const err = short(r.errorText || (r.errorCode !== undefined ? `error ${r.errorCode}` : 'failed'));
      const as = short(d.as(), 60);
      const hidden = d.hidden();
      const q = `?why=${encodeURIComponent(err)}&as=${encodeURIComponent(as)}&hidden=${hidden ? 1 : 0}`;
      const status = await d.get(LOOPBACK + q);
      const ok = status >= 200 && status < 300;
      if (fails >= KEEP_AFTER && d.storage) {
        const t: HeartbeatTrouble = { at: d.now(), as, luna: err, loopback: ok ? 'ok' : status ? `HTTP ${status}` : 'no answer', hidden };
        const kept = heartbeatTrouble(d.storage);
        const same = kept && kept.as === t.as && kept.luna === t.luna && kept.loopback === t.loopback && kept.hidden === t.hidden;
        try {
          if (!same) d.storage.setItem(HEARTBEAT_KEY, JSON.stringify(t));
        } catch (e) {
          // full or refused: the beat still counts
        }
      }
      return ok ? 'loopback' : 'none';
    } finally {
      busy = false;
    }
  };
}

/** The kept trouble, or null. */
export function heartbeatTrouble(storage: Pick<Storage, 'getItem'> | null): HeartbeatTrouble | null {
  try {
    const t = JSON.parse((storage && storage.getItem(HEARTBEAT_KEY)) || 'null');
    return t && typeof t.at === 'number' && typeof t.luna === 'string' ? (t as HeartbeatTrouble) : null;
  } catch (e) {
    return null;
  }
}

/** For the Checks screen: what the last trouble was, in a line; "" when none was kept. */
export function heartbeatText(t: HeartbeatTrouble | null): string {
  if (!t) return '';
  const when = new Date(t.at);
  const stamp = `${when.toDateString().slice(4, 10)} ${when.toTimeString().slice(0, 5)}`;
  return `Heartbeat trouble (${stamp}${t.as ? `, running as ${t.as}` : ''}${t.hidden ? ', page hidden' : ''}): HomeTV’s service said “${t.luna}”; the 127.0.0.1 way: ${t.loopback}.`;
}
