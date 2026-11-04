// Home: the app row (the TV's apps, opened through the bridge) and, for the spike, the way to the Checks screen.
// Ported screens (Movies, TV Shows, Search, the title preview) join through the shell's tabs and the nav.

import { HOME_APPS, homeRow, type HomeApp } from '../apps';
import { bridge, type AppInfo } from '../bridge';
import { h } from '../shell/dom';
import { focusable } from '../shell/focus';
import { shell, type Screen } from '../shell/app';
import { icon } from '../ui/icons';
import { navBar } from '../ui/widgets';
import { showAllApps } from './allApps';
import { showChecks } from './checks';
import { showKeys } from './keys';
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

function tile(app: HomeApp, info: AppInfo | null): HTMLElement {
  const missing = !!info && info.installed === false;
  const el = h('button.tile' + (missing ? '.missing' : ''), { style: `background:${app.bg}` });
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
  const screen = {
    label: 'Home',
    el,
    // The first app, not the search button or the nav above it.
    defaultFocus: () => el.querySelector('.approw [data-focus]') as HTMLElement | null,
    setApps(apps: AppInfo[] | null) {
      lastApps = apps;
      while (el.firstChild) el.removeChild(el.firstChild);
      const bar = topBar('HomeTV');
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
      const row = h('div.approw');
      const shown = rowApps();
      drawnRow = JSON.stringify(shown.map((a) => a.key));
      for (const app of shown) row.appendChild(tile(app, apps ? apps.filter((a) => a.key === app.key)[0] || null : null));
      el.appendChild(row);
      const all = focusable(h('button.button', 'All apps'), { key: 'all-apps', onOk: showAllApps });
      const checks = focusable(h('button.button', 'Checks for the TV call'), { key: 'checks', onOk: showChecks });
      // The key page is v1: keys are only needed by v1's screens.
      const keys = V1 ? focusable(h('button.button', 'API keys'), { key: 'keys', onOk: showKeys }) : null;
      el.appendChild(h('div.lowerrow', all, checks, keys, h('span.hint', 'Blue key or Info: Checks · the remote’s Home key leaves HomeTV')));
      shell.refocus();
    },
    // Back from All apps: the row as it now is.
    onShow() {
      if (JSON.stringify(rowApps().map((a) => a.key)) !== drawnRow) screen.setApps(lastApps);
    },
  };
  screen.setApps(null);
  return screen;
}
