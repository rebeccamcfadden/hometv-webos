// First run (design_preview's screens/setup.ts at 2bf3c2d, V2 designs 01-setup B and r2-setup-checklist), with only the
// steps v0 has on Samsung: Region and the weather city (no features, services, stores, keys or account: v1). One page:
// the checklist starts wide and focused, each row with its value and pill, and a help pane for the focused row on the
// right. → on a row (or OK) opens that step's panel on the same page, focus in it: the checklist shrinks to a column of
// tabs and the panel takes the right, the same pane as Settings with a footer ("Step 1 of 2", Next or Done). Back on a
// tab closes the panel; Back on the checklist, or Start using Home, ends first run. It shows once, on the first start
// (`hometv-setup-done`), and again from Settings › First run.
import './settings.css';
import { markSetupDone, pageStorage, prefs, REGION_LABELS } from '../launcherSettings';
import { shell, type Screen } from '../shell/app';
import { h, replace } from '../shell/dom';
import { focusable } from '../shell/focus';
import { icon } from '../ui/icons';
import { button } from '../ui/widgets';
import type { Pane, PaneHost } from './panes/pane';
import { regionPane } from './panes/region';
import { weatherPane } from './panes/weather';
import { weather } from '../weather/homeWeather';

type StepId = 'region' | 'weather';

interface Step {
  id: StepId;
  title: string;
  sub: string;
  /** The current value, from the same settings the pane changes; '' while not chosen. */
  value: () => string;
  /** The pill while the row isn't done. */
  pill: () => string;
  help: { eyebrow: string; title: string; body: string; note: string };
}

export const STEPS: Step[] = [
  {
    id: 'region',
    title: 'Region',
    sub: 'Services, stores and prices',
    value: () => (prefs.get().region ? REGION_LABELS[prefs.get().region!] : ''),
    pill: () => (prefs.get().region ? 'Chosen' : 'Not chosen'),
    help: {
      eyebrow: 'Region',
      title: 'Where is this TV?',
      body: 'HomeTV shows one country’s streaming services, stores and prices: Sweden or the United States. It also decides °C or °F.',
      note: '→ opens the same pane as Settings › Region.',
    },
  },
  {
    id: 'weather',
    title: 'Weather city',
    sub: 'The weather under Home’s clock',
    value: () => (prefs.get().place ? prefs.get().place!.name : ''),
    pill: () => (prefs.get().place ? 'Chosen' : 'Not chosen'),
    help: {
      eyebrow: 'Weather',
      title: 'Which city’s weather?',
      body: 'Home shows the weather there now under its clock, from Open-Meteo. Type the first letters of a city; only those are sent.',
      note: 'Without a city Home shows no weather. → opens the same pane as Settings › Weather.',
    },
  },
];

export function setupScreen(): Screen {
  const done: Record<string, boolean> = {};
  const doneCount = () => STEPS.filter((s) => done[s.id]).length;
  /** The panel showing on the right; null while the checklist is wide. */
  let open: StepId | null = null;
  let inPanel = false;

  const titleEl = h('h1.setup-title');
  const leadEl = h('div.setup-lead');
  const rowsEl = h('div.cl-rows');
  const help = h('div.panel.setup-help');
  const scroll = h('div.pane-scroll', { 'data-scroll': 'y', 'data-scroll-pad': 40 });
  const foot = h('div.pane-foot');
  const panel = h('div.set-pane.setup-panel', scroll, foot);

  const start = button('Start using Home', { icon: 'home', primary: true, key: 'start', onOk: () => shell.goTab('home') });

  const stepOf = (id: StepId | null) => STEPS.filter((s) => s.id === id)[0];
  const tabOf = (id: StepId) => rowsEl.querySelector(`[data-key="step-${id}"]`) as HTMLElement | null;
  const entryOf = () => (scroll.querySelector('[data-entry]') || scroll.querySelector('[data-focus]') || foot.querySelector('[data-focus]')) as HTMLElement | null;

  const host: PaneHost = {
    rerender: () => paintPanel(),
    focusKey(k) {
      const target = k ? (panel.querySelector(`[data-key="${CSS.escape(k)}"]`) as HTMLElement | null) : entryOf();
      if (target) shell.focus(target);
    },
    setup: true,
  };
  const panes: Record<StepId, Pane> = { region: regionPane(), weather: weatherPane(host) };

  const paintHelp = (step: Step | null) => {
    const all = doneCount() === STEPS.length;
    const left = STEPS.length - doneCount();
    replace(
      help,
      step
        ? [
            h('div.eyebrow', step.help.eyebrow),
            h('div.setup-help-title', step.help.title),
            h('div.setup-help-body', step.help.body),
            h('div.setup-help-divider'),
            h('div.setup-help-note', doneCount() && !done[step.id] ? `${doneCount()} done. Start using Home at any time; change the rest later.` : step.help.note),
          ]
        : [
            h('div.eyebrow', all ? 'Ready' : 'Start'),
            h('div.setup-help-title', all ? 'Your Home screen is set up.' : 'Start now?'),
            h(
              'div.setup-help-body',
              all ? 'Home shows your apps, the clock and the weather.' : `${left} step${left === 1 ? '' : 's'} not opened yet. Start now and set ${left === 1 ? 'it' : 'them'} later.`,
            ),
            h('div.setup-help-divider'),
            h('div.setup-help-note', 'Settings, from Home’s lower row, changes any of it.'),
          ],
    );
  };

  /** The panel for the open step: its pane, and the footer to step on. */
  function paintPanel() {
    if (!open) return;
    replace(scroll, panes[open].render());
    const i = STEPS.map((s) => s.id).indexOf(open);
    const next = STEPS[i + 1];
    replace(
      foot,
      h('span.pane-foot-note', `Step ${i + 1} of ${STEPS.length} · changes save at once`),
      h(
        'div.pane-foot-actions',
        button(next ? `Next: ${next.title}` : 'Done', {
          icon: next ? 'chevRight' : 'check',
          small: true,
          primary: true,
          key: 'foot-next',
          onOk: () => (next ? enter(next.id) : finish()),
        }),
      ),
    );
    if (inPanel) shell.refocus();
  }

  /** The tabs: the checklist rows, wide or cut down beside an open panel. */
  function paint() {
    const all = doneCount() === STEPS.length;
    el.classList.toggle('setup--open', !!open);
    replace(titleEl, all ? 'You’re all set' : 'Set up your Home screen');
    replace(leadEl, all ? 'Every row is done. Change any of them now, or start.' : 'Two quick choices. Move right to open a row, or start right away.');
    replace(
      rowsEl,
      STEPS.map((s, i) => {
        const isDone = !!done[s.id];
        const value = s.value();
        return focusable(
          h(
            'div.lrow.cl-row' + (open === s.id ? '.is-shown' : ''),
            isDone ? h('div.cl-num.is-done', { html: icon('check', 22) }) : h('div.cl-num', String(i + 1)),
            h('div.lr-main', h('div.lr-title', s.title), h('div.lr-sub', s.sub)),
            value ? h('div.lr-value', value) : null,
            isDone ? null : h('span.status.status--' + (value ? 'accent' : 'muted'), s.pill()),
            h('span.lr-icon', { html: icon('chevRight', 26) }),
          ),
          { group: 'steps', key: `step-${s.id}`, isDefault: i === 0, onFocus: () => focusTab(s.id), onOk: () => enter(s.id) },
        );
      }),
    );
    paintShown();
    if (shell.top() === screen) shell.refocus();
  }

  /** The open step's tab stays lit while its panel has focus; the panel's border brightens. */
  function paintShown() {
    panel.classList.toggle('is-live', inPanel);
    const rows = rowsEl.querySelectorAll('.cl-row');
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] as HTMLElement;
      r.classList.toggle('is-active', inPanel && r.getAttribute('data-key') === `step-${open}`);
    }
  }

  /** A tab got focus: wide, the help pane follows it; open, its panel shows at once (not entered, not done). */
  function focusTab(id: StepId) {
    if (!open) return paintHelp(stepOf(id) || null);
    show(id);
  }

  function show(id: StepId) {
    if (open === id) return;
    const wasOpen = !!open;
    open = id;
    scroll.scrollTop = 0;
    if (!wasOpen) paint();
    paintPanel();
  }

  /** → or OK on a tab, or Next: the panel opens (the checklist shrinks to tabs) and focus goes into it. */
  function enter(id: StepId) {
    done[id] = true;
    open = id;
    scroll.scrollTop = 0;
    inPanel = true;
    paint();
    paintPanel();
    const target = entryOf();
    if (target) shell.focus(target);
  }

  /** Back on a tab: the panel closes and the checklist is wide again, focus on the row it was on. */
  function close(focusId?: StepId) {
    const at = focusId || open;
    open = null;
    inPanel = false;
    paint();
    const row = at ? tabOf(at) : null;
    if (row) shell.focus(row);
  }

  /** Done on the last step: the checklist widens, focus on the first row not done, or Start. */
  function finish() {
    const next = STEPS.filter((s) => !done[s.id])[0];
    close();
    shell.focus(next ? tabOf(next.id) : start);
  }

  const el = h(
    'div.screen.screen--full.screen--setup',
    h(
      'div.setup-main',
      h('div.eyebrow', 'First run'),
      titleEl,
      leadEl,
      rowsEl,
      h('div.setup-start', start, h('span.setup-start-note', 'The same pages are in Settings.')),
    ),
    help,
    panel,
  );

  const screen: Screen = {
    label: 'First run',
    el,
    defaultFocus: () => (inPanel ? entryOf() : null) || (open ? tabOf(open) : null) || (rowsEl.querySelector('[data-focus]') as HTMLElement | null),
    onShow: () => paint(),
    onFocus(f) {
      const was = inPanel;
      inPanel = panel.contains(f);
      if (was !== inPanel) paintShown();
      if (f === start && !open) paintHelp(null);
    },
    onText: (ch) => inPanel && !!open && !!panes[open].onText && panes[open].onText!(ch),
    onKey(key, f) {
      if (!f) return false;
      // Start sits alone on its line: ← and → stay on it, and ↓ doesn't slip into an open panel without entering it.
      if (f === start) {
        if (key === 'back' && open) {
          close();
          return true;
        }
        return key === 'left' || key === 'right' || (key === 'down' && !!open);
      }
      if (rowsEl.contains(f)) {
        const id = (f.getAttribute('data-key') || '').replace(/^step-/, '') as StepId;
        if (key === 'right') {
          enter(id);
          return true;
        }
        if (key === 'left') return true;
        if (key === 'back' && open) {
          close(id);
          return true;
        }
        return false;
      }
      if (!open || !panel.contains(f)) return false;
      const p = panes[open];
      if (p.onKey && p.onKey(key, f)) return true;
      const tab = () => shell.focus(tabOf(open!));
      if (key === 'back') {
        if (!p.back || !p.back()) tab();
        return true;
      }
      if (key === 'left') {
        if (!shell.moveWithin(panel, 'left')) tab();
        return true;
      }
      if (key === 'up' || key === 'down' || key === 'right') {
        shell.moveWithin(panel, key);
        return true;
      }
      return false;
    },
  };

  const repaint = () => {
    paint();
    paintPanel();
  };
  const offs = [
    prefs.on(repaint),
    // The forecast for a city just chosen arrives after the pane drew "Getting the weather…".
    weather.on(() => {
      if (open === 'weather') paintPanel();
    }),
  ];
  // First run has ended (Start, Back, the nav): it doesn't show by itself again.
  const offStack = shell.onChange(() => {
    if (shell.has(screen)) return;
    offs.forEach((off) => off());
    offStack();
    markSetupDone(pageStorage());
  });

  paint();
  paintHelp(STEPS[0]);
  return screen;
}

export const showSetup = () => shell.push(setupScreen());
