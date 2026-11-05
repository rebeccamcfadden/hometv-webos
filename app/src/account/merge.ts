// Merging a list on the TV with the same list on TMDB (the Android launcher's ListMerge). A title nobody changed takes
// TMDB's state. A change made on the TV wins when TMDB didn't change that title since the last read, or when the TV's
// change is newer than that read; the changes that win stay queued to go up. Pure, tested.

import { type Op } from './ledger';

export interface Merged {
  /** The list as the TV should now show it: its own order first, then titles new from TMDB, then queued additions. */
  local: string[];
  /** The changes still to send, oldest first. */
  keep: Op[];
}

export function merge(local: string[], base: string[] | null, basePulledAt: number, remote: string[], pending: Op[]): Merged {
  const ops: Record<string, Op> = {};
  for (const op of pending) {
    const had = ops[op.id];
    if (!had || op.at >= had.at) ops[op.id] = op;
  }
  const keep: Op[] = [];
  const present: Record<string, true> = {};
  const all: string[] = [];
  const add = (id: string) => {
    if (all.indexOf(id) < 0) all.push(id);
  };
  local.forEach(add);
  remote.forEach(add);
  Object.keys(ops).forEach(add);
  for (const id of all) {
    const r = remote.indexOf(id) >= 0;
    const op = ops[id];
    let on: boolean;
    if (!op || op.present === r) {
      on = r;
    } else {
      const remoteChanged = r !== (!!base && base.indexOf(id) >= 0);
      if (!remoteChanged || op.at > basePulledAt) {
        on = op.present;
        keep.push(op);
      } else {
        on = r;
      }
    }
    if (on) present[id] = true;
  }
  const out: string[] = [];
  const put = (id: string) => {
    if (present[id] && out.indexOf(id) < 0) out.push(id);
  };
  local.forEach(put);
  remote.forEach(put);
  for (const op of keep) if (op.present) put(op.id);
  keep.sort((a, b) => a.at - b.at);
  return { local: out, keep };
}
