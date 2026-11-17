// Home: the app row (the TV's apps, opened through the bridge) and, for the spike, the way to the Checks screen.
// Ported screens (Movies, TV Shows, Search, the title preview) join through the shell's tabs and the nav.

import { HOME_APPS, homeRow, type HomeApp } from '../apps';
import { bridge, type AppInfo } from '../bridge';
import { h, replace } from '../shell/dom';
import { focusable } from '../shell/focus';
import { shell, type Key, type Screen } from '../shell/app';
import { icon, type IconName } from '../ui/icons';
import { navBar } from '../ui/widgets';
import { showAllApps } from './allApps';
import { showChecks } from './checks';
import { showKeys } from './keys';
import { tileMenu } from './homeTileMenu';
import { showSettings } from './settings';
import { homeHero, weatherCard } from '../ui/homeTop';
import { inputLabel, openTvPage, showInput } from './navMenus';
import type { TvInput } from '../platform';
import './home.css';
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

/** A tile of Home's lower rows: the icon over its label. */
const homeTile = (label: string, ic: IconName, key: string, group: string, onOk: () => void) =>
  focusable(h('div.home-tile', h('span', { html: icon(ic, 28) }), h('span.ht-label', label)), { group, key, onOk });

export function homeScreen(): Screen & { setApps(apps: AppInfo[] | null): void } {
  const el = h('div.screen.screen--full.home');
  // Everything but the nav moves together when Down reaches Inputs, Shortcuts and the weather (is-scrolled, home.css).
  const content = h('div.home-content');
  let inputsBox: HTMLElement | null = null;
  /**
   * The Inputs tiles: Live TV, then the HDMI and other ports the TV lists (a device's name when it knows it), four at
   * most. When the TV won't list them (a PC, or eim refusing), one tile that opens the TV's own inputs page.
   */
  const paintInputs = (list: TvInput[] | null, asked: boolean) => {
    if (!inputsBox) return;
    const had = !!inputsBox.querySelector('.is-focused');
    const tv = (list || []).filter((i) => i.kind === 'tv');
    const ports = (list || []).filter((i) => i.kind !== 'tv');
    const shownList = tv.concat(ports).slice(0, 4);
    const tiles = shownList.length
      ? shownList.map((i) =>
          homeTile(inputLabel(i), i.kind === 'hdmi' ? 'hdmi' : i.kind === 'av' ? 'av' : 'liveTv', `in-${i.id}`, 'inputs', () => {
            void showInput(i);
          }),
        )
      : [homeTile(asked ? 'TV inputs' : 'Inputs', 'input', 'in-tv', 'inputs', () => openTvPage('inputs', 'The TV’s inputs'))];
    replace(inputsBox, tiles);
    if (had) shell.refocus();
  };
  const askInputs = () => {
    void bridge.platform.inputs.list().then((list) => {
      if (inputsBox && inputsBox.parentNode) paintInputs(list, true);
    });
  };
  /** Down from the apps lands on the lower rows, which then slide up (design_preview's is-scrolled). */
  const scrollTo = (f: HTMLElement | null) => {
    const lower = !!f && !!f.closest && (!!f.closest('.home-lower') || !!f.closest('.weather'));
    el.classList.toggle('is-scrolled', lower);
  };
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
    const old = content.querySelector('.movehint');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    if (lifted) content.appendChild(h('div.movehint', '← → moves it · OK puts it down · Back puts it back'));
    if (focusId !== undefined) {
      const t = row.querySelector(`[data-key="${CSS.escape('app-' + focusId)}"]`) as HTMLElement | null;
      shell.focus(t || (el.querySelector('[data-key="sc-apps"]') as HTMLElement | null));
    }
  };
  const menu = tileMenu({ redraw: (id) => fillRow(id === undefined ? '' : id) });
  const screen = {
    label: 'Home',
    el,
    // The first app, not the search button or the nav above it.
    defaultFocus: () => el.querySelector('.approw [data-focus]') as HTMLElement | null,
    onFocus: (f: HTMLElement) => scrollTo(f),
    setApps(apps: AppInfo[] | null) {
      lastApps = apps;
      while (el.firstChild) el.removeChild(el.firstChild);
      while (content.firstChild) content.removeChild(content.firstChild);
      // Search, as design_preview's nav has it: v1 only, so v0 has the Home tab and the device icons.
      const nav = navBar('home');
      el.appendChild(nav);
      el.appendChild(content);
      content.appendChild(homeHero());
      row = h('div.approw');
      content.appendChild(row);
      fillRow();
      // Inputs and Shortcuts, as design_preview's Home has them, and the weather card under them.
      inputsBox = h('div.home-tiles');
      paintInputs(null, false);
      const shortcuts = [
        homeTile('All apps', 'apps', 'sc-apps', 'shortcuts', showAllApps),
        homeTile('Launcher settings', 'home', 'sc-launcher', 'shortcuts', () => showSettings()),
        homeTile('TV Settings', 'settings', 'sc-settings', 'shortcuts', () => openTvPage('main', 'The TV’s settings')),
        // The first call's checks (Blue or Info open them too); the key page is v1's.
        homeTile('Call checks', 'info', 'checks', 'shortcuts', showChecks),
        V1 ? homeTile('API keys', 'filter', 'keys', 'shortcuts', showKeys) : null,
      ];
      content.appendChild(
        h(
          'div.home-lower',
          h('div.home-group.home-group--inputs', h('div.home-heading', 'Inputs'), inputsBox),
          h('div.home-group.home-group--short', h('div.home-heading', 'Shortcuts'), h('div.home-tiles', shortcuts)),
        ),
      );
      content.appendChild(weatherCard(focusable(h('div.weather'), { group: 'weather', key: 'weather', onOk: () => showSettings('weather') })));
      askInputs();
      shell.refocus();
    },
    // Hold OK on a tile: Move, Remove from Home, App info (homeTileMenu.ts); while moving, it has the keys.
    onLongOk: (f: HTMLElement | null) => menu.onLongOk(f),
    onKey: (key: Key, f: HTMLElement | null) => menu.onKey(key, f),
    // Back from All apps: the row as it now is.
    onShow() {
      askInputs();
      if (JSON.stringify(rowApps().map((a) => a.key)) !== drawnRow) screen.setApps(lastApps);
    },
  };
  screen.setApps(null);
  return screen;
}
