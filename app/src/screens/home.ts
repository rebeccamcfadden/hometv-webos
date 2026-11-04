// Home: the app row (the TV's apps, opened through the bridge) and, for the spike, the way to the Checks screen.
// Ported screens (Movies, TV Shows, Search, the title preview) join through the shell's tabs and the nav.

import { HOME_APPS, homeRow, type HomeApp } from '../apps';
import { bridge, type AppInfo } from '../bridge';
import { h } from '../shell/dom';
import { focusable } from '../shell/focus';
import { shell, type Key, type Screen } from '../shell/app';
import { icon } from '../ui/icons';
import { navBar } from '../ui/widgets';
import { showAllApps } from './allApps';
import { showChecks } from './checks';
import { showKeys } from './keys';
import { tileMenu } from './homeTileMenu';
import { showSettings } from './settings';
import { homeTop } from '../ui/homeTop';
import { V1 } from '../features';

const MODE_TEXT = {
  app: `${bridge.platform.brand} app`,
  tv: 'On the TV (TizenBrew)',
  'fake-tv': 'Fake TV on this PC',
  preview: 'Preview: no TV, apps don’t open',
};

export function topBar(title: string): HTMLElement {
  const bar = h('div.topbar', h('div.brand', title));
  const right = h('div.topright', h('span.pill.' + bridge.mode(), MODE_TEXT[bridge.mode()]));
  if (bridge.problem()) bar.appendChild(h('div.problem', 'TV: ' + bridge.problem()));
  const clock = h('span.clock');
  const tick = () => {
    const d = new Date();
    clock.textContent = `${d.getHours()}:${('0' + d.getMinutes()).slice(-2)}`;
  };
  tick();
  window.setInterval(tick, 15000);
  right.appendChild(clock);
  bar.appendChild(right);
  return bar;
}

function tile(app: HomeApp, info: AppInfo | null, moving = false): HTMLElement {
  const missing = !!info && info.installed === false;
  const el = h('button.tile' + (missing ? '.missing' : '') + (moving ? '.is-moving' : ''), { style: `background:${app.bg}`, 'data-row-id': app.key });
  el.appendChild(h('span.mark', { style: `font-weight:${app.weight};color:${app.fg}` }, app.mark));
  // The TV's own artwork for the app when it has some (Samsung's icon cache); the wordmark stays underneath.
  const art = bridge.artwork(app.key);
  if (art.length) {
    const img = h('img.art') as HTMLImageElement;
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
  el.appendChild(h('span.name', missing ? `${app.name} · not on this TV` : app.name));
  if (moving) {
    el.appendChild(h('span.move-arrow.move-arrow--l', { html: icon('chevLeft', 28) }));
    el.appendChild(h('span.move-arrow.move-arrow--r', { html: icon('chevRight', 28) }));
  }
  return focusable(el, {
    group: 'apps',
    key: 'app-' + app.key,
    onOk: async () => {
      if (missing) return shell.toast(`${app.name} isn’t on this TV. Samsung’s Apps can add it.`, true);
      shell.toast(`Opening ${app.name}…`);
      const r = await bridge.launch(app.key);
      if (r.ok && r.id) shell.toast(`Opening ${app.name} (${r.id}).`);
      else if (r.ok) shell.toast(`Preview: on the TV this opens ${app.name}.`);
      else shell.toast(`${app.name} didn’t open: ${r.error}`, true);
    },
  });
}

/** Home's row as chosen in All apps: a Home app's tile, or a plain one with the name for any other app. */
const rowApps = (): HomeApp[] =>
  homeRow.get().map(
    (e) => HOME_APPS.filter((a) => a.key === e.id)[0] || { key: e.id, id: e.id, name: e.name, mark: e.name, weight: 500, bg: '#1c1c1e', fg: '#ffffff' },
  );

export function homeScreen(): Screen & { setApps(apps: AppInfo[] | null): void } {
  const el = h('div.screen.home');
  let lastApps: AppInfo[] | null = null;
  let drawnRow = '';
  let row: HTMLElement | null = null;
  /** Draws the row's tiles (all of Home only when the apps change), focusing `focusId`'s tile if given. */
  const fillRow = (focusId?: string) => {
    if (!row) return;
    while (row.firstChild) row.removeChild(row.firstChild);
    const shown = rowApps();
    drawnRow = JSON.stringify(shown.map((a) => a.key));
    const lifted = menu.moving();
    for (const app of shown) row.appendChild(tile(app, lastApps ? lastApps.filter((a) => a.key === app.key)[0] || null : null, app.key === lifted));
    if (!shown.length) row.appendChild(h('div.approw-empty', 'No apps on Home. Hold OK on an app in All apps to add it.'));
    if (row.nextSibling && (row.nextSibling as HTMLElement).className === 'movehint') el.removeChild(row.nextSibling);
    if (lifted) el.insertBefore(h('div.movehint', '← → moves it · OK puts it down · Back puts it back'), row.nextSibling);
    if (focusId !== undefined) {
      const t = row.querySelector(`[data-key="${CSS.escape('app-' + focusId)}"]`) as HTMLElement | null;
      shell.focus(t || (el.querySelector('[data-key="all-apps"]') as HTMLElement | null));
    }
  };
  const menu = tileMenu({ redraw: (id) => fillRow(id === undefined ? '' : id) });
  const screen = {
    label: 'Home',
    el,
    // The first app, not the search button or the nav above it.
    defaultFocus: () => el.querySelector('.approw [data-focus]') as HTMLElement | null,
    setApps(apps: AppInfo[] | null) {
      lastApps = apps;
      while (el.firstChild) el.removeChild(el.firstChild);
      const bar = homeTop();
      // Search, as design_preview's top bar has it: ↑ from the nav reaches it.
      const search = focusable(h('button.searchbtn', { 'aria-label': 'Search', html: icon('search', 30) }), {
        key: 'search',
        onOk: () => shell.goTab('search'),
      });
      const right = bar.querySelector('.topright') as HTMLElement;
      if (V1) right.insertBefore(search, right.firstChild);
      el.appendChild(bar);
      el.appendChild(navBar('home'));
      el.appendChild(h('h2.rowtitle', 'Apps'));
      row = h('div.approw');
      el.appendChild(row);
      fillRow();
      const all = focusable(h('button.button', 'All apps'), { key: 'all-apps', onOk: showAllApps });
      const settings = focusable(h('button.button', 'Settings'), { key: 'settings', onOk: () => showSettings() });
      const checks = focusable(h('button.button', 'Checks for the TV call'), { key: 'checks', onOk: showChecks });
      // The key page is v1: keys are only needed by v1's screens.
      const keys = V1 ? focusable(h('button.button', 'API keys'), { key: 'keys', onOk: showKeys }) : null;
      el.appendChild(h('div.lowerrow', all, settings, checks, keys, h('span.hint', 'Blue key or Info: Checks · the remote’s Home key leaves HomeTV')));
      shell.refocus();
    },
    // Hold OK on a tile: Move, Remove from Home, App info (homeTileMenu.ts); while moving, it has the keys.
    onLongOk: (f: HTMLElement | null) => menu.onLongOk(f),
    onKey: (key: Key, f: HTMLElement | null) => menu.onKey(key, f),
    // Back from All apps: the row as it now is.
    onShow() {
      if (JSON.stringify(rowApps().map((a) => a.key)) !== drawnRow) screen.setApps(lastApps);
    },
  };
  screen.setApps(null);
  return screen;
}
