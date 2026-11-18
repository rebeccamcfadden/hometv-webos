// hometv-lg-root prepare against a pretend TV (fake-ssap.mjs) and a pretend Windows (no real admin change, firewall or
// download): each step's ready and stop paths, the resume, root off on an unlisted software version, the undo, and that
// the TV's address, serial and device id never reach the output, the log, the state or the report.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fakeTv, tvWithState } from './fake-ssap.mjs';
import { runPrepare, undoPrepare, loadUndo, loadState, compatEntry, compatList, signInList, PREPARE_STEPS, RULE, ADMIN, adminWrap, elevateCommand } from '../tools/lib/prepare.mjs';

const APP = 'com.hometv.app';
const HOME = 'com.webos.app.home';
const DEVMODE = 'com.palmdts.devmode';
const SECRETS = ['SECRET123', 'aa:bb:cc', '127.0.0.1', os.homedir()];
const TITLES = { netflix: 'Netflix', 'youtube.leanback.v4': 'YouTube', [DEVMODE]: 'Developer Mode', [APP]: 'HomeTV', 'com.webos.app.browser': 'Web Browser' };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function scratch(name) {
  const d = path.resolve('dist', 'test-' + name + '-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(d, { recursive: true });
  return d;
}
const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
async function closedPort() { const s = net.createServer(); const p = await listen(s); await new Promise((r) => s.close(r)); return p; }

/** A pretend Windows: OpenSSH, the network's profile and the firewall rule, changed only in this object. */
function fakeWindows({ ssh = true, category = 'Public', refuse = false } = {}) {
  // net: the network the Wi-Fi adapter is on now (its id stands for its name, salted); categories: each network's setting
  const w = {
    ssh, programs: [], calls: [], opened: [], net: 'HomeWifiSSID', categories: { HomeWifiSSID: category, CafeWifiSSID: 'Public' },
    get category() { return w.categories[w.net]; },
    set category(v) { w.categories[w.net] = v; },
    async sshPath() { return w.ssh ? 'C:\\Windows\\System32\\OpenSSH\\ssh.exe' : ''; },
    async addSsh() { w.calls.push('addSsh'); if (w.refuse) return { error: 'No was chosen at Windows\' prompt' }; w.ssh = true; return { ok: true }; },
    async network(host, salt) { return { index: 7, alias: 'Wi-Fi', category: w.category, id: sha(salt + w.net).slice(0, 16) }; },
    async profile(alias, salt) { return w.net ? { category: w.category, id: sha(salt + w.net).slice(0, 16) } : { error: 'not connected' }; },
    async rulePrograms(rule) { return rule === RULE ? [...w.programs] : []; },
    async ruleThere(rule) { return rule === RULE && w.programs.length > 0; },
    async allow({ programs, setPrivate }) {
      w.calls.push('allow');
      if (w.refuse) return { error: 'No was chosen at Windows\' prompt' };
      if (setPrivate) w.category = 'Private';
      w.programs = [...programs];
      return { ok: true };
    },
    async undo({ rule, restore }) {
      w.calls.push('undo');
      if (w.refuse) return { error: 'No was chosen at Windows\' prompt' };
      if (rule) w.programs = [];
      for (const n of restore) w.category = n.was;
      return { ok: true };
    },
    open(target) { w.opened.push(target); }
  };
  w.refuse = refuse;
  return w;
}

async function setup({ apps = ['netflix', 'youtube.leanback.v4', DEVMODE, APP], minor = '31.75', autoUpdate = 'off', replies = {}, windows = {}, devmodeOn = true, keyServer = true } = {}) {
  const t = scratch('prepare');
  const state = { apps: [...apps], foreground: HOME, minor, autoUpdate };
  const handlers = tvWithState(state);
  handlers['com.webos.applicationManager/listLaunchPoints'] = () => ({ returnValue: true, launchPoints: state.apps.map((id) => ({ id, title: TITLES[id] || id })) });
  const tv = fakeTv(handlers);
  const ws = await listen(tv.server);
  const dev = net.createServer((s) => s.end());
  const devSshPort = devmodeOn ? await listen(dev) : await closedPort();
  const laptop = path.join(t, 'laptop');
  const exeDir = path.join(t, 'downloads');
  fs.mkdirSync(exeDir, { recursive: true });
  // the downloads: tiny files standing for the pinned ones
  const files = { 'hometv-lg.exe': Buffer.from('pretend hometv-lg v3'), 'com.hometv.app_0.2.0_all.ipk': crypto.randomBytes(3000) };
  const pins = {
    'hometv-lg-v3': { url: 'https://github.com/x/hometv-lg.exe', file: 'hometv-lg.exe', sha256: sha(files['hometv-lg.exe']) },
    'hometv-v2': { url: 'https://github.com/x/com.hometv.app_0.2.0_all.ipk', file: 'com.hometv.app_0.2.0_all.ipk', sha256: sha(files['com.hometv.app_0.2.0_all.ipk']) }
  };
  const fetched = [];
  const box = { badDownload: false };
  const out = [];
  const asked = [];
  const sticks = [];
  const w = fakeWindows(windows);
  const ctx = {
    host: '127.0.0.1', dir: laptop, exeDir, exePath: path.join(exeDir, 'hometv-lg-root.exe'), pins,
    ssapPorts: [{ url: 'ws://127.0.0.1:' + ws + '/', insecure: false }],
    reachAddress: '127.0.0.1', reachWaitMs: 5000, devSshPort, windows: w, compat: compatList(),
    fetchImpl: async (url) => {
      fetched.push(url);
      const body = box.badDownload ? Buffer.from('not it') : files[path.basename(url)];
      return { ok: !!body, status: body ? 200 : 404, arrayBuffer: async () => body };
    },
    getRootKit: async (dir) => { fs.mkdirSync(path.join(dir, 'python'), { recursive: true }); fs.writeFileSync(path.join(dir, 'python', 'python.exe'), ''); return dir; },
    fetchKey: async () => (keyServer ? { pem: '-----BEGIN RSA PRIVATE KEY-----' } : { error: 'down' }),
    getDevmodeKey: async (host, dir) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'devmode_rsa'), 'k'); return { file: path.join(dir, 'devmode_rsa') }; },
    checkStick: (drive, info) => { sticks.push({ drive, ...info }); return { file: 'pretend.epk', good: ['a pretend stick'], problems: [], unsure: [] }; },
    say: (s) => out.push(s),
    ask: async (q) => {
      asked.push(q);
      for (const [k, a] of Object.entries({ 'Add it now': 'y', 'Do it now': 'y', 'Save Developer Mode': '', 'when you have them': 'done', 'stick ready already': 'E', ...replies })) {
        if (q.includes(k)) return typeof a === 'function' ? a() : a;
      }
      return '';
    }
  };
  return {
    t, ctx, out, asked, sticks, fetched, box, w, state, seen: tv.seen, laptop, exeDir,
    done: async () => { tv.server.close(); dev.close(); fs.rmSync(t, { recursive: true, force: true }); }
  };
}

function noSecrets(s) {
  const report = fs.readdirSync(s.laptop).filter((f) => f.startsWith('prepare-report-')).map((f) => fs.readFileSync(path.join(s.laptop, f), 'utf8')).join('\n');
  const texts = { output: s.out.join('\n'), log: fs.readFileSync(path.join(s.laptop, 'prepare-log.txt'), 'utf8'), state: fs.readFileSync(path.join(s.laptop, 'prepare-state.json'), 'utf8'), report };
  if (fs.existsSync(path.join(s.laptop, 'sign-in-list.txt'))) texts.signIn = fs.readFileSync(path.join(s.laptop, 'sign-in-list.txt'), 'utf8');
  for (const [where, text] of Object.entries(texts)) for (const x of SECRETS) assert.ok(!text.includes(x), where + ' holds ' + x);
  return report;
}

test('prepare the whole way: tools, OpenSSH added, firewall set and undoable, the TV read only, a report that says ready', { timeout: 60000 }, async () => {
  const s = await setup({ windows: { ssh: false } });
  try {
    const r = await runPrepare(s.ctx);
    assert.deepEqual({ done: r.done }, { done: true }, s.out.join('\n'));
    // the tools, checked, where they belong
    assert.ok(fs.existsSync(path.join(s.exeDir, 'hometv-lg.exe')));
    assert.ok(fs.existsSync(path.join(s.laptop, 'com.hometv.app_0.2.0_all.ipk')));
    // OpenSSH: asked, then added; the firewall: asked, one change, Private, the rule for this program and Python
    assert.deepEqual(s.w.calls, ['addSsh', 'allow']);
    assert.equal(s.w.category, 'Private');
    assert.deepEqual(s.w.programs, [s.ctx.exePath, path.join(s.laptop, 'tools', 'python', 'python.exe')]);
    assert.ok(s.asked.some((q) => q.includes('Add it now')) && s.asked.some((q) => q.includes('Do it now')));
    const undo = loadUndo(s.laptop);
    assert.deepEqual(undo.firewall.networks.map((n) => [n.alias, n.was]), [['Wi-Fi', 'Public']]);
    assert.equal(undo.firewall.rule, RULE);
    assert.ok(undo.openssh);
    // the TV: nothing but reads, and its browser opened once for the reach check
    const changing = s.seen.requests.map((q) => q.uri).filter((u) => !/^(com\.webos\.service\.update\/getCurrentSWInformation|system\/getSystemInfo|com\.webos\.applicationManager\/(listLaunchPoints|getForegroundAppInfo)|settings\/getSystemSettings|tv\/getExternalInputList|com\.webos\.service\.apiadapter\/audio\/getSoundOutput|system\.launcher\/(open|close))$/.test(u));
    assert.deepEqual(changing, []);
    assert.equal(s.seen.requests.filter((q) => q.uri === 'system.launcher/open').length, 1);
    // Developer Mode's key saved (Key Server was on); the backup taken; the sign-in list; the stick checked with the TV's model and software
    assert.ok(fs.existsSync(path.join(s.laptop, 'devmode_rsa')));
    assert.equal(fs.readdirSync(s.laptop).filter((f) => /^lg-backup-.*\.json$/.test(f)).length, 1);
    const list = fs.readFileSync(path.join(s.laptop, 'sign-in-list.txt'), 'utf8');
    assert.match(list, /\[ \] Netflix/);
    assert.match(list, /\[ \] YouTube/);
    assert.match(list, /LG account/);
    assert.match(list, /Wi-Fi name: write it here/);
    assert.ok(!/Developer Mode|HomeTV  |Web Browser/.test(list.split('The TV\'s apps:')[1]));
    assert.deepEqual(s.sticks, [{ drive: 'E', model: '43UT8000AUA', software: '33.31.75' }]);
    const report = noSecrets(s);
    assert.equal(report.trim().split(/\r?\n/).pop(), 'Ready for the call.');
    assert.match(report, /prepare --undo/);
    assert.equal((report.match(/\[ready\]/g) || []).length, PREPARE_STEPS.length);
  } finally {
    await s.done();
  }
});

test('run again, finished steps are skipped; a "no" at the firewall stops it, and the report says what is missing', { timeout: 60000 }, async () => {
  const s = await setup({ replies: { 'Do it now': 'n' } });
  try {
    const r = await runPrepare(s.ctx);
    assert.equal(r.stopped, 'firewall');
    assert.deepEqual(s.w.calls, []);
    assert.equal(loadUndo(s.laptop).firewall, undefined);
    let report = noSecrets(s);
    assert.match(report, /\[ready\] The tools on this laptop/);
    assert.match(report, /\[not ready\] The firewall/);
    assert.match(report, /Next: By hand: Settings > Network & internet/);
    assert.match(report.trim().split(/\r?\n/).pop(), /^Not ready yet\. Missing: The firewall: the TV can reach this laptop; The TV: /);
    // again, with yes: the tools aren't fetched again
    const before = s.fetched.length;
    s.ctx.ask = async (q) => (q.includes('Do it now') ? 'y' : q.includes('when you have them') ? 'done' : q.includes('stick ready') ? 'E' : '');
    for (const f of fs.readdirSync(s.laptop).filter((f) => f.startsWith('prepare-report-'))) fs.rmSync(path.join(s.laptop, f));
    const again = await runPrepare(s.ctx);
    assert.equal(again.done, true);
    assert.equal(s.fetched.length, before);
    assert.match(s.out.join('\n'), /Step 1 of 9: The tools on this laptop \(done /);
    report = noSecrets(s);
    assert.equal(report.trim().split(/\r?\n/).pop(), 'Ready for the call.');
  } finally {
    await s.done();
  }
});

test('software the TV won\'t say, typed, and not in compat.json: root is off for this call, no USB stick, stage 2 only', { timeout: 60000 }, async () => {
  const s = await setup({ minor: 'refused', replies: { 'Software Version exactly': '33.31.80' } });
  try {
    const r = await runPrepare(s.ctx);
    assert.equal(r.done, true, s.out.join('\n'));
    assert.match(s.out.join('\n'), /Root is OFF for this call: software 33\.31\.80/);
    assert.deepEqual(s.sticks, []);
    assert.ok(!s.asked.some((q) => q.includes('stick ready')));
    const report = noSecrets(s);
    assert.match(report, /\[not ready\] The TV's software version/);
    assert.match(report, /USB stick[^\n]*\n\s+not needed: root is off/);
    assert.equal(report.trim().split(/\r?\n/).pop(), 'Ready for the call: stage 2 only. Root is OFF for this call (software 33.31.80 isn\'t in the list root is known to work on).');
    assert.equal(loadState(s.laptop).rootOff, true);
  } finally {
    await s.done();
  }
});

test('the TV\'s checks stop it: automatic updates on; Developer Mode off; Key Server down; OpenSSH declined', { timeout: 60000 }, async () => {
  const cases = [
    [{ autoUpdate: 'on' }, 'tv', /Allow Automatic Updates is on/],
    [{ devmodeOn: false }, 'tv', /Developer Mode isn't on/],
    [{ keyServer: false }, 'tv', /Key Server isn't answering/],
    [{ windows: { ssh: false }, replies: { 'Add it now': 'n' } }, 'openssh', /OpenSSH client isn't on this laptop/],
    [{ windows: { ssh: false, refuse: true } }, 'openssh', /couldn't be added \(No was chosen/]
  ];
  for (const [opts, at, why] of cases) {
    const s = await setup(opts);
    try {
      const r = await runPrepare(s.ctx);
      assert.equal(r.stopped, at, JSON.stringify(opts) + '\n' + s.out.join('\n'));
      assert.match(s.out.join('\n'), why);
      noSecrets(s);
    } finally {
      await s.done();
    }
  }
});

test('the tools: a hometv-lg.exe that isn\'t v3 is replaced only when agreed; a download that doesn\'t match is refused and not kept', { timeout: 60000 }, async () => {
  const s = await setup({ replies: { 'Replace it with hometv-lg-v3': 'n' } });
  try {
    fs.writeFileSync(path.join(s.exeDir, 'hometv-lg.exe'), 'an older one');
    assert.equal((await runPrepare(s.ctx)).stopped, 'tools');
    assert.equal(fs.readFileSync(path.join(s.exeDir, 'hometv-lg.exe'), 'utf8'), 'an older one');
    s.ctx.ask = async (q) => (q.includes('Replace it') ? '' : 'n');
    s.box.badDownload = true;
    assert.equal((await runPrepare(s.ctx)).stopped, 'tools');
    assert.match(s.out.join('\n'), /hometv-lg\.exe \(hometv-lg-v3\) couldn't be downloaded and checked \(hometv-lg\.exe is not the expected file/);
    assert.equal(fs.readFileSync(path.join(s.exeDir, 'hometv-lg.exe'), 'utf8'), 'an older one');
    s.box.badDownload = false;
    s.ctx.ask = async () => '';
    await runPrepare(s.ctx);
    assert.equal(fs.readFileSync(path.join(s.exeDir, 'hometv-lg.exe'), 'utf8'), 'pretend hometv-lg v3');
  } finally {
    await s.done();
  }
});

test('prepare --undo: the rule out and the network back in one prompt; a "no" keeps the list; another network is left alone', { timeout: 60000 }, async () => {
  const s = await setup();
  try {
    await runPrepare(s.ctx);
    const w = s.w;
    assert.equal(w.category, 'Private');
    assert.ok(!JSON.stringify(loadUndo(s.laptop)).includes('HomeWifiSSID'), 'the network\'s name isn\'t kept');
    const say = (x) => s.out.push(x);
    const undo = () => undoPrepare({ dir: s.laptop, say, windows: w });
    // "No" at Windows' prompt: nothing changes, the list stays
    w.refuse = true;
    assert.equal((await undo()).stopped, true);
    assert.ok(loadUndo(s.laptop).firewall.rule);
    assert.equal(w.category, 'Private');
    // on another Wi-Fi (same adapter): the rule goes, that network isn't touched, the call's network stays on the list
    w.refuse = false;
    w.net = 'CafeWifiSSID';
    w.categories.CafeWifiSSID = 'Private';
    assert.equal((await undo()).stopped, true);
    assert.deepEqual(w.programs, []);
    assert.equal(w.categories.CafeWifiSSID, 'Private');
    assert.equal(w.categories.HomeWifiSSID, 'Private');
    assert.match(s.out.join('\n'), /isn't on the network the call used now/);
    assert.equal(loadUndo(s.laptop).firewall.rule, null);
    assert.equal(loadUndo(s.laptop).firewall.networks.length, 1);
    // back home: put back, and the list is empty
    w.net = 'HomeWifiSSID';
    const before = w.calls.length;
    assert.equal((await undo()).done, true, s.out.join('\n'));
    assert.equal(w.calls.length, before + 1);
    assert.equal(w.categories.HomeWifiSSID, 'Public');
    assert.equal(loadUndo(s.laptop).firewall, undefined);
    assert.match(s.out.join('\n'), /the network the call used is Public again/);
    assert.equal((await undo()).done, true);
    assert.match(s.out.at(-1), /Nothing to undo/);
  } finally {
    await s.done();
  }
});

test('after --undo, prepare checks the firewall again: never "Ready" with the rule gone', { timeout: 60000 }, async () => {
  const s = await setup();
  try {
    await runPrepare(s.ctx);
    assert.equal((await undoPrepare({ dir: s.laptop, say: () => {}, windows: s.w })).done, true);
    assert.equal(loadState(s.laptop).steps.firewall, undefined);
    for (const f of fs.readdirSync(s.laptop).filter((f) => f.startsWith('prepare-report-'))) fs.rmSync(path.join(s.laptop, f));
    s.ctx.ask = async () => 'n';
    const r = await runPrepare(s.ctx);
    assert.equal(r.stopped, 'firewall');
    assert.match(noSecrets(s).trim().split(/\r?\n/).pop(), /^Not ready yet\. Missing: The firewall/);
  } finally {
    await s.done();
  }
});

test('compat.json and ROOTABLE decide root for the call; the sign-in list holds app names only', () => {
  const list = compatList();
  assert.ok(compatEntry(list, '43UT8000AUA', '33.31.75'));
  assert.ok(compatEntry(list, '43UT8000AUA', '33.31.61'));
  assert.equal(compatEntry(list, '43UT8000AUA', '33.31.80'), null);
  assert.equal(compatEntry(list, 'OLED65C46LA', '33.31.75'), null);
  const text = signInList([{ id: 'netflix', title: 'Netflix' }, { id: 'com.webos.app.livetv', title: 'Live TV' }, { id: 'org.webosbrew.hbchannel', title: 'Homebrew Channel' }, { id: 'amazon', title: 'Prime Video' }]);
  assert.match(text, /\[ \] Netflix/);
  assert.match(text, /\[ \] Prime Video/);
  assert.ok(!/Live TV|Homebrew/.test(text));
  assert.ok(!/password:/i.test(text));
});

test('what runs as administrator parses as PowerShell (parsed only, nothing run); names with quotes stay quoted', { skip: process.platform !== 'win32', timeout: 60000 }, () => {
  const scripts = [
    adminWrap(ADMIN.addSsh(), 'C:\\x\\err.txt'),
    adminWrap(ADMIN.allow({ index: 7, programs: ['C:\\Users\\o\'brien\\Downloads\\hometv-lg-root.exe', 'C:\\py\\python.exe'], rule: RULE, setPrivate: true }), 'C:\\x\\err.txt'),
    adminWrap(ADMIN.undo({ rule: RULE, restore: [{ alias: 'Wi-Fi \'2\'', was: 'Public' }] }), 'C:\\x\\err.txt'),
    elevateCommand(adminWrap(ADMIN.addSsh(), 'C:\\x\\err.txt'))
  ];
  const check = '$e = $null; $t = $null; [void][System.Management.Automation.Language.Parser]::ParseInput([Console]::In.ReadToEnd(), [ref]$t, [ref]$e); ' +
    'if ($e.Count) { $e | ForEach-Object { $_.Message }; exit 1 }; ($t | Where-Object { $_.Kind -eq \'StringLiteral\' } | ForEach-Object { $_.Value }) -join \'|\'';
  for (const s of scripts) {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', check], { input: s, encoding: 'utf8' });
    if (s.includes('o\'brien')) assert.ok(out.includes('C:\\Users\\o\'brien\\Downloads\\hometv-lg-root.exe'), out);
    if (s.includes('Wi-Fi')) assert.ok(out.includes('Wi-Fi \'2\''), out);
  }
  assert.ok(!ADMIN.undo({ rule: RULE, restore: [] }).includes('Set-NetConnectionProfile'), 'no network to put back: none changed');
  assert.ok(!ADMIN.undo({ rule: null, restore: [{ alias: 'Wi-Fi', was: 'Public' }] }).includes('Remove-NetFirewallRule'));
});

test('the admin prompt\'s command: "No" is 1223, a start that fails is 1, never 0; else the script\'s own code (run without the prompt)', { skip: process.platform !== 'win32', timeout: 60000 }, () => {
  const cmd = elevateCommand('exit 0');
  assert.match(cmd, /Start-Process powershell\.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ErrorAction Stop /);
  const start = /\$p = Start-Process .*? \} catch/;
  const run = (c) => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', c], { encoding: 'utf8' }).status;
  assert.equal(run(cmd.replace(start, "throw 'The operation was canceled by the user.' } catch")), 1223);
  assert.equal(run(cmd.replace(start, '$p = Start-Process doesnotexist_hometv.exe -Wait -PassThru -ErrorAction Stop } catch')), 1);
  assert.equal(run(cmd.replace(start, "$p = Start-Process cmd.exe -Wait -PassThru -WindowStyle Hidden -ErrorAction Stop -ArgumentList '/c','exit 3' } catch")), 3);
});

test('the command line: prepare --list and usage (the root build); the steps are in the .exe build, root only', () => {
  const dir = scratch('prepare-cli');
  try {
    const env = { ...process.env, HOMETV_DIR: dir };
    assert.match(execFileSync(process.execPath, ['tools/hometv-lg.mjs', 'prepare', '--list'], { env, encoding: 'utf8' }), /^1\. tools +not run/);
    assert.throws(() => execFileSync(process.execPath, ['tools/hometv-lg.mjs', 'prepare'], { env, stdio: 'pipe' }), /Usage: hometv-lg-root prepare/);
    const build = fs.readFileSync('tools/build-exe.mjs', 'utf8');
    assert.match(build, /ROOT_ONLY = \[[^\]]*'tools\/prepare\.mjs'/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
