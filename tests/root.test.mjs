// HomeTV's root scripts (root/) on a PC: Git's sh runs them against stub commands (mount, umount, systemctl,
// luna-send, pkill, pgrep, sleep) that record what they were asked and keep a pretend /proc/mounts. Nothing here
// touches a TV. Skipped where no sh is found.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const decide = require('../root/decide.js');
const ROOT = path.resolve('root');
const SH = ['C:/Program Files/Git/bin/sh.exe', '/bin/sh', '/usr/bin/sh'].find((p) => fs.existsSync(p));
const GITBIN = '/usr/bin:/bin';
const HOME_APP = '/usr/palm/applications/com.webos.app.home';
const fwd = (p) => p.replace(/\\/g, '/');
// PATH entries for Git's sh: C:/x would split at the colon, so /c/x.
const msys = (p) => fwd(p).replace(/^([A-Za-z]):/, (m, d) => '/' + d.toLowerCase());

const STUBS = {
  mount: '[ "$1" = --bind ] && echo "overlay $3 none bind 0 0" >> "$HOMETV_MOUNTS"; echo "mount $*" >> "$STUB_LOG"',
  umount: 'grep -v " $1 " "$HOMETV_MOUNTS" > "$HOMETV_MOUNTS.t"; cat "$HOMETV_MOUNTS.t" > "$HOMETV_MOUNTS"; echo "umount $*" >> "$STUB_LOG"',
  systemctl: 'echo "systemctl $*" >> "$STUB_LOG"\ncase "$1" in cat) case " $STUB_SERVICES " in *" ${2%.service} "*) exit 0;; esac; exit 1;; esac\nexit 0',
  'luna-send': 'echo "luna $*" >> "$STUB_LOG"\ncase "$*" in *getForegroundAppInfo*) echo "{\\"appId\\": \\"$STUB_FG\\"}";; *getSystemInfo*) echo \'{"sdkVersion": "10.3.1"}\';; *) echo \'{"returnValue": true}\';; esac',
  pkill: 'echo "pkill $*" >> "$STUB_LOG"',
  pgrep: 'echo "pgrep $*" >> "$STUB_LOG"; case "$*" in *watchdog*) exit 0;; esac; exit 1',
  sleep: 'exit 0'
};

function setup({ homeType = 'flutter', fg = 'com.webos.app.home', services = 'videooutputd umediaserver' } = {}) {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'hometv-root-'));
  const D = path.join(t, 'hometv');
  const bin = path.join(t, 'bin');
  const app = path.join(t, 'app');
  fs.mkdirSync(path.join(D, 'backup'), { recursive: true });
  fs.mkdirSync(bin);
  fs.mkdirSync(app);
  for (const f of fs.readdirSync(ROOT)) if (f !== 'README.md') fs.copyFileSync(path.join(ROOT, f), path.join(D, f));
  fs.writeFileSync(path.join(D, 'backup', 'home-appinfo.orig.json'),
    JSON.stringify({ id: 'com.webos.app.home', type: homeType, main: 'lib/app', splashBackground: 'x.png', title: 'Home' }));
  fs.writeFileSync(path.join(app, 'index.html'), '<title>HomeTV</title>');
  for (const [name, body] of Object.entries(STUBS)) fs.writeFileSync(path.join(bin, name), '#!/bin/sh\n' + body + '\n');
  const mounts = path.join(t, 'mounts');
  fs.writeFileSync(mounts, 'rootfs / rootfs ro 0 0\n');
  const env = {
    ...process.env,
    HOMETV_PATH: [msys(bin), msys(path.dirname(process.execPath)), GITBIN].join(':'),
    HOMETV_DIR: fwd(D), HOMETV_APP: fwd(app), HOMETV_MOUNTS: fwd(mounts), HOMETV_LOG: fwd(path.join(t, 'boot.log')),
    HOMETV_ALIVE: fwd(path.join(t, 'alive')), HOMETV_LASTAPP: fwd(path.join(t, 'lastapp.json')),
    STUB_LOG: fwd(path.join(t, 'stub.log')), STUB_FG: fg, STUB_SERVICES: services,
    HOMETV_WATCH_MAX: '8'
  };
  const run = (script, ...args) => execFileSync(SH, [fwd(path.join(D, script)), ...args], { env, encoding: 'utf8', timeout: 20000 });
  const read = (f) => (fs.existsSync(path.join(t, f)) ? fs.readFileSync(path.join(t, f), 'utf8') : '');
  const mounted = () => read('mounts').includes(' ' + HOME_APP + ' ');
  const waitFor = async (re) => {
    for (let i = 0; i < 100 && !re.test(read('stub.log') + read('boot.log')); i++) await new Promise((r) => setTimeout(r, 50));
  };
  return { t, D, run, read, mounted, waitFor, done: () => fs.rmSync(t, { recursive: true, force: true }) };
}

test('decide.js: only the flutter or web Home is taken over; services by SDK', () => {
  assert.equal(decide.takeover('com.webos.app.home flutter'), 'mount');
  assert.equal(decide.takeover('com.webos.app.home web'), 'mount');
  assert.equal(decide.takeover('com.webos.app.home native'), 'unsupported');
  assert.equal(decide.takeover(''), 'unsupported');
  assert.equal(decide.afterSam('10.3.1', 'com.webos.app.home flutter'), 'videooutputd umediaserver');
  assert.equal(decide.afterSam('11.2.0', 'com.webos.app.home web'), 'arccontroller umediaserver');
  assert.equal(decide.afterSam('9.2.1', 'com.webos.app.home flutter'), '');
  assert.equal(decide.afterSam('10.3.1', 'com.webos.app.home native'), '');
});

test('the start-up hook mounts HomeTV over LG\'s Home, restarts sam and the webOS 25 services', { skip: !SH }, async () => {
  const s = setup();
  try {
    s.run('10-hometv-home');
    assert.ok(s.mounted());
    const info = JSON.parse(fs.readFileSync(path.join(s.D, 'home-overlay', 'appinfo.json'), 'utf8'));
    assert.deepEqual([info.id, info.type, info.main, info.splashBackground], ['com.webos.app.home', 'web', 'index.html', undefined]);
    assert.ok(fs.existsSync(path.join(s.D, 'home-overlay', 'index.html')));
    await s.waitFor(/launch.*com\.webos\.app\.home/);
    const log = s.read('stub.log');
    assert.match(log, /systemctl restart sam/);
    assert.match(log, /systemctl restart videooutputd/);
    assert.match(log, /systemctl restart umediaserver/);
    // a second start (an update) doesn't mount twice or restart sam again
    const before = (log.match(/restart sam/g) || []).length;
    s.run('10-hometv-home');
    assert.equal((s.read('mounts').match(/com\.webos\.app\.home/g) || []).length, 1);
    assert.equal((s.read('stub.log').match(/restart sam/g) || []).length, before);
  } finally {
    s.done();
  }
});

test('"Use LG\'s Home" (DISABLE) and a native Home leave LG\'s Home alone', { skip: !SH }, () => {
  const a = setup();
  try {
    fs.writeFileSync(path.join(a.D, 'DISABLE'), '');
    a.run('10-hometv-home');
    assert.ok(!a.mounted());
    assert.doesNotMatch(a.read('stub.log'), /restart sam/);
  } finally {
    a.done();
  }
  const b = setup({ homeType: 'native' });
  try {
    b.run('10-hometv-home');
    assert.ok(!b.mounted());
    assert.match(b.read('boot.log'), /only takes over the flutter or web Home/);
  } finally {
    b.done();
  }
});

test('undo-home: temp puts LG\'s Home back for now; without temp it stays (DISABLE)', { skip: !SH }, async () => {
  const s = setup();
  try {
    s.run('10-hometv-home');
    await s.waitFor(/launch/);
    s.run('undo-home.sh', 'temp');
    assert.ok(!s.mounted());
    assert.ok(!fs.existsSync(path.join(s.D, 'DISABLE')));
    assert.match(s.read('stub.log'), /umount \/usr\/palm\/applications\/com\.webos\.app\.home/);
    assert.match(s.read('boot.log'), /LG's Home is back until the next restart/);
    s.run('10-hometv-home');
    assert.ok(s.mounted());
    s.run('undo-home.sh');
    assert.ok(!s.mounted());
    assert.ok(fs.existsSync(path.join(s.D, 'DISABLE')));
    s.run('10-hometv-home');
    assert.ok(!s.mounted());
  } finally {
    s.done();
  }
});

test('undo-home with nothing replaced does nothing to sam', { skip: !SH }, () => {
  const s = setup();
  try {
    s.run('undo-home.sh', 'temp');
    assert.doesNotMatch(s.read('stub.log'), /restart sam/);
    assert.match(s.read('boot.log'), /isn't replaced; nothing to undo/);
  } finally {
    s.done();
  }
});

test('the watchdog brings LG\'s Home back when HomeTV\'s page stops answering on screen, not otherwise', { skip: !SH }, async () => {
  const s = setup();
  try {
    s.run('10-hometv-home');
    await s.waitFor(/launch/);
    // alive just now: no fallback within its (capped) checks
    fs.writeFileSync(path.join(s.t, 'alive'), '');
    s.run('watchdog.sh');
    assert.ok(s.mounted());
    // no heartbeat: after six checks, LG's Home until the next restart
    fs.rmSync(path.join(s.t, 'alive'));
    s.run('watchdog.sh');
    assert.ok(!s.mounted());
    assert.match(s.read('boot.log'), /hasn't answered for a minute/);
    assert.ok(!fs.existsSync(path.join(s.D, 'DISABLE')));
  } finally {
    s.done();
  }
});

test('the watchdog leaves things alone while another app is on screen', { skip: !SH }, async () => {
  const s = setup({ fg: 'netflix' });
  try {
    s.run('10-hometv-home');
    await s.waitFor(/after-sam/);
    s.run('watchdog.sh');
    assert.ok(s.mounted());
  } finally {
    s.done();
  }
});
