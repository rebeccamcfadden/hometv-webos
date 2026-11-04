// Settings › Performance and Settings › Screensaver, from design_preview's screens/panes/misc.ts at 2bf3c2d
// (performancePane, screensaverPane), slim for v0 on Samsung. Performance has Motion only: card shadows, the focus
// glow, the backdrop picture and animated details come with themes (Midnight has none of them), and Light mode with
// them. Screensaver has Start after (off by default), Behind the clock (Glow or Black: Midnight has no picture), and
// Show it now. design_preview's note on the TV's own screensaver ("HomeTV Clock") is left out: a Samsung app can't be
// the TV's screensaver. ↓ goes to the next row's selected option and → stays within its control, as design_preview
// does, since the controls have different widths; ← from a control's first option goes back to the section.
import './look.css';
import {
  MOTION_LABELS,
  MOTIONS,
  prefs,
  SCREENSAVER_AFTER,
  SCREENSAVER_AFTER_LABELS,
  SCREENSAVER_BACK_LABELS,
  SCREENSAVER_BACKS,
  type Motion,
  type ScreensaverAfter,
  type ScreensaverBack,
} from '../../launcherSettings';
import { shell, type Key } from '../../shell/app';
import { h } from '../../shell/dom';
import { segmented } from '../../ui/segmented';
import { showScreensaver } from '../../ui/screensaver';
import { button } from '../../ui/widgets';
import type { Pane, PaneHost } from './pane';

/** A choice's row: its name over what it is, and its segmented control on the right. */
const perfRow = (title: string, sub: string, control: HTMLElement) =>
  h('div.perf-row', h('div.perf-text', h('div.perf-title', title), h('div.perf-sub', sub)), h('div.perf-ctl', control));

/** → to the next option of the same control, never onto another row's. */
function rightInControl(host: PaneHost, focused: HTMLElement): boolean {
  const seg = focused.closest('.seg');
  if (!seg) return false;
  const opts = Array.prototype.slice.call(seg.querySelectorAll('.seg-opt')) as HTMLElement[];
  const next = opts[opts.indexOf(focused) + 1];
  const k = next && next.getAttribute('data-key');
  if (k) host.focusKey(k);
  return true;
}

/**
 * ← to the previous option of the same control; from the first, back to the section in the list (the page's spatial ←
 * would land on a button lower down the pane).
 */
function leftInControl(focused: HTMLElement, section: string): boolean {
  const seg = focused.closest('.seg');
  if (!seg) return false;
  const opts = Array.prototype.slice.call(seg.querySelectorAll('.seg-opt')) as HTMLElement[];
  const prev = opts[opts.indexOf(focused) - 1];
  const top = shell.top();
  const target = prev || (top ? (top.el.querySelector(`[data-key="sec-${section}"]`) as HTMLElement | null) : null);
  if (target) shell.focus(target);
  return true;
}

export const performancePane = (host: PaneHost): Pane => ({
  onKey(key: Key, focused: HTMLElement) {
    if (key === 'left') return leftInControl(focused, 'performance');
    return key === 'right' ? rightInControl(host, focused) : false;
  },
  render: () => [
    h('div.eyebrow', 'Performance'),
    h('div.pane-title', 'Performance'),
    h('div.pane-sub', 'How much HomeTV moves. Lighter choices keep it smooth on TVs with little memory; what it shows stays the same.'),
    h(
      'div.perf-rows',
      perfRow(
        'Motion',
        'Menus sliding in, the focus growing, and fades',
        segmented<Motion>({
          options: MOTIONS.map((m): [Motion, string] => [m, MOTION_LABELS[m]]),
          get: () => prefs.get().motion,
          set: (motion) => prefs.set({ motion }),
          group: 'seg-motion',
          small: true,
          entry: true,
        }),
      ),
    ),
  ],
});

export const screensaverPane = (host: PaneHost): Pane => ({
  onKey(key: Key, focused: HTMLElement) {
    if (key === 'right') return rightInControl(host, focused);
    if (key === 'left') return leftInControl(focused, 'screensaver');
    if (key !== 'down') return false;
    const k = focused.getAttribute('data-key') || '';
    if (k.indexOf('seg-saver-after') === 0) host.focusKey(`seg-saver-back-${prefs.get().screensaverBack}`);
    else if (k.indexOf('seg-saver-back') === 0) host.focusKey('saver-now');
    else return false;
    return true;
  },
  render: () => [
    h('div.eyebrow', 'Screensaver'),
    h('div.pane-title', 'Clock screensaver'),
    h(
      'div.pane-sub',
      'The time and date drift slowly across a dark screen while nobody is using the TV. It starts only from Home, never over an app or an input, and any button brings Home back.',
    ),
    h(
      'div.perf-rows',
      perfRow(
        'Start after',
        'How long Home sits untouched first',
        segmented<ScreensaverAfter>({
          options: SCREENSAVER_AFTER.map((a): [ScreensaverAfter, string] => [a, SCREENSAVER_AFTER_LABELS[a]]),
          get: () => prefs.get().screensaverAfter,
          set: (screensaverAfter) => prefs.set({ screensaverAfter }),
          group: 'seg-saver-after',
          small: true,
          entry: true,
        }),
      ),
      perfRow(
        'Behind the clock',
        'A slow colour glow, or black (best for an OLED)',
        segmented<ScreensaverBack>({
          options: SCREENSAVER_BACKS.map((b): [ScreensaverBack, string] => [b, SCREENSAVER_BACK_LABELS[b]]),
          get: () => prefs.get().screensaverBack,
          set: (screensaverBack) => prefs.set({ screensaverBack }),
          group: 'seg-saver-back',
          small: true,
        }),
      ),
    ),
    h('div.pane-actions', button('Show it now', { icon: 'clock', key: 'saver-now', onOk: () => showScreensaver() })),
  ],
});
