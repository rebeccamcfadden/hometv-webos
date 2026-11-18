// What applies the theme to the page (design_preview's core/theme.ts at 2bf3c2d, for the TV): data-theme, data-period,
// data-phase and data-font on <html> (ui/themes.css keys the colours, radii and type on them), the active theme's fonts
// from Google Fonts (the TV's Roboto when that can't be had or Typeface says System), and the backdrop, downloaded once
// and kept (backdropStore.ts). A Seasonal picture follows the date (ten periods) and the sun at the Weather place, or
// Time of day's Day or Night. Midnight, the first theme, has its evening picture but no fonts to fetch; until the picture
// has arrived (or when it can't be fetched) it looks as it did.
import { prefs } from '../launcherSettings';
import { backdropBlob } from './backdropStore';
import { msToNextPhase, phaseAt, setSite, siteFromZone, type Phase } from './daylight';
import { fontsHref, periodAt, PERIOD_LABELS, themeById, type Backdrop, type Face, type Period, type ThemeDef } from './themes';

const root = document.documentElement;
let wanted = '';
let timer = 0;
let objectUrl = '';
const listeners: (() => void)[] = [];

function link(id: string): HTMLLinkElement {
  let el = document.getElementById(id) as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement('link');
    el.id = id;
    el.rel = 'stylesheet';
    document.head.appendChild(el);
  }
  return el;
}

/** Only the active theme's faces are fetched; Midnight's Inter and Settings' System font need none (Roboto is the TV's). */
function applyFonts(t: ThemeDef, system: boolean) {
  const faces: Face[] = system || t.id === 'midnight' ? [] : [t.display, t.ui];
  const el = link('theme-fonts');
  const href = faces.length ? fontsHref(faces) : '';
  if (el.getAttribute('href') !== href) {
    if (href) el.setAttribute('href', href);
    else el.removeAttribute('href');
  }
}

function setImage(src: string | null) {
  root.style.setProperty('--bg-image', src ? `url("${src}")` : 'none');
  // Midnight shows its glow until the picture is here (ui/themeHome.css).
  if (src) root.setAttribute('data-pic', '1');
  else root.removeAttribute('data-pic');
}

/** No picture: the sky shows, and the last picture's blob is let go (a TV with little memory keeps no decoded image it isn't showing). */
function clearImage() {
  setImage(null);
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = '';
}

/** The picture, once it is on the TV; the theme's sky shows while it loads, when it can't be fetched, and offline until it has been. */
function applyBackdrop(b: Backdrop) {
  root.setAttribute('data-backdrop', b.kind);
  if (b.kind === 'none') {
    wanted = '';
    return clearImage();
  }
  if (wanted === b.src) return;
  wanted = b.src;
  clearImage();
  void backdropBlob(b.src).then((blob) => {
    if (wanted !== b.src) return;
    // Not fetched (offline, a timeout): ask again at the next look (the network coming back, the hour, a setting).
    if (!blob) {
      wanted = '';
      return;
    }
    const next = URL.createObjectURL(blob);
    setImage(next);
    objectUrl = next;
  });
}

/** The part of the day a Seasonal picture shows: Time of day's Day or Night, or the sun now at the Weather place. */
function currentPhase(now: Date): Phase {
  const t = prefs.get().timeOfDay;
  return t === 'sun' ? phaseAt(now) : t;
}

const dependsOn = () => {
  const s = prefs.get();
  return [s.theme, s.themeFont, s.timeOfDay, s.place ? s.place.latitude + ',' + s.place.longitude : ''].join('|');
};

function apply() {
  const s = prefs.get();
  const t = themeById(s.theme);
  const now = new Date();
  const place = s.place;
  setSite(place ? { lat: place.latitude, lon: place.longitude } : siteFromZone(now));
  root.setAttribute('data-theme', t.id);
  if (t.group === 'seasonal') root.setAttribute('data-period', periodAt(now));
  else root.removeAttribute('data-period');
  root.setAttribute('data-font', s.themeFont);
  applyFonts(t, s.themeFont === 'system');
  const phase = currentPhase(now);
  root.setAttribute('data-phase', phase);
  applyBackdrop(t.backdrop(periodAt(now), now.getHours(), phase));
  // Landscapes changes on the hour, the period at midnight and a Seasonal picture when the sun moves on: look again
  // at whichever comes first.
  window.clearTimeout(timer);
  let wait = 3600000 - (now.getTime() % 3600000);
  if (t.group === 'seasonal' && s.timeOfDay === 'sun') wait = Math.min(wait, msToNextPhase(now));
  timer = window.setTimeout(apply, wait + 1000);
  listeners.slice().forEach((fn) => fn());
}

export const theme = {
  /** Applies the saved theme and follows changes to it, the Weather place, and the network coming back. */
  init() {
    let last = dependsOn();
    // Only a change to what the theme depends on repaints; an unrelated setting (Motion, the unit) does not.
    prefs.on(() => {
      const key = dependsOn();
      if (key !== last) {
        last = key;
        apply();
      }
    });
    window.addEventListener('online', apply);
    apply();
  },
  current: (): ThemeDef => themeById(prefs.get().theme),
  period: (): Period => periodAt(new Date()),
  phase: (): Phase => currentPhase(new Date()),
  /** What Settings shows: "Midnight", or a Seasonal style with today's period, "Vector art · Halloween". */
  label(): string {
    const t = theme.current();
    return t.group === 'seasonal' ? `${t.name} · ${PERIOD_LABELS[theme.period()]}` : t.name;
  },
  /** Calls `fn` whenever the theme, its period or its backdrop is looked at again; returns a function that stops it. */
  on(fn: () => void): () => void {
    listeners.push(fn);
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  },
};
