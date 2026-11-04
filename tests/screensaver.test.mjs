// The clock screensaver's rules (app/src/ui/saverModel.ts) and its saved choices (Settings › Performance and Screensaver,
// in app/src/launcherSettings.ts): it starts only on
// Home, only in front, only after the chosen idle time; any key wakes it and is swallowed with its release. `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { afterMs, clockText, createIdle, glowBackground, mix, PALETTE } from '../app/src/ui/saverModel.ts';
import { loadTs } from './ts-module.mjs';

const ls = await loadTs('launcherSettings.ts');

const clock = (t = 0) => {
  const c = { t, now: () => c.t };
  return c;
};
const HOME = { home: true, visible: true };
const MIN = 60000;

test('it starts after the idle time on Home, and not before', () => {
  const c = clock();
  const idle = createIdle(c.now);
  c.t = 5 * MIN - 1;
  assert.equal(idle.due(5 * MIN, HOME), false);
  c.t = 5 * MIN;
  assert.equal(idle.due(5 * MIN, HOME), true);
});

test('a key starts the wait again', () => {
  const c = clock();
  const idle = createIdle(c.now);
  c.t = 4 * MIN;
  assert.equal(idle.keyDown(40), false, 'a key while it is down passes to Home');
  idle.keyUp(40);
  c.t = 8 * MIN;
  assert.equal(idle.due(5 * MIN, HOME), false);
  c.t = 9 * MIN;
  assert.equal(idle.due(5 * MIN, HOME), true);
});

test('never over another page, a menu, an input or another app, and never when off', () => {
  const c = clock();
  const idle = createIdle(c.now);
  c.t = 60 * MIN;
  assert.equal(idle.due(5 * MIN, { home: false, visible: true }), false, 'a page or menu over Home');
  assert.equal(idle.due(5 * MIN, { home: true, visible: false }), false, 'another app in front');
  assert.equal(idle.due(0, HOME), false, 'off');
  assert.equal(idle.due(5 * MIN, HOME), true);
});

test('the key that wakes it is swallowed, with its repeats and its release; the next key acts', () => {
  const c = clock();
  const idle = createIdle(c.now);
  c.t = 10 * MIN;
  idle.show();
  assert.equal(idle.isShown(), true);
  assert.equal(idle.due(5 * MIN, HOME), false, 'not twice');
  assert.equal(idle.keyDown(13), true, 'OK wakes it and does nothing on Home');
  assert.equal(idle.isShown(), false);
  assert.equal(idle.keyDown(13), true, 'its repeat while held');
  assert.equal(idle.keyUp(13), true, 'its release');
  assert.equal(idle.keyDown(13), false, 'the next OK acts');
  assert.equal(idle.keyUp(13), false);
  assert.equal(idle.due(5 * MIN, HOME), false, 'and the wait starts again');
});

test('going behind another app takes it down and starts the wait again', () => {
  const c = clock();
  const idle = createIdle(c.now);
  c.t = 10 * MIN;
  idle.show();
  idle.hide();
  assert.equal(idle.isShown(), false);
  assert.equal(idle.keyDown(39), false, 'a key afterwards is not swallowed');
  c.t = 14 * MIN;
  assert.equal(idle.due(5 * MIN, HOME), false);
});

test('the idle time: design_preview’s choices, off by default, and ?saver=fast', () => {
  assert.equal(afterMs('off'), 0);
  assert.equal(afterMs(''), 0);
  assert.equal(afterMs('5'), 5 * MIN);
  assert.equal(afterMs('30'), 30 * MIN);
  assert.equal(afterMs('5', true), 10000);
  assert.equal(afterMs('nonsense'), 0);
  assert.equal(ls.defaults().screensaverAfter, 'off');
});

test('the clock’s words, written out', () => {
  assert.deepEqual(clockText(new Date(2026, 10, 4, 21, 5)), { time: '9:05', ampm: 'PM', date: 'Wednesday, November 4' });
  assert.deepEqual(clockText(new Date(2026, 0, 1, 0, 30)), { time: '12:30', ampm: 'AM', date: 'Thursday, January 1' });
  assert.equal(clockText(new Date(2026, 0, 1, 12, 0)).ampm, 'PM');
});

test('the glow: colours mix in steps, and the gradient has no color-mix() (Chromium 56)', () => {
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mix(PALETTE[0], PALETTE[1], 0), PALETTE[0]);
  assert.equal(mix(PALETTE[0], PALETTE[1], 1), PALETTE[1]);
  const g = glowBackground('#2b5cff', 100.4, 200.6);
  assert.match(g, /^radial-gradient\(circle 1056px at 100px 201px, rgba\(43,92,255,0\.25\)/);
  assert.doesNotMatch(g, /color-mix/);
});

test('Motion and the screensaver are in the one settings store: saved, read back, odd values fall back', () => {
  const m = new Map();
  const s = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
  const look = (p) => ({ motion: p.motion, screensaverAfter: p.screensaverAfter, screensaverBack: p.screensaverBack });
  assert.deepEqual(look(ls.loadPrefs(s)), { motion: 'full', screensaverAfter: 'off', screensaverBack: 'glow' });
  const store = ls.createPrefs(s);
  store.set({ region: 'us' });
  store.set({ motion: 'off', screensaverAfter: '15', screensaverBack: 'black' });
  assert.equal(store.get().region, 'us', 'other settings stay');
  assert.deepEqual(look(ls.loadPrefs(s)), { motion: 'off', screensaverAfter: '15', screensaverBack: 'black' });
  assert.deepEqual(Array.from(m.keys()), [ls.SETTINGS_KEY], 'one key');
  m.set(ls.SETTINGS_KEY, JSON.stringify({ motion: 'wild', screensaverAfter: 7, screensaverBack: 'picture' }));
  assert.deepEqual(look(ls.loadPrefs(s)), { motion: 'full', screensaverAfter: 'off', screensaverBack: 'glow' });
  assert.deepEqual(look(ls.loadPrefs(null)), { motion: 'full', screensaverAfter: 'off', screensaverBack: 'glow' });
});
