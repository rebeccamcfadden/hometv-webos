// The glass dropdown, ported from design_preview's screens/dropdown.ts as far as the library and All apps need it: a
// menu hung under a button (Sort) or from a card (All apps' hold-OK menu). It closes on Back, on OK on a row, on a
// click outside it, or when the D-pad moves past its edge; focus returns to the button or card. Rows a status, dots,
// ticks or a header (design_preview's settings and Wi-Fi menus) aren't needed here yet.

import { shell, STAGE_H, STAGE_W, type Screen } from '../shell/app';
import { h } from '../shell/dom';
import { focusable } from '../shell/focus';
import { icon, type IconName } from '../ui/icons';

export interface MenuRow {
  label: string;
  icon?: IconName;
  /** The choice in force (the library's Sort menu): a check at the right, and the menu's first focus. */
  checked?: boolean;
  onOk?: () => void;
}

/** The title-safe margins a menu hung from a card stays inside. */
const SAFE_X = 96;
const SAFE_Y = 54;
/** The gap between a card and the menu hung from it. */
const GAP = 14;

export function dropdown(label: string, anchor: HTMLElement | null, rows: MenuRow[], opts: { onCard?: boolean } = {}): Screen & { close(): void } {
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
  const rowEls = rows.map((r, i) =>
    focusable(
      h(
        'div.menu-row',
        r.icon ? h('span.menu-icon', { html: icon(r.icon, 28) }) : null,
        h('span.menu-label', r.label),
        r.checked ? h('span.menu-check', { html: icon('check', 28) }) : null,
      ),
      {
        group: 'menu',
        key: `m-${i}`,
        isDefault: i === first,
        onOk: () => {
          close();
          if (r.onOk) r.onOk();
        },
      },
    ),
  );

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
  const panel = h('div.menu' + (opts.onCard ? '.menu--card' : ''), { style: `top:${top}px;right:${right}px` }, rowEls);
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
