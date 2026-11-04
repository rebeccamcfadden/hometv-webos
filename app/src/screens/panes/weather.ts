// Settings › Weather and first run's Weather step, from design_preview's screens/panes/weather.ts at 2bf3c2d (V2 design
// r2-weather A): the place now showing with its weather, Change city, and the unit. Change city is a sub-state: the
// 6×6 keyboard and the matches inside the pane; with nothing typed it shows the place now showing and quick picks (the
// places chosen before). Back leaves the sub-state. Changes from design_preview: the matches come from Open-Meteo's
// place search (the Android launcher's WeatherPlace), not a mock list; there is no default place (no sample data in
// v0), so no "Use default"; the unit's third choice follows HomeTV's region rather than the TV's.
import { bridge } from '../../bridge';
import { fahrenheit, prefs, UNIT_LABELS, withPlace, type Unit } from '../../launcherSettings';
import { getText } from '../../net';
import { shell } from '../../shell/app';
import { h, replace } from '../../shell/dom';
import { focusable } from '../../shell/focus';
import { icon } from '../../ui/icons';
import { segmented } from '../../ui/segmented';
import { button } from '../../ui/widgets';
import { conditionText, matched, mergePlaces, nowReading, parseSearch, placeDetail, samePlace, searchable, searchUrl, SEARCH_LANGUAGES, type Place } from '../../weather/openMeteo';
import { weather } from '../../weather/homeWeather';
import type { Pane, PaneHost } from './pane';

const KEY_ROWS = ['abcdef', 'ghijkl', 'mnopqr', 'stuvwx', 'yz1234', '567890'];
const TYPEABLE = /^[a-zåäöéüæø0-9 '\-]$/i;
/** Wait this long after the last letter before asking Open-Meteo, so typing a name sends one search, not one a letter. */
const SEARCH_DELAY_MS = 450;

type Found = { state: 'idle' } | { state: 'searching' } | { state: 'failed' } | { state: 'done'; places: Place[] };

export function weatherPane(host: PaneHost): Pane {
  let changing = false;
  let query = '';
  let found: Found = { state: 'idle' };
  let seq = 0;
  let timer = 0;

  const choose = (p: Place) => {
    prefs.set(withPlace(prefs.get(), p));
    changing = false;
    query = '';
    found = { state: 'idle' };
    host.rerender();
    host.focusKey('w-change');
  };

  function search() {
    const q = query.trim();
    const mine = ++seq;
    window.clearTimeout(timer);
    if (!searchable(q) || !bridge.platform.online()) {
      found = { state: 'idle' };
      return;
    }
    found = { state: 'searching' };
    timer = window.setTimeout(() => {
      Promise.all(SEARCH_LANGUAGES.map((lang) => getText(searchUrl(q, lang)).then((t) => (t ? parseSearch(t) : null)))).then((answers) => {
        if (mine !== seq) return;
        found = answers.every((a) => a === null) ? { state: 'failed' } : { state: 'done', places: mergePlaces(q, answers) };
        paintSearch();
      });
    }, SEARCH_DELAY_MS);
  }

  const setQuery = (q: string) => {
    query = q.replace(/^\s+/, '').replace(/\s{2,}/g, ' ');
    search();
    paintSearch();
  };

  const summary = () => {
    const p = prefs.get();
    const place = p.place;
    const shown = place ? weather.current() : null;
    const r = shown ? nowReading(shown.forecast, Date.now()) : null;
    const change = button(place ? 'Change city' : 'Choose a city', {
      icon: 'search',
      key: 'w-change',
      onOk: () => {
        changing = true;
        query = '';
        found = { state: 'idle' };
        host.rerender();
        host.focusKey('wk-a');
      },
    });
    change.setAttribute('data-entry', '');
    return [
      h('div.eyebrow', 'Weather'),
      h('div.pane-title', 'Weather on Home'),
      place
        ? h(
            'div.place',
            h('span.place-pin', { html: icon('pin', 30) }),
            h('div', h('div.nm', place.name), h('div.rg', placeDetail(place))),
            h('div.now', r ? [h('b', `${r.temp}°`), h('div', conditionText(r.code))] : h('div', bridge.platform.online() ? 'Getting the weather…' : 'Unavailable offline')),
          )
        : h('div.place.place--none', h('span.place-pin', { html: icon('pin', 30) }), h('div', h('div.nm', 'No place yet'), h('div.rg', 'Home shows no weather until you choose one.'))),
      h('div.wrow', h('div', h('div.k', 'Place'), h('div.s', 'The weather under Home’s clock')), h('div.wrow-ctl', change)),
      h(
        'div.wrow',
        h('div', h('div.k', 'Temperature'), h('div.s', `Now in ${fahrenheit(p) ? '°F' : '°C'}. Region’s follows Settings › Region.`)),
        segmented<Unit>({
          options: (['c', 'f', 'region'] as Unit[]).map((u): [Unit, string] => [u, UNIT_LABELS(p)[u]]),
          get: () => prefs.get().unit,
          set: (unit) => prefs.set({ unit }),
          group: 'w-unit',
        }),
      ),
      h('div.pane-note', 'Forecasts from Open-Meteo. Only the place name you type, and then the chosen place’s position, are sent.'),
    ];
  };

  // ---- Change city ----
  const typed = h('span.sb-typed');
  const ghost = h('span.sb-ghost');
  const results = h('div.w-results');

  const key = (label: string, onOk: () => void, cls = '') =>
    focusable(h('div.wkb-key' + cls, label), { group: 'wkb', key: `wk-${label}`, isDefault: label === 'a', onOk });
  const keyboard = () =>
    h(
      'div.wkb-pad',
      h(
        'div.wkb',
        KEY_ROWS.map((row) => h('div.wkb-row', row.split('').map((c) => key(c, () => setQuery(query + c))))),
        h(
          'div.wkb-row',
          key('Space', () => setQuery(query + ' '), '.wkb-key--space'),
          focusable(h('div.wkb-key', { html: icon('backspace', 26) }), { group: 'wkb', key: 'wk-del', onOk: () => setQuery(query.slice(0, -1)) }),
          key('Clear', () => setQuery(''), '.wkb-key--clear'),
        ),
      ),
    );

  const res = (p: Place, k: string, opts: { cur?: boolean; line?: string } = {}) => {
    const n = query ? matched(p.name, query) : 0;
    const name = n ? [h('span.hl', p.name.slice(0, n)), p.name.slice(n)] : p.name;
    return focusable(
      h('div.res' + (opts.cur ? '.is-cur' : ''), h('span.pin', { html: icon('pin', 26) }), h('div', h('div.nm', name), h('div.rg', opts.line || placeDetail(p)))),
      { group: 'wres', key: k, onOk: () => choose(p) },
    );
  };

  function paintSearch() {
    typed.classList.toggle('is-placeholder', !query);
    replace(typed, query || 'Type a city');
    const p = prefs.get();
    const picks = p.recentPlaces.filter((x) => !samePlace(x, p.place));
    const quick = picks.length
      ? [h('div.sp-head.sp-head--gap', 'Quick picks'), h('div.res-list', picks.map((x, i) => res(x, `wr-recent-${i}`, { line: `Recent · ${placeDetail(x)}` })))]
      : null;
    const top = found.state === 'done' ? found.places[0] : undefined;
    const n = top ? matched(top.name, query) : 0;
    replace(ghost, top && n === query.length && n < top.name.length ? top.name.slice(n).toLowerCase() : '');
    if (!query) {
      replace(
        results,
        p.place ? [h('div.sp-head', 'Now showing'), h('div.res-list', res(p.place, 'wr-now', { cur: true }))] : h('div.tip', 'Type the first letters of a city or town.'),
        quick,
      );
    } else if (!bridge.platform.online()) {
      replace(
        results,
        h('div.offline-pill', h('span', { html: icon('wifiOff', 24) }), 'Offline'),
        h('div.tip', 'Finding a city needs the internet. The quick picks work offline.'),
        quick,
      );
    } else if (!searchable(query)) {
      replace(results, h('div.tip', 'Keep typing: two letters or more.'), quick);
    } else if (found.state === 'searching' || found.state === 'idle') {
      replace(results, h('div.sp-head', 'Searching…'));
    } else if (found.state === 'failed') {
      replace(results, h('div.sp-head', 'Couldn’t search'), h('div.tip', 'Open-Meteo didn’t answer. Try again in a moment.'), quick);
    } else if (!found.places.length) {
      replace(results, h('div.sp-head', 'No places'), h('div.tip', `Nothing called “${query}”. Try fewer letters, or the English name.`));
    } else {
      const places = found.places;
      replace(
        results,
        h('div.sp-head', `${places.length} place${places.length === 1 ? '' : 's'}`),
        h('div.res-list', places.map((x, i) => res(x, `wr-${i}`, { cur: samePlace(x, p.place) }))),
      );
    }
    shell.refocus();
  }

  const change = () => {
    paintSearch();
    return [
      h('div.crumb', h('span', { html: icon('back', 20) }), 'Weather · ' + (prefs.get().place ? 'Change city' : 'Choose a city')),
      h('div.qbar', h('span', { html: icon('search', 28) }), typed, ghost),
      h('div.w-change', keyboard(), results),
    ];
  };

  return {
    render: () => (changing ? change() : summary()),
    back() {
      if (!changing) return false;
      changing = false;
      query = '';
      seq++;
      window.clearTimeout(timer);
      found = { state: 'idle' };
      host.rerender();
      host.focusKey('w-change');
      return true;
    },
    onText(ch) {
      if (!changing || !TYPEABLE.test(ch)) return false;
      setQuery(query + ch.toLowerCase());
      return true;
    },
  };
}
