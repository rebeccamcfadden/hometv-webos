// The lookups waiting for the price thread, ported from the Android launcher's PriceQueue: a title page's lookups go before
// the rows', then first come first served. A title is queued once; a title page asking for one a row queued moves it ahead
// (boost). A lookup already running is left alone. Pure: book.ts drains it one lookup at a time.
import type { Kind } from '@hometv/core/types.ts';
import type { Trigger } from './types';

export interface Job {
  id: string;
  kind: Kind;
  name: string;
  year: number;
  needPrices: boolean;
  trigger: Trigger;
  seq: number;
}

export class PriceQueue {
  private jobs: Job[] = [];
  private seq = 0;

  /** Queues a lookup; false when the title is already queued (see boost). */
  add(id: string, kind: Kind, name: string, year: number, needPrices: boolean, trigger: Trigger): boolean {
    if (this.isQueued(id)) return false;
    this.jobs.push({ id, kind, name, year, needPrices, trigger, seq: ++this.seq });
    return true;
  }

  /** A title page wants a title: its waiting row lookup becomes a preview one (asking for prices if either did). False when the title isn't waiting or already is a preview's. */
  boost(id: string, needPrices: boolean): boolean {
    const i = this.jobs.findIndex((j) => j.id === id);
    if (i < 0) return false;
    const old = this.jobs[i];
    if (old.trigger === 'preview' && (old.needPrices || !needPrices)) return false;
    this.jobs[i] = { ...old, needPrices: old.needPrices || needPrices, trigger: 'preview', seq: ++this.seq };
    return true;
  }

  isQueued(id: string): boolean {
    return this.jobs.some((j) => j.id === id);
  }

  size(): number {
    return this.jobs.length;
  }

  /** The next job, or null: previews first, then in the order they were queued. */
  poll(): Job | null {
    let best = -1;
    for (let i = 0; i < this.jobs.length; i++) {
      if (best < 0 || this.before(this.jobs[i], this.jobs[best])) best = i;
    }
    return best < 0 ? null : this.jobs.splice(best, 1)[0];
  }

  private before(a: Job, b: Job): boolean {
    const pa = a.trigger === 'preview';
    const pb = b.trigger === 'preview';
    return pa !== pb ? pa : a.seq < b.seq;
  }
}
