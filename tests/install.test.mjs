// hometv-lg install against pretend TVs: the remote-control connection (fake-ssap.mjs, with apps and a screen that
// change), Homebrew Channel's Telnet (fake-telnet.mjs: Git's sh in a folder standing for the TV, stub luna-send), a
// pretend SlopBro, and a pretend SSH port. Each step's pass and stop paths, the typed confirmation before root, the
// resume, and that the TV's address, serial and device id never reach the output, the log or the saved state.
// Nothing here touches a real TV or runs SlopBro. The Telnet parts are skipped where no sh is found.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fakeTv, tvWithState } from './fake-ssap.mjs';
import { fakeTelnet, fakeRootedTv, SH } from './fake-telnet.mjs';
import { runInstall, STEPS, ROOT_STEPS, loadState, scrub, rootFiles } from '../tools/lib/install-steps.mjs';
import { telnetParser, telnetShell, pushFile } from '../tools/lib/telnet.mjs';

const APP = 'com.hometv.app';
const HOME = 'com.webos.app.home';
const DEVMODE = 'com.palmdts.devmode';
const HBC = 'org.webosbrew.hbchannel';
const SECRETS = ['SECRET123', 'aa:bb:cc', '127.0.0.1', os.homedir()];

function scratch(name) {
  const d = path.resolve('dist', 'test-' + name + '-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(d, { recursive: true });
  return d;
}
const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
async function closedPort() { const s = net.createServer(); const p = await listen(s); await new Promise((r) => s.close(r)); return p; }

/** A whole pretend set-up: the TV's remote-control side, its rooted shell, the laptop folder, the root kit. */
async function setup({ apps = ['netflix', DEVMODE], minor, telnet = true, telnetEnv = {}, replies = {}, hooks = {} } = {}) {
  const t = scratch('install');
  const state = { apps: [...apps], foreground: HOME, minor };
  const tv = fakeTv(tvWithState(state));
  const ws = await listen(tv.server);
  const laptop = path.join(t, 'laptop');
  fs.mkdirSync(laptop);
  const kitDir = path.join(t, 'kit');
  fs.mkdirSync(kitDir);
  fs.writeFileSync(path.join(kitDir, 'python.exe'), '');
  fs.writeFileSync(path.join(kitDir, 'slopbro_packed.py'), '# a pretend SlopBro\n');
  const kit = { python: path.join(kitDir, 'python.exe'), slopbro: path.join(kitDir, 'slopbro_packed.py'),
    sha256: crypto.createHash('sha256').update('# a pretend SlopBro\n').digest('hex') };
  const ipk = path.join(t, 'com.hometv.app_0.0.1_all.ipk');
  fs.writeFileSync(ipk, crypto.randomBytes(40000));
  const rooted = fakeRootedTv(path.join(t, 'tv'), telnetEnv);
  let tn = null;
  let telnetPort = await closedPort();
  if (telnet && SH) {
    tn = fakeTelnet({ env: rooted.env, setup: rooted.setup });
    telnetPort = await listen(tn.server);
  }
  const ssh = net.createServer((s) => s.end());
  const sshPort = await listen(ssh);
  const out = [];
  const asked = [];
  const slopbro = [];
  const logins = [];
  const flags = { defaultPassword: false, lost: [] };
  const ctx = {
    host: '127.0.0.1', dir: laptop, ipk, kit,
    ssapPorts: [{ url: 'ws://127.0.0.1:' + ws + '/', insecure: false }],
    reachAddress: '127.0.0.1', reachWaitMs: 5000, launchWaitMs: 2000,
    telnetPort, sshPort, tvPaths: rooted.tvPaths, telnetTimeoutMs: 60000,
    say: (s) => out.push(s),
    ask: async (q) => {
      asked.push(q);
      for (const [re, fn] of Object.entries(hooks)) if (q.includes(re)) await fn();
      for (const [re, a] of Object.entries(replies)) if (q.includes(re)) return a;
      return '';
    },
    runSlopbro: async (k, host) => { slopbro.push(host); state.apps.push(HBC); return 0; },
    // a pretend Windows ssh (tools/lib/root-shell.mjs's shape): root when the key is the one the TV was given; answers
    // the restart check's key-only check and Homebrew Channel's switches from the folder standing for the TV
    rootShell: (o) => ({
      async run(cmd) {
        logins.push({ ...o, cmd });
        const ak = path.join(t, 'tv', 'ssh', 'authorized_keys');
        const ok = fs.existsSync(ak) && fs.existsSync(o.key + '.pub') &&
          fs.readFileSync(ak, 'utf8').includes(fs.readFileSync(o.key + '.pub', 'utf8').trim());
        if (!ok) return { code: 255, stdout: '', stderr: 'Permission denied (publickey).' };
        if (cmd === 'id -u') return { code: 0, stdout: '0\n', stderr: '' };
        if (cmd.includes('/etc/shadow')) return { code: 0, stdout: 'authorized-keys\n' + (flags.defaultPassword ? 'default-password\n' : ''), stderr: '' };
        if (cmd.includes('hbchannel.service/getConfiguration')) {
          const f = (n) => !flags.lost.includes(n) && fs.existsSync(path.join(t, 'tv', 'prefs', 'webosbrew_' + n));
          return { code: 0, stdout: JSON.stringify({ returnValue: true, root: true, telnetDisabled: f('telnet_disabled'), sshdEnabled: f('sshd_enabled'), blockUpdates: f('block_updates') }), stderr: '' };
        }
        return { code: 127, stdout: '', stderr: 'not in the pretend ssh' };
      }
    })
  };
  const done = async () => {
    tv.server.close();
    ssh.close();
    if (tn) await tn.stop();
    fs.rmSync(t, { recursive: true, force: true });
  };
  return { t, ctx, state, out, asked, slopbro, logins, tn, rooted, laptop, flags, done, text: () => out.join('\n') };
}

// The answers a person gives on the happy path; the hooks do what the person does on the TV meanwhile.
function happy(s) {
  return {
    replies: {
      'Dev Manager says': '', 'Go on to the root steps': 'y', 'restarted since': 'y', 'USB stick': 'y',
      'Automatic Updates': 'y', 'root the TV': 'Root the TV', 'HomeTV on screen': 'y'
    },
    hooks: {
      'Dev Manager says': () => s.state.apps.push(APP),
      // deleting the Developer Mode app takes the apps installed through it with it
      'Go on to the root steps': () => { s.state.apps = s.state.apps.filter((a) => a !== DEVMODE && a !== APP); },
      'back on': async () => { s.state.foreground = HOME; if (s.tn) await s.tn.stop(); }
    }
  };
}

async function happySetup(opts = {}) {
  const box = {};
  const s = await setup({ ...opts, ...happy(box), ...(opts.over || {}) });
  box.state = s.state;
  box.tn = s.tn;
  return s;
}

function noSecrets(s) {
  const all = s.text() + fs.readFileSync(path.join(s.laptop, 'install-log.txt'), 'utf8') +
    fs.readFileSync(path.join(s.laptop, 'install-state.json'), 'utf8');
  for (const x of SECRETS) assert.ok(!all.includes(x), 'leaked: ' + x);
}

test('the steps are data, in the decided order (docs/root-plan.md)', () => {
  assert.deepEqual(STEPS.map((s) => s.id),
    ['backup', 'dev-install', 'go-on', 'root-checks', 'root', 'hbc-check', 'root-install', 'restart-check']);
  for (const s of STEPS) assert.ok(s.title && s.what && s.undo && typeof s.run === 'function', s.id);
});

test('scrub takes out addresses, MACs and the home folder, keeps software versions', () => {
  const s = scrub('wss://192.168.1.50:3001/ aa:bb:cc:dd:ee:ff 33.31.61 10.3.1-3001 ' + path.join(os.homedir(), 'HomeTV') + ' tv.local', 'tv.local');
  assert.equal(s, 'wss://<ip>:3001/ <mac> 33.31.61 10.3.1-3001 ' + path.join('%USERPROFILE%', 'HomeTV') + ' <tv ip>');
});

test('root files go with Unix line ends, all but the README', () => {
  const files = rootFiles();
  assert.ok(files.some((f) => f.name === 'install.sh') && !files.some((f) => f.name === 'README.md'));
  for (const f of files) assert.ok(!f.data.includes(13), f.name + ' has CR');
});

test('Telnet: option questions answered and dropped, even split across reads', () => {
  const sent = [];
  const parse = telnetParser((b) => sent.push(b));
  const a = parse(Buffer.from([255, 253, 1, 104, 105, 255]));
  const b = parse(Buffer.from([251, 1, 255, 250, 31, 0, 80, 255, 240, 33, 255, 255]));
  assert.equal(Buffer.concat([a, b]).toString('latin1'), 'hi!\xff');
  assert.deepEqual(sent, [[255, 252, 1], [255, 253, 1]]);
});

test('Telnet: commands end at their marker with the exit status; a file arrives intact and checked', { skip: !SH }, async () => {
  const t = scratch('telnet');
  const rooted = fakeRootedTv(t);
  const tn = fakeTelnet({ env: rooted.env, setup: rooted.setup });
  const port = await listen(tn.server);
  try {
    const sh = await telnetShell('127.0.0.1', { port });
    assert.deepEqual(await sh.run('echo one; false'), { code: 1, out: 'one\n' });
    assert.equal((await sh.run('echo "uid=$(id -u)"')).out.trim(), 'uid=0');
    const data = crypto.randomBytes(100000);
    const remote = rooted.tvPaths.tmp + '/blob';
    await pushFile(sh, remote, data);
    assert.ok(fs.readFileSync(path.join(t, 'tmp', 'blob')).equals(data));
    assert.ok(!fs.existsSync(path.join(t, 'tmp', 'blob.b64')));
    sh.close();
  } finally {
    await tn.stop();
    fs.rmSync(t, { recursive: true, force: true });
  }
});

test('the whole way: backup, Developer Mode, checks, root, Homebrew Channel, root edition, restart', { skip: !SH, timeout: 180000 }, async () => {
  const s = await happySetup();
  try {
    const r = await runInstall(s.ctx);
    assert.deepEqual(r, { done: true }, s.text());
    const st = loadState(s.laptop);
    for (const step of STEPS) assert.equal(st.steps[step.id].status, 'done', step.id);
    // step 1: a backup on the laptop, allowlisted
    const backup = fs.readdirSync(s.laptop).find((f) => /^lg-backup-.*\.json$/.test(f));
    const b = fs.readFileSync(path.join(s.laptop, backup), 'utf8');
    assert.ok(!b.includes('SECRET123') && !b.includes('aa:bb:cc'));
    // step 4: the typed phrase, then SlopBro with the address
    assert.deepEqual(s.slopbro, ['127.0.0.1']);
    // step 7: scripts copied, HomeTV put back from the .ipk, install.sh's hooks, the key, the switches
    const tv = (...p) => path.join(s.t, 'tv', ...p);
    for (const f of rootFiles()) assert.ok(fs.readFileSync(tv('hometv', f.name)).equals(f.data), f.name);
    assert.ok(fs.existsSync(tv('app', 'index.html')));
    assert.ok(!fs.existsSync(tv('tmp', 'hometv.ipk')));
    assert.ok(fs.existsSync(tv('initd', '10-hometv-home')) && fs.existsSync(tv('initd', '15-hometv-debloat')));
    assert.ok(fs.existsSync(tv('hometv', 'backup', 'home-appinfo.orig.json')));
    const pub = fs.readFileSync(path.join(s.laptop, 'lg-root-key.pub'), 'utf8').trim();
    assert.match(pub, /^ssh-ed25519 \S+ hometv-lg$/);
    assert.equal(fs.readFileSync(tv('ssh', 'authorized_keys'), 'utf8').trim(), pub);
    assert.ok(fs.existsSync(tv('prefs', 'webosbrew_telnet_disabled')) && fs.existsSync(tv('prefs', 'webosbrew_sshd_enabled')));
    assert.ok(fs.existsSync(tv('prefs', 'webosbrew_block_updates')), 'Block system updates is switched on');
    const stub = fs.readFileSync(tv('stub.log'), 'utf8');
    assert.match(stub, /appInstallService\/dev\/install .*com\.ares\.defaultName/);
    assert.match(s.text(), /Telnet off, SSH on and Block system updates on/);
    assert.match(s.text(), /All steps done: HomeTV is Home\./);
    // step 8 logs in with exactly the key and known-hosts file hometv-lg restore uses, then checks the lock-down
    assert.deepEqual(s.logins.map((l) => [l.key, l.knownHosts]),
      s.logins.map(() => [path.join(s.laptop, 'lg-root-key'), path.join(s.laptop, 'lg-known-hosts')]));
    assert.equal(s.logins[0].cmd, 'id -u');
    assert.match(s.logins[1].cmd, /authorized_keys.*grep -q '\^root:xGVw8H4GqkKg6:' \/etc\/shadow/);
    assert.match(s.logins[2].cmd, /hbchannel\.service\/getConfiguration/);
    assert.match(s.text(), /Telnet off, SSH by key only, Block system updates on/);
    assert.match(fs.readFileSync(path.join(s.laptop, 'lg-root-key'), 'utf8'), /^-----BEGIN OPENSSH PRIVATE KEY-----\n/);
    noSecrets(s);

    // run again: everything is done, nothing runs twice
    const before = s.tn.seen.connections;
    const again = await runInstall(s.ctx);
    assert.deepEqual(again, { done: true });
    assert.equal(s.slopbro.length, 1);
    assert.equal(s.tn.seen.connections, before);
  } finally {
    await s.done();
  }
});

test('stop: the software isn\'t 33.31.61, so no root', async () => {
  const s = await happySetup({ minor: '31.70', telnet: false });
  try {
    assert.deepEqual(await runInstall(s.ctx), { stopped: 'root-checks' });
    assert.match(s.text(), /software is 33\.31\.70, not 33\.31\.61/);
    assert.deepEqual(s.slopbro, []);
    noSecrets(s);
  } finally {
    await s.done();
  }
});

test('stop: the Developer Mode app is still installed before root (SlopBro issue 22)', async () => {
  const box = {};
  // HomeTV gets installed, but nobody deletes the Developer Mode app
  const s = await setup({ telnet: false, replies: happy(box).replies, hooks: { 'Dev Manager says': () => box.state.apps.push(APP) } });
  box.state = s.state;
  try {
    assert.deepEqual(await runInstall(s.ctx), { stopped: 'root-checks' });
    assert.match(s.text(), /Developer Mode app is still installed/);
    assert.match(s.text(), /SlopBro issue 22/);
    assert.deepEqual(s.slopbro, []);
  } finally {
    await s.done();
  }
});

test('the person can stop before root, and the next run carries on there', async () => {
  const s = await happySetup({ telnet: false, over: { replies: { 'Dev Manager says': '', 'Go on to the root steps': '' } } });
  try {
    assert.deepEqual(await runInstall(s.ctx), { paused: 'go-on' });
    assert.equal(loadState(s.laptop).steps['dev-install'].status, 'done');
    assert.match(s.text(), /Stopped before root/);
    s.out.length = 0;
    // next time: the done steps are skipped, the question comes again
    assert.deepEqual(await runInstall(s.ctx), { paused: 'go-on' });
    assert.match(s.text(), /Step 1 of 8: Back up what the laptop can read \(done/);
    assert.match(s.text(), /Step 2 of 8: HomeTV without root \(Developer Mode\) \(done/);
  } finally {
    await s.done();
  }
});

test('Developer Mode step: HomeTV must be listed and open, or it stops', async () => {
  const s = await happySetup({ telnet: false });
  s.state.noOpen = [APP];
  try {
    assert.deepEqual(await runInstall(s.ctx), { stopped: 'dev-install' });
    assert.match(s.text(), /installed but didn't open/);
  } finally {
    await s.done();
  }
  const n = await happySetup({ telnet: false, over: { hooks: {} } });
  try {
    assert.deepEqual(await runInstall(n.ctx), { stopped: 'dev-install' });
    assert.match(n.text(), /doesn't list HomeTV/);
  } finally {
    await n.done();
  }
});

test('the confirmation phrase: anything else and SlopBro never runs', async () => {
  for (const typed of ['', 'yes', 'root', 'root the tv please']) {
    const s = await happySetup({ telnet: false });
    s.ctx.ask = ((ask) => async (q) => (q.includes('root the TV') ? typed : ask(q)))(s.ctx.ask);
    try {
      assert.deepEqual(await runInstall(s.ctx), { paused: 'root' }, typed);
      assert.deepEqual(s.slopbro, []);
      assert.match(s.text(), /Not started: nothing changed on the TV/);
      assert.match(s.text(), /factory reset/);
    } finally {
      await s.done();
    }
  }
});

test('stop: the root kit isn\'t the checked one', async () => {
  const s = await happySetup({ telnet: false });
  fs.appendFileSync(s.ctx.kit.slopbro, 'changed');
  try {
    assert.deepEqual(await runInstall(s.ctx), { stopped: 'root-checks' });
    assert.match(s.text(), /SHA-256 differs/);
    assert.match(s.text(), /hometv-lg get root-kit/);
    assert.deepEqual(s.slopbro, []);
  } finally {
    await s.done();
  }
});

test('stop: USB stick or automatic updates not confirmed', async () => {
  for (const [q, msg] of [['USB stick', /USB stick with LG's firmware isn't ready/], ['Automatic Updates', /automatic updates may still be on/]]) {
    const s = await happySetup({ telnet: false });
    s.ctx.ask = ((ask) => async (x) => (x.includes(q) ? 'n' : ask(x)))(s.ctx.ask);
    try {
      assert.deepEqual(await runInstall(s.ctx), { stopped: 'root-checks' });
      assert.match(s.text(), msg);
      assert.deepEqual(s.slopbro, []);
    } finally {
      await s.done();
    }
  }
});

test('stop: SlopBro fails, then Homebrew Channel missing after root (Q-R2)', async () => {
  const s = await happySetup({ telnet: false });
  s.ctx.runSlopbro = async () => 3;
  try {
    assert.deepEqual(await runInstall(s.ctx), { stopped: 'root' });
    assert.match(s.text(), /exit code 3/);
  } finally {
    await s.done();
  }
  const m = await happySetup({ telnet: false });
  m.ctx.runSlopbro = async () => 0; // "complete", but no Homebrew Channel after the restart
  try {
    assert.deepEqual(await runInstall(m.ctx), { stopped: 'hbc-check' });
    assert.match(m.text(), /Homebrew Channel isn't on the TV after root/);
    assert.match(m.text(), /Don't run SlopBro again/);
    noSecrets(m);
  } finally {
    await m.done();
  }
});

test('stop: Telnet closed, so nothing is copied', async () => {
  const s = await happySetup({ telnet: false });
  try {
    assert.deepEqual(await runInstall(s.ctx), { stopped: 'root-install' });
    assert.match(s.text(), /Telnet isn't answering/);
  } finally {
    await s.done();
  }
});

test('stop: Homebrew Channel not running as root', { skip: !SH }, async () => {
  const s = await happySetup({ telnetEnv: { STUB_HBC_ROOT: 'false' } });
  try {
    assert.deepEqual(await runInstall(s.ctx), { stopped: 'root-install' });
    assert.match(s.text(), /isn't running as root/);
    assert.ok(!fs.existsSync(path.join(s.t, 'tv', 'hometv', 'install.sh')));
  } finally {
    await s.done();
  }
});

test('stop: install.sh refuses (Developer Mode app found on the TV); Telnet is left on', { skip: !SH }, async () => {
  const s = await happySetup();
  fs.mkdirSync(path.join(s.t, 'tv', 'devmode-app'));
  try {
    assert.deepEqual(await runInstall(s.ctx), { stopped: 'root-install' });
    assert.match(s.text(), /install\.sh refused: install: the Developer Mode app is installed/);
    assert.ok(!fs.existsSync(path.join(s.t, 'tv', 'initd', '10-hometv-home')));
    assert.ok(!fs.existsSync(path.join(s.t, 'tv', 'prefs', 'webosbrew_telnet_disabled')));
    noSecrets(s);
  } finally {
    await s.done();
  }
});

test('stop: HomeTV can\'t be put back on the rooted TV', { skip: !SH }, async () => {
  const s = await happySetup({ telnetEnv: { STUB_INSTALL_FAIL: '1' } });
  try {
    assert.deepEqual(await runInstall(s.ctx), { stopped: 'root-install' });
    assert.match(s.text(), /couldn't be installed again/);
  } finally {
    await s.done();
  }
});

test('stop: Homebrew Channel ignores the Telnet and SSH switches', { skip: !SH }, async () => {
  const s = await happySetup({ telnetEnv: { STUB_HBC_IGNORE: '1' } });
  try {
    assert.deepEqual(await runInstall(s.ctx), { stopped: 'root-install' });
    assert.match(s.text(), /didn't take the change/);
  } finally {
    await s.done();
  }
});

test('restart check: Telnet still open, or not HomeTV on screen, stops', { skip: !SH, timeout: 180000 }, async () => {
  const s = await happySetup();
  s.ctx.ask = ((ask) => async (q) => (q.includes('back on') ? '' : ask(q)))(s.ctx.ask); // the port stays open
  try {
    assert.deepEqual(await runInstall(s.ctx), { stopped: 'restart-check' });
    assert.match(s.text(), /Telnet is still on/);
    // after the person fixes it, only the restart check runs again
    await s.tn.stop();
    s.ctx.ask = ((ask) => async (q) => (q.includes('HomeTV on screen') ? 'n' : ask(q)))(s.ctx.ask);
    assert.deepEqual(await runInstall(s.ctx), { stopped: 'restart-check' });
    assert.match(s.text(), /HomeTV didn't take over Home/);
    assert.match(s.text(), /root@<tv ip>/);
    noSecrets(s);
  } finally {
    await s.done();
  }
});

test('restart check: SSH answers but the key doesn\'t log in', { skip: !SH, timeout: 180000 }, async () => {
  const s = await happySetup();
  s.ctx.rootShell = () => ({ run: async () => ({ code: 255, stdout: '', stderr: 'Permission denied (publickey).' }) });
  try {
    assert.deepEqual(await runInstall(s.ctx), { stopped: 'restart-check' });
    assert.match(s.text(), /doesn't log in as root/);
  } finally {
    await s.done();
  }
});

test('--from runs again from a step on', async () => {
  const s = await happySetup({ telnet: false, over: { replies: { 'Go on to the root steps': '' } } });
  try {
    await runInstall(s.ctx);
    assert.equal(loadState(s.laptop).steps.backup.status, 'done');
    s.out.length = 0;
    await runInstall(s.ctx, { from: 'backup' });
    assert.doesNotMatch(s.text(), /\(done /);
    await assert.rejects(runInstall(s.ctx, { from: 'nope' }), /no step named nope/);
  } finally {
    await s.done();
  }
});

test('the command line: --list, usage, and the double-click menu\'s install choice', { timeout: 60000 }, async () => {
  const { spawn, execFileSync } = await import('node:child_process');
  const dir = scratch('cli');
  const state = { apps: [APP], foreground: HOME };
  const tv = fakeTv(tvWithState(state));
  const port = await listen(tv.server);
  try {
    const env = { ...process.env, HOMETV_DIR: dir, HOMETV_NO_EXPLORER: '1', HOMETV_TEST_WS_PORT: String(port) };
    assert.match(execFileSync(process.execPath, ['tools/hometv-lg.mjs', 'install', '--list'], { env, encoding: 'utf8' }), /^1\. backup +not run/);
    assert.throws(() => execFileSync(process.execPath, ['tools/hometv-lg.mjs', 'install', '127.0.0.1', '--from', 'nope'], { env, stdio: 'pipe' }), /Usage/);
    const out = await new Promise((resolve, reject) => {
      const p = spawn(process.execPath, ['tools/hometv-lg.mjs'], { env });
      let text = '';
      const timer = setTimeout(() => { p.kill(); reject(new Error('timed out:\n' + text)); }, 40000);
      p.stdout.on('data', (d) => {
        text += d;
        if (/\[1\]: $/.test(text)) p.stdin.write('3\n');
        else if (/address and press Enter: $/.test(text)) p.stdin.write('127.0.0.1\n');
        else if (/\[y\/N\] $/.test(text)) p.stdin.write('n\n');
        else if (/Press Enter to close\. $/.test(text)) p.stdin.write('\n');
      });
      p.on('exit', () => { clearTimeout(timer); resolve(text); });
    });
    assert.match(out, /Step 1 of 8: Back up/);
    assert.match(out, /HomeTV is installed and opens/);
    assert.match(out, /Stopped before root/);
    assert.ok(!out.includes('SECRET123') && !out.includes('aa:bb:cc'));
    assert.ok(!fs.readFileSync(path.join(dir, 'install-log.txt'), 'utf8').includes('127.0.0.1'));
  } finally {
    tv.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- hometv-lg root: the rooted path alone, on a TV that passed the unrooted install

const ROOT_RUN = { steps: ROOT_STEPS, name: 'root', report: true };

/** A TV that passed hometv-lg install up to "root now?" (answered no): backup taken, HomeTV and Developer Mode on it. */
async function rootSetup({ replies = {}, hooks = {}, ...opts } = {}) {
  const box = {};
  const s = await setup({
    ...opts,
    replies: {
      'Dev Manager says': '', 'Go on to the root steps': 'n', 'photographed': 'y', 'written down': 'y', 'USB stick': 'y',
      'Automatic Updates': 'y', 'owner agrees': 'root', 'restarted since': 'y', 'root the TV': 'Root the TV', 'HomeTV on screen': 'y',
      ...replies
    },
    hooks: {
      'Dev Manager says': () => box.state.apps.push(APP),
      // the person deletes both and restarts, as "Clear the way" asks
      'deleted and the TV is on again': () => { box.state.apps = box.state.apps.filter((a) => a !== DEVMODE && a !== APP); },
      'back on': async () => { box.state.foreground = HOME; if (box.tn) await box.tn.stop(); },
      'Press Home on the remote': () => { box.state.foreground = HOME; },
      ...hooks
    }
  });
  box.state = s.state;
  box.tn = s.tn;
  assert.deepEqual(await runInstall(s.ctx), { paused: 'go-on' }, s.text());
  s.out.length = 0;
  s.asked.length = 0;
  return s;
}

const report = (s) => {
  const f = fs.readdirSync(s.laptop).filter((x) => /^lg-root-report-.*\.txt$/.test(x)).sort().pop();
  return f ? fs.readFileSync(path.join(s.laptop, f), 'utf8') : '';
};

test('hometv-lg root: the checklist and "Clear the way", then the install\'s own steps from root-checks on', () => {
  assert.deepEqual(ROOT_STEPS.map((s) => s.id),
    ['root-preflight', 'clear-the-way', 'root-checks', 'root', 'hbc-check', 'root-install', 'restart-check']);
  for (const id of ROOT_STEPS.slice(2).map((s) => s.id)) assert.equal(ROOT_STEPS.find((s) => s.id === id), STEPS.find((s) => s.id === id), id);
  for (const s of ROOT_STEPS) assert.ok(s.title && s.what && s.undo && typeof s.run === 'function', s.id);
});

test('hometv-lg root, the whole way: checklist, clear the way, root, lock-down, restart, one report', { skip: !SH, timeout: 180000 }, async () => {
  const s = await rootSetup();
  try {
    const r = await runInstall(s.ctx, ROOT_RUN);
    assert.deepEqual(r, { done: true }, s.text());
    assert.deepEqual(s.slopbro, ['127.0.0.1']);
    // asked once each: no second restart or USB question in root-checks
    assert.equal(s.asked.filter((q) => q.includes('USB stick')).length, 1);
    assert.equal(s.asked.filter((q) => q.includes('restarted since')).length, 0);
    assert.match(s.text(), /✓ restarted since \(checked in "Clear the way"\)/);
    assert.match(s.text(), /✓ the backup on this laptop: lg-backup-/);
    assert.match(s.text(), /✓ the apps in the backup are all on the TV/);
    assert.ok(fs.existsSync(path.join(s.t, 'tv', 'prefs', 'webosbrew_block_updates')));
    const rep = report(s);
    for (const st of ROOT_STEPS) assert.match(rep, new RegExp('\\[done\\] ' + st.title.replace(/[()"']/g, '.')), st.id);
    assert.match(rep, /Result: all steps done\./);
    assert.match(rep, /Undo: There is no unroot button/);
    assert.match(rep, /The way back, lightest first/);
    assert.match(rep, /3 {2}Full unroot: Settings > General > System > Reset to Initial Settings/);
    for (const x of SECRETS) assert.ok(!rep.includes(x), 'report leaked: ' + x);
    noSecrets(s);

    // a re-run: nothing runs twice, the report says so again
    s.out.length = 0;
    const before = s.tn.seen.connections;
    assert.deepEqual(await runInstall(s.ctx, ROOT_RUN), { done: true });
    assert.equal(s.slopbro.length, 1);
    assert.equal(s.tn.seen.connections, before);
    assert.match(s.text(), /Step 1 of 7: Before root: the checklist \(done/);
  } finally {
    await s.done();
  }
});

test('hometv-lg root: a "no" at each checklist question stops before anything changes', async () => {
  for (const [q, msg] of [['photographed', /photos of the TV's settings aren't taken/], ['written down', /sign-in list isn't written/],
    ['USB stick', /USB stick with LG's firmware isn't ready/], ['Automatic Updates', /automatic updates may still be on/],
    ['owner agrees', /owner hasn't agreed/]]) {
    const s = await rootSetup({ telnet: false, replies: { [q]: q === 'owner agrees' ? 'yes' : 'n' } });
    try {
      assert.deepEqual(await runInstall(s.ctx, ROOT_RUN), { stopped: 'root-preflight' }, q);
      assert.match(s.text(), msg);
      assert.deepEqual(s.slopbro, []);
      assert.ok(s.state.apps.includes(DEVMODE), 'nothing asked to be deleted yet');
      assert.match(report(s), /\[stopped\] Before root: the checklist/);
      assert.match(report(s), /\[not run\] Root with SlopBro/);
      noSecrets(s);
    } finally {
      await s.done();
    }
  }
});

test('hometv-lg root: the backup must be on this laptop, and of this model', async () => {
  const s = await setup({ telnet: false, replies: { photographed: 'y' } });
  try {
    assert.deepEqual(await runInstall(s.ctx, ROOT_RUN), { stopped: 'root-preflight' });
    assert.match(s.text(), /no backup of this TV on this laptop/);
    assert.equal(s.asked.filter((q) => q.includes('photographed')).length, 0, 'the file is checked before any question');
    fs.writeFileSync(path.join(s.laptop, 'lg-backup-2026-01-01-00-00-00.json'), JSON.stringify({ format: 'hometv-lg-backup', tv: { model: 'OLED55C4' } }));
    s.out.length = 0;
    assert.deepEqual(await runInstall(s.ctx, ROOT_RUN), { stopped: 'root-preflight' });
    assert.match(s.text(), /another TV model \(OLED55C4\)/);
  } finally {
    await s.done();
  }
});

test('hometv-lg root: Allow Automatic Updates is read from the TV when it says', async () => {
  const on = await rootSetup({ telnet: false });
  on.state.autoUpdate = 'on';
  try {
    assert.deepEqual(await runInstall(on.ctx, ROOT_RUN), { stopped: 'root-preflight' });
    assert.match(on.text(), /The TV says Allow Automatic Updates is on/);
    assert.equal(on.asked.filter((q) => q.includes('Automatic Updates')).length, 0);
  } finally {
    await on.done();
  }
  const off = await rootSetup({ telnet: false, replies: { 'Automatic Updates': 'n' } });
  off.state.autoUpdate = 'off';
  try {
    assert.deepEqual(await runInstall(off.ctx, ROOT_RUN), { stopped: 'root-install' }); // pretend Telnet is closed
    assert.match(off.text(), /✓ Allow Automatic Updates is off \(the TV says\)/);
    assert.equal(off.asked.filter((q) => q.includes('Automatic Updates')).length, 0);
  } finally {
    await off.done();
  }
});

test('hometv-lg root: "Clear the way" stops while HomeTV or the Developer Mode app is on, or an app went missing; a re-run carries on', async () => {
  const s = await rootSetup({ telnet: false, hooks: { 'deleted and the TV is on again': () => {} } });
  try {
    assert.deepEqual(await runInstall(s.ctx, ROOT_RUN), { stopped: 'clear-the-way' });
    assert.match(s.text(), /HomeTV and the Developer Mode app still on the TV/);
    // the person deletes only the Developer Mode app (HomeTV's copy stays), then runs it again: the checklist isn't asked again
    s.state.apps = s.state.apps.filter((a) => a !== DEVMODE);
    s.out.length = 0;
    s.asked.length = 0;
    assert.deepEqual(await runInstall(s.ctx, ROOT_RUN), { stopped: 'clear-the-way' });
    assert.match(s.text(), /Step 1 of 7: Before root: the checklist \(done/);
    assert.equal(s.asked.filter((q) => q.includes('photographed')).length, 0);
    assert.match(s.text(), /delete HomeTV:/);
    assert.match(s.text(), /HomeTV still on the TV/);
    // both gone, but Netflix too
    s.state.apps = [];
    s.out.length = 0;
    assert.deepEqual(await runInstall(s.ctx, ROOT_RUN), { stopped: 'clear-the-way' });
    assert.match(s.text(), /Apps in the backup aren't on the TV any more: netflix/);
    // all well: carries on to root-checks and further
    s.state.apps = ['netflix'];
    s.out.length = 0;
    assert.deepEqual(await runInstall(s.ctx, ROOT_RUN), { stopped: 'root-install' }); // pretend Telnet is closed
    assert.equal(loadState(s.laptop).steps['clear-the-way'].status, 'done');
    assert.deepEqual(s.slopbro, ['127.0.0.1']);
  } finally {
    await s.done();
  }
});

test('root-checks: HomeTV\'s Developer Mode copy still on stops it, in hometv-lg install too (root-plan step 5)', async () => {
  const box = {};
  const s = await setup({ telnet: false, replies: happy(box).replies, hooks: {
    'Dev Manager says': () => box.state.apps.push(APP),
    'Go on to the root steps': () => { box.state.apps = box.state.apps.filter((a) => a !== DEVMODE); }
  } });
  box.state = s.state;
  try {
    assert.deepEqual(await runInstall(s.ctx), { stopped: 'root-checks' });
    assert.match(s.text(), /HomeTV's Developer Mode copy is still installed/);
    assert.deepEqual(s.slopbro, []);
  } finally {
    await s.done();
  }
});

test('hometv-lg root: Homebrew Channel missing after the restart stops and points to level 3', async () => {
  const s = await rootSetup({ telnet: false });
  s.ctx.runSlopbro = async () => 0;
  try {
    assert.deepEqual(await runInstall(s.ctx, ROOT_RUN), { stopped: 'hbc-check' });
    assert.match(s.text(), /Homebrew Channel isn't on the TV after root/);
    assert.match(s.text(), /level 3/);
    const rep = report(s);
    assert.match(rep, /Result: stopped at "After root: Homebrew Channel"/);
    assert.match(rep, /\[stopped\] After root: Homebrew Channel/);
    assert.match(rep, /\[not run\] Restart: HomeTV as Home/);
    noSecrets(s);
  } finally {
    await s.done();
  }
});

test('restart check: the default root password, or a switch Homebrew Channel lost, stops it', { skip: !SH, timeout: 180000 }, async () => {
  const s = await rootSetup();
  s.flags.defaultPassword = true;
  try {
    assert.deepEqual(await runInstall(s.ctx, ROOT_RUN), { stopped: 'restart-check' });
    assert.match(s.text(), /default root password \("alpine"\)/);
    s.flags.defaultPassword = false;
    s.flags.lost = ['block_updates'];
    s.out.length = 0;
    assert.deepEqual(await runInstall(s.ctx, ROOT_RUN), { stopped: 'restart-check' });
    assert.match(s.text(), /not on: Block system updates on/);
    s.flags.lost = [];
    assert.deepEqual(await runInstall(s.ctx, ROOT_RUN), { done: true });
  } finally {
    await s.done();
  }
});

test('the command line: hometv-lg root --list and its usage', { timeout: 30000 }, async () => {
  const { execFileSync } = await import('node:child_process');
  const dir = scratch('cli-root');
  try {
    const env = { ...process.env, HOMETV_DIR: dir };
    const list = execFileSync(process.execPath, ['tools/hometv-lg.mjs', 'root', '--list'], { env, encoding: 'utf8' });
    assert.match(list, /^1\. root-preflight +not run +Before root: the checklist/);
    assert.match(list, /7\. restart-check +not run/);
    assert.throws(() => execFileSync(process.execPath, ['tools/hometv-lg.mjs', 'root', '127.0.0.1', '--from', 'backup'], { env, stdio: 'pipe' }),
      (e) => /hometv-lg root <tv address>/.test(String(e.stderr)) && /Steps: root-preflight, clear-the-way/.test(String(e.stderr)));
    const { spawnSync } = await import('node:child_process');
    assert.match(spawnSync(process.execPath, ['tools/hometv-lg.mjs', 'help'], { env, encoding: 'utf8' }).stdout, /hometv-lg root <tv address>/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('hometv-lg root: an older run\'s checklist or "Clear the way" never spares root-checks a question', async () => {
  const s = await rootSetup({ telnet: false });
  fs.appendFileSync(s.ctx.kit.slopbro, 'changed');
  try {
    assert.deepEqual(await runInstall(s.ctx, ROOT_RUN), { stopped: 'root-checks' });
    assert.equal(s.asked.filter((q) => q.includes('restarted since')).length, 0, 'same run: checked in "Clear the way"');
    // the kit is fixed, but meanwhile the Developer Mode app came back (hometv-lg devmode)
    fs.writeFileSync(s.ctx.kit.slopbro, '# a pretend SlopBro\n');
    s.state.apps.push(DEVMODE);
    assert.deepEqual(await runInstall(s.ctx, ROOT_RUN), { stopped: 'root-checks' });
    assert.match(s.text(), /Developer Mode app is still installed/);
    assert.equal(loadState(s.laptop).steps['clear-the-way'], undefined, '"Clear the way" has to be done again');
    // deleted again: "Clear the way" runs again and asks for the restart; the USB stick is asked again too
    s.state.apps = s.state.apps.filter((a) => a !== DEVMODE);
    s.asked.length = 0;
    assert.deepEqual(await runInstall(s.ctx, ROOT_RUN), { stopped: 'root-install' }); // pretend Telnet is closed
    assert.equal(s.asked.filter((q) => q.includes('restarted since')).length, 1);
    assert.equal(s.asked.filter((q) => q.includes('USB stick')).length, 1);
    assert.equal(s.asked.filter((q) => q.includes('photographed')).length, 0);
    assert.deepEqual(s.slopbro, ['127.0.0.1']);
  } finally {
    await s.done();
  }
});
