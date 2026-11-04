// Settings › Home row apps, from design_preview's screens/panes/apps.ts at 2bf3c2d: Home's row as small tiles, in order,
// and the TV's other apps below. OK on a tile on Home picks it up: ← → move it, OK puts it down, ↓ takes it off Home,
// Back cancels. OK on another app adds it at the end of the row, already picked up so it can be placed; Back then takes
// it off again. On Samsung the row is the one All apps changes (homeRow.ts, `hometv-home-row`), and the other apps are
// the TV's own list (AeroTizen's inventory through the bridge), or Home's usual apps where the TV can't list them.
import { HOME_APPS, homeRow } from '../../apps';
import { APP_PREFIX, bridge, type TvApp } from '../../bridge';
import { HOME_ROW_MAX } from '@hometv/core/services.ts';
import type { RowEntry } from '../../homeRow';
import type { Key } from '../../shell/app';
import { shell } from '../../shell/app';
import { h } from '../../shell/dom';
import { focusable } from '../../shell/focus';
import { icon } from '../../ui/icons';
import { paneHead, type Pane, type PaneHost } from './pane';

const known = (id: string) => HOME_APPS.filter((a) => a.key === id)[0];

/** The TV's apps as row entries: a Home tile's key when it is one, else "app:" and the TV's id (as All apps). */
const entryOf = (a: TvApp): RowEntry => ({ id: a.key || APP_PREFIX + a.id, name: a.name });

export function appsPane(host: PaneHost): Pane {
  /** The app being moved, and the row as it was when it was picked up (Back restores it). */
  let moving: { id: string; before: RowEntry[] } | null = null;
  let others: RowEntry[] | null = null;
  bridge.installedApps().then((apps) => {
    others = apps ? apps.map(entryOf) : HOME_APPS.map((a) => ({ id: a.key, name: a.name }));
    host.rerender();
  });
  const row = () => homeRow.get();

  const tile = (e: RowEntry, onHome: boolean, i: number) => {
    const lifted = !!moving && moving.id === e.id;
    const k = known(e.id);
    const el = focusable(
      h(
        'div.ha-tile' + (lifted ? '.is-moving' : ''),
        lifted ? h('span.ha-arrow.ha-arrow--l', { html: icon('chevLeft', 22) }) : null,
        h(
          'div.ha-face',
          k ? { style: `background:${k.bg};color:${k.fg}` } : {},
          h('span', k ? { style: `font-weight:${k.weight}` } : {}, k ? k.mark : e.name),
        ),
        lifted ? h('span.ha-arrow.ha-arrow--r', { html: icon('chevRight', 22) }) : null,
        h('div.ha-name', e.name),
      ),
      {
        group: onHome ? 'ha-home' : 'ha-other',
        key: `ha-${e.id}`,
        isDefault: i === 0,
        onOk: () => {
          if (onHome) {
            moving = { id: e.id, before: row().slice() };
            host.rerender();
            return;
          }
          if (row().length >= HOME_ROW_MAX) return shell.toast(`Home’s row holds ${HOME_ROW_MAX} apps. Take one off first.`);
          moving = { id: e.id, before: row().slice() };
          homeRow.set(row().concat([{ id: e.id, name: e.name }]));
          host.rerender();
          host.focusKey(`ha-${e.id}`);
        },
      },
    );
    if (onHome && i === 0) el.setAttribute('data-entry', '');
    return el;
  };

  const step = (d: number) => {
    const r = row().slice();
    const at = r.map((e) => e.id).indexOf(moving!.id);
    const to = at + d;
    if (at < 0 || to < 0 || to >= r.length) return;
    const x = r[at];
    r[at] = r[to];
    r[to] = x;
    homeRow.set(r);
  };

  return {
    render() {
      const on = row();
      const off = (others || [])
        .filter((a) => !on.some((e) => e.id === a.id))
        .sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0));
      return [
        paneHead('Home', 'Home row apps', `The apps on Home’s row, which holds ${HOME_ROW_MAX}. OK on one picks it up to move it.`),
        h('div.grp-h', `On Home · ${on.length} of ${HOME_ROW_MAX}`),
        on.length ? h('div.ha-row', on.map((e, i) => tile(e, true, i))) : h('div.pane-note', 'No apps on Home. OK on one below adds it.'),
        h('div.ha-hint', moving ? '← → moves it · OK puts it down · ↓ takes it off Home · Back cancels' : 'OK picks an app up, as Hold OK in All apps adds or removes one.'),
        h('div.grp-h', 'Other apps'),
        others === null
          ? h('div.pane-note', 'Asking the TV for its apps…')
          : off.length
            ? h('div.ha-row.ha-row--wrap', off.map((e, i) => tile(e, false, i)))
            : h('div.pane-note', 'Every app is on Home.'),
        h('div.pane-note', 'OK on another app adds it at the end of the row, ready to place.'),
      ];
    },
    back() {
      if (!moving) return false;
      const id = moving.id;
      homeRow.set(moving.before);
      moving = null;
      host.rerender();
      host.focusKey(`ha-${id}`);
      return true;
    },
    onKey(key: Key) {
      // Back reaches back() above, which cancels the move.
      if (!moving || key === 'back') return false;
      const id = moving.id;
      if (key === 'left' || key === 'right') step(key === 'left' ? -1 : 1);
      else if (key === 'ok') moving = null;
      else if (key === 'down') {
        if (row().length === 1) {
          shell.toast('Keep at least one app on Home');
          return true;
        }
        moving = null;
        homeRow.set(row().filter((e) => e.id !== id));
      } else return true;
      host.rerender();
      host.focusKey(`ha-${id}`);
      return true;
    },
  };
}
