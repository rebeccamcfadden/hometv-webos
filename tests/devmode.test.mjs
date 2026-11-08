// hometv-lg devmode against pretend parts: the TV's key server (an encrypted RSA key), a pretend ssh acting as the
// `prisoner` account (fake-devmode-ssh.mjs), the TV's remote-control side (fake-ssap.mjs, its apps and foreground kept
// in a file the pretend ssh also writes), and a pretend Web Inspector with a page that answers like HomeTV's screens
// (fake-cdp.mjs). Nothing here touches a real TV; every port is on localhost.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fakeTv, HANDLERS } from './fake-ssap.mjs';
import { fakeCdp } from './fake-cdp.mjs';
import { PINNED, sha256 } from '../tools/lib/fetch.mjs';
import { fetchKey, openKey, getKey, KEY_SERVER_DOWN } from '../tools/lib/devmode-key.mjs';
import { getIpk, installIpk, runDevmode } from '../tools/lib/devmode.mjs';
import { sshShell } from '../tools/lib/root-shell.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE_SSH = path.join(HERE, 'fake-devmode-ssh.mjs');
const APP = 'com.hometv.app';
const PASS = 'Ab3dE9';
const HOST = '127.0.0.1';
const IPV4 = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const ENCRYPTED = privateKey.export({ type: 'pkcs1', format: 'pem', cipher: 'aes-128-cbc', passphrase: PASS });

function scratch(name) {
  const d = path.resolve('dist', 'test-' + name + '-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(d, { recursive: true });
  return d;
}
const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const closeAll = (...servers) => Promise.all(servers.map((s) => new Promise((r) => { s.closeAllConnections?.(); s.close(r); })));
async function closedPort() { const s = net.createServer(); const p = await listen(s); await new Promise((r) => s.close(r)); return p; }

function keyServer(pem = ENCRYPTED) {
  return http.createServer((req, res) => {
    if (req.url === '/webos_rsa') res.end(pem);
    else { res.statusCode = 404; res.end(); }
  });
}

function withEnv(env, fn) {
  const old = {};
  for (const k of Object.keys(env)) { old[k] = process.env[k]; process.env[k] = env[k]; }
  return Promise.resolve(fn()).finally(() => { for (const k of Object.keys(env)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } });
}

/** The pretend HomeTV page: first run, settings kept in "localStorage", Checks and API keys screens, a problem line. */
function pageModel({ problem = '', firstRunAfterUpdate = false, wipeOnUpdate = false, keyPort, stateFile, aboutText }) {
  const p = { storage: {}, stack: ['screen home'], results: [], seenVersion: '', problem };
  const state = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const push = (check, ok, text) => p.results.unshift({ ok, check: new Date().toTimeString().slice(0, 8) + ' ' + check, text });
  p.onKey = (code) => {
    const top = p.stack[p.stack.length - 1];
    if (code === 406 && !/checks/.test(top)) p.stack.push('screen checks');
    else if (code === 461 && p.stack.length > 1) p.stack.pop();
  };
  p.answer = (name, arg) => {
    const top = p.stack[p.stack.length - 1];
    switch (name) {
      case 'ready': {
        const v = state().version;
        if (v !== p.seenVersion) {
          const update = p.seenVersion !== '';
          p.seenVersion = v;
          if (update && wipeOnUpdate) p.storage = {};
          p.stack = ['screen home'];
          if (!p.storage['hometv-setup-done'] || (update && firstRunAfterUpdate)) p.stack.push('screen screen--full screen--setup');
          p.results = [];
        }
        return true;
      }
      case 'top': return top;
      case 'has': return true;
      case 'visible': return 'visible';
      case 'snapshot': return JSON.stringify({ 'hometv-settings-v1': p.storage['hometv-settings-v1'] ?? null, 'hometv-setup-done': p.storage['hometv-setup-done'] ?? null, 'hometv-home-row': null, 'hometv-household-v1': null });
      case 'problem': return JSON.stringify({ problem: p.problem, tiles: 6, missing: 0 });
      case 'result': {
        const r = p.results[0];
        return JSON.stringify({ n: p.results.length, ok: !!r && r.ok, check: r ? r.check : '', text: r ? r.text : '' });
      }
      case 'keypage': return JSON.stringify({ address: 'http://' + HOST + ':' + keyPort + '/keys', qr: true });
      case 'click': {
        const settings = () => JSON.parse(p.storage['hometv-settings-v1'] || '{}');
        if (arg === 'seg-region-se') p.storage['hometv-settings-v1'] = JSON.stringify({ ...settings(), region: 'se' });
        else if (arg === 'wr-0') p.storage['hometv-settings-v1'] = JSON.stringify({ ...settings(), place: { name: 'Stockholm' } });
        else if (arg === 'start') { p.stack.pop(); p.storage['hometv-setup-done'] = '1'; }
        else if (arg === 'keys') p.stack.push('screen keys');
        else if (arg === 'check-0') push('info', true, aboutText || 'model 43UT8000AUA, firmware 33.31.61');
        else if (arg === 'check-1') push('apps', !p.problem, p.problem ? p.problem : '4 of 4 apps listed');
        else if (arg === 'check-6') {
          const s = state();
          s.foreground = 'youtube.leanback.v4';
          fs.writeFileSync(stateFile, JSON.stringify(s));
        }
        return true;
      }
      default: return undefined;
    }
  };
  return p;
}

/** A whole pretend set-up for one run of runDevmode. */
async function setup({ install = 'ok', replies = {}, keyPem = ENCRYPTED, noKeyServer = false, noInspector = false, page = {}, noKeyPage = false, only } = {}) {
  const t = scratch('devmode');
  const laptop = path.join(t, 'laptop');
  fs.mkdirSync(laptop);
  const stateFile = path.join(t, 'state.json');
  fs.writeFileSync(stateFile, JSON.stringify({ apps: ['netflix', 'youtube.leanback.v4'], foreground: 'com.webos.app.home' }));
  const read = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const tv = fakeTv({
    ...HANDLERS,
    'settings/getSystemSettings': (q) => (read().autoUpdate && q.category === 'option' ? { returnValue: true, settings: { autoUpdate: read().autoUpdate } } : { returnValue: false, errorText: 'no such key' }),
    'com.webos.service.update/getCurrentSWInformation': () => ({ returnValue: true, major_ver: '33', minor_ver: '31.61', device_id: 'aa:bb:cc:dd:ee:ff', serial: 'SECRET123' }),
    'com.webos.applicationManager/listLaunchPoints': () => ({ returnValue: true, launchPoints: read().apps.map((id) => ({ id, title: id })) }),
    'com.webos.applicationManager/getForegroundAppInfo': () => ({ returnValue: true, appId: read().foreground, windowId: 'x' }),
    'com.webos.applicationManager/launch': (q) => {
      const s = read();
      if (!s.apps.includes(q.id)) return { returnValue: false, errorText: 'not installed' };
      s.foreground = q.id;
      fs.writeFileSync(stateFile, JSON.stringify(s));
      return { returnValue: true };
    }
  });
  const ws = await listen(tv.server);
  const keys = keyServer(keyPem);
  const keyPort = noKeyServer ? await closedPort() : await listen(keys);
  const keyPageServer = http.createServer((req, res) => { res.end('<html><body>API keys</body></html>'); });
  const keyPagePort = await listen(keyPageServer);
  const model = pageModel({ ...page, keyPort: keyPagePort, stateFile });
  const cdp = fakeCdp(model);
  const cdpPort = await listen(cdp.server);
  const v0 = path.join(t, 'com.hometv.app_0.0.1_all.ipk');
  const v1 = path.join(t, 'com.hometv.app_0.1.0_all.ipk');
  fs.writeFileSync(v0, crypto.randomBytes(30000));
  fs.writeFileSync(v1, crypto.randomBytes(31000));
  const logFile = path.join(t, 'ssh.log');
  fs.writeFileSync(logFile, '');
  const out = [];
  const asked = [];
  const env = {
    HOMETV_SSH: FAKE_SSH, FAKE_LOG: logFile, FAKE_STATE: stateFile, FAKE_PUTS: path.join(t, 'puts'), FAKE_CDP_PORT: String(cdpPort),
    FAKE_INSTALL: install, FAKE_NO_FORWARD: noInspector ? '1' : ''
  };
  const ctx = {
    host: HOST, dir: laptop, v0, v1, anyIpk: true, only,
    ssapPorts: [{ url: 'ws://' + HOST + ':' + ws + '/', insecure: false }], keyPort,
    stayMs: 300, settleMs: 0, installMs: 4000, listWaitMs: 5000, openWaitMs: 5000, inspectorWaitMs: noInspector ? 600 : 5000, pageWaitMs: 5000,
    say: (s) => out.push(String(s)),
    ask: async (q) => {
      asked.push(q);
      for (const [re, a] of Object.entries(replies)) if (q.includes(re)) return a;
      return /passphrase/.test(q) ? PASS : 'y';
    }
  };
  const lines = () => fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return {
    t, ctx, out, asked, env, model, lines, stateFile, cdp, tv, v0, v1,
    run: () => withEnv(env, () => runDevmode(ctx)),
    done: () => closeAll(tv.server, keys, keyPageServer, cdp.server)
  };
}

const checkOf = (R, id) => R.checks.find((c) => c.id === id);
const statuses = (R) => Object.fromEntries(R.checks.map((c) => [c.id, c.status]));

// ---- the key ----

test('the Developer Mode key: the right passphrase opens it, and it is written locked into the HomeTV folder', async () => {
  const s = keyServer();
  const port = await listen(s);
  const dir = scratch('key');
  const said = [];
  const got = await getKey(HOST, dir, async () => PASS, (x) => said.push(x), { port });
  await closeAll(s);
  assert.ok(got.file && fs.existsSync(got.file));
  assert.equal(path.dirname(got.file), dir);
  const plain = fs.readFileSync(got.file, 'utf8');
  assert.match(plain, /BEGIN RSA PRIVATE KEY/);
  assert.doesNotMatch(plain, /ENCRYPTED/);
  assert.ok(crypto.createPrivateKey(plain).asymmetricKeyType === 'rsa');
  assert.equal(said.length, 0);
});

test('a wrong passphrase says so in plain words and asks again; three wrong ones stop', async () => {
  const s = keyServer();
  const port = await listen(s);
  const said = [];
  const answers = ['wrong1', PASS];
  const ok = await getKey(HOST, scratch('key'), async () => answers.shift(), (x) => said.push(x), { port });
  assert.ok(ok.file);
  assert.equal(said.length, 1);
  assert.match(said[0], /didn't open the key/);
  assert.match(said[0], /capital and small letters/);
  const bad = await getKey(HOST, scratch('key'), async () => 'nope', () => {}, { port });
  await closeAll(s);
  assert.match(bad.error, /three times/);
  assert.equal(openKey(ENCRYPTED, 'nope'), null);
});

test('the key server not answering says to switch Key Server on', async () => {
  const port = await closedPort();
  const r = await fetchKey(HOST, { port, timeoutMs: 1000 });
  assert.equal(r.error, KEY_SERVER_DOWN);
  assert.match(r.error, /switch "Key Server" on/);
  const s = http.createServer((q, res) => res.end('<html>not a key</html>'));
  const p2 = await listen(s);
  assert.equal((await fetchKey(HOST, { port: p2 })).error, KEY_SERVER_DOWN);
  await closeAll(s);
});

// ---- the downloads ----

test('the pins are the published v0 and v1 files', () => {
  assert.equal(PINNED['hometv-v0'].sha256, '945d9c0d00a6258b4d7ba4d558be9c1264950c53d5f3d5c40ea87afae9f003d8');
  assert.equal(PINNED['hometv-v1'].sha256, '6f6abc8348abcaf4349091d9be9d6051c8966bd672e6c9e379af4ff57560cb03');
  assert.match(PINNED['hometv-v0'].url, /app-v0\.0\.1\/com\.hometv\.app_0\.0\.1_all\.ipk$/);
  assert.match(PINNED['hometv-v1'].url, /app-v0\.1\.0\/com\.hometv\.app_0\.1\.0_all\.ipk$/);
});

test('a download that does not match the pin is refused and not kept; a matching cached file skips the download', async () => {
  const dir = scratch('pin');
  const good = Buffer.from('pretend v0 ipk');
  const real = PINNED['hometv-v0'].sha256;
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return { ok: true, status: 200, arrayBuffer: async () => good }; };
  try {
    await assert.rejects(() => getIpk('v0', { dir, say() {}, fetchImpl }), /not the expected file/);
    assert.equal(fs.existsSync(path.join(dir, 'com.hometv.app_0.0.1_all.ipk')), false);
    PINNED['hometv-v0'].sha256 = crypto.createHash('sha256').update(good).digest('hex');
    const file = await getIpk('v0', { dir, say() {}, fetchImpl });
    assert.equal(fs.readFileSync(file, 'utf8'), 'pretend v0 ipk');
    assert.equal(calls.length, 2);
    await getIpk('v0', { dir, say() {}, fetchImpl });
    assert.equal(calls.length, 2, 'the checked file in the folder is not downloaded again');
  } finally {
    PINNED['hometv-v0'].sha256 = real;
  }
});

test('--v0 / --v1 files are held to the pin unless --any-ipk', async () => {
  const dir = scratch('pin');
  const f = path.join(dir, 'mine.ipk');
  fs.writeFileSync(f, 'a dev build');
  await assert.rejects(() => getIpk('v1', { dir, say() {}, v1: f }), /isn't the published v1/);
  assert.equal(await getIpk('v1', { dir, say() {}, v1: f, anyIpk: true }), f);
  await assert.rejects(() => getIpk('v0', { dir, say() {}, v0: path.join(dir, 'missing.ipk'), anyIpk: true }), /isn't there/);
});

// ---- the install over ssh ----

test('install: the copy, the luna-send-pub call, success, and the temp file removed', async () => {
  const s = await setup();
  try {
    const r = await withEnv(s.env, () => installIpk(sshShell({ host: HOST, key: path.join(s.t, 'k'), knownHosts: path.join(s.t, 'kh'), port: 9922, user: 'prisoner', timeoutMs: 20000, options: ['-o', 'HostKeyAlgorithms=+ssh-rsa', '-o', 'PubkeyAcceptedKeyTypes=+ssh-rsa'] }), s.v0, { installMs: 4000 }));
    assert.equal(r.ok, true);
    const log = s.lines();
    const calls = log.filter((l) => l.command);
    assert.ok(calls.every((c) => c.user === 'prisoner' && c.port === '9922'));
    assert.ok(calls.every((c) => c.options.includes('HostKeyAlgorithms=+ssh-rsa') && c.options.includes('PubkeyAcceptedKeyTypes=+ssh-rsa')));
    const put = calls.find((c) => c.command.startsWith('mkdir -p /media/developer/temp && cat > '));
    assert.match(put.command, /cat > '\/media\/developer\/temp\/com\.hometv\.app_0\.0\.1_all\.ipk'$/);
    const install = calls.find((c) => c.command.startsWith('luna-send-pub -i '));
    assert.match(install.command, /luna:\/\/com\.webos\.appInstallService\/dev\/install/);
    const payload = JSON.parse(install.command.match(/'(\{.*\})'$/)[1]);
    assert.deepEqual(payload, { id: 'com.ares.defaultName', ipkUrl: '/media/developer/temp/com.hometv.app_0.0.1_all.ipk', subscribe: true });
    assert.equal(fs.readFileSync(path.join(s.t, 'puts', 'com.hometv.app_0.0.1_all.ipk')).length, 30000, 'the whole file reached the TV');
    assert.deepEqual(log.filter((l) => l.removed).map((l) => l.removed), ['/media/developer/temp/com.hometv.app_0.0.1_all.ipk']);
  } finally { await s.done(); }
});

test('install: a refusal from the TV is a failure with its reason; no answer is a failure too; the temp file goes either way', async () => {
  for (const mode of ['fail', 'silent']) {
    const s = await setup({ install: mode });
    try {
      const r = await withEnv(s.env, () => installIpk(sshShell({ host: HOST, key: path.join(s.t, 'k'), knownHosts: path.join(s.t, 'kh'), port: 9922, user: 'prisoner', timeoutMs: 20000 }), s.v1, { installMs: 800 }));
      assert.equal(r.ok, false);
      if (mode === 'fail') assert.match(r.note, /refused it: FAILED_IPK_SIGNATURE/);
      else assert.match(r.note, /no "installed" answer/);
      assert.equal(s.lines().filter((l) => l.removed).length, 1);
    } finally { await s.done(); }
  }
});

// ---- the whole run ----

function noLeaks(s, r) {
  const files = r.files.map((f) => fs.readFileSync(f, 'utf8'));
  const everything = files.join('\n') + '\n' + s.out.join('\n');
  assert.doesNotMatch(everything, IPV4, 'no IPv4 address anywhere');
  for (const secret of [HOST, 'SECRET123', 'aa:bb:cc', PASS]) assert.ok(!everything.includes(secret), secret + ' must not appear');
  return everything;
}

test('devmode: v0, then v1 over it: every check passes, the person is asked only the two yes/no questions per version', async () => {
  const s = await setup();
  try {
    const r = await s.run();
    assert.equal(r.stopped, false);
    assert.equal(r.failed, 0, s.out.join('\n'));
    const [v0, v1] = r.report.versions;
    assert.deepEqual([v0.version, v1.version], ['v0', 'v1']);
    for (const id of ['installed', 'listed', 'version', 'opens', 'screen', 'launchpoints', 'about', 'stays', 'applaunch', 'contentid']) {
      assert.equal(checkOf(v0, id).status, 'ok', 'v0 ' + id);
      assert.equal(checkOf(v1, id).status, 'ok', 'v1 ' + id);
    }
    assert.equal(checkOf(v0, 'firstrun').status, 'ok');
    assert.match(checkOf(v0, 'firstrun').note, /Sweden.*Stockholm/);
    assert.equal(checkOf(v0, 'settings'), undefined, 'settings kept is a v1 check');
    assert.equal(checkOf(v1, 'settings').status, 'ok');
    assert.equal(checkOf(v1, 'keypage').status, 'ok');
    assert.match(checkOf(v1, 'keypage').note, /HTTP 200/);
    assert.equal(checkOf(v1, 'keyqr').status, 'ok');
    assert.equal(v1.firstRunShownAfterUpdate, false);
    assert.equal(checkOf(v1, 'firstrun').note, 'no (not shown)');
    assert.equal(checkOf(v0, 'keypage'), undefined, 'v0 has no API keys screen');
    assert.deepEqual(v0.settings, { region: 'se', weatherCity: 'Stockholm', setupDone: true });
    assert.match(r.report.tv.model, /43UT8000AUA/);
    assert.equal(r.report.tv.firmware, '33.31.61');
    assert.equal(v0.inspector, 'reached');
    // yes/no: before v0 the two update questions, then "Is HomeTV on the TV screen now?" and "Is a YouTube video playing" once per version
    const yn = s.asked.filter((q) => /\[y\/n\]/.test(q));
    assert.equal(yn.length, 6);
    assert.ok(yn.filter((q) => /Is HomeTV on the TV screen now\?/.test(q)).length === 2);
    assert.ok(yn.filter((q) => /Is a YouTube video playing/.test(q)).length === 2);
    assert.equal(s.asked.filter((q) => /passphrase/.test(q)).length, 1);
    assert.equal(s.asked.filter((q) => /press Enter here to install v1 over it/.test(q)).length, 1, 'one pause between v0 and v1');
    assert.equal(r.report.answers.length, 6);
    // the TV ends with HomeTV in front, the inspector forwards went to the TV's 9998 on its own side
    assert.equal(JSON.parse(fs.readFileSync(s.stateFile, 'utf8')).foreground, APP);
    const forwards = s.lines().filter((l) => l.forward);
    assert.equal(forwards.length, 2);
    assert.ok(forwards.every((f) => f.forward.remote === 9998));
    // what was said at the end
    const text = noLeaks(s, r);
    assert.match(text, /Switch Key Server off in the Developer Mode app/);
    assert.match(text, /To remove HomeTV: delete it from the TV's app list, or delete the Developer Mode app\./);
    assert.match(text, /To let the TV update itself again: Settings › Support › Software Update › Allow Automatic Updates on/);
    assert.deepEqual(r.report.autoUpdates, { wasOn: true, nowOff: true, source: 'told by person' });
    assert.match(text, /automatic updates: were on, now off; told by person/);
    assert.ok(r.files.every((f) => fs.existsSync(f)) && r.files.some((f) => /lg-devmode-\d{4}-\d\d-\d\d\.json$/.test(f)) && r.files.some((f) => /\.txt$/.test(f)));
    // the keys the page was driven with: Blue opens Checks, Back leaves it
    assert.ok(s.cdp.seen.keys.includes(406) && s.cdp.seen.keys.includes(461));
  } finally { await s.done(); }
});

test('devmode: only the Developer Mode account, port 9922, the rsa options, the temp folder; no root, no rm outside it', async () => {
  const s = await setup();
  try {
    await s.run();
    const log = s.lines();
    const calls = log.filter((l) => l.command !== undefined);
    assert.ok(calls.length > 6);
    assert.ok(calls.every((c) => c.user === 'prisoner'), 'never root');
    assert.ok(calls.every((c) => c.port === '9922'));
    assert.ok(calls.every((c) => c.key === 'devmode_rsa'));
    assert.ok(calls.every((c) => c.options.includes('HostKeyAlgorithms=+ssh-rsa') && c.options.includes('PubkeyAcceptedKeyTypes=+ssh-rsa') && c.options.includes('BatchMode=yes')));
    const run = calls.filter((c) => c.command);
    for (const c of run) {
      assert.match(c.command, /^(id -un|mkdir -p \/media\/developer\/temp && cat > '[^']+'|luna-send-pub -(i|n 1) .*|rm -f '\/media\/developer\/temp\/[^'\/]+')$/, c.command);
      assert.doesNotMatch(c.command, /\bsu\b|sudo|\bluna-send\b(?!-pub)|reboot|rm -rf|uninstall|\/etc\b|mount/);
    }
    assert.equal(run.filter((c) => c.command.includes('/dev/install')).length, 2);
    assert.deepEqual(log.filter((l) => l.removed).map((l) => l.removed), [
      '/media/developer/temp/com.hometv.app_0.0.1_all.ipk', '/media/developer/temp/com.hometv.app_0.1.0_all.ipk']);
    // the decrypted key is only in the HomeTV folder, with the known_hosts file
    assert.ok(fs.existsSync(path.join(s.ctx.dir, 'devmode_rsa')));
  } finally { await s.done(); }
});

test('devmode: a launch-point refusal ("TV: ...") is read from the page and reported as denied', async () => {
  const s = await setup({ page: { problem: 'TV: the TV refused to list its apps' }, only: 'v0' });
  try {
    const r = await s.run();
    const c = checkOf(r.report.versions[0], 'launchpoints');
    assert.equal(c.status, 'failed');
    assert.match(c.note, /^denied: TV: the TV refused to list its apps/);
    assert.ok(r.failed >= 1);
    noLeaks(s, r);
  } finally { await s.done(); }
});

test('devmode: settings lost in the update are a failed check, with which ones differ', async () => {
  const s = await setup({ page: { wipeOnUpdate: true } });
  try {
    const r = await s.run();
    const c = checkOf(r.report.versions[1], 'settings');
    assert.equal(c.status, 'failed');
    assert.match(c.note, /settings-v1/);
    assert.equal(checkOf(r.report.versions[0], 'launchpoints').status, 'ok');
  } finally { await s.done(); }
});

test('devmode: v1\'s first run after the update is passed (Start) and recorded, not a failure', async () => {
  const s = await setup({ page: { firstRunAfterUpdate: true } });
  try {
    const r = await s.run();
    const v1 = r.report.versions[1];
    assert.equal(v1.firstRunShownAfterUpdate, true);
    const c = checkOf(v1, 'firstrun');
    assert.equal(c.status, 'ok');
    assert.equal(c.label, 'first run shown after the update');
    assert.match(c.note, /Start using Home/);
    assert.equal(checkOf(v1, 'settings').status, 'ok');
    assert.equal(checkOf(v1, 'launchpoints').status, 'ok');
    assert.equal(r.failed, 0, s.out.join('\n'));
    assert.match(fs.readFileSync(r.files[1], 'utf8'), /first run shown after the update: Start using Home/);
  } finally { await s.done(); }
});

test('devmode: when the inspector can not be reached, it says so and asks the person yes or no instead', async () => {
  const s = await setup({ noInspector: true, only: 'v1' });
  try {
    const r = await s.run();
    const v = r.report.versions[0];
    assert.equal(v.inspector, 'inspector: not reachable');
    assert.equal(checkOf(v, 'installed').status, 'ok');
    assert.equal(checkOf(v, 'opens').status, 'ok');
    assert.equal(checkOf(v, 'stays').status, 'ok');
    for (const id of ['launchpoints', 'applaunch', 'contentid'].filter((i) => checkOf(v, i))) assert.match(checkOf(v, id).note || 'asked, not read', /asked, not read|^$/);
    assert.match(checkOf(v, 'launchpoints').note, /asked, not read \(inspector: not reachable\)/);
    assert.ok(s.asked.some((q) => /Is HomeTV's Home screen showing\?/.test(q)));
    assert.ok(s.asked.some((q) => /Did YouTube open\?/.test(q)));
    assert.equal(checkOf(v, 'keypage').status, 'skipped');
    assert.equal(s.cdp.seen.evals.length, 0);
    noLeaks(s, r);
  } finally { await s.done(); }
});

test('devmode: an install the TV refuses stops that version, skips the rest, and says why', async () => {
  const s = await setup({ install: 'fail', only: 'v0' });
  try {
    const r = await s.run();
    const v = r.report.versions[0];
    assert.equal(checkOf(v, 'installed').status, 'failed');
    assert.match(checkOf(v, 'installed').note, /FAILED_IPK_SIGNATURE/);
    assert.equal(statuses(v).opens, 'skipped');
    assert.equal(statuses(v).launchpoints, 'skipped');
    assert.equal(s.lines().filter((l) => l.command && l.command.includes('applicationManager/launch')).length, 0, 'no launch after a failed install');
    assert.ok(r.failed >= 1);
    assert.equal(s.lines().filter((l) => l.removed).length, 1);
  } finally { await s.done(); }
});

test('devmode: key server off stops with the plain message; no report holds the address', async () => {
  const s = await setup({ noKeyServer: true, only: 'v0' });
  try {
    const r = await s.run();
    assert.equal(r.stopped, true);
    assert.match(r.report.stopped, /switch "Key Server" on/);
    assert.equal(s.lines().length, 0, 'ssh never started');
    noLeaks(s, r);
  } finally { await s.done(); }
});

test('devmode: a wrong passphrase is asked again, and the run goes on', async () => {
  const s = await setup({ only: 'v0' });
  const answers = ['WRONG1', PASS];
  s.ctx.ask = async (q) => { s.asked.push(q); return /passphrase/.test(q) ? answers.shift() : 'y'; };
  try {
    const r = await s.run();
    assert.equal(r.stopped, false);
    assert.equal(s.asked.filter((q) => /passphrase/.test(q)).length, 2);
    assert.ok(s.out.some((l) => /didn't open the key/.test(l)));
  } finally { await s.done(); }
});

test('devmode: a serial number or device id in the About line is cut out of the report', async () => {
  const s = await setup({ only: 'v0', page: { aboutText: 'model 43UT8000AUA, serial SECRET123, device id aa:bb:cc:dd:ee:ff' } });
  try {
    const r = await s.run();
    assert.match(checkOf(r.report.versions[0], 'about').note, /43UT8000AUA/);
    noLeaks(s, r);
  } finally { await s.done(); }
});

test('automatic updates, asked: the two yes/no questions come before anything is installed, and nothing is set', async () => {
  const s = await setup({ only: 'v0', replies: { 'Was Allow Automatic Updates on before you switched it?': 'n' } });
  const real = s.ctx.ask;
  let putsAtQuestion = -1;
  s.ctx.ask = async (q) => {
    if (/Was Allow Automatic Updates on before you switched it\?/.test(q)) putsAtQuestion = s.lines().filter((l) => l.put).length;
    if (/Is Allow Automatic Updates now off\?/.test(q)) assert.equal(s.lines().filter((l) => l.put).length, 0);
    return real(q);
  };
  try {
    const r = await s.run();
    assert.equal(putsAtQuestion, 0, 'asked before the .ipk was copied');
    assert.ok(s.asked.some((q) => /Was Allow Automatic Updates on before you switched it\? \[y\/n\]/.test(q)));
    assert.ok(s.asked.some((q) => /Is Allow Automatic Updates now off\? \[y\/n\]/.test(q)));
    assert.deepEqual(r.report.autoUpdates, { wasOn: false, nowOff: true, source: 'told by person' });
    assert.equal(r.report.setup[0].status, 'ok');
    assert.equal(r.report.setup[0].note, 'were off, now off; told by person');
    assert.match(s.out.join('\n'), /Settings › Support › Software Update › Allow Automatic Updates/);
    assert.ok(s.lines().filter((l) => l.command).every((l) => !/setSystemSettings|settingsservice\/set/i.test(l.command)));
    noLeaks(s, r);
  } finally { await s.done(); }
});

test('automatic updates, asked: still on is a failed check in the report, and the run carries on', async () => {
  const s = await setup({ only: 'v0', replies: { 'Is Allow Automatic Updates now off?': 'n' } });
  try {
    const r = await s.run();
    assert.equal(r.report.setup[0].status, 'failed');
    assert.match(r.report.setup[0].note, /were on, now not off; told by person/);
    assert.equal(r.report.autoUpdates.nowOff, false);
    assert.equal(checkOf(r.report.versions[0], 'installed').status, 'ok');
    assert.ok(r.failed >= 1);
    assert.match(s.out.join('\n'), /may update itself during the checks/);
  } finally { await s.done(); }
});

test('automatic updates, read by the script: on before, off after the person switches it, confirmed without asking', async () => {
  const s = await setup({ only: 'v0' });
  const st = JSON.parse(fs.readFileSync(s.stateFile, 'utf8'));
  fs.writeFileSync(s.stateFile, JSON.stringify({ ...st, autoUpdate: 'on' }));
  const real = s.ctx.ask;
  s.ctx.ask = async (q) => {
    if (/Switch it off, then press Enter/.test(q)) fs.writeFileSync(s.stateFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(s.stateFile, 'utf8')), autoUpdate: 'off' }));
    return real(q);
  };
  try {
    const r = await s.run();
    assert.deepEqual(r.report.autoUpdates, { wasOn: true, nowOff: true, source: 'read by script' });
    assert.equal(r.report.setup[0].note, 'were on, now off; read by script');
    assert.ok(!s.asked.some((q) => /Allow Automatic Updates (now off|on before)/.test(q)), 'nothing to ask when the TV says');
    const reads = s.lines().filter((l) => l.command && l.command.includes('getSystemSettings'));
    assert.ok(reads.length >= 2 && reads.length <= 6, 'a bounded number of reads');
    assert.match(reads[0].command, /luna-send-pub -n 1 .*settingsservice\/getSystemSettings/);
  } finally { await s.done(); }
});

// ---- the command and the .exe ----

test('hometv-lg devmode with no address prints usage and exits 2; the usage comment lists it', () => {
  const r = spawnSync(process.execPath, [path.join(HERE, '..', 'tools', 'hometv-lg.mjs'), 'devmode'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Usage: hometv-lg devmode <tv address>/);
  const top = fs.readFileSync(path.join(HERE, '..', 'tools', 'hometv-lg.mjs'), 'utf8').split('\n').slice(0, 20).join('\n');
  assert.match(top, /hometv-lg devmode <tv address>/);
  const menu = spawnSync(process.execPath, [path.join(HERE, '..', 'tools', 'hometv-lg.mjs'), '--help'], { encoding: 'utf8' });
  assert.match(menu.stdout + menu.stderr, /devmode/);
});

test('the .exe build includes every devmode module', () => {
  const build = fs.readFileSync(path.join(HERE, '..', 'tools', 'build-exe.mjs'), 'utf8');
  for (const f of ['tools/devmode.mjs', 'tools/lib/devmode.mjs', 'tools/lib/devmode-key.mjs', 'tools/lib/devmode-cdp.mjs']) {
    assert.ok(build.includes("'" + f + "'"), f);
    assert.ok(fs.existsSync(path.join(HERE, '..', f)), f + ' exists');
  }
});

test('sha256 of a file is the pin format (lowercase hex)', async () => {
  const f = path.join(scratch('sha'), 'x');
  fs.writeFileSync(f, 'abc');
  assert.equal(await sha256(f), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
