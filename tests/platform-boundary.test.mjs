// The platform boundary (docs/platform.md): only the platform files talk to the TV's own APIs, so an LG copy swaps
// those files and keeps every screen and the shell unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(import.meta.dirname, '..', 'app', 'src');
/** The LG side: replaced as a set from hometv-tizen's (bridge.ts, platform.ts, pageChecks.ts), plus LG's Luna helpers. */
const PLATFORM_FILES = new Set(['bridge.ts', 'platform.ts', 'pageChecks.ts', 'webos/luna.ts', 'webos/apps.ts']);
/** The TV's own APIs: Samsung's `tizen` and `webapis`, AeroTizen's scripts, LG's webOS objects, and the online state. */
const PLATFORM_CALL = /\btizen\b|\bwebapis\b|\bAeroTizen\b|\bwebOS\b|\bPalmSystem\b|navigator\.onLine|HomeTVBoot/;

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.ts$/.test(e.name) ? [p] : [];
  });
}

/** The code without comments, so explaining where something comes from stays allowed. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

test('screens, the shell and the rest call the TV only through the bridge', () => {
  const offenders = [];
  for (const f of files(SRC)) {
    const rel = path.relative(SRC, f).split(path.sep).join('/');
    if (PLATFORM_FILES.has(rel)) continue;
    code(fs.readFileSync(f, 'utf8'))
      .split('\n')
      .forEach((line, i) => {
        if (PLATFORM_CALL.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(offenders, []);
});

test('the shell has no Samsung key codes of its own', () => {
  const shell = code(fs.readFileSync(path.join(SRC, 'shell', 'app.ts'), 'utf8'));
  assert.doesNotMatch(shell, /10009|\b40[3-6]\b|\b457\b/);
});
