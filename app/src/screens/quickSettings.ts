// The nav's Settings menu, from hometv-launcher's design_preview/src/screens/quickSettings.ts at 2bf3c2d (V2 design
// final-quick-settings): the Wi-Fi and Inputs dropdown look, hung under the icon, in groups. TV settings and Launcher
// settings; the TV's own pages; then Motion, where OK steps the value in place, the menu stays open, and dots show
// where it is. Of the household rows, Weather (its pane is in Settings); TMDB account and Streaming services come
// with v1's Settings.
// The TV's pages open through the platform (Samsung's Settings app when the TV lists one), or the menu says where they
// are in the TV's menus.

import { MOTION_LABELS, MOTIONS, prefs, unitSymbol } from '../launcherSettings';
import type { Screen } from '../shell/app';
import { dropdown, type MenuRow } from './dropdown';
import { openTvPage } from './navMenus';
import { showSettings } from './settings';

export function settingsMenu(anchor: HTMLElement | null): Screen {
  const rows: MenuRow[] = [
    { label: 'TV settings', icon: 'settings', onOk: () => openTvPage('main', 'The TV’s settings') },
    { label: 'Launcher settings', icon: 'apps', chevron: true, onOk: () => showSettings() },
    { label: 'Picture', icon: 'picture', divider: true, onOk: () => openTvPage('picture', 'Picture settings') },
    { label: 'Sound', icon: 'sound', onOk: () => openTvPage('sound', 'Sound settings') },
    { label: 'Network & Wi-Fi', icon: 'wifi', onOk: () => openTvPage('network', 'Network and Wi-Fi settings') },
    { label: 'Inputs', icon: 'input', onOk: () => openTvPage('inputs', 'The TV’s inputs') },
  ];
  // design_preview's household group, as far as Samsung's Settings has its panes: Weather (TMDB account and Streaming
  // services come with v1's Settings).
  rows.push({
    label: 'Weather',
    icon: 'cloud',
    divider: true,
    chevron: true,
    status: () => {
      const p = prefs.get();
      return p.place ? `${p.place.name} · ${unitSymbol(p)}` : 'Not set';
    },
    onOk: () => showSettings('weather'),
  });
  rows.push({
    label: 'Motion',
    icon: 'motion',
    divider: true,
    status: () => MOTION_LABELS[prefs.get().motion],
    dots: () => [MOTIONS.length, MOTIONS.indexOf(prefs.get().motion)],
    cycle: () => prefs.set({ motion: MOTIONS[(MOTIONS.indexOf(prefs.get().motion) + 1) % MOTIONS.length] }),
  });
  return dropdown('Settings', anchor, rows, { className: 'menu--settings' });
}
