// "Report a problem": a small log of HomeTV's own errors, kept on the TV, and the short report a person reads out,
// photographs, or scans as a QR (screens/report.ts). Nothing is ever sent: no analytics, no upload.
//
// Privacy by allowlist, not blocklist (the idea is AeroTizen's diagnostics-privacy.js, vendor/aerotizen, MIT): an
// entry keeps only the fields in FIELDS, and each field only a value its rule allows: names of error types from a
// list, our own reasons from a list, file names from a list, numbers in range, Home's app keys (public names such as
// "netflix"). An error's message never goes in: it becomes a coarse code ("reference_unavailable"). So no titles, no
// app lists, no IP addresses, no network names, no device ids and no account data can reach the log or the report.
// Pure apart from the storage passed in, so tests run it in Node.

export const LOG_KEY = 'hometv-error-log';
/** Entries kept on the TV, newest last. */
export const LOG_MAX = 40;
/** Entries a report shows. */
export const REPORT_MAX = 12;

/** What went wrong, in words a person reads. */
export const KINDS = {
  error: 'Page error',
  rejection: 'Page error (unhandled)',
  launch_failed: 'An app didn’t open',
  title_failed: 'A title didn’t open in its app',
  fetch_failed: 'Something didn’t download',
  input_failed: 'An input didn’t show',
} as const;
export type ErrorKind = keyof typeof KINDS;

const ERROR_TYPES = ['Error', 'TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'URIError', 'EvalError', 'SecurityError', 'NotFoundError', 'NotSupportedError', 'InvalidValuesError', 'UnknownError', 'TimeoutError', 'NetworkError', 'AbortError', 'QuotaExceededError'];

/** HomeTV's own reasons, word for word as bridge.ts and platform.ts give them. */
const REASONS = [
  'not on this TV',
  'not opened',
  'no service',
  'timed out',
  'no readable answer',
  'the TV refused',
  'it failed to start',
  'the TV couldn’t switch to it',
  'the TV couldn’t show it',
  'the TV didn’t answer',
  'this TV doesn’t let apps show its inputs',
  'offline',
];

/** The coarse codes a free-text message becomes (AeroTizen's errorCode, with a few more). */
const CODES: [RegExp, string][] = [
  [/cannot read|undefined is not an object|null is not an object|of undefined|of null/i, 'property_access_failed'],
  [/is not defined|can't find variable/i, 'reference_unavailable'],
  [/is not a function|not a constructor/i, 'not_a_function'],
  [/unexpected token|syntax/i, 'invalid_syntax'],
  [/timed? ?out|timeout/i, 'timed_out'],
  [/network|failed to fetch|no service|offline|unreachable/i, 'network'],
  [/denied|refused|security|permission|not allowed/i, 'denied'],
  [/not ?found|no such|missing/i, 'not_found'],
  [/quota|storage/i, 'storage'],
];
const CODE_NAMES = CODES.map((c) => c[1]).concat(['detail_omitted']);

/** The page's own script files: anything else is "other". */
const FILES = [
  'app.js',
  'main.ts',
  'aero-glue.js',
  'index.html',
  'boot.js',
  'update.js',
  'config.js',
  'app-catalog.js',
  'app-lookup.js',
  'dom.js',
  'artwork.js',
  'brands.js',
  'homewatch.js',
  'native-navigation.js',
  'apps.js',
];

const WHAT = ['service', 'key page', 'page update', 'weather', 'catalogue', 'posters', 'prices'];
const INPUTS = ['hdmi', 'av', 'tv'];
const MODES = ['app', 'tv', 'fake-tv', 'preview'];

export function codeOf(message: unknown): string {
  const text = typeof message === 'string' ? message.slice(0, 1024) : '';
  if (CODE_NAMES.indexOf(text) >= 0) return text;
  for (const [re, code] of CODES) if (re.test(text)) return code;
  return 'detail_omitted';
}

function fileOf(v: unknown): string {
  if (typeof v !== 'string') return 'other';
  const name = v.split(/[?#]/)[0].split(/[\\/]/).pop() || '';
  return FILES.indexOf(name) >= 0 ? name : 'other';
}

const int = (v: unknown, max: number): number | null => (typeof v === 'number' && isFinite(v) && v >= 0 && v <= max && Math.floor(v) === v ? v : null);
const oneOf = (list: string[], v: unknown): string | null => (typeof v === 'string' && list.indexOf(v) >= 0 ? v : null);

export interface Known {
  /** Home's app keys ("netflix"): public names, kept as they are. Any other app is "other". */
  apps: string[];
}

type Rule = (v: unknown, known: Known) => string | number | null;

/** Every field an entry may hold, and what each may hold. Nothing else is ever kept. */
export const FIELDS: Record<string, Rule> = {
  error: (v) => oneOf(ERROR_TYPES, v) || (v === undefined ? null : 'Error'),
  code: (v) => (v === undefined ? null : codeOf(v)),
  file: (v) => (v === undefined ? null : fileOf(v)),
  line: (v) => int(v, 1e7),
  col: (v) => int(v, 1e7),
  app: (v, known) => (typeof v !== 'string' ? null : known.apps.indexOf(v) >= 0 ? v : 'other'),
  reason: (v) => {
    if (typeof v !== 'string') return null;
    if (REASONS.indexOf(v) >= 0) return v;
    if (/^HTTP [1-5][0-9]{2}$/.test(v)) return v;
    return codeOf(v);
  },
  input: (v) => oneOf(INPUTS, v),
  what: (v) => oneOf(WHAT, v),
  status: (v) => int(v, 599),
  mode: (v) => oneOf(MODES, v),
};
/** The order fields are written in a report. */
const ORDER = ['app', 'input', 'what', 'reason', 'status', 'error', 'code', 'file', 'line', 'col', 'mode'];

export interface LogEntry {
  /** When, to the minute, local time: "2026-11-04 23:40". */
  at: string;
  kind: ErrorKind;
  /** How many times in a row it happened. */
  n: number;
  fields: Record<string, string | number>;
}

const two = (n: number) => (n < 10 ? '0' : '') + n;
export const minuteOf = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;

/** An entry with only what the allowlist keeps, or null for a kind that isn't on the list. */
export function clean(kind: string, data: Record<string, unknown> | null | undefined, known: Known, when: Date): LogEntry | null {
  if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) return null;
  const fields: Record<string, string | number> = {};
  if (data && typeof data === 'object') {
    for (const key of ORDER) {
      if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
      const v = FIELDS[key](data[key], known);
      if (v !== null) fields[key] = v;
    }
  }
  return { at: minuteOf(when), kind: kind as ErrorKind, n: 1, fields };
}

const same = (a: LogEntry, b: LogEntry) => a.kind === b.kind && JSON.stringify(a.fields) === JSON.stringify(b.fields);

/** The log with `e` added: the same problem again just counts up; the oldest go past LOG_MAX. */
export function addEntry(log: LogEntry[], e: LogEntry, max = LOG_MAX): LogEntry[] {
  const last = log[log.length - 1];
  if (last && same(last, e)) return log.slice(0, -1).concat([{ at: e.at, kind: e.kind, n: Math.min(last.n + 1, 9999), fields: last.fields }]);
  return log.concat([e]).slice(-max);
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** The saved log, every entry checked again against the allowlist (storage is the page's, but checked all the same). */
export function loadLog(storage: KeyValueStore | null, known: Known): LogEntry[] {
  try {
    const raw = storage && storage.getItem(LOG_KEY);
    const saved = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(saved)) return [];
    const out: LogEntry[] = [];
    for (const s of saved as Partial<LogEntry>[]) {
      if (!s || typeof s !== 'object' || typeof s.at !== 'string' || !/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(s.at)) continue;
      const e = clean(String(s.kind), (s.fields || {}) as Record<string, unknown>, known, new Date());
      if (!e) continue;
      e.at = s.at;
      e.n = int(s.n, 9999) || 1;
      out.push(e);
    }
    return out.slice(-LOG_MAX);
  } catch (e) {
    return [];
  }
}

export function saveLog(storage: KeyValueStore | null, log: LogEntry[]): void {
  try {
    if (storage) storage.setItem(LOG_KEY, JSON.stringify(log));
  } catch (e) {
    // Full or blocked storage: the log lasts until the page reloads.
  }
}

/** About the page, for the report's first line: each checked the same way. */
export interface About {
  /** 'v0' or 'v1' (features.ts). */
  build: string;
  mode: string;
  /** "Samsung", "Tizen", "5.0". */
  brand: string;
  os: string;
  osVersion: string;
  /** The browser engine's major version, from the user agent. */
  engine: string;
  screen: string;
}

const word = (v: string, re: RegExp) => (re.test(v) ? v : '?');

export function aboutLine(a: About): string {
  return [
    'HomeTV ' + word(a.build, /^v\d$/),
    ({ app: `${word(a.brand, /^[A-Za-z]{2,12}$/)} app`, tv: 'TizenBrew', 'fake-tv': 'Fake TV', preview: 'Preview' } as Record<string, string>)[a.mode] || '?',
    `${word(a.os, /^[A-Za-z]{2,12}$/)} ${word(a.osVersion, /^\d{1,2}(\.\d{1,2}){0,3}$/)}`,
    'Chromium ' + word(a.engine, /^\d{2,3}$/),
    word(a.screen, /^\d{3,4}x\d{3,4}$/),
  ].join(' · ');
}

/** One entry as a line: "23:40 An app didn't open · app netflix · reason not on this TV (3 times)". */
export function entryLine(e: LogEntry): string {
  const parts = [`${e.at.slice(11)} ${KINDS[e.kind]}`];
  for (const key of ORDER) if (Object.prototype.hasOwnProperty.call(e.fields, key)) parts.push(`${key} ${e.fields[key]}`);
  return parts.join(' · ') + (e.n > 1 ? ` (${e.n} times)` : '');
}

/** The short report: what HomeTV runs on, then the newest entries first. */
export function reportText(log: LogEntry[], about: About, made: Date, max = REPORT_MAX): string {
  const lines = ['HomeTV problem report', aboutLine(about), `Made ${minuteOf(made)}. Kept on the TV; nothing is sent.`];
  if (!log.length) {
    lines.push('No problems noted.');
    return lines.join('\n');
  }
  const shown = log.slice(-max).reverse();
  lines.push(log.length > shown.length ? `The last ${shown.length} of ${log.length} problems, newest first:` : `${log.length} problem${log.length === 1 ? '' : 's'}, newest first:`);
  let day = '';
  for (const e of shown) {
    if (e.at.slice(0, 10) !== day) {
      day = e.at.slice(0, 10);
      lines.push(day);
    }
    lines.push(entryLine(e));
  }
  return lines.join('\n');
}
