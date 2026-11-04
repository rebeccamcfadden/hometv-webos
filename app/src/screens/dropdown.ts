// The glass dropdown, ported from design_preview's screens/dropdown.ts: a menu hung under a button (Sort, the nav's
// Wi-Fi, Inputs and Settings) or from a card (the hold-OK menus of All apps and Home). It closes on Back, on OK on a
// row, on a click outside it, or when the D-pad moves past its edge; focus returns to the button or card. Rows may have
// a status, a green dot, a chevron, position dots that OK steps (Motion), and a line above them; the menu may have a
// header (Wi-Fi). The title menu's ticks aren't needed yet.

import { shell, STAGE_H, STAGE_W, type Screen } from '../shell/app';
import { h } from '../shell/dom';
import { focusable } from '../shell/focus';
import { icon, type IconName } from '../ui/icons';

export interface MenuRow {
  label: string;
  icon?: IconName;
  /** Right-hand note, e.g. "Connected"; a function for a value that changes while the menu is open. */
  status?: string | (() => string);
  /** A chevron after the status: the row opens a Launcher settings page. */
  chevron?: boolean;
  /** Small position dots after the status, for a value that OK steps through: [how many, which is on]. */
  dots?: () => [number, number];
  /** OK steps the value in place and the menu stays open (Motion). */
  cycle?: () => void;
  /** Draws the status with the green dot (a connected input). */
  good?: boolean;
  /** A line between groups, drawn above this row. */
  divider?: boolean;
  /** The choice in force (the library's Sort menu): a check at the right, and the menu's first focus. */
  checked?: boolean;
  onOk?: () => void;
}

/** The title-safe margins a menu hung from a card stays inside. */
const SAFE_X = 96;
const SAFE_Y = 54;
/** The gap between a card and the menu hung from it. */
const GAP = 14;

export function dropdown(
  label: string,
  anchor: HTMLElement | null,
  rows: MenuRow[],
  opts: { onCard?: boolean; header?: HTMLElement; className?: string } = {},
): Screen & { close(): void } {
  let top = 130;
  let right = 96;
  if (anchor) {
    const a = anchor.getBoundingClientRect();
    const s = shell.stage.getBoundingClientRect();
    top = Math.round((a.bottom - s.top) / shell.scale) + 14;
    right = Math.round(STAGE_W - (a.right - s.left) / shell.scale);
  }

  let first = 0;
  rows.forEach((r, i) => {
    if (r.checked) first = i;
  });
  const statusOf = (r: MenuRow): HTMLElement | null => {
    const text = typeof r.status === 'function' ? r.status() : r.status;
    const dots = r.dots ? r.dots() : null;
    if (!text && !r.chevron && !dots && !r.checked) return null;
    const dotEls: HTMLElement[] = [];
    if (dots) for (let k = 0; k < dots[0]; k++) dotEls.push(h(k === dots[1] ? 'i.on' : 'i'));
    return h(
      'span.menu-status' + (r.good ? '.is-good' : ''),
      r.good ? h('span.menu-dot') : null,
      text || null,
      dots ? h('span.dots', dotEls) : null,
      r.chevron ? h('span.chev', { html: icon('chevRight', 22) }) : null,
      r.checked ? h('span.menu-check', { html: icon('check', 28) }) : null,
    );
  };

  const rowEls = rows.map((r, i) => {
    const el: HTMLElement = focusable(
      h('div.menu-row', r.icon ? h('span.menu-icon', { html: icon(r.icon, 28) }) : null, h('span.menu-label', r.label), statusOf(r)),
      {
        group: 'menu',
        key: `m-${i}`,
        isDefault: i === first,
        onOk: () => {
          if (r.cycle) {
            r.cycle();
            const old = el.querySelector('.menu-status');
            const next = statusOf(r);
            if (old) el.removeChild(old);
            if (next) el.appendChild(next);
            return;
          }
          close();
          if (r.onOk) r.onOk();
        },
      },
    );
    return [r.divider ? h('div.menu-divider') : null, el];
  });

  const catcher = h('div.menu-catcher');
  // A card's menu remembers the card's row or grid, nearest first, for when the card has gone on closing.
  const near = opts.onCard && anchor ? nearestKeys(anchor) : [];
  const close = () => {
    shell.pop();
    if (!opts.onCard || !anchor) return;
    if (anchor.isConnected) return void shell.focus(anchor);
    const page = shell.top();
    const at = (k: string) => (page ? (page.el.querySelector(`[data-key="${CSS.escape(k)}"]`) as HTMLElement | null) : null);
    const key = anchor.getAttribute('data-key');
    if (key && at(key)) return;
    for (const k of near) {
      const n = at(k);
      if (n && n.getClientRects().length) return void shell.focus(n);
    }
  };
  catcher.addEventListener('click', close);
  const cls = (opts.className ? '.' + opts.className : '') + (opts.onCard ? '.menu--card' : '');
  const panel = h('div.menu' + cls, { style: `top:${top}px;right:${right}px` }, opts.header || null, rowEls);
  const el = h('div.screen.screen--full', catcher, panel);
  if (!opts.onCard && anchor) anchor.classList.add('is-open');
  let placed = false;
  const screen: Screen & { close(): void } = {
    label,
    el,
    layer: 'dialog',
    close,
    defaultFocus: () => (el.querySelector('.menu-row[data-default]') as HTMLElement | null) || (el.querySelector('.menu-row') as HTMLElement | null),
    onShow() {
      if (!opts.onCard || placed || !anchor) return;
      placed = true;
      placeOnCard(panel, anchor);
    },
    onKey(key) {
      if (key === 'back' && opts.onCard) {
        close();
        return true;
      }
      if (key !== 'up' && key !== 'down' && key !== 'left' && key !== 'right') return false;
      if (shell.moveWithin(panel, key)) return true;
      close();
      if (anchor && anchor.isConnected) shell.focus(anchor);
      // A card's menu just closes; a button's menu carries the move on one step from its button.
      if (key !== 'up' && !opts.onCard) shell.move(key);
      return true;
    },
  };
  const stop = shell.onChange(() => {
    if (shell.has(screen)) return;
    if (anchor) anchor.classList.remove('is-open');
    stop();
  });
  return screen;
}

/** The keys of the card's row or grid (its focus group) on the page, nearest first, the one after it first. */
function nearestKeys(card: HTMLElement): string[] {
  const group = card.getAttribute('data-group');
  const page = shell.top();
  if (!group || !page) return [];
  const all = page.el.querySelectorAll('[data-focus]');
  const keys: string[] = [];
  for (let i = 0; i < all.length; i++) {
    const e = all[i] as HTMLElement;
    const k = e.getAttribute('data-key');
    if (e.getAttribute('data-group') === group && k) keys.push(k);
  }
  const i = keys.indexOf(card.getAttribute('data-key') || '');
  if (i < 0) return [];
  const out: string[] = [];
  for (let d = 1; d < keys.length; d++) {
    if (i + d < keys.length) out.push(keys[i + d]);
    if (i - d >= 0) out.push(keys[i - d]);
  }
  return out;
}

/** Hangs a menu from a card, as the TV's MenuPlace does: under it, else over it, else beside it, inside the safe area. */
function placeOnCard(panel: HTMLElement, card: HTMLElement) {
  const s = shell.stage.getBoundingClientRect();
  const c = card.getBoundingClientRect();
  const r = {
    left: (c.left - s.left) / shell.scale,
    top: (c.top - s.top) / shell.scale,
    right: (c.right - s.left) / shell.scale,
    bottom: (c.bottom - s.top) / shell.scale,
  };
  const w = panel.offsetWidth;
  const ph = panel.offsetHeight;
  const clampX = (x: number) => Math.max(SAFE_X, Math.min(x, STAGE_W - SAFE_X - w));
  const clampY = (y: number) => Math.max(SAFE_Y, Math.min(y, STAGE_H - SAFE_Y - ph));
  let left: number;
  let top: number;
  let origin: string;
  if (r.bottom + GAP + ph <= STAGE_H - SAFE_Y) {
    left = clampX(r.left);
    top = r.bottom + GAP;
    origin = 'top left';
  } else if (r.top - GAP - ph >= SAFE_Y) {
    left = clampX(r.left);
    top = r.top - GAP - ph;
    origin = 'bottom left';
  } else if (r.right + GAP + w <= STAGE_W - SAFE_X) {
    left = r.right + GAP;
    top = clampY(r.top);
    origin = 'center left';
  } else {
    left = Math.max(SAFE_X, r.left - GAP - w);
    top = clampY(r.top);
    origin = 'center right';
  }
  panel.style.right = '';
  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
  panel.style.transformOrigin = origin;
}
