// The service and the phone page's script are ES5 (older LG TVs run an old Node; tools/check-legacy.mjs, which
// `npm run build:app` also runs over the built page).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('check-legacy --service-only: service.js, pages.js and the key page’s script are ES5', () => {
  const r = spawnSync(process.execPath, ['tools/check-legacy.mjs', '--service-only'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /service is ES5/);
});
