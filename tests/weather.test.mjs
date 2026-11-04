// Home's weather, run as TypeScript by Node: Open-Meteo's forecast and place search answers (saved in tests/fixtures,
// fetched from api.open-meteo.com and geocoding-api.open-meteo.com for Gothenburg), what "now" shows, and the store's
// cache: shown at once, fetched only when over 30 minutes old, nothing asked offline, an old answer for another place
// ignored (app/src/weather/). `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadTs } from './ts-module.mjs';

const { m, s } = await loadTs({ m: 'weather/openMeteo.ts', s: 'weather/weatherStore.ts' });
const fixture = (name) => fs.readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8');
const FORECAST = fixture('open-meteo-forecast.json');
const SEARCH_EN = fixture('open-meteo-search-en.json');
const SEARCH_SV = fixture('open-meteo-search-sv.json');

/** 23:40 in Gothenburg (UTC+1) on the fixture's day: ten minutes after its current reading. */
const NOW = Date.UTC(2026, 10, 4, 22, 40);

test('the forecast answer: current conditions, 72 hours and 3 days, in the place’s own time', () => {
  const f = m.parseForecast(FORECAST);
  assert.equal(f.offset, 3600);
  assert.deepEqual(f.current, { time: '2026-11-04T23:30', temp: 8, code: 1, day: false });
  assert.equal(f.hours.length, 72);
  assert.deepEqual(f.hours[23], { time: '2026-11-04T23:00', temp: 8, code: 1, day: false });
  assert.deepEqual(f.days[0], { date: '2026-11-04', max: 10, min: 2, code: 3 });
});

test('now: the current reading while under an hour old, then the hour’s forecast, then nothing', () => {
  const f = m.parseForecast(FORECAST);
  assert.equal(m.nowReading(f, NOW), f.current);
  // Two hours later the current reading is too old: 01:00 on the 5th from the hourly forecast.
  const later = m.nowReading(f, NOW + 2 * 3600000);
  assert.equal(later.time, '2026-11-05T01:00');
  // A cache from a week ago covers no hour of now.
  assert.equal(m.nowReading(f, NOW + 7 * 86400000), null);
  assert.equal(m.dayAt(f, NOW).date, '2026-11-04');
  assert.equal(m.dayAt(f, NOW, 1).date, '2026-11-05');
});

test('WMO codes as the Android launcher words them, and the design’s three icons', () => {
  assert.equal(m.conditionText(1), 'Mainly clear');
  assert.equal(m.conditionText(63), 'Rain');
  assert.equal(m.conditionText(99), 'Thunderstorm with hail');
  assert.equal(m.conditionText(42), 'Weather');
  assert.equal(m.weatherIcon(1, true), 'sun');
  assert.equal(m.weatherIcon(2, false), 'moon');
  assert.equal(m.weatherIcon(61, true), 'cloud');
});

test('answers that aren’t weather', () => {
  assert.equal(m.parseForecast('not json'), null);
  assert.equal(m.parseForecast('{"error":true,"reason":"bad"}'), null);
  // Missing values are skipped, not shown as 0°.
  const f = m.parseForecast(
    JSON.stringify({ hourly: { time: ['2026-11-04T10:00', '2026-11-04T11:00'], temperature_2m: [null, 4.4], weather_code: [3, 3] } }),
  );
  assert.deepEqual(f.hours, [{ time: '2026-11-04T11:00', temp: 4, code: 3, day: true }]);
  assert.equal(f.current, null);
});

test('the requests go only to Open-Meteo’s public endpoints, with what was typed or the place’s position', () => {
  assert.equal(
    m.forecastUrl(57.70716, 11.96679, true),
    'https://api.open-meteo.com/v1/forecast?latitude=57.7072&longitude=11.9668&current=temperature_2m,weather_code,is_day' +
      '&hourly=temperature_2m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=3' +
      '&temperature_unit=fahrenheit',
  );
  assert.equal(m.searchUrl(' Göteborg ', 'sv'), 'https://geocoding-api.open-meteo.com/v1/search?name=G%C3%B6teborg&count=10&language=sv&format=json');
  assert.deepEqual(m.SEARCH_LANGUAGES, ['en', 'sv']);
});

test('place search: English and Swedish answers in one list, the same place once, exact names first', () => {
  const en = m.parseSearch(SEARCH_EN);
  const sv = m.parseSearch(SEARCH_SV);
  assert.deepEqual(en[0], { name: 'Gothenburg', region: 'Västra Götaland County', country: 'Sweden', latitude: 57.70716, longitude: 11.96679 });
  const merged = m.mergePlaces('gothenburg', [en, sv]);
  assert.deepEqual(
    merged.map((p) => `${p.name}, ${p.country}`),
    ['Gothenburg, Sweden', 'Gothenburg, United States', 'Gothenburg City Airport, Sweden', 'Gothenburg Diversion Dam, United States', 'Gothenburg-Landvetter Airport, Sweden'],
  );
  // Typed in Swedish, without the accent: Göteborg is the exact match, so first, though English answered first. Its
  // country is named in English from its code ("Sverige" in the Swedish answer).
  const typedSv = m.mergePlaces('goteborg', [[], sv]);
  assert.equal(typedSv[0].name, 'Göteborg');
  assert.equal(typedSv[0].country, 'Sweden');
  // A failed language is skipped; nothing matched is an empty list; an error answer isn't one.
  assert.equal(m.mergePlaces('gothenburg', [null, sv]).length, 5);
  assert.deepEqual(m.parseSearch('{"generationtime_ms":0.1}'), []);
  assert.equal(m.parseSearch('{"error":true,"reason":"bad"}'), null);
  assert.equal(m.placeDetail(en[0]), 'Västra Götaland County, Sweden');
  assert.equal(m.placeLabel(en[0]), 'Gothenburg, Sweden');
  assert.equal(m.matched('Göteborg', 'gote'), 4);
  assert.equal(m.searchable(' g '), false);
  assert.equal(m.searchable('go'), true);
});

/** localStorage's two calls, over a Map. */
const memory = () => {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map };
};

/** A store with a fake network: each request waits until the test answers it. */
function harness({ online = true, storage = memory() } = {}) {
  const asked = [];
  const env = { now: NOW, online };
  const store = s.createWeather({
    storage,
    get: (url) => new Promise((resolve) => asked.push({ url, resolve })),
    now: () => env.now,
    online: () => env.online,
  });
  return { store, asked, env, storage };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const URL_A = m.forecastUrl(57.70716, 11.96679, false);
const URL_B = m.forecastUrl(40.92945, -100.16068, true);

test('a fresh answer is fetched, shown and saved; within 30 minutes nothing is asked again', async () => {
  const { store, asked, env, storage } = harness();
  let told = 0;
  store.on(() => told++);
  store.use(URL_A);
  assert.equal(store.current(), null);
  store.refresh();
  store.refresh();
  assert.equal(asked.length, 1, 'one request at a time');
  assert.equal(asked[0].url, URL_A);
  asked[0].resolve(FORECAST);
  await tick();
  assert.equal(store.current().forecast.current.temp, 8);
  assert.equal(store.current().fetchedAt, NOW);
  assert.ok(told >= 1);
  assert.equal(JSON.parse(storage.map.get(s.WEATHER_CACHE_KEY)).query, URL_A);
  env.now += 29 * 60000;
  store.refresh();
  assert.equal(asked.length, 1);
  env.now += 2 * 60000;
  store.refresh();
  assert.equal(asked.length, 2, 'over 30 minutes old: asked again');
});

test('the saved answer shows at once after a restart, and offline nothing is asked', async () => {
  const first = harness();
  first.store.use(URL_A);
  first.store.refresh();
  first.asked[0].resolve(FORECAST);
  await tick();
  const again = harness({ online: false, storage: first.storage });
  again.env.now = NOW + 3 * 3600000;
  again.store.use(URL_A);
  assert.equal(again.store.current().fetchedAt, NOW, 'the last answer, with when it was fetched');
  again.store.refresh();
  assert.equal(again.asked.length, 0);
  // Another place has no saved answer: no weather until it's fetched.
  again.store.use(URL_B);
  assert.equal(again.store.current(), null);
});

test('a failed fetch keeps what was shown and isn’t retried for 2 minutes, unless the network comes back', async () => {
  const { store, asked, env } = harness();
  store.use(URL_A);
  store.refresh();
  asked[0].resolve(null);
  await tick();
  assert.equal(store.current(), null);
  env.now += 60000;
  store.refresh();
  assert.equal(asked.length, 1);
  store.retry();
  assert.equal(asked.length, 2);
  asked[1].resolve('{"error":true}');
  await tick();
  env.now += 2 * 60000 + 1;
  store.refresh();
  assert.equal(asked.length, 3);
});

test('an answer for a place no longer chosen is dropped, and the new place is asked for', async () => {
  const { store, asked } = harness();
  store.use(URL_A);
  store.refresh();
  store.use(URL_B);
  store.refresh();
  assert.equal(asked.length, 2);
  asked[0].resolve(FORECAST);
  await tick();
  assert.equal(store.current(), null, 'not the old place’s weather');
  asked[1].resolve(FORECAST);
  await tick();
  assert.ok(store.current());
  store.use(null);
  assert.equal(store.current(), null, 'no place, no weather');
});
