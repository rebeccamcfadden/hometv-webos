// "An LG update ended root" (docs/root-plan.md, When an LG update ends root) on a PC: the page's decision (both ways,
// a TV never rooted, a service that can't tell) and its once-per-software-version rule with "Don't show again"; the
// laptop's `hometv-lg check` line from what LG's remote-control connection and SSH answer. The start-up hook's note
// and the service's comparison are in
// root.test.mjs. Nothing touches a real TV.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { loadTs } from './ts-module.mjs';
import { rootedBefore, knownHost, rootStatus, describeRootStatus } from '../tools/lib/root-status.mjs';

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

const tvSaying = (lines) => shellSaying({ code: 0, stdout: lines.join('\n') + '\n' });
const ON = ['uid=0', 'boot=start-2', 'noted=start-2', 'hooked=1'];
const said = (s) => describeRootStatus(s).join('\n');

test('laptop: root still on: Homebrew Channel listed and SSH logs in as root, in one read-only command', async () => {
  const on = tvSaying(ON);
  assert.deepEqual(await rootStatus({ wasRooted: true, apps: APPS, shell: on }), { state: 'rooted', why: '' });
  assert.equal(on.ran.length, 1, 'one command');
  assert.match(on.ran[0], /id -u/);
  assert.match(on.ran[0], /'\/media\/developer\/hometv\/started'/);
  assert.doesNotMatch(on.ran[0], /\brm\b|\bmv\b|[^2]>|\btouch\b|\bchattr\b/, 'reads only');
  assert.equal((await rootStatus({ wasRooted: true, apps: null, shell: tvSaying(ON) })).state, 'rooted', 'app list unread: SSH decides');
  assert.match(said({ state: 'rooted', why: '' }), /^Root: still on/);
  // the start note can't say: none yet (no restart since the install), "Use LG's Home" chosen, or the hook unlinked
  for (const lines of [['uid=0', 'boot=start-2', 'noted=', 'hooked=1'], ['uid=0', 'boot=start-2', 'noted=start-1', 'hooked=1', 'chosen=1'],
    ['uid=0', 'boot=start-2', 'noted=start-1'], ['uid=0', 'boot=', 'noted=start-1', 'hooked=1']]) {
    assert.equal((await rootStatus({ wasRooted: true, apps: APPS, shell: tvSaying(lines) })).state, 'rooted', lines.join(' '));
  }
});

test('laptop: the TV doesn\'t answer at all: "Can\'t reach the TV"', async () => {
  for (const err of ['ssh: connect to host x port 22: Connection timed out', 'ssh: connect to host x port 22: No route to host',
    'ssh: connect to host x port 22: Connection refused']) {
    const r = await rootStatus({ wasRooted: true, tvAnswers: false, apps: null, shell: shellSaying({ code: 255, stderr: err }) });
    assert.deepEqual(r, { state: 'unreachable', why: '' }, err);
  }
  assert.equal((await rootStatus({ wasRooted: true, tvAnswers: false, apps: null, shell: null })).state, 'unreachable', 'no root key either');
  assert.deepEqual(describeRootStatus({ state: 'unreachable', why: '' }),
    ['Can\'t reach the TV. Check it\'s on and on the same Wi-Fi, then run this again.']);
  assert.equal((await rootStatus({ wasRooted: true, tvAnswers: false, apps: null, shell: tvSaying(ON) })).state, 'rooted',
    'LG\'s connection down, SSH up: root is on');
});

test('laptop: Homebrew Channel listed but SSH refuses or times out: "Root looks fine, but the laptop can\'t log in"', async () => {
  for (const err of ['ssh: connect to host x port 22: Connection refused', 'ssh: connect to host x port 22: Connection timed out']) {
    const r = await rootStatus({ wasRooted: true, apps: APPS, shell: shellSaying({ code: 255, stderr: err }) });
    assert.equal(r.state, 'no-login', err);
    const text = said(r);
    assert.match(text, /^Root looks fine, but the laptop can't log in/);
    assert.match(text, /On the TV, open Homebrew Channel > Settings, check SSH Server is on, then run this again\.$/);
    assert.doesNotMatch(text, /ended|Choices/);
  }
});

test('laptop: Homebrew Channel gone from the app list: "Root has ended", the three choices, no SSH tried', async () => {
  const gone = tvSaying(ON);
  const r = await rootStatus({ wasRooted: true, apps: ['netflix', 'com.hometv.app'], shell: gone });
  assert.equal(r.state, 'ended');
  assert.deepEqual(gone.ran, []);
  const text = said(r);
  assert.match(text, /^Root has ended\. Homebrew Channel isn't in the TV's app list any more\./);
  assert.match(text, /LG's Home is back/);
  assert.match(text, /nothing is broken/);
  assert.match(text, /1\. Leave it/);
  assert.match(text, /2\. A factory reset .*then HomeTV as a Developer Mode app/);
  assert.match(text, /3\. Root again, only if a tool exists/);
  assert.match(text, /root\/#after-an-update/, 'the guide\'s address, as the TV\'s notice gives it');
  assert.doesNotMatch(text, /update may have removed it|SSH Server/);
});

test('laptop: the start note says the hook didn\'t run: "Root has ended (an update may have removed it)"', async () => {
  const r = await rootStatus({ wasRooted: true, apps: APPS, shell: tvSaying(['uid=0', 'boot=start-2', 'noted=start-1', 'hooked=1']) });
  assert.equal(r.state, 'ended');
  assert.equal(r.noteEnded, true);
  const text = said(r);
  assert.match(text, /^Root has ended \(an update may have removed it\)\. HomeTV's start note says its start-up hook didn't run/);
  assert.match(text, /1\. Leave it/);
});

test('laptop: the app list unread and SSH refusing: says plainly which it can\'t tell, and what to look for', async () => {
  {
    const r = await rootStatus({ wasRooted: true, apps: null, shell: shellSaying({ code: 255, stderr: 'port 22: Connection refused' }) });
    assert.equal(r.state, 'unknown');
    const text = said(r);
    assert.match(text, /^Root: can't tell \(SSH refuses the connection; the TV's app list couldn't be read, so this can't tell whether root has ended or only the laptop can't log in\)\./);
    assert.match(text, /Look for Homebrew Channel in the TV's apps\. There: open it > Settings, check SSH Server is on, then run this again\. Gone: root has ended/);
  }
  const denied = await rootStatus({ wasRooted: true, apps: APPS, shell: shellSaying({ code: 255, stderr: 'root@x: Permission denied (publickey).' }) });
  assert.deepEqual(denied, { state: 'unknown', why: 'SSH answers but the root key doesn\'t log in' });
  assert.equal((await rootStatus({ wasRooted: true, apps: APPS, shell: null })).state, 'unknown', 'no root key');
  assert.equal((await rootStatus({ wasRooted: true, apps: APPS, shell: tvSaying(['uid=1000']) })).state, 'unknown', 'not root');
});

test('laptop: a TV this laptop never rooted gets no root line', async () => {
  const never = tvSaying(ON);
  const r = await rootStatus({ wasRooted: false, apps: APPS, shell: never });
  assert.equal(r.state, 'never');
  assert.deepEqual(never.ran, []);
  assert.deepEqual(describeRootStatus(r), []);
});

test('laptop: hometv-lg check when LG\'s connection doesn\'t answer: SSH decides, else "Can\'t reach the TV"', async () => {
  const d = path.resolve('dist', 'test-rootended-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(d, { recursive: true });
  try {
    fs.writeFileSync(path.join(d, 'install-state.json'), JSON.stringify({ steps: { root: { status: 'done' } } }));
    fs.writeFileSync(path.join(d, 'lg-root-key'), 'x');
    fs.writeFileSync(path.join(d, 'lg-known-hosts'), '127.0.0.1 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIexample\n');
    const ssh = path.join(d, 'ssh.mjs');
    fs.writeFileSync(ssh, 'if (process.env.FAKE_SSH === "root") { console.log("uid=0\\nboot=b\\nnoted=b\\nhooked=1"); }\n' +
      'else { console.error("ssh: connect to host 127.0.0.1 port 22: Connection timed out"); process.exit(255); }\n');
    const port = await new Promise((resolve) => { const sv = net.createServer().listen(0, '127.0.0.1', () => { const p = sv.address().port; sv.close(() => resolve(p)); }); });
    const run = (mode) => new Promise((resolve) => execFile(process.execPath, ['tools/tv-check.mjs', '127.0.0.1', '--ws-port', String(port)],
      { env: { ...process.env, HOMETV_DIR: d, HOMETV_SSH: ssh, FAKE_SSH: mode }, timeout: 30000 },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: stdout + stderr })));
    const down = await run('timeout');
    assert.equal(down.code, 1);
    assert.match(down.out, /Can't reach the TV at 127\.0\.0\.1 \(.*\)\. Check it's on and on the same Wi-Fi, then run this again\./);
    assert.doesNotMatch(down.out, /Root/, 'one line, not two saying the same');
    const up = await run('root');
    assert.equal(up.code, 1);
    assert.match(up.out, /LG's remote-control connection didn't answer/);
    assert.match(up.out, /Root: still on/);
    // the TV answers but refuses to pair, and SSH is off: not a Wi-Fi problem, and the app list is unread
    const refusing = http.createServer().on('upgrade', (req, sock) => {
      const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
      const p = Buffer.from(JSON.stringify({ type: 'error', id: 'register_0', error: '403 denied' }));
      sock.write(Buffer.concat([Buffer.from([0x81, p.length]), p]));
      sock.on('error', () => {});
    });
    await new Promise((resolve) => refusing.listen(port, '127.0.0.1', resolve));
    try {
      const unpaired = await run('timeout');
      assert.equal(unpaired.code, 1);
      assert.match(unpaired.out, /The TV answered but didn't pair with this laptop \(pairing refused: 403 denied\)\. Press "Allow"/);
      assert.doesNotMatch(unpaired.out, /Can't reach the TV/);
      assert.match(unpaired.out, /Root: can't tell \(SSH doesn't answer; the TV's app list couldn't be read/);
    } finally {
      refusing.close();
    }
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('laptop: "rooted before" is the root steps done in install-state.json, or the root key, and this TV\'s address in the kept host keys', () => {
  const d = path.resolve('dist', 'test-rootended-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(d, { recursive: true });
  const TV = '192.168.1.50';
  try {
    fs.writeFileSync(path.join(d, 'lg-known-hosts'), TV + ' ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIexample\n');
    assert.equal(rootedBefore(d, TV), false, 'nothing here');
    fs.writeFileSync(path.join(d, 'install-state.json'), JSON.stringify({ steps: { backup: { status: 'done' }, root: { status: 'stopped' } } }));
    assert.equal(rootedBefore(d, TV), false, 'Developer Mode only, or root stopped');
    fs.writeFileSync(path.join(d, 'install-state.json'), JSON.stringify({ steps: { root: { status: 'done' } } }));
    assert.equal(rootedBefore(d, TV), true);
    assert.equal(rootedBefore(d, '192.168.1.51'), false, 'another TV checked from this laptop: no root line');
    fs.writeFileSync(path.join(d, 'install-state.json'), 'not json');
    assert.equal(rootedBefore(d, TV), false);
    fs.writeFileSync(path.join(d, 'lg-root-key'), 'x');
    assert.equal(rootedBefore(d, TV), true);
    fs.rmSync(path.join(d, 'lg-known-hosts'));
    assert.equal(rootedBefore(d, TV), false, 'no host keys kept: never logged in');
    // a hashed line (HashKnownHosts), and [host]:22
    const salt = crypto.randomBytes(20);
    const hash = crypto.createHmac('sha1', salt).update(TV).digest('base64');
    fs.writeFileSync(path.join(d, 'kh'), '# c\n|1|' + salt.toString('base64') + '|' + hash + ' ssh-ed25519 AAAA\n');
    assert.equal(knownHost(path.join(d, 'kh'), TV), true);
    assert.equal(knownHost(path.join(d, 'kh'), '192.168.1.5'), false);
    fs.writeFileSync(path.join(d, 'kh'), 'other,[' + TV + ']:22 ssh-rsa AAAA\n');
    assert.equal(knownHost(path.join(d, 'kh'), TV), true);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('laptop: SSH\'s own error text, which names the TV, never reaches the report', async () => {
  const TV = '192.168.1.50';
  for (const err of [
    'ssh: connect to host ' + TV + ' port 22: Network is unreachable',
    'ssh: Could not resolve hostname tv.example: Name or service not known',
    'Command failed: ssh -p 22 -i C:\\Users\\someone\\HomeTV\\lg-root-key root@' + TV + ' id -u',
    '@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@ ' + TV,
    'kex_exchange_identification: Connection closed by remote host ' + TV,
    'ssh: connect to host ' + TV + ' port 22: Connection refused'
  ]) {
    const r = await rootStatus({ wasRooted: true, apps: APPS, shell: shellSaying({ code: 255, stderr: err }) });
    const text = JSON.stringify(r) + describeRootStatus(r).join('\n');
    assert.ok(!text.includes(TV) && !text.includes('tv.example') && !text.includes('someone'), text);
  }
  const closed = await rootStatus({ wasRooted: true, apps: APPS, shell: shellSaying({ code: 255, stderr: 'Connection closed by remote host' }) });
  assert.equal(closed.state, 'unknown', 'a closed connection isn\'t proof root ended');
});

test('the notice\'s help address is a page and an anchor in docs/, linked from /install/ and /check/', () => {
  const u = new URL(re.AFTER_UPDATE_URL);
  const m = u.pathname.match(/^\/hometv-webos\/(.+)\/$/);
  assert.ok(m, 'a Pages folder: ' + u.pathname);
  const docs = path.join(import.meta.dirname, '..', 'docs');
  const page = fs.readFileSync(path.join(docs, m[1], 'index.html'), 'utf8');
  assert.match(page, new RegExp('id="' + u.hash.slice(1) + '"'), 'the anchor ' + u.hash);
  assert.match(fs.readFileSync(path.join(docs, m[1] + '.md'), 'utf8'), new RegExp('id="' + u.hash.slice(1) + '"'));
  for (const from of ['install', 'check']) {
    assert.match(fs.readFileSync(path.join(docs, from, 'index.html'), 'utf8'), new RegExp('href="\\.\\./' + m[1] + '/"'), from);
  }
});
