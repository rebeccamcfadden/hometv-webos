// Loads the details of a list's titles a few at a time, for the Availability and Length filters: a list entry carries
// neither where to watch nor a runtime, a details answer does. Only when a screen asks (a filter is on), never more than
// `parallel` at once and `cap` titles per ask, so a weak TV is not flooded; each title once. The source's own cache
// (live/cache.ts) keeps what comes back. Platform-free: the source's `need` and `on` come in.
import type { Phase } from './source';

export interface Prefetch {
  /** Queues the titles whose details haven't arrived (the first `cap` of them), then keeps `parallel` loading. */
  ask(ids: string[]): void;
  /** How many of these titles are still queued or loading. */
  waiting(ids: string[]): number;
}

export function createPrefetch(need: (id: string) => { phase: Phase }, on: (fn: () => void) => unknown, parallel = 3, cap = 60): Prefetch {
  const queued: string[] = [];
  const inflight: Record<string, true> = {};
  const seen: Record<string, true> = {};

  const pump = (): void => {
    for (const id of Object.keys(inflight)) if (need(id).phase !== 'loading') delete inflight[id];
    while (queued.length && Object.keys(inflight).length < parallel) {
      const id = queued.shift() as string;
      if (need(id).phase === 'loading') inflight[id] = true;
    }
  };
  on(pump);

  return {
    ask(ids) {
      // Only a list's first `cap` titles, however often a screen asks again: a redraw must not walk on down the list.
      for (const id of ids.slice(0, cap)) {
        if (seen[id]) continue;
        seen[id] = true;
        queued.push(id);
      }
      pump();
    },
    waiting: (ids) => ids.filter((id) => !!inflight[id] || queued.indexOf(id) >= 0).length,
  };
}
