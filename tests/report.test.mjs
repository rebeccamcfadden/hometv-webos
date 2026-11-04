// The problem report's privacy (app/src/report.ts): the log keeps only the allowlisted fields, each only a value its
// rule allows, so nothing a person or household could be known by (titles, app lists, addresses, network names,
// device ids, accounts) can reach the TV's log, the report or its QR. `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { addEntry, clean, codeOf, entryLine, FIELDS, KINDS, LOG_KEY, LOG_MAX, loadLog, reportText, saveLog } from '../app/src/report.ts';

const known = { apps: ['netflix', 'youtube', 'prime'] };
const when = new Date(2026, 10, 4, 23, 40);
const about = { build: 'v0', mode: 'app', brand: 'Samsung', os: 'Tizen', osVersion: '5.0', engine: '56', screen: '1920x1080' };

/** Things that must never get into the log, whatever field or kind they come in. */
const POISON = [
  '192.168.1.50',
  'http://192.168.1.50:8766/report',
  'fe80::1',
  'someone@example.com',
  'MyHomeWiFi-5G',
  'Severance S01E03',
  'Knives Out',
  'SERIAL-R2D2C3PO-0042',
  'duid:7f3c2a9e',
  'AA:BB:CC:DD:EE:FF',
  'token=abc123secret',
  'FakeTwtch1.Twitch',
  'app:FakeTwtch1.Twitch',
  'Cannot read property of undefined at http://192.168.1.50/app.js',
  'x'.repeat(5000),
];

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), raw: m };
};

/** Every value a rule may give, for a field. */
function allowed(key, v) {
  const rule = FIELDS[key];
  assert.ok(rule, `field ${key} is not on the allowlist`);
  if (key === 'line' || key === 'col') return typeof v === 'number';
  if (key === 'status') return typeof v === 'number' && v <= 599;
  return typeof v === 'string' && v.length <= 60;
}

test('only allowlisted fields, with allowed values: poison in every field and in extra fields never gets in', () => {
  const s = memory();
  let log = [];
  const keys = Object.keys(FIELDS).concat(['title', 'ssid', 'ip', 'name', 'account', 'email', 'deviceId', 'message', 'stack', 'url', 'apps']);
  for (const kind of Object.keys(KINDS)) {
    for (const p of POISON) {
      const data = {};
      for (const k of keys) data[k] = p;
      const e = clean(kind, data, known, when);
      assert.ok(e);
      for (const [k, v] of Object.entries(e.fields)) assert.ok(allowed(k, v), `${kind}.${k} = ${String(v).slice(0, 40)}`);
      log = addEntry(log, e);
    }
  }
  saveLog(s, log);
  const stored = s.raw.get(LOG_KEY);
  const report = reportText(loadLog(s, known), about, when, 100);
  for (const p of POISON) {
    // A poison string may only show up as a whole allowed word that happens to be inside it ("app" in an id): check
    // the risky parts directly.
    for (const bit of ['192.168', 'fe80::', '@example', 'MyHomeWiFi', 'Severance', 'Knives', 'SERIAL', 'duid', 'AA:BB', 'abc123secret', 'Twtch', 'xxxxxxxx']) {
      assert.ok(!stored.includes(bit), `stored: ${bit} (from ${p.slice(0, 30)})`);
      assert.ok(!report.includes(bit), `report: ${bit}`);
    }
  }
});

test('the fields an entry keeps, and what each becomes', () => {
  const e = clean(
    'launch_failed',
    { app: 'netflix', reason: 'not on this TV', mode: 'app', status: 404, line: 12, extra: 'dropped', title: 'Knives Out' },
    known,
    when,
  );
  assert.deepEqual(e, { at: '2026-11-04 23:40', kind: 'launch_failed', n: 1, fields: { app: 'netflix', reason: 'not on this TV', status: 404, line: 12, mode: 'app' } });
  assert.equal(clean('launch_failed', { app: 'app:FakeTwtch1.Twitch' }, known, when).fields.app, 'other', 'an app not on Home’s list is just "other"');
  assert.equal(clean('error', { file: 'http://192.168.1.50:5180/dist/assets/app.js?v=2' }, known, when).fields.file, 'app.js');
  assert.equal(clean('error', { file: 'file:///opt/usr/home/owner/secret.js' }, known, when).fields.file, 'other');
  assert.equal(clean('error', { error: 'TypeError', code: "Cannot read property 'x' of undefined" }, known, when).fields.code, 'property_access_failed');
  assert.equal(clean('error', { error: 'WeirdError: 192.168.1.50' }, known, when).fields.error, 'Error');
  assert.equal(clean('fetch_failed', { what: 'service', reason: 'HTTP 503', status: 503 }, known, when).fields.reason, 'HTTP 503');
  assert.equal(clean('fetch_failed', { what: 'somewhere else' }, known, when).fields.what, undefined);
  assert.equal(clean('fetch_failed', { status: 1e6, line: -1, col: 1.5 }, known, when).fields.status, undefined);
  assert.equal(clean('input_failed', { input: 'hdmi', reason: 'the TV couldn’t show it' }, known, when).fields.reason, 'the TV couldn’t show it');
  assert.equal(clean('telemetry', { app: 'netflix' }, known, when), null, 'a kind that isn’t on the list');
  assert.equal(codeOf('ReferenceError: foo is not defined'), 'reference_unavailable');
  assert.equal(codeOf('Knives Out failed at 192.168.1.50'), 'detail_omitted');
});

test('the same problem again counts up; the log keeps the newest LOG_MAX', () => {
  let log = [];
  const e = clean('launch_failed', { app: 'netflix', reason: 'not on this TV' }, known, when);
  log = addEntry(addEntry(addEntry(log, e), e), e);
  assert.equal(log.length, 1);
  assert.equal(log[0].n, 3);
  assert.match(entryLine(log[0]), /^23:40 An app didn’t open · app netflix · reason not on this TV \(3 times\)$/);
  for (let i = 0; i < LOG_MAX + 10; i++) log = addEntry(log, clean('error', { line: i }, known, when));
  assert.equal(log.length, LOG_MAX);
  assert.equal(log[log.length - 1].fields.line, LOG_MAX + 9);
});

test('a saved log is checked again on the way in', () => {
  const s = memory();
  s.setItem(
    LOG_KEY,
    JSON.stringify([
      { at: '2026-11-04 23:40', kind: 'launch_failed', n: 2, fields: { app: 'netflix', ssid: 'MyHomeWiFi', reason: 'Knives Out' } },
      { at: 'yesterday', kind: 'error', n: 1, fields: {} },
      { at: '2026-11-04 23:41', kind: 'upload', n: 1, fields: {} },
      null,
    ]),
  );
  const log = loadLog(s, known);
  assert.deepEqual(log, [{ at: '2026-11-04 23:40', kind: 'launch_failed', n: 2, fields: { app: 'netflix', reason: 'detail_omitted' } }]);
  s.setItem(LOG_KEY, '{nope');
  assert.deepEqual(loadLog(s, known), []);
  assert.deepEqual(loadLog(null, known), []);
});

test('the report: what HomeTV runs on, newest first, and nothing sent', () => {
  let log = [];
  log = addEntry(log, clean('fetch_failed', { what: 'service', reason: 'timed out' }, known, new Date(2026, 10, 4, 22, 1)));
  log = addEntry(log, clean('launch_failed', { app: 'youtube', reason: 'not opened' }, known, when));
  const text = reportText(log, about, when);
  assert.equal(
    text,
    [
      'HomeTV problem report',
      'HomeTV v0 · Samsung app · Tizen 5.0 · Chromium 56 · 1920x1080',
      'Made 2026-11-04 23:40. Kept on the TV; nothing is sent.',
      '2 problems, newest first:',
      '2026-11-04',
      '23:40 An app didn’t open · app youtube · reason not opened',
      '22:01 Something didn’t download · what service · reason timed out',
    ].join('\n'),
  );
  assert.match(reportText([], about, when), /No problems noted\.$/);
  const odd = reportText([], { ...about, brand: 'Sam sung 192.168.1.50', osVersion: '192.168.1.50', screen: 'big' }, when);
  assert.ok(!odd.includes('192.168'), odd);
});

test('a failed page-update check is noted once per check, as a page update and nothing more', async () => {
  const { loadTs } = await import('./ts-module.mjs');
  const m = memory();
  globalThis.window = { localStorage: m, addEventListener() {} };
  const { noteUpdateCheck, errorLog } = await loadTs('errors.ts');
  noteUpdateCheck(null);
  noteUpdateCheck({ checkedAt: 1000, failed: false });
  assert.equal(errorLog().length, 0);
  noteUpdateCheck({ checkedAt: 2000, failed: true, url: 'https://updates.example.com/page.json' });
  noteUpdateCheck({ checkedAt: 2000, failed: true });
  assert.equal(errorLog().length, 1);
  assert.deepEqual(errorLog()[0].fields, { what: 'page update' });
  noteUpdateCheck({ checkedAt: 3000, failed: true });
  assert.equal(errorLog()[0].n, 2, 'the next failed check counts up');
  assert.ok(!m.raw.get(LOG_KEY).includes('example.com'));
});
