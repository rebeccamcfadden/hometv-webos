// "An LG update ended root" (docs/root-plan.md, When an LG update ends root) on a PC: the page's decision (both ways,
// a TV never rooted, a service that can't tell) and its once-per-software-version rule with "Don't show again"; the
// laptop's `hometv-lg check` line from what SSH answers. The start-up hook's note and the service's comparison are in
// root.test.mjs. Nothing touches a real TV.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadTs } from './ts-module.mjs';
import { rootedBefore, rootStatus, describeRootStatus } from '../tools/lib/root-status.mjs';

const { re } = await loadTs({ re: 'webos/rootEdition.ts' });

const ROOTED = { edition: true, hooked: true, chosen: false, ranThisStart: true };

test('page: root ended only when the hook didn\'t run this start on a TV with the root edition hooked', () => {
  assert.equal(re.rootEnded({ ...ROOTED, ranThisStart: false }, false), true, 'the hook didn\'t run: root ended');
  assert.equal(re.rootEnded(ROOTED, false), false, 'the hook ran: root is on (HomeTV opened from its tile)');
  assert.equal(re.rootEnded({ ...ROOTED, ranThisStart: false }, true), false, 'HomeTV is LG\'s Home: root is on');
  assert.equal(re.rootEnded({ ...ROOTED, ranThisStart: null }, false), false, 'can\'t tell: nothing');
  assert.equal(re.rootEnded({ ...ROOTED, ranThisStart: false, chosen: true }, false), false, '"Use LG\'s Home" chosen');
  assert.equal(re.rootEnded({ ...ROOTED, ranThisStart: false, hooked: false }, false), false, 'no hook to run');
});

test('page: a TV that was never rooted shows nothing', () => {
  assert.equal(re.rootEnded(null, false), false, 'no service answer (Developer Mode edition, or off a TV)');
  assert.equal(re.rootEnded({ edition: false, hooked: false, chosen: false, ranThisStart: null }, false), false);
  assert.equal(re.rootEnded({ edition: false, hooked: false, chosen: false, ranThisStart: false }, false), false);
});

function memory() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
}

test('page: the notice shows once per TV software version; a new version shows it again; "Don\'t show again" ends it', () => {
  const s = memory();
  assert.equal(re.takeRootEndedNotice(s, '33.31.61'), true);
  assert.equal(re.takeRootEndedNotice(s, '33.31.61'), false, 'the next start, same software');
  assert.equal(re.takeRootEndedNotice(s, '33.40.10'), true, 'another LG update');
  assert.equal(re.takeRootEndedNotice(s, '33.40.10'), false);
  assert.equal(re.takeRootEndedNotice(s, ''), true, 'unknown version counts as one');
  assert.equal(re.takeRootEndedNotice(s, ''), false);
  re.neverRootEndedNotice(s);
  assert.equal(re.takeRootEndedNotice(s, '34.00.00'), false, 'never again, whatever the version');
  assert.equal(re.takeRootEndedNotice(null, '33.31.61'), true, 'no storage: once a start');
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(re.takeRootEndedNotice(blocked, '33.31.61'), true);
  assert.doesNotThrow(() => re.neverRootEndedNotice(blocked));
});

test('page: the notice\'s help link is the guide\'s part on it; off a TV the software version is unknown', async () => {
  assert.equal(re.AFTER_UPDATE_URL, 'https://rebeccamcfadden.github.io/hometv-webos/root/#after-an-update');
  assert.equal(await re.tvFirmware(), '');
});

// --- The laptop: hometv-lg check

const shellSaying = (r) => ({ ran: [], async run(cmd) { this.ran.push(cmd); return { stdout: '', stderr: '', ...r }; } });
const APPS = ['netflix', 'com.hometv.app', 'org.webosbrew.hbchannel'];

test('laptop: root still on, ended (SSH refused, timed out, or Homebrew Channel gone), or can\'t tell', async () => {
  const on = shellSaying({ code: 0, stdout: '0\n' });
  assert.deepEqual(await rootStatus({ wasRooted: true, apps: APPS, shell: on }), { state: 'rooted', why: '' });
  assert.deepEqual(on.ran, ['id -u'], 'one read-only command');
  for (const err of ['ssh: connect to host x port 22: Connection refused', 'ssh: connect to host x port 22: Connection timed out']) {
    const r = await rootStatus({ wasRooted: true, apps: APPS, shell: shellSaying({ code: 255, stderr: err }) });
    assert.equal(r.state, 'ended', err);
  }
  const gone = shellSaying({ code: 0, stdout: '0\n' });
  assert.equal((await rootStatus({ wasRooted: true, apps: ['netflix'], shell: gone })).state, 'ended');
  assert.deepEqual(gone.ran, [], 'Homebrew Channel gone: no SSH tried');
  assert.equal((await rootStatus({ wasRooted: true, apps: null, shell: shellSaying({ code: 0, stdout: '0\n' }) })).state, 'rooted',
    'app list unread: SSH decides');
  const denied = await rootStatus({ wasRooted: true, apps: APPS, shell: shellSaying({ code: 255, stderr: 'root@x: Permission denied (publickey).' }) });
  assert.deepEqual(denied, { state: 'unknown', why: 'SSH answers but the root key doesn\'t log in' });
  assert.equal((await rootStatus({ wasRooted: true, apps: APPS, shell: null })).state, 'unknown');
  assert.equal((await rootStatus({ wasRooted: true, apps: APPS, shell: shellSaying({ code: 0, stdout: '1000\n' }) })).state, 'unknown');
});

test('laptop: a TV this laptop never rooted gets no root line; ended names the choices plainly', async () => {
  const never = shellSaying({ code: 0, stdout: '0\n' });
  const r = await rootStatus({ wasRooted: false, apps: APPS, shell: never });
  assert.equal(r.state, 'never');
  assert.deepEqual(never.ran, []);
  assert.deepEqual(describeRootStatus(r), []);
  const text = describeRootStatus({ state: 'ended', why: 'x' }).join('\n');
  assert.match(text, /^Root: ended \(x\)/);
  assert.match(text, /LG's Home is back/);
  assert.match(text, /nothing is broken/);
  assert.match(text, /1\. Leave it/);
  assert.match(text, /2\. A factory reset .*then HomeTV as a Developer Mode app/);
  assert.match(text, /3\. Root again, only if a tool exists/);
  assert.match(describeRootStatus({ state: 'rooted', why: '' })[0], /^Root: still on/);
});

test('laptop: "rooted before" is the root steps done in install-state.json, or the root key', () => {
  const d = path.resolve('dist', 'test-rootended-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(d, { recursive: true });
  try {
    assert.equal(rootedBefore(d), false, 'nothing here');
    fs.writeFileSync(path.join(d, 'install-state.json'), JSON.stringify({ steps: { backup: { status: 'done' }, root: { status: 'stopped' } } }));
    assert.equal(rootedBefore(d), false, 'Developer Mode only, or root stopped');
    fs.writeFileSync(path.join(d, 'install-state.json'), JSON.stringify({ steps: { root: { status: 'done' } } }));
    assert.equal(rootedBefore(d), true);
    fs.writeFileSync(path.join(d, 'install-state.json'), 'not json');
    assert.equal(rootedBefore(d), false);
    fs.writeFileSync(path.join(d, 'lg-root-key'), 'x');
    assert.equal(rootedBefore(d), true);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});
