// D-pad moves inside a grid of same-size items laid out in rows (Movies, TV Shows, All apps, a person's titles), by
// index rather than by measuring every item: the grid draws once and each move costs nothing on a weak TV. As
// design_preview's spatial focus does in its CSS grids: no wrapping at a row's ends, Down onto a shorter last row lands
// on its last item, and leaving the grid (Up from the first row, any move at an edge) is the screen's to handle.

import type { Dir } from './focus';

/** The index `dir` moves to from `i` in a grid of `count` items, `cols` to a row; null when it leaves the grid. */
export function gridMove(i: number, count: number, cols: number, dir: Dir): number | null {
  if (i < 0 || i >= count || cols < 1) return null;
  const row = Math.floor(i / cols);
  const lastRow = Math.floor((count - 1) / cols);
  switch (dir) {
    case 'left':
      return i % cols === 0 ? null : i - 1;
    case 'right':
      return i % cols === cols - 1 || i === count - 1 ? null : i + 1;
    case 'up':
      return row === 0 ? null : i - cols;
    default:
      return row === lastRow ? null : Math.min(i + cols, count - 1);
  }
}

/** How many of `items` share the first one's row (inline-block items wrap, so the row is read off the layout). */
export function columnsOf(items: ArrayLike<HTMLElement>): number {
  if (!items.length) return 1;
  const top = items[0].offsetTop;
  let n = 1;
  while (n < items.length && items[n].offsetTop === top) n++;
  return n;
}
