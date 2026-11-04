// TEMPORARY port of the Android launcher's weather rules, until weather is shared in @hometv/core: hometv-launcher at
// 2bf3c2d, launcher/app/src/main/java/com/hometv/launcher/Weather.java (the forecast answer, WMO codes, "now") and
// WeatherPlace.java (Open-Meteo's place search), with the words of res/values/strings_home.xml. design_preview's
// weather is a mock (data/places.ts), so the Android launcher is the reference for the real thing. Changes: Java to
// TypeScript for Chromium 56; local times kept as Open-Meteo's "YYYY-MM-DDTHH:MM" strings; the search asks in English
// and Swedish but not yet in the TV's own language (not read on Samsung yet); countries keep Open-Meteo's names except
// a short list named in English by their code (Java's Locale knows every country; Chromium 56 has no Intl.DisplayNames).
// Pure: tests run it in Node with saved answers.

/** A reading at one local time at the place: the current conditions or one hour of the forecast. */
export interface Reading {
  /** The place's wall-clock time, "2026-11-04T21:15". */
  time: string;
  temp: number;
  code: number;
  day: boolean;
}

export interface Day {
  /** "2026-11-04". */
  date: string;
  max: number;
  min: number;
  code: number;
}

export interface Forecast {
  /** The place's offset from UTC, in seconds (Open-Meteo's utc_offset_seconds, with timezone=auto). */
  offset: number;
  current: Reading | null;
  hours: Reading[];
  days: Day[];
}

export type WeatherIcon = 'sun' | 'moon' | 'cloud';

/** How long the current conditions stand in for "now" before the hourly forecast takes over. */
export const CURRENT_VALID_MS = 60 * 60 * 1000;

/** The forecast request; the cache is only used for the same one, so a new place or unit starts fresh. */
export function forecastUrl(latitude: number, longitude: number, fahrenheit: boolean): string {
  return (
    'https://api.open-meteo.com/v1/forecast?latitude=' +
    latitude.toFixed(4) +
    '&longitude=' +
    longitude.toFixed(4) +
    '&current=temperature_2m,weather_code,is_day' +
    '&hourly=temperature_2m,weather_code,is_day' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min' +
    '&timezone=auto&forecast_days=3' +
    (fahrenheit ? '&temperature_unit=fahrenheit' : '')
  );
}

type Json = Record<string, unknown>;
const obj = (x: unknown): Json | null => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Json) : null);
const arr = (x: unknown): unknown[] | null => (Array.isArray(x) ? x : null);
const num = (x: unknown): number | null => (typeof x === 'number' && isFinite(x) ? x : null);
const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A local time string as milliseconds on a UTC clock, to compare and subtract; NaN when it isn't one. */
export function localMs(time: string): number {
  const m = LOCAL_TIME.exec(time);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : NaN;
}

/**
 * An Open-Meteo /v1/forecast answer asked for current temperature_2m, weather_code and is_day; the same hourly; daily
 * weather_code, temperature_2m_max and temperature_2m_min; with timezone=auto. Hours and days with a missing value are
 * skipped; an answer with neither current conditions nor any hour isn't weather (null).
 */
export function parseForecast(text: string): Forecast | null {
  let o: Json | null;
  try {
    o = obj(JSON.parse(text));
  } catch (e) {
    return null;
  }
  if (!o) return null;
  const offset = num(o.utc_offset_seconds) || 0;
  let current: Reading | null = null;
  const c = obj(o.current);
  if (c) {
    const t = num(c.temperature_2m);
    const code = num(c.weather_code);
    if (t !== null && code !== null && typeof c.time === 'string' && LOCAL_TIME.test(c.time)) {
      current = { time: c.time, temp: Math.round(t), code, day: c.is_day !== 0 };
    }
  }
  const hours: Reading[] = [];
  const hr = obj(o.hourly);
  if (hr) {
    const times = arr(hr.time);
    const temps = arr(hr.temperature_2m);
    const codes = arr(hr.weather_code);
    const isDay = arr(hr.is_day);
    const n = times && temps && codes ? Math.min(times.length, temps.length, codes.length) : 0;
    for (let i = 0; i < n; i++) {
      const time = times![i];
      const t = num(temps![i]);
      const code = num(codes![i]);
      if (typeof time !== 'string' || !LOCAL_TIME.test(time) || t === null || code === null) continue;
      hours.push({ time, temp: Math.round(t), code, day: !isDay || i >= isDay.length || isDay[i] !== 0 });
    }
  }
  const days: Day[] = [];
  const d = obj(o.daily);
  if (d) {
    const dates = arr(d.time);
    const max = arr(d.temperature_2m_max);
    const min = arr(d.temperature_2m_min);
    const codes = arr(d.weather_code);
    const n = dates && max && min && codes ? Math.min(dates.length, max.length, min.length, codes.length) : 0;
    for (let i = 0; i < n; i++) {
      const date = dates![i];
      const hi = num(max![i]);
      const lo = num(min![i]);
      const code = num(codes![i]);
      if (typeof date !== 'string' || !LOCAL_DATE.test(date) || hi === null || lo === null || code === null) continue;
      days.push({ date, max: Math.round(hi), min: Math.round(lo), code });
    }
  }
  if (!current && !hours.length) return null;
  return { offset, current, hours, days };
}

/** The place's wall clock at this instant, as milliseconds on a UTC clock (compare with localMs). */
export const placeClock = (f: Forecast, nowMs: number) => nowMs + f.offset * 1000;

/**
 * The conditions now: the current reading while it's under an hour old, else the forecast for this hour. Null when the
 * data no longer covers now (a cache from days ago).
 */
export function nowReading(f: Forecast, nowMs: number): Reading | null {
  const local = placeClock(f, nowMs);
  if (f.current) {
    const age = local - localMs(f.current.time);
    if (age >= 0 && age < CURRENT_VALID_MS) return f.current;
  }
  const hour = Math.floor(local / 3600000) * 3600000;
  for (const r of f.hours) if (localMs(r.time) === hour) return r;
  // A clock behind the data (or data fetched a moment ago, in the same hour) still shows what was fetched.
  if (f.current && local <= localMs(f.current.time)) return f.current;
  return null;
}

/** The forecast for the place's today (0) or tomorrow (1), or null when the data has none. */
export function dayAt(f: Forecast, nowMs: number, ahead = 0): Day | null {
  const d = new Date(placeClock(f, nowMs) + ahead * 86400000);
  const date = d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
  for (const x of f.days) if (x.date === date) return x;
  return null;
}

/** WMO weather interpretation codes (Open-Meteo's weather_code), in the Android launcher's words. */
export function conditionText(code: number): string {
  switch (code) {
    case 0:
      return 'Clear';
    case 1:
      return 'Mainly clear';
    case 2:
      return 'Partly cloudy';
    case 3:
      return 'Overcast';
    case 45:
    case 48:
      return 'Fog';
    case 51:
    case 53:
    case 55:
      return 'Drizzle';
    case 56:
    case 57:
      return 'Freezing drizzle';
    case 61:
    case 63:
    case 65:
      return 'Rain';
    case 66:
    case 67:
      return 'Freezing rain';
    case 71:
    case 73:
    case 75:
      return 'Snow';
    case 77:
      return 'Snow grains';
    case 80:
    case 81:
    case 82:
      return 'Rain showers';
    case 85:
    case 86:
      return 'Snow showers';
    case 95:
      return 'Thunderstorm';
    case 96:
    case 99:
      return 'Thunderstorm with hail';
    default:
      return 'Weather';
  }
}

/** The design's three weather icons: sun or moon for a clear to partly cloudy sky, by day or night; else a cloud. */
export const weatherIcon = (code: number, day: boolean): WeatherIcon => (code >= 0 && code <= 2 ? (day ? 'sun' : 'moon') : 'cloud');

// ---- Places (WeatherPlace.java) ----

export interface Place {
  name: string;
  /** The region (Open-Meteo's admin1), or "" when the answer has none. */
  region: string;
  /** The country, or "" (Open-Meteo leaves it out for places such as Svalbard). */
  country: string;
  latitude: number;
  longitude: number;
}

/** Fewer letters than this match half the world; the search waits for more. */
export const MIN_QUERY = 2;
export const RESULTS = 10;

/** "Västra Götaland, Sweden": the line under the name in the results. */
export const placeDetail = (p: Place) => (!p.region ? p.country : !p.country ? p.region : p.region + ', ' + p.country);

/** "Gothenburg, Sweden": how Settings names the chosen place. */
export const placeLabel = (p: Place) => (p.country ? p.name + ', ' + p.country : p.name);

export const validPosition = (lat: number, lon: number) => isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

/** Whether what was typed is worth a search: at least MIN_QUERY letters once trimmed. */
export const searchable = (typed: string) => typed.trim().length >= MIN_QUERY;

/** The same place: the same name and, to about a kilometre, the same position. */
export const samePlace = (a: Place | null, b: Place | null) =>
  !a || !b
    ? a === b
    : a.name.toLowerCase() === b.name.toLowerCase() && Math.abs(a.latitude - b.latitude) < 0.01 && Math.abs(a.longitude - b.longitude) < 0.01;

/**
 * The search request in one language. Open-Meteo matches names in the language asked for (and returns them in it): in
 * English it finds "Gothenburg" but not "Göteborg", so a search asks in each of searchLanguages.
 */
export function searchUrl(typed: string, language: string): string {
  const lang = (language || '').trim().toLowerCase() || 'en';
  return (
    'https://geocoding-api.open-meteo.com/v1/search?name=' +
    encodeURIComponent(typed.trim()) +
    '&count=' +
    RESULTS +
    '&language=' +
    encodeURIComponent(lang) +
    '&format=json'
  );
}

/**
 * The languages a search asks in: English, then Swedish, as the Android launcher asks (after the TV's own language,
 * which Samsung's page doesn't read yet), so "Göteborg" is found as well as "Gothenburg".
 */
export const SEARCH_LANGUAGES = ['en', 'sv'];

/** Trimmed, lower case and without accents, so "goteborg" names Göteborg exactly. */
export function fold(s: string): string {
  const t = (s || '').trim();
  const plain = typeof t.normalize === 'function' ? t.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : t;
  return plain.toLowerCase();
}

/**
 * English names for the countries a Swedish answer names in Swedish ("Sverige"), by Open-Meteo's country_code, as the
 * Android launcher names them in the TV's language; any other country keeps the answer's name.
 */
const COUNTRIES: Record<string, string> = {
  SE: 'Sweden',
  US: 'United States',
  NO: 'Norway',
  DK: 'Denmark',
  FI: 'Finland',
  IS: 'Iceland',
  GB: 'United Kingdom',
  IE: 'Ireland',
  DE: 'Germany',
  NL: 'Netherlands',
  BE: 'Belgium',
  FR: 'France',
  ES: 'Spain',
  PT: 'Portugal',
  IT: 'Italy',
  AT: 'Austria',
  CH: 'Switzerland',
  PL: 'Poland',
  EE: 'Estonia',
  CA: 'Canada',
  AU: 'Australia',
};

/**
 * The places in a search answer, best match first. An answer with no "results" (nothing matched) is an empty list; a
 * result without a name or a usable position is skipped. Null when the answer isn't one (an error, not JSON).
 */
export function parseSearch(text: string): Place[] | null {
  let o: Json | null;
  try {
    o = obj(JSON.parse(text));
  } catch (e) {
    return null;
  }
  if (!o || o.error) return null;
  const out: Place[] = [];
  const results = arr(o.results);
  if (!results) return out;
  const str = (r: Json, k: string) => (typeof r[k] === 'string' ? (r[k] as string).trim() : '');
  for (const x of results) {
    const r = obj(x);
    if (!r) continue;
    const name = str(r, 'name');
    const lat = num(r.latitude);
    const lon = num(r.longitude);
    if (!name || lat === null || lon === null || !validPosition(lat, lon)) continue;
    out.push({ name, region: str(r, 'admin1'), country: COUNTRIES[str(r, 'country_code').toUpperCase()] || str(r, 'country'), latitude: lat, longitude: lon });
  }
  return out;
}

/**
 * One list from the answers in each language, the first language's first: a place already listed (within about a
 * kilometre, whatever its name in that language) isn't listed again, places named exactly what was typed come first,
 * and there are at most RESULTS. A null answer (that language's search failed) is skipped.
 */
export function mergePlaces(typed: string, answers: (Place[] | null)[]): Place[] {
  const all: Place[] = [];
  for (const answer of answers) {
    if (!answer) continue;
    for (const p of answer) {
      if (!all.some((q) => Math.abs(p.latitude - q.latitude) < 0.01 && Math.abs(p.longitude - q.longitude) < 0.01)) all.push(p);
    }
  }
  const t = fold(typed);
  const exact = all.filter((p) => fold(p.name) === t);
  const rest = all.filter((p) => fold(p.name) !== t);
  return exact.concat(rest).slice(0, RESULTS);
}

/** How many of the name's first letters are what was typed, ignoring case and accents: the highlighted part. */
export function matched(name: string, typed: string): number {
  const t = typed.trim();
  if (!t || name.length < t.length) return 0;
  return fold(name.slice(0, t.length)) === fold(t) ? t.length : 0;
}

/** A saved place, or null when it isn't one (from localStorage, so anything may be there). */
export function readPlace(x: unknown): Place | null {
  const r = obj(x);
  if (!r || typeof r.name !== 'string' || !r.name) return null;
  const lat = num(r.latitude);
  const lon = num(r.longitude);
  if (lat === null || lon === null || !validPosition(lat, lon)) return null;
  const s = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : '');
  return { name: r.name, region: s('region'), country: s('country'), latitude: lat, longitude: lon };
}
