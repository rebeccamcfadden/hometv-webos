// Settings (design_preview's screens/settings.ts at 2bf3c2d, "Launcher settings"), slimmed for v0 on Samsung:
// Performance (Motion), Screensaver, Home row apps, Weather, Region and About, and a way back into first run. Sections on the left with their values; the pane on
// the right shows the focused section at once. → or OK enters the pane (its border brightens), ← from its left edge
// returns to the section. Back in the pane leaves a sub-state first (Change city, an app being moved), then the pane;
// Back on the list closes the page. Changes save at once. Not in v0 (docs/versions.md): account, streaming services,
// stores, API keys, features, theme, notes, the phone remote, Open on start, Default Home.
import './settings.css';
import { homeRow } from '../apps';
import { bridge } from '../bridge';
import { MOTION_LABELS, prefs, REGION_LABELS, SCREENSAVER_AFTER_LABELS } from '../launcherSettings';
import { shell, type Screen } from '../shell/app';
import { h, replace } from '../shell/dom';
import { focusable } from '../shell/focus';
import { icon, type IconName } from '../ui/icons';
import { button } from '../ui/widgets';
import { aboutValue } from '../updates';
import { PAGE_VERSION } from '../version';
import { aboutPane } from './panes/about';
import { appsPane } from './panes/apps';
import { performancePane, screensaverPane } from './panes/look';
import type { Pane, PaneHost } from './panes/pane';
import { regionPane } from './panes/region';
import { weatherPane } from './panes/weather';
import { showSetup } from './setup';
import { weather } from '../weather/homeWeather';

export type SectionId = 'performance' | 'screensaver' | 'apps' | 'weather' | 'region' | 'setup' | 'about';

interface Section {
  id: SectionId;
  label: string;
  icon: IconName;
  /** The current value, in grey at the row's right. */
  value: () => string;
}

const SECTIONS: Section[] = [
  { id: 'performance', label: 'Performance', icon: 'gauge', value: () => `Motion ${MOTION_LABELS[prefs.get().motion].toLowerCase()}` },
  // F36: the clock screensaver, off by default.
  { id: 'screensaver', label: 'Screensaver', icon: 'clock', value: () => SCREENSAVER_AFTER_LABELS[prefs.get().screensaverAfter] },
  { id: 'apps', label: 'Home row apps', icon: 'apps', value: () => String(homeRow.get().length) },
  { id: 'weather', label: 'Weather', icon: 'cloud', value: () => (prefs.get().place ? prefs.get().place!.name : 'Not set') },
  { id: 'region', label: 'Region', icon: 'pin', value: () => (prefs.get().region ? REGION_LABELS[prefs.get().region!] : 'Not set') },
  { id: 'setup', label: 'First run', icon: 'home', value: () => '' },
  { id: 'about', label: 'About', icon: 'info', value: () => aboutValue(bridge.platform.pageUpdates(), PAGE_VERSION) },
];

/** design_preview's groups (F23), with the sections v0 has. */
const GROUPS: { title: string; items: SectionId[] }[] = [
  { title: 'Home & look', items: ['performance', 'screensaver', 'apps', 'weather'] },
  { title: 'This TV', items: ['region', 'setup', 'about'] },
];

/** First run again, from Settings: the same steps as on the first start. */
const setupAgainPane = (): Pane => ({
  render: () => {
    const b = button('Open first run', { icon: 'chevRight', primary: true, key: 'setup-open', onOk: () => showSetup() });
    b.setAttribute('data-entry', '');
    return [
      h('div.eyebrow', 'First run'),
      h('div.pane-title', 'Set up again'),
      h('div.pane-sub', 'The steps HomeTV showed on its first start: where this TV is, and the weather place. Each keeps what you chose until you change it.'),
      h('div.pane-actions', b),
    ];
  },
});

export function settingsScreen(initial: SectionId = 'apps'): Screen {
  const sections = GROUPS.reduce((all: Section[], g) => all.concat(g.items.map((id) => SECTIONS.filter((s) => s.id === id)[0])), []);
  let current: SectionId = initial;
  let shown: SectionId | null = null;
  let inPane = false;

  const list = h('div.sec-list.sec-list--grouped', { 'data-scroll': 'y', 'data-scroll-pad': 56 });
  const scroll = h('div.pane-scroll', { 'data-scroll': 'y', 'data-scroll-pad': 40 });
  const pane = h('div.set-pane', scroll);

  const entryOf = () => (scroll.querySelector('[data-entry]') || scroll.querySelector('[data-focus]')) as HTMLElement | null;

  const host: PaneHost = {
    rerender: () => rerender(),
    focusKey(k) {
      const target = k ? (pane.querySelector(`[data-key="${CSS.escape(k)}"]`) as HTMLElement | null) : entryOf();
      if (target) shell.focus(target);
    },
    setup: false,
  };
  const panes: Record<SectionId, Pane> = {
    performance: performancePane(host),
    screensaver: screensaverPane(host),
    apps: appsPane(host),
    weather: weatherPane(host),
    region: regionPane(),
    setup: setupAgainPane(),
    about: aboutPane(),
  };

  const rows = sections.map((sec) =>
    focusable(h('div.sec', { 'data-section': sec.id }, h('span.sec-icon', { html: icon(sec.icon, 28) }), h('span.sec-label', sec.label), h('span.sec-value')), {
      group: 'sections',
      key: `sec-${sec.id}`,
      isDefault: sec.id === current,
      onFocus: () => show(sec.id),
      onOk: () => enter(sec.id),
    }),
  );
  replace(
    list,
    GROUPS.map((g) => [h('div.sec-head', g.title), g.items.map((id) => rows[sections.map((s) => s.id).indexOf(id)])]),
  );
  const rowOf = (id: SectionId) => rows[sections.map((s) => s.id).indexOf(id)];

  function paintValues() {
    sections.forEach((sec, i) => {
      (rows[i].querySelector('.sec-value') as HTMLElement).textContent = sec.value();
    });
  }

  function rerender() {
    replace(scroll, panes[current].render());
    paintValues();
    if (inPane) shell.refocus();
  }

  function show(id: SectionId) {
    current = id;
    if (shown === id) return;
    shown = id;
    scroll.scrollTop = 0;
    rerender();
  }

  function enter(id: SectionId) {
    show(id);
    const target = entryOf();
    if (target) shell.focus(target);
  }

  show(current);

  const el = h(
    'div.screen.screen--full.settings',
    h('div.set-head', h('h1.page-title', 'Settings'), h('span.set-hint', 'Back closes · changes save at once')),
    list,
    pane,
  );

  const screen: Screen = {
    label: 'Settings',
    el,
    defaultFocus: () => (inPane ? entryOf() : null) || rowOf(current),
    onShow: () => rerender(),
    // While the pane has focus, its section stays lit and the pane's border brightens.
    onFocus(f) {
      inPane = pane.contains(f);
      pane.classList.toggle('is-live', inPane);
      rows.forEach((r) => r.classList.toggle('is-active', inPane && r.getAttribute('data-section') === current));
    },
    onText: (ch) => !!panes[current].onText && panes[current].onText!(ch),
    onKey(key, f) {
      if (!f) return false;
      if (list.contains(f)) {
        if (key === 'right') {
          enter(current);
          return true;
        }
        if (key === 'left') return true;
        if (key === 'up' || key === 'down') {
          shell.moveWithin(list, key);
          return true;
        }
        return false;
      }
      const p = panes[current];
      if (p.onKey && p.onKey(key, f)) return true;
      if (key === 'back') {
        if (p.back && p.back()) return true;
        shell.focus(rowOf(current));
        return true;
      }
      if (key === 'left') {
        if (!shell.moveWithin(pane, 'left')) shell.focus(rowOf(current));
        return true;
      }
      if (key === 'up' || key === 'down' || key === 'right') {
        shell.moveWithin(pane, key);
        return true;
      }
      return false;
    },
  };

  // Live values: the place, the region, the unit; the weather that arrives for a new place.
  const offs = [prefs.on(() => rerender()), weather.on(() => current === 'weather' && rerender())];
  const offStack = shell.onChange(() => {
    if (shell.has(screen)) return;
    offs.forEach((off) => off());
    offStack();
  });
  return screen;
}

export const showSettings = (initial?: SectionId) => shell.push(settingsScreen(initial));
