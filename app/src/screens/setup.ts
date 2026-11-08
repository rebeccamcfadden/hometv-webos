// First run (design_preview's screens/setup.ts at 2bf3c2d, V2 designs 01-setup B and r2-setup-checklist), with only the
// steps v0 has on Samsung: Region and the weather city (no features, services, stores, keys or account: v1). One page:
// the checklist starts wide and focused, each row with its value and pill, and a help pane for the focused row on the
// right. → on a row (or OK) opens that step's panel on the same page, focus in it: the checklist shrinks to a column of
// tabs and the panel takes the right, the same pane as Settings with a footer ("Step 1 of 2", Next or Done). Back on a
// tab closes the panel; Back on the checklist, or Start using Home, ends first run. It shows once, on the first start
// (`hometv-setup-done`), and again from Settings › First run.
//
// v1 (v1.ts fills routes.tmdbSetup) adds Android's two TMDB steps after Region: TMDB key, only when no key was saved as
// First run opened, and Sign in to TMDB. Their panels say what each is for and open the API keys page (its QR leads a
// phone to the key page, which explains getting the key) or the TMDB account screen over First run; Back returns here.
// After an update from v0, main.ts shows First run once more (`hometv-setup-v1-done`) unless the key is already saved.
import './settings.css';
import { markSetupDone, pageStorage, prefs, REGION_LABELS, SETUP_V1_KEY } from '../launcherSettings';
import { shell, type Screen } from '../shell/app';
import { h, replace } from '../shell/dom';
import { focusable } from '../shell/focus';
import { icon } from '../ui/icons';
import { button } from '../ui/widgets';
import { paneHead, type Pane, type PaneHost } from './panes/pane';
import { regionPane } from './panes/region';
import { weatherPane } from './panes/weather';
import { weather } from '../weather/homeWeather';
import { routes, type TmdbSetup } from './routes';

type StepId = 'region' | 'weather' | 'tmdbKey' | 'account';

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

/** v1's TMDB steps, with the key's state as First run last read it. */
function tmdbSteps(tmdb: TmdbSetup, keySaved: () => boolean): Step[] {
  return [
    {
      id: 'tmdbKey',
      title: 'TMDB key',
      sub: 'Movies, TV Shows and Search',
      value: () => (keySaved() ? 'Saved' : ''),
      pill: () => (keySaved() ? 'Saved' : 'Not sent'),
      help: {
        eyebrow: 'TMDB key',
        title: 'Send the TMDB key from a phone',
        body: 'Movies, TV Shows and Search come from TMDB, the free film and TV database. The API keys page shows a QR code: the page it opens on a phone explains making a free TMDB account and copying its key, and sends the key to this TV.',
        note: '→ opens this step; Show the QR code opens the same page as Settings › API keys.',
      },
    },
    {
      id: 'account',
      title: 'Sign in to TMDB',
      sub: 'My list, Favorites and Seen',
      value: () => tmdb.signedInAs(),
      pill: () => (tmdb.signedInAs() ? 'Signed in' : 'Not signed in'),
      help: {
        eyebrow: 'TMDB account',
        title: 'Sign in to TMDB?',
        body: 'Signed in, My list, Favorites and Seen are kept on the TMDB account too, so they follow it to a phone or another TV. Sign in with a phone: scan the code and approve this TV on TMDB. It needs the TMDB key first.',
        note: 'Optional. → opens this step; the same screen is under Settings › API keys › TMDB account.',
      },
    },
  ];
}

/** The panel for a TMDB step: what it is for, where it stands, and the button that opens its screen. */
function tmdbPane(body: () => { eyebrow: string; title: string; sub: string; status: string; label: string; open: () => void }): Pane {
  return {
    render() {
      const b = body();
      return [
        ...paneHead(b.eyebrow, b.title, b.sub),
        h('div.setup-step-status', b.status),
        h('div.setup-step-action', button(b.label, { icon: 'chevRight', primary: true, key: 'tmdb-open', onOk: b.open })),
      ];
    },
  };
}

export function setupScreen(): Screen {
  const tmdb = routes.tmdbSetup;
  /** The TMDB key's state; null until First run has read it once. */
  let keySaved: boolean | null = null;
  let steps: Step[] = tmdb ? [STEPS[0], ...tmdbSteps(tmdb, () => !!keySaved), STEPS[1]] : STEPS;
  const done: Record<string, boolean> = {};
  const doneCount = () => steps.filter((s) => done[s.id]).length;
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

  const stepOf = (id: StepId | null) => steps.filter((s) => s.id === id)[0];
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
  const panes: Record<StepId, Pane> = {
    region: regionPane(),
    weather: weatherPane(host),
    tmdbKey: tmdbPane(() => ({
      eyebrow: 'TMDB key',
      title: 'Send the TMDB key from a phone',
      sub: 'Show the QR code and scan it with a phone on this Wi-Fi. The page on the phone explains making a free TMDB account and copying its API Read Access Token, then sends it to this TV. Back on that page returns here.',
      status: keySaved ? 'A TMDB key is saved on this TV.' : 'No TMDB key on this TV yet.',
      label: 'Show the QR code',
      open: () => tmdb && tmdb.openKeys(),
    })),
    account: tmdbPane(() => {
      const who = tmdb ? tmdb.signedInAs() : '';
      return {
        eyebrow: 'TMDB account',
        title: 'Sign in to TMDB',
        sub: 'Scan the code with a phone and approve this TV on TMDB. My list, Favorites and Seen then follow the account. Back on that screen returns here.',
        status: who ? `Signed in as ${who}.` : keySaved ? 'Not signed in.' : 'Not signed in. Signing in needs the TMDB key first.',
        label: who ? 'TMDB account' : 'Sign in with a phone',
        open: () => tmdb && tmdb.openAccount(),
      };
    }),
  };

  const paintHelp = (step: Step | null) => {
    const all = doneCount() === steps.length;
    const left = steps.length - doneCount();
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
    const i = steps.map((s) => s.id).indexOf(open);
    const next = steps[i + 1];
    replace(
      foot,
      h('span.pane-foot-note', `Step ${i + 1} of ${steps.length} · changes save at once`),
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
    const all = doneCount() === steps.length;
    el.classList.toggle('setup--open', !!open);
    replace(titleEl, all ? 'You’re all set' : 'Set up your Home screen');
    replace(
      leadEl,
      all
        ? 'Every row is done. Change any of them now, or start.'
        : `${tmdb ? 'A few steps' : 'Two quick choices'}. Move right to open a row, or start right away.`,
    );
    replace(
      rowsEl,
      steps.map((s, i) => {
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
    const next = steps.filter((s) => !done[s.id])[0];
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
    onShow: () => {
      paint();
      // Back from the API keys page or the account screen: the key may have just come.
      readKey();
    },
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
  /** Reads the TMDB key's state. The first answer decides the key step: a TV that already had a key doesn't show it. */
  function readKey() {
    if (!tmdb) return;
    void tmdb.keySaved().then((saved) => {
      const first = keySaved === null;
      keySaved = saved;
      if (first && saved && open !== 'tmdbKey') steps = steps.filter((s) => s.id !== 'tmdbKey');
      if (shell.has(screen)) repaint();
    });
  }
  const offs = [
    prefs.on(repaint),
    // The forecast for a city just chosen arrives after the pane drew "Getting the weather…".
    weather.on(() => {
      if (open === 'weather') paintPanel();
    }),
  ];
  if (tmdb) offs.push(tmdb.on(repaint));
  // First run has ended (Start, Back, the nav): it doesn't show by itself again.
  const offStack = shell.onChange(() => {
    if (shell.has(screen)) return;
    offs.forEach((off) => off());
    offStack();
    markSetupDone(pageStorage());
    if (tmdb) markSetupDone(pageStorage(), SETUP_V1_KEY);
  });

  paint();
  paintHelp(steps[0]);
  return screen;
}

export const showSetup = () => shell.push(setupScreen());
