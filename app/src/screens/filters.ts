// The Filters drawer on Movies and TV Shows, from design_preview's screens/filters.ts: a side drawer whose changes apply
// live to the page behind it. ← and → change a value, OK steps it on; Back or Done closes it.

import type { Kind } from '@hometv/core/types.ts';
import { shell, type Screen } from '../shell/app';
import { h, replace } from '../shell/dom';
import { focusable } from '../shell/focus';
import { icon } from '../ui/icons';
import { button } from '../ui/widgets';
import { cycleFilter, type FilterDef, type FilterState } from './filterDefs';

type CycleEl = HTMLElement & { cycle?: (step: number) => void };

export function filtersDrawer(kind: Kind, defs: FilterDef[], state: FilterState, onChange: () => void): Screen {
  const rows = defs.map((d) => {
    const value = h('span.setting-value');
    const render = () => replace(value, d.options[state[d.id] || 0]);
    render();
    const cycle = (step: number) => {
      cycleFilter(d, state, step);
      render();
      onChange();
    };
    const row: CycleEl = focusable(
      h(
        'div.setting',
        h('span.setting-label', d.label),
        h('span.setting-control', h('span.setting-arrow', { html: icon('chevLeft', 22) }), value, h('span.setting-arrow', { html: icon('chevRight', 22) })),
      ),
      { group: 'settings', key: `f-${d.id}`, onOk: () => cycle(1) },
    );
    row.cycle = cycle;
    return { row, render };
  });

  const clear = button('Clear all', {
    small: true,
    key: 'f-clear',
    onOk: () => {
      for (const d of defs) state[d.id] = 0;
      rows.forEach((r) => r.render());
      onChange();
    },
  });
  const done = button('Done', { small: true, primary: true, key: 'f-done', onOk: () => shell.back() });

  const el = h(
    'div.screen.screen--full',
    h('div.scrim.scrim--light'),
    h(
      'div.drawer',
      h('div.drawer-title', 'Filters'),
      h('div.drawer-note', `${kind === 'movie' ? 'Movies' : 'TV Shows'} · ← → changes a value`),
      h('div.drawer-rows', rows.map((r) => r.row)),
      h('div.drawer-actions', clear, done),
    ),
  );

  return {
    label: 'Filters',
    el,
    layer: 'dialog',
    defaultFocus: () => rows[0].row,
    onKey(key, f) {
      const cycle = f ? (f as CycleEl).cycle : undefined;
      if (cycle && (key === 'left' || key === 'right')) {
        cycle(key === 'left' ? -1 : 1);
        return true;
      }
      return false;
    },
  };
}
