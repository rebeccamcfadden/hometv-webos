// app/src/webos/apps.ts: LG app ids, finding Home's apps in the TV's list, and title-link params. Node runs the
// TypeScript as it is (type stripping).
import test from 'node:test';
import assert from 'node:assert/strict';
import { findApp, guessId, titleParams, netflixOldLink, LG_APP_IDS } from '../app/src/webos/apps.ts';

const TV = [
  { id: 'netflix', title: 'Netflix' },
  { id: 'youtube.leanback.v4', title: 'YouTube' },
  { id: 'com.hbo.hbomax', title: 'Max' },
  { id: 'com.example.svtplay', title: 'SVT Play' },
  { id: 'com.webos.app.browser', title: 'Web Browser' },
];

test('known ids first, newest first', () => {
  assert.equal(findApp(TV, 'netflix')?.id, 'netflix');
  assert.equal(findApp(TV, 'max', 'HBO Max')?.id, 'com.hbo.hbomax');
});

test('an app without a known id is found by its name; a missing one is null', () => {
  assert.equal(findApp(TV, 'svtplay', 'SVT Play')?.id, 'com.example.svtplay');
  assert.equal(findApp(TV, 'disney', 'Disney+'), null);
  assert.equal(findApp(TV, 'svtplay'), null);
});

test('every Home key the Samsung copy uses has an LG id', () => {
  for (const key of ['netflix', 'youtube', 'prime', 'disney', 'max', 'appletv', 'spotify']) {
    assert.ok(LG_APP_IDS[key] && LG_APP_IDS[key].length, key);
  }
  assert.equal(guessId('prime'), 'amazon');
  assert.equal(guessId('nothing'), null);
});

test('YouTube opens the video by contentId, from the payload or the link', () => {
  assert.deepEqual(titleParams('youtube', null, 'v=jNQXAC9IVRw'), { contentId: 'v=jNQXAC9IVRw' });
  assert.deepEqual(titleParams('youtube', 'https://www.youtube.com/watch?v=jNQXAC9IVRw', ''), { contentId: 'v=jNQXAC9IVRw' });
  assert.equal(titleParams('youtube', null, ''), null);
});

test('Netflix gets its old catalogue form only when the flag is on; others get contentTarget', () => {
  assert.equal(titleParams('netflix', 'https://www.netflix.com/title/80057281', '', false), null);
  assert.equal(titleParams('netflix', 'https://www.netflix.com/title/80057281', ''), null);
  assert.deepEqual(titleParams('netflix', 'https://www.netflix.com/title/80057281', '', true),
    { contentId: 'm=http://api.netflix.com/catalog/titles/movies/80057281&source_type=4' });
  assert.deepEqual(titleParams('netflix', 'https://www.netflix.com/se-en/title/80057281', '', true).contentId,
    'm=http://api.netflix.com/catalog/titles/movies/80057281&source_type=4');
  assert.equal(titleParams('netflix', 'https://example.com/x', '', true), null);
  assert.deepEqual(titleParams('disney', 'https://www.disneyplus.com/movies/x/abc', ''), { contentTarget: 'https://www.disneyplus.com/movies/x/abc' });
  assert.equal(titleParams('disney', null, ''), null);
});

test('the Netflix flag is the page’s localStorage "hometv.netflix-old-link"=1, off without it', () => {
  const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const set = (v) => Object.defineProperty(globalThis, 'localStorage', { value: v, configurable: true, writable: true });
  try {
    set(undefined);
    assert.equal(netflixOldLink(), false);
    set({ getItem: () => null });
    assert.equal(netflixOldLink(), false);
    set({ getItem: (k) => (k === 'hometv.netflix-old-link' ? '1' : null) });
    assert.equal(netflixOldLink(), true);
  } finally {
    if (real) Object.defineProperty(globalThis, 'localStorage', real);
    else delete globalThis.localStorage;
  }
});
