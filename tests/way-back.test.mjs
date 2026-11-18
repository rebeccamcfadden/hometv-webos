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
    for (const who of ['', 'com.other.app', 'com.hometv.app-evil', 'com.hometv.app-1', 'com.webos.app.home-12345678']) {
      assert.equal((await call(s.methods, 'rootState', {}, who)).errorText, 'not HomeTV', who);
      assert.equal((await call(s.methods, 'useLgHome', { mode: 'temp' }, who)).errorText, 'not HomeTV', who);
    }
    assert.equal(s.log.spawned.length + s.log.ran.length, 0);
    assert.deepEqual(await call(s.methods, 'rootState', {}, HOME), { returnValue: true, edition: true, hooked: true, chosen: false, ranThisStart: null });
    assert.equal((await call(s.methods, 'rootState', {}, APP + ' 12')).returnValue, true, 'an instance after a space');
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
    assert.deepEqual(await call(s.methods, 'rootState', {}), { returnValue: true, edition: true, hooked: false, chosen: true, ranThisStart: null });
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

test('service: alive takes LG\'s Home with any instance or suffix (HomeTV mounted over it); refusals and the first beat go to the boot log', async () => {
  const t = scratch('alive');
  const log = path.join(t, 'boot.log');
  try {
    const methods = svc.createMethods({ logFile: log, uptime: () => '61.20', alive: path.join(t, 'alive') });
    const msg = (sender, appId) => new Promise((resolve) => methods.alive({ sender, payload: {}, respond: resolve,
      ls2Message: appId === undefined ? undefined : { applicationID: () => appId, senderServiceName: () => '' } }));
    for (const who of [HOME, HOME + ' 1', HOME + '-12', HOME + '-0b6f9c5e', APP, APP + ' 7', '']) {
      assert.equal(svc.allowed({ sender: who }), true, who);
    }
    for (const who of ['com.webos.app.homeevil', 'com.other.app', 'com.hometv.app-evil']) assert.equal(svc.allowed({ sender: who }), false, who);
    // the methods that change Home stay exact
    assert.equal((await call(methods, 'rootState', {}, HOME + '-12')).errorText, 'not HomeTV');
    assert.equal((await msg('com.other.app<x>', 'com.other.app<x> 99')).errorText, 'not HomeTV');
    await msg('com.other.app<x>', 'com.other.app<x> 99');
    const text = fs.readFileSync(log, 'utf8');
    assert.match(text, /^61\.20 service: refused rootState from 'com\.webos\.app\.home-12'$/m);
    assert.equal((text.match(/refused alive from 'com\.other\.app\?x\?' \(app id 'com\.other\.app\?x\? 99'\)/g) || []).length, 1, 'once per caller and method, ids only');
    // a beat that counts: the heartbeat touched, noted once, with who sent it
    assert.deepEqual(await msg(HOME, HOME + ' 4321'), { returnValue: true });
    await msg(HOME, HOME + ' 4321');
    assert.ok(fs.existsSync(path.join(t, 'alive')));
    const after = fs.readFileSync(log, 'utf8');
    assert.equal((after.match(/service: first heartbeat, from 'com\.webos\.app\.home' \(app id 'com\.webos\.app\.home 4321'\)/g) || []).length, 1);
  } finally {
    fs.rmSync(t, { recursive: true, force: true });
  }
});

test('page: the heartbeat falls back to 127.0.0.1 when the service refuses, and keeps the trouble after three failed calls', async () => {
  const hb = await loadTs('webos/heartbeat.ts');
  const store = new Map();
  let writes = 0;
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => (writes++, store.set(k, v)), removeItem: (k) => store.delete(k) };
  let reply = { returnValue: false, errorCode: -1, errorText: 'Denied method call "alive" for category "/"' };
  let status = 204;
  let as = HOME + ' 1234';
  const got = [];
  const beat = hb.createHeartbeat({
    call: async () => reply, get: async (url) => (got.push(url), status), storage,
    as: () => as, hidden: () => false, now: () => Date.UTC(2026, 10, 18, 17, 34),
  });
  assert.equal(await beat(), 'loopback');
  assert.match(got[0], /^http:\/\/127\.0\.0\.1:8767\/alive\?why=Denied%20method%20call.*&as=com\.webos\.app\.home%201234&hidden=0$/);
  await beat();
  assert.equal(hb.heartbeatTrouble(storage), null, 'not kept before the third');
  status = 0;
  assert.equal(await beat(), 'none');
  const t = hb.heartbeatTrouble(storage);
  assert.deepEqual([t.as, t.luna, t.loopback, t.hidden], [HOME + ' 1234', reply.errorText, 'no answer', false]);
  assert.match(hb.heartbeatText(t), /running as com\.webos\.app\.home 1234\): HomeTV’s service said “Denied method call "alive" for category "\/"”; the 127\.0\.0\.1 way: no answer\./);
  await beat();
  await beat();
  assert.equal(writes, 1, 'written when it changes, not at every beat');
  // the service answers HomeTV opened from its tile: the trouble as LG's Home stays for the Checks screen
  reply = { returnValue: true };
  as = APP + ' 9';
  assert.equal(await beat(), 'service');
  assert.equal(got.length, 5, 'no fallback when the service answers');
  assert.ok(hb.heartbeatTrouble(storage));
  // the service answers the page as LG's Home again: dropped
  as = HOME + ' 1234';
  await beat();
  assert.equal(hb.heartbeatTrouble(storage), null);
  assert.equal(hb.heartbeatText(null), '');
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

// The restart with the hooks in: HomeTV mounted over LG's Home and its page's heartbeat fresh, as 10-hometv-home leaves it
const takeover = (t) => () => {
  fs.appendFileSync(path.join(t, 'tv', 'mounts'), 'overlay /usr/palm/applications/com.webos.app.home none bind 0 0\n');
  fs.writeFileSync(path.join(t, 'tv', 'alive'), '');
};

test('hometv-lg root --home-again: after "Use LG\'s Home", the hooks come back and DISABLE goes; checked after the restart', { skip: !SH, timeout: 120000 }, async () => {
  const box = {};
  const s = await rootedTv({ replies: { 'Make HomeTV': 'y', 'HomeTV on screen': 'y' }, hooks: { 'back on': () => takeover(box.t)() } });
  box.t = s.t;
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

test('hometv-lg root --home-again: a takeover that doesn\'t come up after the restart is rolled back', { skip: !SH, timeout: 120000 }, async () => {
  const s = await rootedTv({ replies: { 'Make HomeTV': 'y', 'HomeTV on screen': 'y' } });
  s.ctx.verifyWaitMs = 0;
  try {
    s.tvSh('sh ' + s.ctx.tvPaths.dir + '/undo-home.sh at-restart');
    const r = await runWayBack(s.ctx, 'home-again');
    assert.match(r.why, /didn't come up as Home \(HomeTV isn't mounted over LG's Home\), so it was rolled back/);
    assert.deepEqual(s.hooks(), [], 'the hooks are out again');
    assert.ok(fs.existsSync(s.p('hometv', 'DISABLE')));
    assert.ok(fs.existsSync(s.p('hometv', 'install.sh')), 'the root edition stays, for --home-again later');
  } finally {
    s.done();
  }
});

test('hometv-lg root --home-again --watch: reports the heartbeat and the boot notes, masked, before deciding', { skip: !SH, timeout: 120000 }, async () => {
  const box = {};
  const notes = (t) => fs.appendFileSync(path.join(t, 'tv', 'boot.log'),
    '59.10 home: mounting HomeTV over LG\'s Home, restarting sam\n61.00 home: bus groups: files read 3; com.webos.app.home: applications; com.hometv.app.service: public; shared: none\n' +
    '75.30 service: refused alive from \'com.webos.app.home-9\' (seen from 127.0.0.1)\n80.00 something else entirely\n');
  const s = await rootedTv({ replies: { 'Make HomeTV': 'y', 'HomeTV on screen': 'y' }, hooks: { 'back on': () => { takeover(box.t)(); notes(box.t); } } });
  box.t = s.t;
  Object.assign(s.ctx, { watch: true, watchEveryMs: 0, watchMs: 2000, verifyWaitMs: 0 });
  try {
    s.tvSh('sh ' + s.ctx.tvPaths.dir + '/undo-home.sh at-restart');
    const r = await runWayBack(s.ctx, 'home-again');
    assert.ok(r.done, s.text());
    const text = s.text();
    assert.match(text, /Watching HomeTV for up to/);
    assert.match(text, /0:0\d {2}HomeTV mounted, heartbeat \d+ s ago/);
    assert.match(text, /home: bus groups: .*shared: none/);
    assert.match(text, /service: refused alive from 'com\.webos\.app\.home-9'/);
    assert.ok(!/something else entirely/.test(text), 'only the notes it watches');
    assert.equal((text.match(/refused alive from/g) || []).length, 1, 'each note once');
    assert.match(text, /HomeTV's page answers/);
    assert.match(text, /HomeTV is Home again/);
    assert.ok(!text.includes('127.0.0.1'), 'no TV address');
  } finally {
    s.done();
  }
});

test('hometv-lg root --home-again: a page that never answers is rolled back, with what the TV noted about the heartbeat', { skip: !SH, timeout: 120000 }, async () => {
  const box = {};
  const s = await rootedTv({ replies: { 'Make HomeTV': 'y', 'HomeTV on screen': 'y' }, hooks: { 'back on': () => {
    fs.appendFileSync(path.join(box.t, 'tv', 'mounts'), 'overlay /usr/palm/applications/com.webos.app.home none bind 0 0\n');
    fs.appendFileSync(path.join(box.t, 'tv', 'boot.log'), '70.00 heartbeat: the page\'s call to HomeTV\'s service failed: Denied method call\n');
  } } });
  box.t = s.t;
  Object.assign(s.ctx, { verifyWaitMs: 0, firstBeatMs: 1000 });
  try {
    s.tvSh('sh ' + s.ctx.tvPaths.dir + '/undo-home.sh at-restart');
    const r = await runWayBack(s.ctx, 'home-again');
    const text = s.text();
    assert.match(text, /Waiting for HomeTV's page to answer/);
    assert.match(text, /What the TV noted about the heartbeat[\s\S]*service failed: Denied method call/);
    assert.match(r.why, /HomeTV's page isn't answering\), so it was rolled back/);
    assert.deepEqual(s.hooks(), []);
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
