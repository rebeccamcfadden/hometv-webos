// The themes (M9), as design_preview's core/theme.ts at 2bf3c2d and the Android launcher have them, without the page: the
// list, each theme's faces and backdrop, the Seasonal period by date, and the Google Fonts address. Classic themes keep
// their look all year; Seasonal ones follow the date through ten periods, and their picture follows the part of the day
// (F22). Colours, radii and type are CSS variables (ui/themes.css, made by tools/gen-theme-css.mjs); Midnight, HomeTV's
// first theme, is the shared tokens.css and has no backdrop here, so it looks as before. Pure, so tests run it in Node.
import type { Phase } from './daylight';

export type ThemeId = 'midnight' | 'daylight' | 'oled' | 'high-contrast' | 'cinema' | 'landscapes' | 'seasonal-vector' | 'seasonal-8bit';

export type Period = 'snow' | 'thaw' | 'spring-rain' | 'bloom' | 'pride' | 'midsummer' | 'late-summer' | 'autumn' | 'halloween' | 'christmas';

export const PERIOD_LABELS: Record<Period, string> = {
  snow: 'Snow',
  thaw: 'Thaw',
  'spring-rain': 'Spring rain',
  bloom: 'Bloom',
  pride: 'Pride',
  midsummer: 'Midsummer',
  'late-summer': 'Late summer',
  autumn: 'Autumn',
  halloween: 'Halloween',
  christmas: 'Christmas',
};

/** Where the photos and drawings are downloaded from: launcher/backdrops/ in the launcher's repo (Android's theme_assets_url). */
export const BACKDROP_BASE = 'https://cdn.jsdelivr.net/gh/rebeccamcfadden/hometv-launcher@main/launcher/backdrops/';

/** A Google Fonts family and the weights to ask for (none for single-weight faces). */
export interface Face {
  family: string;
  weights?: string;
}

/** What is behind Home: nothing, a downloaded picture, or 8-bit's pixel art. */
export type Backdrop = { kind: 'url' | 'pixel'; src: string } | { kind: 'none' };

export interface ThemeDef {
  id: ThemeId;
  name: string;
  group: 'classic' | 'seasonal';
  display: Face;
  ui: Face;
  backdrop(period: Period, hour: number, phase: Phase): Backdrop;
}

export const UI_WEIGHTS = '400;500;600;700';
const url = (path: string): Backdrop => ({ kind: 'url', src: BACKDROP_BASE + path });

export const THEMES: ThemeDef[] = [
  { id: 'midnight', name: 'Midnight', group: 'classic', display: { family: 'Inter', weights: '300' }, ui: { family: 'Inter', weights: UI_WEIGHTS }, backdrop: () => ({ kind: 'none' }) },
  { id: 'daylight', name: 'Daylight', group: 'classic', display: { family: 'Figtree', weights: '300' }, ui: { family: 'Figtree', weights: UI_WEIGHTS }, backdrop: () => url('classic/daylight.webp') },
  { id: 'oled', name: 'OLED Black', group: 'classic', display: { family: 'Manrope', weights: '300' }, ui: { family: 'Manrope', weights: UI_WEIGHTS }, backdrop: () => ({ kind: 'none' }) },
  {
    id: 'high-contrast',
    name: 'High Contrast',
    group: 'classic',
    display: { family: 'Atkinson Hyperlegible Next', weights: '400' },
    ui: { family: 'Atkinson Hyperlegible Next', weights: UI_WEIGHTS },
    backdrop: () => ({ kind: 'none' }),
  },
  { id: 'cinema', name: 'Cinema', group: 'classic', display: { family: 'DM Serif Display' }, ui: { family: 'DM Sans', weights: UI_WEIGHTS }, backdrop: () => url('classic/cinema.webp') },
  {
    id: 'landscapes',
    name: 'Landscapes',
    group: 'classic',
    display: { family: 'Outfit', weights: '300' },
    ui: { family: 'Outfit', weights: UI_WEIGHTS },
    // A new photo every hour, from four.
    backdrop: (_p, hour) => url(`classic/landscapes-${(hour % 4) + 1}.webp`),
  },
  {
    id: 'seasonal-vector',
    name: 'Vector art',
    group: 'seasonal',
    display: { family: 'Baloo 2', weights: '500' },
    ui: { family: 'Nunito', weights: UI_WEIGHTS },
    backdrop: (p, _h, phase) => url(`seasonal/vector-6/${p}-${phase}.webp`),
  },
  {
    id: 'seasonal-8bit',
    name: '8-bit',
    group: 'seasonal',
    display: { family: 'Press Start 2P' },
    ui: { family: 'Pixelify Sans', weights: UI_WEIGHTS },
    backdrop: (p, _h, phase) => ({ kind: 'pixel', src: `${BACKDROP_BASE}seasonal/8bit/${p}${phase === 'day' ? '' : `-${phase}`}.png` }),
  },
];

export const THEME_IDS = THEMES.map((t) => t.id);
/** A saved id, or Midnight for anything unknown (design_preview's removed Seasonal · Nature shows Vector art). */
export const themeById = (id: string): ThemeDef =>
  THEMES.filter((t) => t.id === (id === 'seasonal-nature' ? 'seasonal-vector' : id))[0] || THEMES[0];

const MONTHS: Period[] = ['snow', 'snow', 'thaw', 'spring-rain', 'bloom', 'pride', 'midsummer', 'late-summer', 'autumn', 'autumn', 'autumn', 'christmas'];

/** The period on a date: by month, except Halloween, 15 Oct – 2 Nov (as the launcher's SeasonCalendar). */
export function periodAt(d: Date): Period {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  if ((m === 10 && day >= 15) || (m === 11 && day <= 2)) return 'halloween';
  return MONTHS[m - 1];
}

/** One css2 URL for the faces, with each family's weights merged ("Figtree:wght@300;400;500;600;700"). */
export function fontsHref(faces: Face[]): string {
  const order: string[] = [];
  const weights: Record<string, string[]> = {};
  for (const f of faces) {
    if (!weights[f.family]) {
      weights[f.family] = [];
      order.push(f.family);
    }
    (f.weights ? f.weights.split(';') : []).forEach((w) => weights[f.family].indexOf(w) < 0 && weights[f.family].push(w));
  }
  const families = order.map((family) => {
    const list = weights[family].sort((a, b) => Number(a) - Number(b));
    return `family=${family.replace(/ /g, '+')}${list.length ? `:wght@${list.join(';')}` : ''}`;
  });
  return `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`;
}
