// The root edition's own updates (Settings › Updates on a rooted TV): service/update.js (look, download, checks),
// service.js (updateCheck, updateInstall, updateStatus, version) and service/update-apply.js (swap in, wait for the new
// version to answer, swap back), against fake releases and a pretend TV: folders for /media/developer/hometv and the
// app, and a fake shell whose LG installer "installs" an .ipk by writing its version into appinfo.json.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { makeKeyPair } from '../tools/page-key.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const U = require('../service/update.js');
const { apply } = require('../service/update-apply.js');
const svc = require('../service/service.js');

const keys = makeKeyPair();
const otherKeys = makeKeyPair();
const URL_ = 'https://example.org/hometv/releases/latest/download/hometv-root.json';
const HOME = '/usr/palm/applications/com.webos.app.home';

/** A release of `version`: its .ipk says how the app behaves once installed ("starts", or "dead": never answers). */
function release(version, { behaves = 'starts', key = keys.privateKey, tag = 'app-v' + version } = {}) {
  const ipkName = `com.hometv.app_${version}_all.ipk`;
  const files = new Map([[ipkName, Buffer.from(`IPK ${version} ${behaves}`)]]);
  for (const n of U.ROOT_FILES) files.set(n, Buffer.from(`#!/bin/sh\n# ${n} ${version}\n`));
  const manifest = {
    format: 1, app: 'hometv-webos-root', version, tag,
    files: [...files].map(([name, data]) => ({ name, size: data.length, sha512: U.sha512(data) })),
  };
  const bytes = Buffer.from(JSON.stringify(manifest));
  return { manifest, bytes, sig: crypto.sign(null, bytes, key).toString('base64'), files, ipkName };
}

const SCRATCH = path.join(root, '.data', 'test-root-updates');
test.after(() => fs.rmSync(SCRATCH, { recursive: true, force: true }));

function scratch() {
  const t = path.join(SCRATCH, crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(t, { recursive: true });
  return t;
}

/** The pretend rooted TV with HomeTV 0.1.1 installed and mounted as LG's Home. */
function makeTv({ uid = 0, keptIpk = true } = {}) {
  const t = scratch();
  const D = path.join(t, 'hometv');
  const app = path.join(t, 'app');
  fs.mkdirSync(D);
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(D, 'undo-home.sh'), '# 0.1.1');
  for (const n of U.ROOT_FILES) fs.writeFileSync(path.join(D, n), `# ${n} 0.1.1\n`);
  fs.writeFileSync(path.join(app, 'appinfo.json'), JSON.stringify({ id: 'com.hometv.app', version: '0.1.1' }));
  if (keptIpk) {
    fs.mkdirSync(path.join(D, 'updates'));
    fs.writeFileSync(path.join(D, 'updates', 'current.ipk'), 'IPK 0.1.1 starts');
  }
  const mounts = path.join(t, 'mounts');
  fs.writeFileSync(mounts, `/dev/x ${HOME} none bind 0 0\n`);

  const tv = { t, D, app, mounts, online: true, offer: null, tamper: {}, gets: [], spawned: [], shell: [], answering: '0.1.1' };
  tv.get = (url, max, cb) => {
    tv.gets.push(url);
    if (!tv.online) return cb(new Error('no connection'));
    const r = tv.offer;
    if (!r) return cb(new Error('HTTP 404'));
    if (url === URL_) return cb(null, r.bytes);
    if (url === URL_ + '.sig') return cb(null, Buffer.from(r.sig));
    const m = /\/releases\/download\/([^/]+)\/([^/]+)$/.exec(url);
    if (!m || m[1] !== r.manifest.tag) return cb(new Error('HTTP 404'));
    const name = decodeURIComponent(m[2]);
    const body = tv.tamper[name] || r.files.get(name);
    if (!body) return cb(new Error('HTTP 404'));
    if (body.length > max) return cb(new Error('larger than expected'));
    cb(null, body);
  };
  /** LG's installer, the start-up hook and the service's answer, as update-apply.js calls them through sh -c. */
  tv.run = (cmd, cb) => {
    tv.shell.push(cmd);
    if (/appInstallService\/dev\/install/.test(cmd)) {
      const file = /"ipkUrl":"([^"]+)"/.exec(cmd)[1].replace(/\\\\/g, '\\');
      const [, v, behaves] = String(fs.readFileSync(file)).split(' ');
      fs.writeFileSync(path.join(app, 'appinfo.json'), JSON.stringify({ id: 'com.hometv.app', version: v }));
      tv.answering = behaves === 'starts' ? v : '';
      return cb(0, 'installed');
    }
    if (/service\/version/.test(cmd)) return cb(tv.answering ? 0 : 1, tv.answering ? `{"returnValue": true, "version": "${tv.answering}"}` : '');
    return cb(0, '');
  };
  tv.methods = svc.createMethods({
    rootDir: D, appDir: app, uid: () => uid, updateGet: tv.get,
    updateConfig: { url: URL_, keys: [keys.publicKey], on: true },
    spawn: (cmd, args, opts) => (tv.spawned.push({ cmd, args, opts }), { on() {}, unref() {} }),
  });
  tv.call = (name, payload = {}, sender = 'com.webos.app.home') =>
    new Promise((resolve) => tv.methods[name]({ sender, payload, respond: resolve }));
  /** What the detached update-apply.js does, with the keys of the app installed now. */
  tv.apply = (over = {}) => new Promise((resolve) => apply({
    stage: tv.spawned[tv.spawned.length - 1].args[1], dir: D, app, home: HOME, mounts, keys: [keys.publicKey],
    run: tv.run, sleep: (ms, cb) => setImmediate(cb), stepMs: 2000, ...over,
  }, resolve));
  tv.version = () => JSON.parse(fs.readFileSync(path.join(app, 'appinfo.json'), 'utf8')).version;
  tv.script = (n) => fs.readFileSync(path.join(D, n), 'utf8');
  tv.last = () => JSON.parse(fs.readFileSync(path.join(D, 'updates', 'last.json'), 'utf8'));
  /** Install update pressed, and the download finished. */
  tv.install = async (version) => {
    const r = await tv.call('updateInstall', { version });
    for (let i = 0; i < 50 && tv.last().state === 'downloading'; i++) await new Promise((x) => setImmediate(x));
    return r;
  };
  return tv;
}

const fileGets = (tv) => tv.gets.filter((u) => !/hometv-root\.json(\.sig)?$/.test(u));

test('root update: look, Install update, swap in; the new version answers, the old one is kept', async () => {
  const tv = makeTv();
  tv.offer = release('0.2.0');
  const c = await tv.call('updateCheck');
  assert.equal(c.returnValue, true);
  assert.equal(c.available, '0.2.0');
  assert.equal(c.installed, '0.1.1');
  assert.equal(c.root, true);
  assert.deepEqual(fileGets(tv), [], 'nothing downloaded before Install update');

  const r = await tv.install('0.2.0');
  assert.equal(r.returnValue, true);
  assert.equal(tv.spawned.length, 1);
  assert.equal(tv.spawned[0].cmd, process.execPath);
  assert.match(tv.spawned[0].args[0], /update-apply\.js$/);
  assert.equal(tv.spawned[0].opts.detached, true);
  assert.equal(fileGets(tv).length, 1 + U.ROOT_FILES.length);
  assert.ok(fileGets(tv).every((u) => u.includes('/releases/download/app-v0.2.0/')), 'files from the manifest’s own release');
  assert.equal((await tv.call('updateStatus')).busy, true);

  const done = await tv.apply();
  assert.equal(done.state, 'done', done.note);
  assert.equal(tv.version(), '0.2.0');
  assert.match(tv.script('lib.sh'), /lib\.sh 0\.2\.0/);
  assert.equal(String(fs.readFileSync(path.join(tv.D, 'updates', 'current.ipk'))), 'IPK 0.2.0 starts');
  assert.match(fs.readFileSync(path.join(tv.D, 'updates', 'prev', 'lib.sh'), 'utf8'), /0\.1\.1/, 'the previous scripts kept');
  assert.equal(String(fs.readFileSync(path.join(tv.D, 'updates', 'prev', 'app.ipk'))), 'IPK 0.1.1 starts');
  assert.equal(tv.shell.filter((c) => /10-hometv-home/.test(c)).length, 1, 'HomeTV as LG’s Home refreshed in place');
  assert.ok(!fs.existsSync(path.join(tv.D, 'updates', 'stage')), 'the download is tidied');
  const s = await tv.call('updateStatus');
  assert.equal(s.busy, false);
  assert.equal(s.last.state, 'done');
  assert.equal((await tv.call('updateCheck')).available, null, 'up to date');
});

test('root update: a bad signature is refused; nothing is downloaded or installed', async () => {
  const tv = makeTv();
  tv.offer = release('0.2.0', { key: otherKeys.privateKey });
  const c = await tv.call('updateCheck');
  assert.equal(c.available, null);
  assert.equal(c.refused, 'bad signature');
  await tv.install('0.2.0');
  assert.equal(tv.last().state, 'refused');
  assert.equal(tv.spawned.length, 0);
  assert.deepEqual(fileGets(tv), []);
  assert.equal(tv.version(), '0.1.1');

  const r = release('0.2.0');
  const m = JSON.parse(String(r.bytes));
  m.files.push({ name: 'evil.sh', size: 1, sha512: 'a'.repeat(128) });
  const bytes = Buffer.from(JSON.stringify(m));
  tv.offer = { ...r, manifest: m, bytes, sig: crypto.sign(null, bytes, keys.privateKey).toString('base64') };
  assert.match((await tv.call('updateCheck')).refused, /a file this TV never installs: evil\.sh/, 'signed, but lists another file');
});

test('root update: a bad checksum is refused and the download deleted; a stage changed after the download is refused too', async () => {
  const tv = makeTv();
  tv.offer = release('0.2.0');
  tv.tamper['watchdog.sh'] = Buffer.from('#!/bin/sh\n# watchdog.sh 6.6.6\n');
  await tv.install('0.2.0');
  assert.equal(tv.last().state, 'refused');
  assert.match(tv.last().note, /watchdog\.sh: SHA-512 doesn't match/);
  assert.equal(tv.spawned.length, 0);
  assert.ok(!fs.existsSync(path.join(tv.D, 'updates', 'stage')));
  assert.match(tv.script('watchdog.sh'), /0\.1\.1/);

  tv.tamper = {};
  await tv.install('0.2.0');
  const stage = tv.spawned[0].args[1];
  fs.writeFileSync(path.join(stage, 'lib.sh'), '#!/bin/sh\nrm -rf /\n');
  const r = await tv.apply();
  assert.equal(r.state, 'refused');
  assert.match(r.note, /lib\.sh doesn't match the signed manifest/);
  assert.equal(tv.version(), '0.1.1', 'nothing installed');
  assert.equal(tv.shell.length, 0, 'no command run');
  assert.ok(!fs.existsSync(stage));
});

test('root update: a new version that doesn\'t answer in 40 s is swapped back and never offered again', async () => {
  const tv = makeTv();
  tv.offer = release('0.2.0', { behaves: 'dead' });
  await tv.install('0.2.0');
  const r = await tv.apply();
  assert.equal(r.state, 'rolled back');
  assert.match(r.note, /didn't answer within 40 s; 0\.1\.1 is back/);
  assert.equal(tv.shell.filter((c) => /service\/version/.test(c)).length, 21, 'asked every 2 s for 40 s');
  assert.equal(tv.version(), '0.1.1', 'the previous app installed again');
  assert.equal(tv.answering, '0.1.1');
  assert.match(tv.script('lib.sh'), /0\.1\.1/, 'the previous scripts back');
  assert.equal(fs.readFileSync(path.join(tv.D, 'updates', 'failed'), 'utf8'), '0.2.0\n');

  const again = await tv.call('updateCheck');
  assert.equal(again.available, null);
  assert.equal(again.failedBefore, '0.2.0', 'not retried');
  await tv.install('0.2.0');
  assert.equal(tv.last().state, 'refused');
  assert.match(tv.last().note, /0\.2\.0 failed before/);
  assert.equal(tv.spawned.length, 1);

  tv.offer = release('0.2.1');
  assert.equal((await tv.call('updateCheck')).available, '0.2.1', 'a newer one is offered');
});

test('root update: without a kept copy of the app, the scripts still go back and the note says so', async () => {
  const tv = makeTv({ keptIpk: false });
  tv.offer = release('0.2.0', { behaves: 'dead' });
  await tv.install('0.2.0');
  const r = await tv.apply({ answerMs: 4000 });
  assert.equal(r.state, 'rolled back');
  assert.match(r.note, /no copy of the previous app was kept: reinstall it from Homebrew Channel/);
  assert.match(tv.script('lib.sh'), /0\.1\.1/);
});

test('root update: no network says so and changes nothing', async () => {
  const tv = makeTv();
  tv.online = false;
  const c = await tv.call('updateCheck');
  assert.equal(c.available, null);
  assert.equal(c.error, 'no connection');
  await tv.install('0.2.0');
  assert.equal(tv.last().state, 'failed');
  assert.equal(tv.last().note, 'no connection');
  assert.equal(tv.spawned.length, 0);
});

test('root update: only HomeTV, as root, on the root edition, one at a time; version answers anyone', async () => {
  const tv = makeTv();
  tv.offer = release('0.2.0');
  assert.equal((await tv.call('updateInstall', { version: '0.2.0' }, 'com.example.app')).errorText, 'not HomeTV');
  assert.equal((await tv.call('updateCheck', {}, 'com.hometv.app-1')).errorText, 'not HomeTV');
  assert.equal((await tv.call('version', {}, 'com.webos.lunasend')).returnValue, true);
  const jailed = makeTv({ uid: 1000 });
  jailed.offer = release('0.2.0');
  assert.match((await jailed.call('updateInstall', { version: '0.2.0' })).errorText, /isn't running as root/);
  assert.equal((await jailed.call('updateCheck', {}, 'com.hometv.app')).root, false, 'Developer Mode: the page says the laptop');
  await tv.install('0.2.0');
  assert.match((await tv.call('updateInstall', { version: '0.2.0' })).errorText, /already running/);
});

test('root update: the manifest rules and the address of a file', () => {
  const r = release('0.2.0');
  assert.equal(U.validate(r.manifest), null);
  const bad = (change) => {
    const m = JSON.parse(JSON.stringify(r.manifest));
    change(m);
    return U.validate(m);
  };
  assert.match(bad((m) => (m.app = 'hometv-webos')), /another app/, 'a page manifest is not a root one');
  assert.match(bad((m) => (m.files = m.files.filter((f) => !/\.ipk$/.test(f.name)))), /no com\.hometv\.app_0\.2\.0_all\.ipk/);
  assert.match(bad((m) => (m.files[1].name = '../lib.sh')), /never installs/);
  assert.match(bad((m) => m.files.push(m.files[1])), /repeated/);
  assert.match(bad((m) => (m.files[0].sha512 = 'x')), /bad SHA-512/);
  assert.match(bad((m) => (m.tag = '../x')), /bad tag/);
  assert.equal(U.fileUrl(URL_, r.manifest, 'lib.sh'), 'https://example.org/hometv/releases/download/app-v0.2.0/lib.sh');
  assert.equal(U.fileUrl('https://x.org/a/hometv-root.json', r.manifest, 'lib.sh'), 'https://x.org/a/lib.sh');
  const listed = fs.readdirSync(path.join(root, 'root')).filter((f) => !['README.md', 'package.json'].includes(f)).sort();
  assert.deepEqual([...U.ROOT_FILES].sort(), listed, 'ROOT_FILES is every root script');
  assert.equal(U.loadConfig(path.join(root, 'service')).on, false, 'off in the repo: no address, no key');
});
