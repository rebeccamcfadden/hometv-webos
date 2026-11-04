// A segmented control (two or three options in a pill), from hometv-launcher's design_preview/src/ui/widgets.ts at
// 2bf3c2d: moving only highlights an option, OK selects it. The selected one has the accent ring and is where focus
// lands when the control is entered.
import { h } from '../shell/dom';
import { focusable } from '../shell/focus';

export function segmented<T extends string>(opts: {
  options: [T, string][];
  get: () => T | null;
  set: (v: T) => void;
  group: string;
  small?: boolean;
  /** Marks the selected option (or the first, with none selected) as its pane's first focus. */
  entry?: boolean;
}): HTMLElement {
  const current = opts.get();
  const els = opts.options.map(([v, label], i) => {
    const on = v === current;
    const el = focusable(h('div.seg-opt' + (on ? '.is-selected' : ''), label), {
      group: opts.group,
      key: `${opts.group}-${v}`,
      isDefault: on || (current === null && i === 0),
      onOk: () => {
        opts.set(v);
        els.forEach((e, j) => e.classList.toggle('is-selected', opts.options[j][0] === v));
      },
    });
    if (opts.entry && (on || (current === null && i === 0))) el.setAttribute('data-entry', '');
    return el;
  });
  return h('div.seg' + (opts.small ? '.seg--small' : ''), els);
}
