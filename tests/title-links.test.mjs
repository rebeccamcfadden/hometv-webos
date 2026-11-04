// Which Samsung app a service opens in, and how a title opens there (app/src/titleLinks.ts): the core ServiceIds
// mapped to the keys service/service.js and Home's tiles use, as app/src/apps.ts maps them.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTs } from './ts-module.mjs';

const { samsungApp, openPlan, linkFor } = await loadTs('titleLinks.ts');
const { SERVICES } = await loadTs('../../vendor/hometv-launcher/packages/core/src/services.ts');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('each service opens in its own app; a store in the app it sells in', () => {
  const keys = {};
  for (const id of Object.keys(SERVICES)) keys[id] = samsungApp(id);
  assert.deepEqual(keys.netflix, { key: 'netflix', name: 'Netflix' });
  assert.deepEqual(keys.appletvplus, { key: 'appletv', name: 'Apple TV' });
  assert.deepEqual(keys.appletv, { key: 'appletv', name: 'Apple TV' });
  assert.deepEqual(keys.amazonvideo, { key: 'prime', name: 'Prime Video' });
  assert.deepEqual(keys.viaplaystore, { key: 'viaplay', name: 'Viaplay' });
  assert.deepEqual(keys.youtube, { key: 'youtube', name: 'YouTube' });
  assert.deepEqual(keys.max, { key: 'max', name: 'HBO Max' });
  assert.deepEqual(keys.sfanytime, { key: 'sfanytime', name: 'SF Anytime' });
});

test('the keys of the apps Samsung has ids for have LG ids too (app/src/webos/apps.ts LG_APP_IDS)', async () => {
  const { LG_APP_IDS } = await loadTs('webos/apps.ts');
  for (const id of ['netflix', 'youtube', 'prime', 'disney', 'max', 'appletvplus', 'amazonvideo', 'appletv']) {
    const key = samsungApp(id).key;
    assert.ok(LG_APP_IDS[key] && LG_APP_IDS[key].length, `${id} → ${key}`);
  }
});

test('YouTube opens the video with PAYLOAD and no link; another service gets its web link', () => {
  assert.deepEqual(openPlan('youtube', { payload: 'v=aqz-KE-bpKQ', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' }), {
    how: 'link',
    app: { key: 'youtube', name: 'YouTube' },
    url: null,
    payload: 'v=aqz-KE-bpKQ',
  });
  assert.deepEqual(openPlan('netflix', { url: 'https://www.netflix.com/title/80057281', payload: 'm=80057281' }), {
    how: 'link',
    app: { key: 'netflix', name: 'Netflix' },
    url: 'https://www.netflix.com/title/80057281',
    payload: 'm=80057281',
  });
  assert.equal(openPlan('amazonvideo', { url: 'https://app.primevideo.com/detail?gti=x' }).app.key, 'prime');
});

test('with no link, or a link the app can’t take, the app opens on its home', () => {
  assert.deepEqual(openPlan('disney'), { how: 'app', app: { key: 'disney', name: 'Disney+' } });
  assert.equal(openPlan('youtube', { url: 'https://www.youtube.com/watch?v=x' }).how, 'app');
  assert.equal(openPlan('netflix', { payload: 'm=1' }).how, 'app');
});

test('the mock catalogue has no title links yet', () => {
  assert.equal(linkFor({ id: 'arrival' }, 'prime'), undefined);
});
