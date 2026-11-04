// All apps, ported from design_preview's screens/allApps.ts (pushed from Home's All apps button): every app on the TV,
// by name (AeroTizen's inventory through the bridge), then the TV Utilities folder (F35 b, last), which holds the apps
// the TV came with that aren't watch apps (tvUtilities.ts). OK opens an app or the folder; hold OK adds an app to
// Home's row or takes it off, moves it into or out of the folder, or shows its app info. The folder is its own page
// with the same grid; Back returns to its tile.

import './allApps.css';
import { HOME_APPS, homeRow } from '../apps';
import { APP_PREFIX, bridge, type TvApp } from '../bridge';
import { onRow, toggleOnRow, type RowEntry } from '../homeRow';
import { HOME_ROW_MAX } from '@hometv/core/services.ts';
import { shell, type Screen } from '../shell/app';
import { h, replace } from '../shell/dom';
import { focusable } from '../shell/focus';
import { columnsOf, gridMove } from '../shell/grid';
import { isTvUtility, loadMoves, moveApp, saveMoves, type Moved } from '../tvUtilities';
import { folderFace } from '../ui/folderArt';
import { button } from '../ui/widgets';
import { dropdown, type MenuRow } from './dropdown';

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch (e) {
    return null;
  }
};

/** The TV's apps, listed once per start: undefined while the TV is asked, null when it won't say. */
let listed: TvApp[] | null | undefined;
let asking: Promise<TvApp[] | null> | null = null;
function tvApps(): Promise<TvApp[] | null> {
  if (!asking) {
    asking = bridge.installedApps().then((apps) => {
      listed = apps;
      return apps;
    });
  }
  return asking;
}

const facts = (a: TvApp, moved?: Moved) => ({ name: a.name, watch: !!a.key, moved });
const inFolder = (a: TvApp) => isTvUtility(facts(a, loadMoves(storage())[a.id]));
const count = (n: number) => `${n} app${n === 1 ? '' : 's'}`;
/** Home's row entry for an app: its Home tile key when it is one, else its id. */
const entryOf = (a: TvApp): RowEntry => ({ id: a.key || APP_PREFIX + a.id, name: a.name });

/** The app's face: the TV's artwork when it has some, over the app's wordmark (a Home app) or its name. */
function face(a: TvApp): HTMLElement {
  const known = a.key ? HOME_APPS.filter((x) => x.key === a.key)[0] : undefined;
  const el = h(
    'div.aa-face',
    known ? { style: `background:${known.bg};color:${known.fg}` } : {},
    h('span.aa-mark', known ? { style: `font-weight:${known.weight}` } : {}, known ? known.mark : a.name),
  );
  const art = bridge.artwork(APP_PREFIX + a.id);
  if (art.length) {
    const img = h('img.aa-art', { alt: '' }) as HTMLImageElement;
    let next = 0;
    img.onerror = () => {
      next++;
      if (next < art.length) img.src = art[next];
      else if (img.parentNode) img.parentNode.removeChild(img);
    };
    img.onload = () => el.classList.add('has-art');
    img.src = art[0];
    el.appendChild(img);
  }
  return el;
}

/** All apps, or with `folder` the TV Utilities page. */
export function allAppsScreen(folder = false): Screen {
  const back = button('Back', { icon: 'back', small: true, key: 'back', onOk: () => shell.back() });
  const title = folder ? 'TV Utilities' : 'All apps';
  const countEl = h('span.aa-count');
  const grid = h('div.aa-grid');
  const scroll = h('div.aa-scroll', { 'data-scroll': 'y', 'data-scroll-pad': 40 }, grid);
  const el = h(
    'div.screen.screen--full.aa-page',
    back,
    h('div.aa-head', h('h1.page-title', title), countEl),
    folder ? h('div.aa-note', 'Apps that came with the TV. Hold OK on one to move it back to All apps.') : null,
    scroll,
  );

  const appTile = (a: TvApp, i: number) =>
    focusable(h('div.aa-app', { 'data-app': a.id }, face(a), h('div.aa-name', a.name)), {
      group: 'aa',
      key: `aa-${a.id}`,
      isDefault: i === 0,
      onOk: async () => {
        shell.toast(`Opening ${a.name}…`);
        const r = await bridge.launch(APP_PREFIX + a.id);
        if (r.ok && !r.id) shell.toast(`Preview: on the TV this opens ${a.name}.`);
        else if (!r.ok) shell.toast(`${a.name} didn’t open: ${r.error}`, true);
      },
    });

  const folderTile = (inside: TvApp[], isFirst: boolean) =>
    focusable(h('div.aa-app.aa-folder', h('div.aa-folder-face', folderFace(264, 148, 6)), h('div.aa-name', 'TV Utilities ', h('span.aa-folder-count', `· ${inside.length}`))), {
      group: 'aa',
      key: 'aa-folder',
      isDefault: isFirst,
      onOk: () => shell.push(allAppsScreen(true)),
    });

  let shown: TvApp[] = [];
  let cols = 0;
  const paint = () => {
    cols = 0;
    if (listed === undefined) {
      countEl.textContent = '';
      replace(grid, h('div.aa-empty', 'Asking the TV for its apps…'));
      return;
    }
    if (listed === null) {
      countEl.textContent = '';
      replace(grid, h('div.aa-empty', 'This TV didn’t list its apps. Apps on Home still open.'));
      return;
    }
    const all = listed;
    const inside = all.filter(inFolder);
    shown = folder ? inside : all.filter((a) => !inFolder(a));
    countEl.textContent = count(folder ? inside.length : all.length);
    const tiles = shown.map((a, i) => appTile(a, i));
    replace(grid, !folder && inside.length ? tiles.concat([folderTile(inside, !tiles.length)]) : tiles);
  };
  paint();
  if (listed === undefined) {
    tvApps().then(() => {
      paint();
      if (shell.top() === screen) shell.focus(screen.defaultFocus!());
    });
  }

  /** After an app left this page: focus the one that took its place, or `key`. */
  const settle = (gone: string, key?: string) => {
    let at = -1;
    shown.forEach((a, i) => {
      if (a.id === gone) at = i;
    });
    paint();
    if (folder && !shown.length) return shell.pop();
    const target = key || (shown.length ? `aa-${shown[Math.min(Math.max(at, 0), shown.length - 1)].id}` : 'back');
    shell.focus((el.querySelector(`[data-key="${CSS.escape(target)}"]`) as HTMLElement | null) || back);
  };

  const move = (a: TvApp, to: Moved) => {
    saveMoves(storage(), moveApp(loadMoves(storage()), a.id, facts(a), to));
    shell.toast(to === 'in' ? `Moved ${a.name} to TV Utilities` : `Moved ${a.name} out of TV Utilities`);
    settle(a.id, to === 'in' ? 'aa-folder' : undefined);
  };

  const menu = (tile: HTMLElement): boolean => {
    const a = shown.filter((x) => x.id === tile.getAttribute('data-app'))[0];
    if (!a) return false;
    const entry = entryOf(a);
    const home = onRow(homeRow.get(), entry.id);
    const rows: MenuRow[] = [
      {
        label: home ? 'Remove from Home' : 'Add to Home',
        icon: home ? 'home' : 'plus',
        onOk: () => {
          const r = toggleOnRow(homeRow.get(), entry, HOME_ROW_MAX);
          if (r.result === 'full') return shell.toast(`Home’s row holds ${HOME_ROW_MAX} apps. Take one off first.`);
          homeRow.set(r.row);
          shell.toast(r.result === 'added' ? 'Added to Home' : 'Removed from Home');
        },
      },
      folder ? { label: 'Move out of TV Utilities', icon: 'apps', onOk: () => move(a, 'out') } : { label: 'Move to TV Utilities', icon: 'apps', onOk: () => move(a, 'in') },
      // Samsung's own app info page can't be opened from an app (no API for it that we know of): the facts we have.
      { label: 'App info', icon: 'info', onOk: () => shell.toast(`${a.name} · app id ${a.id}`) },
    ];
    shell.push(dropdown('App menu', tile, rows, { onCard: true }));
    return true;
  };

  const screen: Screen = {
    label: title,
    el,
    defaultFocus: () => (grid.querySelector('[data-focus]') as HTMLElement | null) || back,
    onShow: paint,
    onLongOk: (f) => !!f && f.hasAttribute('data-app') && menu(f),
    onKey(key, f) {
      if (!f || !grid.contains(f) || (key !== 'up' && key !== 'down' && key !== 'left' && key !== 'right')) return false;
      const tiles = grid.querySelectorAll('.aa-app') as NodeListOf<HTMLElement>;
      if (!cols) cols = columnsOf(tiles);
      const next = gridMove(Array.prototype.indexOf.call(tiles, f), tiles.length, cols, key);
      if (next !== null) {
        shell.focus(tiles[next]);
        return true;
      }
      // Up from the first row goes on to Back; the grid's other edges keep focus where it is.
      return key !== 'up';
    },
  };
  return screen;
}

/** Opens All apps, and starts asking the TV for its apps if nobody has yet. */
export function showAllApps(): void {
  tvApps();
  shell.push(allAppsScreen());
}
