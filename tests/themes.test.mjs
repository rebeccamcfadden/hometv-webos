// The themes (app/src/theme): the list and its Seasonal periods, the Google Fonts address, the sun's part of the day, and
// that ui/themes.css is what tools/gen-theme-css.mjs makes (no colour mix or :is() left for the TV's old Chromium).
// `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadTs } from './ts-module.mjs';
import { build, mix, parseColor, rgba, SOURCE, OUT } from '../tools/gen-theme-css.mjs';

const { t, sun } = await loadTs({ t: 'theme/themes.ts', sun: 'theme/daylight.ts' });

test('eight themes: six Classic, two Seasonal, Midnight first and the fallback', () => {
  assert.deepEqual(
    t.THEMES.map((x) => x.id),
    ['midnight', 'daylight', 'oled', 'high-contrast', 'cinema', 'landscapes', 'seasonal-vector', 'seasonal-8bit'],
  );
  assert.equal(t.THEMES.filter((x) => x.group === 'seasonal').length, 2);
  assert.equal(t.themeById('nonsense').id, 'midnight');
  assert.equal(t.themeById('seasonal-nature').id, 'seasonal-vector');
});

test('the Seasonal period by date: ten periods, Halloween from 15 October to 2 November', () => {
  const at = (m, d) => t.periodAt(new Date(2026, m - 1, d, 12));
  assert.equal(at(1, 15), 'snow');
  assert.equal(at(3, 15), 'thaw');
  assert.equal(at(10, 14), 'autumn');
  assert.equal(at(10, 15), 'halloween');
  assert.equal(at(11, 2), 'halloween');
  assert.equal(at(11, 3), 'autumn');
  assert.equal(at(12, 24), 'christmas');
  assert.equal(new Set(Array.from({ length: 12 }, (_, i) => at(i + 1, 20))).size >= 9, true);
});

test('backdrops come from the launcher repo: Midnight, OLED and High Contrast have none; Seasonal follows period and phase', () => {
  const b = (id, p = 'snow', hour = 5, phase = 'day') => t.themeById(id).backdrop(p, hour, phase);
  for (const id of ['midnight', 'oled', 'high-contrast']) assert.equal(b(id).kind, 'none');
  assert.equal(b('landscapes', 'snow', 6).src, t.BACKDROP_BASE + 'classic/landscapes-3.webp');
  assert.equal(b('seasonal-vector', 'halloween', 0, 'night').src, t.BACKDROP_BASE + 'seasonal/vector-6/halloween-night.webp');
  assert.deepEqual(b('seasonal-8bit', 'bloom', 0, 'day'), { kind: 'pixel', src: t.BACKDROP_BASE + 'seasonal/8bit/bloom.png' });
  assert.equal(b('seasonal-8bit', 'bloom', 0, 'dawn').src, t.BACKDROP_BASE + 'seasonal/8bit/bloom-dawn.png');
});

test('one Google Fonts address for the faces, weights merged and sorted', () => {
  const href = t.fontsHref([t.themeById('daylight').display, t.themeById('daylight').ui, t.themeById('cinema').display]);
  assert.equal(href, 'https://fonts.googleapis.com/css2?family=Figtree:wght@300;400;500;600;700&family=DM+Serif+Display&display=swap');
});

test('the sun: night at midnight, day at noon, dawn and sunset between, at a Swedish place', () => {
  sun.setSite({ lat: 57.7, lon: 11.97 });
  // 2026-06-21 in UTC+2: sunrise about 03:51, sunset about 22:00 local; the TV's zone is whatever Node runs in, so use UTC dates
  const at = (iso) => sun.phaseAt(new Date(iso));
  assert.equal(at('2026-06-21T10:00:00Z'), 'day');
  assert.equal(at('2026-12-21T23:30:00Z'), 'night');
  assert.equal(at('2026-12-21T11:00:00Z'), 'day');
  assert.ok(sun.msToNextPhase(new Date('2026-06-21T10:00:00Z')) > 0);
  assert.ok(Math.abs(sun.siteFromZone(new Date('2026-06-21T12:00:00Z')).lon) <= 180);
});

test('colour mixes are worked out as CSS does: alpha scaled, and premultiplied interpolation', () => {
  assert.equal(rgba([255, 255, 255, 0.2]), 'rgba(255, 255, 255, 0.2)');
  assert.deepEqual(parseColor('#1f5fbf'), [31, 95, 191, 1]);
  const m = mix([255, 255, 255, 0.05], [255, 255, 255, 0.09], 0.875);
  assert.equal(rgba(m), 'rgba(255, 255, 255, 0.055)');
});

test('ui/themes.css is what the tool makes from the shared design, with nothing the TV’s Chromium lacks', () => {
  const made = build(fs.readFileSync(SOURCE, 'utf8'));
  assert.equal(fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n'), made.replace(/\r\n/g, '\n'), 'run: node tools/gen-theme-css.mjs');
  assert.doesNotMatch(made.replace(/\/\*[\s\S]*?\*\//g, ''), /color-mix|:is\(/);
  assert.match(made, /\[data-theme='daylight'\]/);
  assert.match(made, /--pane-live: /);
});
