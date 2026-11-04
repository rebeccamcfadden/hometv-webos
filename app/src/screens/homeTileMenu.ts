// Home's tile menu: hold OK on an app on Home's row for Move, Remove from Home and App info, as the Android launcher's
// Home has it (design_preview's Home row apps pane: "OK picks an app up, as Hold OK → Move does on Home"). The menu is
// All apps' (screens/dropdown.ts, hung from the tile). Move lifts the tile: ← → move it along the row, OK puts it down,
// Back puts it back where it was. The row's order is homeRow.ts's, saved on the TV.

import { homeRow } from '../apps';
import { bridge } from '../bridge';
import { moveInRow, removeFromRow, type RowEntry } from '../homeRow';
import { shell, type Key } from '../shell/app';
import { dropdown } from './dropdown';

export interface RowHost {
  /** Draws the row again, focusing the tile of app `focusId` (or the one nearest where it was). */
  redraw(focusId?: string): void;
}

export interface TileMenu {
  /** The app being moved, or null. */
  moving(): string | null;
  onLongOk(f: HTMLElement | null): boolean;
  onKey(key: Key, f: HTMLElement | null): boolean;
}

export function tileMenu(host: RowHost): TileMenu {
  let moving: { id: string; before: RowEntry[] } | null = null;

  const drop = () => {
    if (!moving) return;
    const id = moving.id;
    moving = null;
    host.redraw(id);
  };

  const open = (tile: HTMLElement): boolean => {
    const id = tile.getAttribute('data-row-id');
    const entry = id ? homeRow.get().filter((e) => e.id === id)[0] : null;
    if (!entry) return false;
    shell.push(
      dropdown(
        'App menu',
        tile,
        [
          {
            label: 'Move',
            icon: 'move',
            onOk: () => {
              moving = { id: entry.id, before: homeRow.get() };
              host.redraw(entry.id);
            },
          },
          {
            label: 'Remove from Home',
            icon: 'home',
            onOk: () => {
              const row = homeRow.get();
              let at = 0;
              row.forEach((e, i) => {
                if (e.id === entry.id) at = i;
              });
              const next = removeFromRow(row, entry.id);
              homeRow.set(next);
              shell.toast('Removed from Home');
              host.redraw(next.length ? next[Math.min(at, next.length - 1)].id : undefined);
            },
          },
          {
            label: 'App info',
            icon: 'info',
            onOk: () => {
              const appId = bridge.appId(entry.id);
              shell.toast(appId ? `${entry.name} · app id ${appId}` : `${entry.name} · the TV hasn’t said its app id here`);
            },
          },
        ],
        { onCard: true },
      ),
    );
    return true;
  };

  return {
    moving: () => (moving ? moving.id : null),
    onLongOk(f) {
      // Holding OK while moving puts the app down, as a short press does.
      if (moving) {
        drop();
        return true;
      }
      return !!f && f.hasAttribute('data-row-id') && open(f);
    },
    onKey(key) {
      if (!moving) return false;
      const id = moving.id;
      if (key === 'left' || key === 'right') {
        const row = homeRow.get();
        const next = moveInRow(row, id, key === 'left' ? -1 : 1);
        if (next !== row) {
          homeRow.set(next);
          host.redraw(id);
        }
      } else if (key === 'ok') {
        drop();
      } else if (key === 'back') {
        homeRow.set(moving.before);
        moving = null;
        host.redraw(id);
      }
      // Up and Down stay on the lifted tile.
      return true;
    },
  };
}
