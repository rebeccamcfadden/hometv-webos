// Home's hero and weather card, as design_preview's Home has them (screens/home.ts at 2bf3c2d, "home-hero" and "weather"):
// the greeting and date on the left, the clock on the right with the forecast under it (Today · max | Tomorrow · max), and,
// below the rows, the weather card: the place, its temperature now and the next hours. The weather is Open-Meteo's for
// the place chosen in Settings (weather/homeWeather.ts); offline it shows the saved answer with how old it is, and
// nothing when there is none or no place is chosen. Nothing here waits on the network.

import { bridge } from '../bridge';
import { ago, dateLine, greeting, timeParts, use24 } from '../clockText';
import { prefs } from '../launcherSettings';
import { h, replace } from '../shell/dom';
import { shell } from '../shell/app';
import { conditionText, dayAt, localMs, nowReading, placeClock, weatherIcon, type Forecast, type Reading } from '../weather/openMeteo';
import { weather } from '../weather/homeWeather';
import { icon } from './icons';
import './homeTop.css';

const MODE_TEXT = {
  app: `${bridge.platform.brand} app`,
  tv: 'On the TV (TizenBrew)',
  'fake-tv': 'Fake TV on this PC',
  preview: 'Preview: no TV, apps don’t open',
};

interface Painter {
  el: HTMLElement;
  paintClock(): void;
  paintWeather(): void;
}

/** Every piece drawn; one timer keeps those on the page current. A piece Home has replaced is dropped. */
let painters: Painter[] = [];
let timer = 0;

function tick() {
  painters = painters.filter((p) => !!p.el.parentNode);
  const shown = painters.filter((p) => document.body.contains(p.el));
  shown.forEach((p) => {
    p.paintClock();
    // The hour moves on, and the TV may have gone offline.
    p.paintWeather();
  });
  // Cheap: it asks Open-Meteo only when the answer is over 30 minutes old (or 2 minutes after a failed try).
  if (shown.length) weather.refresh();
}

weather.on(() => painters.forEach((p) => p.paintWeather()));
prefs.on(() => painters.forEach((p) => p.paintWeather()));
// Home came back into view: the clock at once, and a fresh forecast if the saved one is stale.
shell.onChange(tick);

function register(p: Painter) {
  p.paintClock();
  p.paintWeather();
  painters.push(p);
  if (!timer) timer = window.setInterval(tick, 15000);
}

/** "Today · 11°  |  Tomorrow · 9°", with what is known; null when nothing is. */
function forecastLine(f: Forecast, now: number): HTMLElement | null {
  const parts: HTMLElement[] = [];
  const day = (label: string, ahead: number) => {
    const d = dayAt(f, now, ahead);
    if (!d) return;
    if (parts.length) parts.push(h('span.sep'));
    parts.push(h('span', { html: icon(weatherIcon(d.code, true), 24) }), h('span.ht-fday', `${label} · ${d.max}°`));
  };
  day('Today', 0);
  day('Tomorrow', 1);
  return parts.length ? h('div.home-forecast', parts) : null;
}

/** The greeting and date, and the clock with the forecast, over the picture at the middle of Home. */
export function homeHero(): HTMLElement {
  const hello = h('div.ht-greeting');
  const date = h('div.ht-date');
  const time = h('span.ht-time');
  const ampm = h('span.ht-ampm');
  const wx = h('div.ht-wx');
  const right = h('div.home-clock', h('span.pill.' + bridge.mode(), MODE_TEXT[bridge.mode()]), h('div', time, ampm), wx);
  // The TV's problem line sits under the date, in the flow, and the block grows upward from the date.
  const problem = bridge.problem() ? h('div.problem', 'TV: ' + bridge.problem()) : null;
  const el = h('div.home-hero', h('div.home-hello', hello, date, problem), right);
  register({
    el,
    paintClock() {
      const c = bridge.platform.clock();
      hello.textContent = greeting(c.hours);
      date.textContent = dateLine(c);
      const t = timeParts(c.hours, c.minutes, use24(c.hour24, prefs.get().region));
      time.textContent = t.time;
      ampm.textContent = t.ampm;
    },
    paintWeather() {
      const shown = weather.current();
      replace(wx, prefs.get().place && shown ? forecastLine(shown.forecast, Date.now()) : null);
    },
  });
  return el;
}

/** The next hours from this one, at the place, for the card's strip. */
function nextHours(f: Forecast, now: number, count: number): Reading[] {
  const start = Math.floor(placeClock(f, now) / 3600000) * 3600000;
  return f.hours.filter((r) => localMs(r.time) >= start).slice(0, count);
}

/** "9 PM", or "21:00" on a 24-hour clock. */
function hourLabel(time: string, hour24: boolean): string {
  const hr = parseInt(time.slice(11, 13), 10);
  if (hour24) return `${('0' + hr).slice(-2)}:00`;
  return `${hr % 12 === 0 ? 12 : hr % 12} ${hr < 12 ? 'AM' : 'PM'}`;
}

/**
 * The weather card under Inputs and Shortcuts: hidden until a place is chosen and a forecast has arrived. `card` is the
 * focusable element Home made for it (OK opens Settings › Weather: HomeTV has no forecast page of its own).
 */
export function weatherCard(card: HTMLElement): HTMLElement {
  const paint = () => {
    const p = prefs.get().place;
    const shown = weather.current();
    const now = Date.now();
    const r = p && shown ? nowReading(shown.forecast, now) : null;
    card.style.display = r ? '' : 'none';
    if (!p || !shown || !r) return;
    const today = dayAt(shown.forecast, now, 0);
    const offline = !bridge.platform.online();
    const c = bridge.platform.clock();
    const hour24 = use24(c.hour24, prefs.get().region);
    const hours = nextHours(shown.forecast, now, 6);
    const high = today ? ` · H:${today.max}° L:${today.min}°` : '';
    replace(
      card,
      h(
        'div.weather-now',
        h('div.weather-label', p.name),
        h('div.weather-temp', `${r.temp}°`),
        offline ? h('div.weather-desc.weather-stale', `Offline · updated ${ago(shown.fetchedAt, now)}`) : h('div.weather-desc', `${conditionText(r.code)}${high}`),
      ),
      hours.length > 1
        ? h(
            'div.weather-hours',
            hours.map((x) => h('div.weather-hour', h('div', hourLabel(x.time, hour24)), h('span', { html: icon(weatherIcon(x.code, x.day), 24) }), h('b', `${x.temp}°`))),
          )
        : null,
    );
  };
  register({ el: card, paintClock() {}, paintWeather: paint });
  return card;
}
