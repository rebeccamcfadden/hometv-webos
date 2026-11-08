// The light ways back (docs/root-plan.md, levels 0-2) on a PC: HomeTV's service methods that call root/undo-home.sh
// (who may call, which modes, root only, one detached run per press), the page's Home x3 counter and where "Use LG's
// Home" shows, and hometv-lg root --home-again / unroot-home against a pretend TV (fake-ssap.mjs for the screen, Git's
// sh in a folder standing for the TV for the SSH shell, running the real root/ scripts). Nothing touches a real TV.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fakeTv, tvWithState } from './fake-ssap.mjs';
import { fakeRootedTv, SH, fwd } from './fake-telnet.mjs';
import { loadTs } from './ts-module.mjs';
import { runWayBack } from '../tools/lib/way-back.mjs';

const require = createRequire(import.meta.url);
const svc = require('../service/service.js');
const APP = 'com.hometv.app';
const HOME = 'com.webos.app.home';
const HBC = 'org.webosbrew.hbchannel';

function scratch(name) {
  const d = path.resolve('dist', 'test-' + name + '-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(d, { recursive: true });
  return d;
}
const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const call = (methods, name, payload, sender = APP) =>
  new Promise((resolve) => methods[name]({ sender, payload, respond: resolve }));

// --- HomeTV's service

function service({ uid = 0, edition = true } = {}) {
  const t = scratch('svc');
  const dir = path.join(t, 'hometv');
  const initd = path.join(t, 'initd');
  fs.mkdirSync(dir);
  fs.mkdirSync(initd);
  if (edition) fs.writeFileSync(path.join(dir, 'undo-home.sh'), '');
  fs.writeFileSync(path.join(initd, '10-hometv-home'), '');
  const log = { spawned: [], ran: [] };
  const clock = { t: 1_000_000 };
  let fail = false;
  const methods = svc.createMethods({
    rootDir: dir, initd, uid: () => uid, now: () => clock.t,
    spawn: (file, args, opts) => { log.spawned.push({ file, args, opts }); return { on() {}, unref() {} }; },
    execFile: (file, args, opts, cb) => {
      log.ran.push({ file, args });
      if (!fail) { fs.writeFileSync(path.join(dir, 'DISABLE'), ''); fs.rmSync(path.join(initd, '10-hometv-home')); }
      setImmediate(() => cb(fail ? new Error('exit 1') : null));
    }
  });
  return { t, dir, initd, methods, log, clock, failNext: () => { fail = true; }, done: () => fs.rmSync(t, { recursive: true, force: true }) };
}

test('service: rootState and useLgHome answer HomeTV only, as its own app or mounted over LG\'s Home', async () => {
  const s = service();
  try {
    for (const who of ['', 'com.other.app', 'com.hometv.app-evil']) {
      assert.equal((await call(s.methods, 'rootState', {}, who)).errorText, 'not HomeTV', who);
      assert.equal((await call(s.methods, 'useLgHome', { mode: 'temp' }, who)).errorText, 'not HomeTV', who);
    }
    assert.equal(s.log.spawned.length + s.log.ran.length, 0);
    assert.deepEqual(await call(s.methods, 'rootState', {}, HOME), { returnValue: true, edition: true, hooked: true, chosen: false });
  } finally {
    s.done();
  }
});

test('service: useLgHome takes only temp or at-restart, needs root/ on the TV and a service running as root', async () => {
  const s = service();
  try {
    assert.match((await call(s.methods, 'useLgHome', { mode: 'forever' })).errorText, /temp or at-restart/);
    assert.match((await call(s.methods, 'useLgHome', {})).errorText, /temp or at-restart/);
  } finally {
    s.done();
  }
  const jailed = service({ uid: 1000 });
  try {
    assert.match((await call(jailed.methods, 'useLgHome', { mode: 'temp' })).errorText, /isn't running as root/);
  } finally {
    jailed.done();
  }
  const none = service({ edition: false });
  try {
    assert.match((await call(none.methods, 'useLgHome', { mode: 'at-restart' })).errorText, /root edition isn't on this TV/);
    assert.equal(none.log.spawned.length + none.log.ran.length, 0);
  } finally {
    none.done();
  }
});

test('service: Home x3 runs undo-home.sh temp detached, once a minute at most', async () => {
  const s = service();
  try {
    assert.deepEqual(await call(s.methods, 'useLgHome', { mode: 'temp' }, HOME), { returnValue: true });
    assert.equal(s.log.spawned.length, 1);
    const [one] = s.log.spawned;
    assert.equal(one.file, 'sh');
    assert.deepEqual(one.args, [path.join(s.dir, 'undo-home.sh'), 'temp']);
    assert.equal(one.opts.detached, true);
    s.clock.t += 30000;
    assert.equal((await call(s.methods, 'useLgHome', { mode: 'temp' }, HOME)).already, true);
    assert.equal(s.log.spawned.length, 1);
    s.clock.t += 31000;
    await call(s.methods, 'useLgHome', { mode: 'temp' }, HOME);
    assert.equal(s.log.spawned.length, 2);
  } finally {
    s.done();
  }
});

test('service: "Use LG\'s Home" runs undo-home.sh at-restart and answers only once the hook is gone', async () => {
  const s = service();
  try {
    const r = await call(s.methods, 'useLgHome', { mode: 'at-restart' }, HOME);
    assert.deepEqual(r, { returnValue: true, chosen: true, hooked: false });
    assert.deepEqual(s.log.ran[0].args, [path.join(s.dir, 'undo-home.sh'), 'at-restart']);
    assert.deepEqual(await call(s.methods, 'rootState', {}), { returnValue: true, edition: true, hooked: false, chosen: true });
  } finally {
    s.done();
  }
  const f = service();
  try {
    f.failNext();
    const r = await call(f.methods, 'useLgHome', { mode: 'at-restart' });
    assert.equal(r.returnValue, false);
    assert.equal(r.hooked, true);
  } finally {
    f.done();
  }
});

// --- HomeTV's page

const { re, settings } = await loadTs({ re: 'webos/rootEdition.ts', settings: 'screens/settingsGroups.ts' });

test('page: Home pressed three times within two seconds, not slower; then it counts afresh', () => {
  const clock = { t: 0 };
  let fired = 0;
  const p = re.homePresses(() => fired++, () => clock.t);
  for (const dt of [0, 900, 900]) { clock.t += dt; p.press(); }
  assert.equal(fired, 1, 'three in 1.8 s');
  for (const dt of [5000, 1500, 1500, 1500]) { clock.t += dt; p.press(); }
  assert.equal(fired, 1, 'one every 1.5 s never makes three within 2 s');
  clock.t += 10000;
  p.press(); p.press();
  assert.equal(fired, 1);
  p.press();
  assert.equal(fired, 2);
});

test('page: HomeTV knows it is LG\'s Home by its own app id; "Use LG\'s Home" shows on the root edition only', () => {
  assert.equal(re.pageAppId({ webOSSystem: { identifier: 'com.webos.app.home 1234' } }), HOME);
  assert.equal(re.pageAppId({ PalmSystem: { identifier: APP } }), APP);
  assert.equal(re.pageAppId({}), '');
  assert.equal(re.isLgHome({ PalmSystem: { identifier: HOME } }), true);
  assert.equal(re.isLgHome({ PalmSystem: { identifier: APP } }), false);
  assert.equal(re.rootEdition.shows(), false, 'off a TV, no service: hidden');
  const items = (on) => settings.groupsNow(on).reduce((all, g) => all.concat(g.items), []);
  assert.ok(!items(false).includes('lghome'));
  assert.ok(items(true).includes('lghome'));
  assert.deepEqual(items(true).filter((x) => x !== 'lghome'), items(false));
});

// --- hometv-lg root --home-again and unroot-home

/** A pretend rooted TV: its screen (fake SSAP) and its root shell (Git's sh in a folder, the real root/ scripts). */
async function rootedTv({ apps = ['netflix', APP, HBC], keyOk = true, replies = {}, hooks = {} } = {}) {
  const t = scratch('wayback');
  const rooted = fakeRootedTv(path.join(t, 'tv'));
  const bin = path.join(t, 'tv', 'bin');
  for (const c of ['systemctl', 'mount', 'umount', 'pkill', 'pgrep', 'sleep']) fs.writeFileSync(path.join(bin, c), '#!/bin/sh\necho "' + c + ' $*" >> "$STUB_LOG"\nexit 1\n');
  const env = { ...rooted.env, HOMETV_SKIP_ROOT_CHECK: '1', HOMETV_LASTAPP: fwd(path.join(t, 'tv', 'lastapp.json')),
    HOMETV_SBIN: fwd(path.join(t, 'tv', 'sbin')), HOMETV_HOSTS: fwd(path.join(t, 'tv', 'hosts')), HOMETV_DEBLOAT_DELAY: '0' };
  const tvSh = (cmd) => spawnSync(SH, ['-c', rooted.setup + '\n' + cmd], { env, encoding: 'utf8', timeout: 60000 });
  // root/ on the TV, as hometv-lg install leaves it
  for (const f of fs.readdirSync('root')) if (f !== 'README.md') fs.copyFileSync(path.join('root', f), path.join(t, 'tv', 'hometv', f));
  fs.writeFileSync(path.join(t, 'tv', 'app', 'index.html'), '<title>HomeTV</title>');
  const inst = tvSh('sh ' + rooted.tvPaths.dir + '/install.sh');
  assert.equal(inst.status, 0, inst.stderr);
  const state = { apps: [...apps], foreground: HOME };
  const tv = fakeTv(tvWithState(state));
  const ws = await listen(tv.server);
  const laptop = path.join(t, 'laptop');
  fs.mkdirSync(laptop);
  const out = [];
  const asked = [];
  const ctx = {
    host: '127.0.0.1', dir: laptop, tvPaths: rooted.tvPaths, launchWaitMs: 500,
    ssapPorts: [{ url: 'ws://127.0.0.1:' + ws + '/', insecure: false }],
    say: (s) => out.push(s),
    ask: async (q) => {
      asked.push(q);
      for (const [k, fn] of Object.entries(hooks)) if (q.includes(k)) await fn(state);
      for (const [k, a] of Object.entries(replies)) if (q.includes(k)) return a;
      return '';
    },
    rootShell: () => ({
      async run(cmd) {
        if (!keyOk) return { code: 255, stdout: '', stderr: 'Permission denied (publickey).' };
        const r = tvSh(cmd);
        return { code: r.status, stdout: r.stdout, stderr: r.stderr };
      }
    })
  };
  const p = (...x) => path.join(t, 'tv', ...x);
  return {
    t, ctx, state, out, asked, tvSh, p,
    text: () => out.join('\n'),
    hooks: () => fs.readdirSync(p('initd')).sort(),
    done: () => { tv.server.close(); fs.rmSync(t, { recursive: true, force: true }); }
  };
}

test('hometv-lg root --home-again: after "Use LG\'s Home", the hooks come back and DISABLE goes; checked after the restart', { skip: !SH, timeout: 120000 }, async () => {
  const s = await rootedTv({ replies: { 'Make HomeTV': 'y', 'HomeTV on screen': 'y' } });
  try {
    assert.equal(s.tvSh('sh ' + s.ctx.tvPaths.dir + '/undo-home.sh at-restart').status, 0);
    assert.deepEqual(s.hooks(), []);
    const r = await runWayBack(s.ctx, 'home-again');
    assert.ok(r.done, s.text());
    assert.deepEqual(s.hooks(), ['10-hometv-home', '15-hometv-debloat']);
    assert.ok(!fs.existsSync(s.p('hometv', 'DISABLE')));
    assert.match(s.text(), /Undo: Settings > Use LG's Home/);
    assert.match(s.text(), /HomeTV is Home again/);
    assert.ok(!s.text().includes('127.0.0.1'), 'no TV address');
    // run again: nothing to do
    const again = await runWayBack(s.ctx, 'home-again');
    assert.equal(again.note, 'already Home');
  } finally {
    s.done();
  }
});

test('hometv-lg root --home-again: stops on a "no", without the key, or with root/ gone, changing nothing', { skip: !SH, timeout: 120000 }, async () => {
  const no = await rootedTv({ replies: { 'Make HomeTV': 'n' } });
  try {
    no.tvSh('sh ' + no.ctx.tvPaths.dir + '/undo-home.sh at-restart');
    assert.ok((await runWayBack(no.ctx, 'home-again')).stopped);
    assert.deepEqual(no.hooks(), []);
    assert.ok(fs.existsSync(no.p('hometv', 'DISABLE')));
  } finally {
    no.done();
  }
  const key = await rootedTv({ keyOk: false });
  try {
    const r = await runWayBack(key.ctx, 'home-again');
    assert.match(r.why, /doesn't log in to the TV as root/);
    assert.match(key.text(), /Use LG's Home in HomeTV, or level 3/);
  } finally {
    key.done();
  }
  const gone = await rootedTv();
  try {
    gone.tvSh('sh ' + gone.ctx.tvPaths.dir + '/uninstall.sh');
    const r = await runWayBack(gone.ctx, 'home-again');
    assert.match(r.why, /root edition isn't on the TV/);
    assert.match(gone.text(), /--from root-install/);
  } finally {
    gone.done();
  }
});

test('hometv-lg unroot-home: uninstall.sh, the restart, LG\'s Home back and Homebrew Channel opens; level 3 named', { skip: !SH, timeout: 120000 }, async () => {
  const s = await rootedTv({ replies: { 'Remove HomeTV': 'y', 'LG\'s own Home': 'y' } });
  try {
    const r = await runWayBack(s.ctx, 'unroot-home');
    assert.ok(r.done, s.text());
    assert.deepEqual(s.hooks(), []);
    assert.ok(!fs.existsSync(s.p('hometv')));
    assert.ok(fs.existsSync(s.p('app', 'index.html')), 'the HomeTV app stays');
    assert.equal(s.state.foreground, HBC);
    const text = s.text();
    assert.match(text, /This isn't the full unroot: that is level 3/);
    assert.match(text, /Undo: hometv-lg root <tv address> --from root-install/);
    assert.match(text, /Homebrew Channel opens/);
    assert.match(text, /Reset to Initial Settings/);
    assert.ok(!text.includes('127.0.0.1'), 'no TV address');
    assert.ok(s.asked.some((q) => q.includes('once the TV is back on')), 'the restart is asked for');
  } finally {
    s.done();
  }
});

test('hometv-lg unroot-home: HomeTV already uninstalled in Homebrew Channel; stray hooks cleaned; Homebrew Channel missing stops', { skip: !SH, timeout: 120000 }, async () => {
  const s = await rootedTv({ apps: ['netflix'], replies: { 'Remove HomeTV': 'y', 'LG\'s own Home': 'y' } });
  try {
    fs.rmSync(s.p('app'), { recursive: true });
    fs.rmSync(s.p('hometv'), { recursive: true });
    assert.deepEqual(s.hooks(), ['10-hometv-home', '15-hometv-debloat'], 'left behind');
    const r = await runWayBack(s.ctx, 'unroot-home');
    assert.deepEqual(s.hooks(), []);
    assert.match(s.text(), /already gone; removing any start-up hook left behind/);
    assert.match(r.why, /Homebrew Channel didn't open \(missing\)/);
  } finally {
    s.done();
  }
  const no = await rootedTv({ replies: { 'Remove HomeTV': '' } });
  try {
    assert.ok((await runWayBack(no.ctx, 'unroot-home')).stopped);
    assert.deepEqual(no.hooks(), ['10-hometv-home', '15-hometv-debloat'], 'nothing changed');
  } finally {
    no.done();
  }
});

test('the command line: unroot-home and root --home-again need an address', { timeout: 30000 }, () => {
  for (const args of [['unroot-home'], ['root', '--home-again']]) {
    let err;
    try {
      execFileSync(process.execPath, ['tools/hometv-lg.mjs', ...args], { encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      err = e;
    }
    assert.equal(err && err.status, 2, args.join(' '));
    assert.match(String(err.stderr), /Usage: hometv-lg (unroot-home|root <tv address> --home-again)/);
  }
  const help = spawnSync(process.execPath, ['tools/hometv-lg.mjs', 'help'], { encoding: 'utf8' });
  assert.match(help.stdout, /unroot-home <tv address>/);
  assert.match(help.stdout, /--home-again/);
});
