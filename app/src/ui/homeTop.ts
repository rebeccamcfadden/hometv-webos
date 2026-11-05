// Home's top bar, as design_preview's Home has it (screens/home.ts at 2bf3c2d: the greeting and date on the left, the
// clock with the weather under it on the right), in Samsung's Home layout. The weather is the place's conditions now
// and its temperature, from Open-Meteo (weather/homeWeather.ts); offline it shows the saved answer with how old it is,
// and nothing when there is none or no place is chosen. Nothing here waits on the network.

import { bridge } from '../bridge';
import { ago, dateLine, greeting, timeParts, use24 } from '../clockText';
import { prefs } from '../launcherSettings';
import { h, replace } from '../shell/dom';
import { shell } from '../shell/app';
import { conditionText, nowReading, weatherIcon } from '../weather/openMeteo';
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

/** Every top bar drawn; one timer keeps those on the page current. A bar Home has replaced is dropped. */
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

/** The weather line: "☁ 12° Partly cloudy · Gothenburg", or empty. */
function weatherLine(): HTMLElement | null {
  const p = prefs.get();
  const shown = weather.current();
  if (!p.place || !shown) return null;
  const now = Date.now();
  const r = nowReading(shown.forecast, now);
  if (!r) return null;
  const offline = !bridge.platform.online();
  return h(
    'div.ht-weather',
    h('span.ht-wicon', { html: icon(weatherIcon(r.code, r.day), 30) }),
    h('span.ht-temp', `${r.temp}°`),
    h('span.ht-desc', conditionText(r.code)),
    h('span.ht-place', p.place.name),
    offline ? h('span.ht-stale', `Offline · updated ${ago(shown.fetchedAt, now)}`) : null,
  );
}

export function homeTop(): HTMLElement {
  const hello = h('div.ht-greeting');
  const date = h('div.ht-date');
  const time = h('span.ht-time');
  const ampm = h('span.ht-ampm');
  const wx = h('div.ht-wx');
  const right = h('div.topright', h('span.pill.' + bridge.mode(), MODE_TEXT[bridge.mode()]), h('div.ht-clock', h('div', time, ampm), wx));
  // The TV's problem line sits under the date, in the flow, so the taller Home top bar never covers it.
  const problem = bridge.problem() ? h('div.problem', 'TV: ' + bridge.problem()) : null;
  const el = h('div.topbar.home-top', h('div.ht-hello', hello, date, problem), right);

  const painter: Painter = {
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
      replace(wx, weatherLine());
    },
  };
  painter.paintClock();
  painter.paintWeather();
  painters.push(painter);
  if (!timer) timer = window.setInterval(tick, 15000);
  return el;
}
