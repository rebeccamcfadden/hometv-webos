// Settings › Theme, from design_preview's screens/panes/theme.ts at 2bf3c2d (Figma "Settings · Theme picker"): Classic and
// Seasonal swatches, then Typeface, Time of day and App logos. Moving only highlights a swatch; OK selects it, and the
// whole page wears it at once. A swatch carries its own data-theme (and period), so ui/themes.css gives it that theme's
// variables whatever the page is wearing. The rows' OK steps through their values, as the design does.
import './theme.css';
import { APP_LOGOS_LABELS, FONT_LABELS, prefs, TIME_OF_DAY_LABELS, type TimeOfDay } from '../../launcherSettings';
import { h } from '../../shell/dom';
import { focusable } from '../../shell/focus';
import { theme } from '../../theme/theme';
import { fontsHref, PERIOD_LABELS, THEMES, type Period, type ThemeDef } from '../../theme/themes';
import type { Pane } from './pane';

const NEXT_TIME_OF_DAY: Record<TimeOfDay, TimeOfDay> = { sun: 'day', day: 'night', night: 'sun' };

let swatchFonts = false;
/** The swatches show "Aa" in each theme's display face; those are fetched when the picker first shows. */
function loadSwatchFonts() {
  if (swatchFonts || typeof document === 'undefined') return;
  swatchFonts = true;
  const el = document.createElement('link');
  el.rel = 'stylesheet';
  el.href = fontsHref(THEMES.filter((t) => t.id !== 'midnight').map((t) => t.display));
  document.head.appendChild(el);
}

function swatch(t: ThemeDef, period: Period): HTMLElement {
  return h(
    'div.swatch',
    { 'data-theme': t.id, 'data-period': t.group === 'seasonal' ? period : null },
    h('span.swatch-aa', 'Aa'),
    h('div.swatch-shelf', h('i.is-focus'), h('i'), h('i')),
  );
}

export const themePane = (): Pane => ({
  render: () => {
    loadSwatchFonts();
    const s = prefs.get();
    const period = theme.period();
    const option = (t: ThemeDef) => {
      const on = t.id === s.theme;
      const el = focusable(h(`div.theme-opt${on ? '.is-selected' : ''}`, h('div.theme-pic', swatch(t, period)), h('div.theme-name', t.name)), {
        group: 'themes',
        key: `theme-${t.id}`,
        isDefault: on,
        onOk: () => prefs.set({ theme: t.id }),
      });
      if (on) el.setAttribute('data-entry', '');
      return el;
    };
    const row = (key: string, title: string, sub: string, value: string, onOk: () => void) =>
      focusable(h('div.lrow.theme-row', h('div.lr-main', h('div.lr-title', title), h('div.lr-sub', sub)), h('span.theme-val', value)), { group: 'theme-rows', key, onOk });
    return [
      h('div.pane-title', 'Theme'),
      h('div.pane-sub', 'Colours, type and the picture behind Home. Rows, apps and data stay as they are.'),
      h('div.grp-h', 'Classic'),
      h('div.theme-grid', THEMES.filter((t) => t.group === 'classic').map(option)),
      h('div.grp-h', `Seasonal · follows the date · today: ${PERIOD_LABELS[period]}`),
      h('div.theme-grid', THEMES.filter((t) => t.group === 'seasonal').map(option)),
      h(
        'div.theme-rows',
        row('theme-font', 'Typeface', 'System font uses Roboto', FONT_LABELS[s.themeFont], () => prefs.set({ themeFont: s.themeFont === 'theme' ? 'system' : 'theme' })),
        row('theme-time', 'Time of day', 'For Seasonal themes', TIME_OF_DAY_LABELS[s.timeOfDay], () => prefs.set({ timeOfDay: NEXT_TIME_OF_DAY[s.timeOfDay] })),
        row('theme-logos', 'App logos', 'On Home’s row of apps', APP_LOGOS_LABELS[s.appLogos], () => prefs.set({ appLogos: s.appLogos === 'full' ? 'minimal' : 'full' })),
      ),
    ];
  },
});
