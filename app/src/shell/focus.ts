// Spatial (D-pad) navigation, from design_preview's core/focus.ts (same scoring, so focus moves the same way).
// Focusable elements carry `data-focus`; `data-group` lets a row or grid remember where focus was, so leaving and
// re-entering it returns to the same item.

export type Dir = 'up' | 'down' | 'left' | 'right';

export interface FocusOpts {
  onOk?: () => void;
  onFocus?: () => void;
  group?: string;
  /** Stable id used to restore focus after a re-render. */
  key?: string;
  /** The item a group picks when entered for the first time. */
  isDefault?: boolean;
}

const HANDLER = '__hometvFocus';
type WithHandler = HTMLElement & { [HANDLER]?: FocusOpts };

export function focusable<T extends HTMLElement>(el: T, opts: FocusOpts = {}): T {
  el.setAttribute('data-focus', '');
  if (opts.group) el.setAttribute('data-group', opts.group);
  if (opts.key) el.setAttribute('data-key', opts.key);
  if (opts.isDefault) el.setAttribute('data-default', '');
  (el as WithHandler)[HANDLER] = opts;
  return el;
}

export const handlerOf = (el: HTMLElement | null): FocusOpts | undefined => (el ? (el as WithHandler)[HANDLER] : undefined);

export function candidates(root: Element): HTMLElement[] {
  const all = root.querySelectorAll('[data-focus]');
  const out: HTMLElement[] = [];
  for (let i = 0; i < all.length; i++) {
    const el = all[i] as HTMLElement;
    if (!el.closest('[data-inert]') && el.getClientRects().length > 0) out.push(el);
  }
  return out;
}

function score(a: ClientRect, b: ClientRect, dir: Dir): number | null {
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  const bx = b.left + b.width / 2;
  const by = b.top + b.height / 2;
  const horizontal = dir === 'left' || dir === 'right';
  let primary: number;
  switch (dir) {
    case 'right':
      if (bx <= ax + 1 || b.right <= a.right) return null;
      primary = Math.max(0, b.left - a.right);
      break;
    case 'left':
      if (bx >= ax - 1 || b.left >= a.left) return null;
      primary = Math.max(0, a.left - b.right);
      break;
    case 'down':
      if (by <= ay + 1 || b.bottom <= a.bottom) return null;
      primary = Math.max(0, b.top - a.bottom);
      break;
    default:
      if (by >= ay - 1 || b.top >= a.top) return null;
      primary = Math.max(0, a.top - b.bottom);
      break;
  }
  const overlap = horizontal
    ? Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
    : Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const offAxis = horizontal ? Math.abs(by - ay) : Math.abs(bx - ax);
  const secondary = overlap > 0 ? 0 : offAxis;
  // When moving vertically, keep the left edges aligned so a column feels like a column.
  const align = horizontal ? offAxis : Math.abs(b.left - a.left);
  return primary + secondary * 2.5 + align * 0.08;
}

/** The nearest item in `dir` under `root`, with no group memory or default. */
export function nearest(root: Element, from: HTMLElement, dir: Dir): HTMLElement | null {
  const a = from.getBoundingClientRect();
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const c of candidates(root)) {
    if (c === from) continue;
    const s = score(a, c.getBoundingClientRect(), dir);
    if (s !== null && s < bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return best;
}

/** The next item in `dir`; entering another group returns to its remembered item, or its default. */
export function findNext(root: Element, from: HTMLElement, dir: Dir, memory: Record<string, HTMLElement>): HTMLElement | null {
  const list = candidates(root).filter((c) => c !== from);
  const best = nearest(root, from, dir);
  const group = best && best.getAttribute('data-group');
  if (best && group && group !== from.getAttribute('data-group')) {
    const remembered = memory[group];
    if (remembered && document.body.contains(remembered) && list.indexOf(remembered) >= 0) return remembered;
    for (const c of list) if (c.getAttribute('data-group') === group && c.hasAttribute('data-default')) return c;
  }
  return best;
}

/**
 * Scroll every `data-scroll="x|y"` ancestor so `el` is inside it with some padding (`data-scroll-pad`; a vertical
 * box may keep more room at its foot with `data-scroll-pad-bottom`).
 */
export function ensureVisible(el: HTMLElement, scale: number): void {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const axis = node.getAttribute('data-scroll');
    if (!axis) continue;
    const pad = Number(node.getAttribute('data-scroll-pad') || 48);
    const padBottom = Number(node.getAttribute('data-scroll-pad-bottom') || pad);
    const c = node.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (axis.indexOf('y') >= 0) {
      const top = (r.top - c.top) / scale;
      const bottom = (r.bottom - c.top) / scale;
      const height = c.height / scale;
      if (top < pad) node.scrollTop += top - pad;
      else if (bottom > height - padBottom) node.scrollTop += bottom - (height - padBottom);
    }
    if (axis.indexOf('x') >= 0) {
      const left = (r.left - c.left) / scale;
      const right = (r.right - c.left) / scale;
      const width = c.width / scale;
      if (left < pad) node.scrollLeft += left - pad;
      else if (right > width - pad) node.scrollLeft += right - (width - pad);
    }
  }
}
