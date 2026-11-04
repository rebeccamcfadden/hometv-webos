// The screensaver's rules without the DOM (ui/screensaver.ts draws it), so tests run them in Node: when it starts,
// which keys it swallows, the clock's words, and the glow's colours. From hometv-launcher's
// design_preview/src/ui/screensaver.ts at 2bf3c2d (F36).

/** Deep, low-brightness glow colours, drawn at partial alpha on black (upstream's palette). */
export const PALETTE = ['#2b5cff', '#00a39a', '#8a3ffc', '#e0661b', '#d6336c'];

export interface IdleContext {
  /** Home itself is the top of the stack: no popup, dropdown, dialog or other page over it. */
  home: boolean;
  /** HomeTV is in front: no other app, no input. */
  visible: boolean;
}

/**
 * Idle time and waking. Every key counts as input; while the clock is up, the key that wakes it is swallowed, with its
 * repeats and its release (upstream's rule: the key that wakes it doesn't also act on Home). Keys are by keyCode: an
 * old TV may send the remote's keys without `key`.
 */
export function createIdle(now: () => number) {
  let lastInput = now();
  let shown = false;
  const waking: Record<number, true> = {};
  return {
    isShown: () => shown,
    /** A key went down: true when it is swallowed. Hides the clock if it was up. */
    keyDown(code: number): boolean {
      lastInput = now();
      if (shown || waking[code]) {
        waking[code] = true;
        shown = false;
        return true;
      }
      return false;
    },
    /** A key came up: true when it is the release of a waking key, which is swallowed too. */
    keyUp(code: number): boolean {
      if (!waking[code]) return false;
      delete waking[code];
      return true;
    },
    /** Something else that counts as input (a click, HomeTV coming back to the front). */
    touch() {
      lastInput = now();
    },
    /** The clock went up. */
    show() {
      shown = true;
    },
    /** The clock went away without a key (HomeTV went behind another app). */
    hide() {
      shown = false;
      lastInput = now();
    },
    /** Whether the clock should go up now: `afterMs` 0 is off. */
    due(afterMs: number, ctx: IdleContext): boolean {
      if (shown || afterMs <= 0 || !ctx.visible || !ctx.home) return false;
      return now() - lastInput >= afterMs;
    },
  };
}

/** Minutes as the setting stores them ('off', '5', '15', '30') to milliseconds; `fast` (?saver=fast) makes a minute 2 s. */
export function afterMs(after: string, fast = false): number {
  const n = Number(after);
  if (!after || after === 'off' || !isFinite(n) || n <= 0) return 0;
  return n * (fast ? 2000 : 60000);
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * The clock's words as design_preview writes them (en-US): "9:05", "PM", "Wednesday, November 4". Written out, not
 * toLocale…String: an old TV's engine may lack the locale data.
 */
export function clockText(d: Date): { time: string; ampm: string; date: string } {
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes();
  return {
    time: `${h}:${m < 10 ? '0' : ''}${m}`,
    ampm: d.getHours() < 12 ? 'AM' : 'PM',
    date: `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`,
  };
}

/** Mixes two #rrggbb colours. */
export function mix(a: string, b: string, f: number): string {
  const p = (s: string, i: number) => parseInt(s.slice(1 + i * 2, 3 + i * 2), 16);
  let out = '#';
  for (let i = 0; i < 3; i++) {
    const v = Math.round(p(a, i) + (p(b, i) - p(a, i)) * f);
    out += (v < 16 ? '0' : '') + v.toString(16);
  }
  return out;
}

/**
 * The glow behind the clock as a CSS background: a soft pool of `colour` centred at (x, y), at upstream's 25%, 8% and
 * 0% stops. design_preview writes it with color-mix(), which Chromium 56 lacks, so the alphas are rgba() here.
 */
export function glowBackground(colour: string, x: number, y: number): string {
  const p = (i: number) => parseInt(colour.slice(1 + i * 2, 3 + i * 2), 16);
  const rgb = `${p(0)},${p(1)},${p(2)}`;
  return `radial-gradient(circle 1056px at ${Math.round(x)}px ${Math.round(y)}px, rgba(${rgb},0.25), rgba(${rgb},0.08) 50%, rgba(${rgb},0) 100%)`;
}
