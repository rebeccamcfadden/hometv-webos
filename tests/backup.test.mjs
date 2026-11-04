// The backup and restore (tools/lib/backup.mjs, tools/lib/restore.mjs, tools/restore.mjs) against a pretend TV
// (tests/fake-ssap.mjs) and a pretend rooted TV's shell (tests/fake-shell.mjs). Checks: the backup reads only, records
// what the TV allowed, keeps identifiers out of the screen; restore shows a dry run first, never writes in a dry run,
// writes only the backup's differing keys, one category at a time, and stops at the first error. Scratch files go
// in dist/ (ignored by git).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { open } from '../tools/lib/ssap.mjs';
import { backup, describe, isReadOnlyCommand, readOnly, FORMAT } from '../tools/lib/backup.mjs';
import { wanted, plan, rootReader, describePlan, precheck, apply, guarded, menuStep, loadBackup } from '../tools/lib/restore.mjs';
import { sq, luna } from '../tools/lib/root-shell.mjs';
import { fakeTv, HANDLERS } from './fake-ssap.mjs';
import { fakeShell, freshState } from './fake-shell.mjs';

const NEVER = /reset|factory|initiali[sz]e|\brm\b|reboot|chattr|uninstall|dd\b|mkfs/i;

function scratch() {
  fs.mkdirSync('dist', { recursive: true });
  return fs.mkdtempSync(path.join('dist', 'test-backup-'));
}

async function withTv(handlers, fn) {
  const tv = fakeTv(handlers);
  await new Promise((r) => tv.server.listen(0, '127.0.0.1', r));
  const port = tv.server.address().port;
  try { await fn(port, tv.seen); } finally { tv.server.close(); }
}

const connect = (port) => open('127.0.0.1', { ports: [{ url: 'ws://127.0.0.1:' + port + '/' }] });

test('backup without root: what a paired app may read, each read with its permission, saved apart from any report', async () => {
  const dir = scratch();
  try {
    await withTv(HANDLERS, async (port, seen) => {
      const tv = await connect(port);
      const b = await backup(tv, path.join(dir, 'backups'), { now: new Date('2026-11-05T10:00:00Z') });
      tv.close();
      assert.equal(path.basename(b.file), 'lg-backup-2026-11-05-10-00-00.json');
      assert.equal(b.tarFile, null);
      const text = fs.readFileSync(b.file, 'utf8');
      const saved = JSON.parse(text);
      assert.equal(saved.format, FORMAT);
      assert.deepEqual(saved.tv, { model: '43UT8000AUA', software: '33.31.61', webos: 'webOSTV 10.3.1', foreground: 'com.webos.app.home' });
      assert.equal(saved.root, null);
      assert.ok(!text.includes('SECRET123') && !text.includes('aa:bb:cc'), 'serial and device id are dropped even here');
      assert.ok(!text.includes('x.png'), 'icons are not kept');
      assert.deepEqual(saved.ssap.apps.map((a) => a.id), ['netflix', 'youtube.leanback.v4', 'com.webos.app.browser', 'com.palmdts.devmode']);
      assert.deepEqual(saved.ssap.inputs, [{ id: 'HDMI_1', label: 'HDMI 1', connected: true, appId: 'com.webos.app.hdmi1' }]);
      assert.deepEqual(saved.ssap.settings.picture.backlight, { ok: true, value: '80' });
      assert.equal(saved.ssap.settings.picture.contrast.ok, false);
      const sw = saved.ssap.reads.find((r) => r.what === 'software');
      assert.deepEqual([sw.permission, sw.ok], ['READ_UPDATE_INFO', true]);
      const contrast = saved.ssap.reads.find((r) => r.key === 'contrast');
      assert.deepEqual([contrast.permission, contrast.ok, contrast.error], ['READ_SETTINGS', false, 'no such key']);
      assert.ok(saved.ssap.permissionsAsked.includes('READ_SETTINGS') && !saved.ssap.permissionsAsked.includes('WRITE_SETTINGS'));
      // nothing but reads went to the TV
      assert.ok(seen.requests.every((r) => /\/(get|list)[A-Z]/.test(r.uri)), seen.requests.map((r) => r.uri).join(', '));
      assert.equal(b.summary.settingsRead, 1);
      assert.match(describe(b.summary).join('\n'), /Settings read over the remote connection: 1 \(\d+ refused/);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('backup with root: read-only commands only, every settings category found, database pages, a copy of the preferences', async () => {
  const dir = scratch();
  try {
    await withTv(HANDLERS, async (port) => {
      const tv = await connect(port);
      const sh = fakeShell();
      const before = JSON.stringify(sh.state);
      const b = await backup(tv, dir, { shell: sh, now: new Date('2026-11-05T10:00:00Z') });
      tv.close();
      assert.equal(JSON.stringify(sh.state), before, 'the TV is unchanged');
      for (const c of sh.log) assert.ok(isReadOnlyCommand(c), c);
      assert.ok(!sh.log.some((c) => NEVER.test(c) || /setSystemSettings/.test(c)));
      const saved = JSON.parse(fs.readFileSync(b.file, 'utf8'));
      assert.equal(saved.root.ok, true);
      assert.deepEqual(saved.root.settings.picture, { ok: true, values: { pictureMode: 'standard', backlight: '80', contrast: '85' } });
      assert.equal(saved.root.settings.aiSound.ok, false, 'aiSound is found in the database; this pretend TV refuses it');
      assert.equal(saved.root.db8['com.webos.settings.system:1'].results.length, 3, 'two pages read');
      assert.equal(saved.root.db8['com.webos.applicationManager.launchpoints:2'].ok, false);
      assert.equal(path.basename(b.tarFile), 'lg-backup-2026-11-05-10-00-00-files.tar');
      assert.equal(fs.readFileSync(b.tarFile, 'utf8'), 'TARDATA');
      assert.equal(saved.root.files.tar, path.basename(b.tarFile));
      assert.match(saved.root.files.sha256, /^[0-9a-f]{64}$/);
      // a backup may hold identifiers (the TV's name, the PIN), but the screen never shows them
      assert.ok(JSON.stringify(saved).includes('SECRET-TV-NAME'));
      const lines = describe(b.summary).join('\n');
      assert.ok(!lines.includes('SECRET-TV-NAME') && !lines.includes('1234'));
      assert.match(lines, /With root: \d+ settings categories/);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('backup with a shell that is not root: nothing but `id -u` is run', async () => {
  const dir = scratch();
  try {
    const sh = fakeShell({ ...freshState(), uid: '1000' });
    const b = await backup(null, dir, { shell: sh });
    assert.deepEqual(sh.log, ['id -u']);
    assert.deepEqual(b.data.root, { ok: false, error: 'the shell is not root' });
    assert.match(describe(b.summary).join('\n'), /Root backup not taken/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the read-only list refuses writes, other commands and quoting tricks', async () => {
  const set = 'luna-send -n 1 -w 10000 ' + sq('luna://com.webos.settingsservice/setSystemSettings') + ' ' + sq('{}');
  assert.equal(isReadOnlyCommand(set), false);
  assert.equal(isReadOnlyCommand('rm -rf /var/luna/preferences'), false);
  assert.equal(isReadOnlyCommand("luna-send -n 1 -w 10000 'luna://com.webos.settingsservice/getSystemSettings' '{}'; reboot"), false);
  assert.equal(isReadOnlyCommand("luna-send -n 1 -w 10000 'luna://com.webos.settingsservice/getSystemSettings' '{}' ; reboot '{}'"), false);
  assert.equal(isReadOnlyCommand('luna-send -n 1 -w 10000 ' + sq('luna://com.webos.settingsservice/getSystemSettings') + ' ' + sq('{"category":"it\'s"}')), true);
  const sh = fakeShell();
  await assert.rejects(async () => readOnly(sh).run(set), /refused/);
  await assert.rejects(async () => guarded(sh).run('reboot'), /refused/);
  assert.deepEqual(sh.log, []);
  // a quote inside a value survives the trip
  sh.state.settings.picture.pictureMode = "it's";
  assert.equal((await luna(sh, 'com.webos.settingsservice/getSystemSettings', { category: 'picture', keys: ['pictureMode'] })).settings.pictureMode, "it's");
});

/** A backup as the root backup would save it, from the pretend TV's starting state. */
async function rootBackup(dir) {
  const sh = fakeShell();
  return (await backup(null, dir, { shell: sh })).data;
}

function changedTv() {
  const s = freshState();
  s.settings.picture.backlight = '50';
  s.settings.sound.soundOutput = 'external_arc';
  s.settings.network.deviceName = 'OTHER-NAME';
  s.settings.lock.parentalPin = '0000';
  s.settings.option.eulaAgreed = 'false';
  s.settings.option.localeInfo = { clock: '12', locales: { TV: 'en-US', UI: 'en-US' } }; // the same, in another order
  delete s.settings.picture.contrast;
  return fakeShell(s);
}

test('restore, dry run: lists what would be written; network, PIN and agreements are by hand and their values hidden', async () => {
  const dir = scratch();
  try {
    const data = await rootBackup(dir);
    data.tv.model = '43UT8000AUA';
    const sh = changedTv();
    const p = await plan(wanted(data), rootReader(guarded(sh)));
    const differs = p.rows.filter((r) => r.state === 'differs').map((r) => r.category + '.' + r.key + (r.writable ? '' : ' (by hand)'));
    assert.deepEqual(differs.sort(), ['lock.parentalPin (by hand)', 'network.deviceName (by hand)', 'option.eulaAgreed (by hand)', 'picture.backlight', 'sound.soundOutput']);
    assert.equal(p.rows.find((r) => r.key === 'contrast').state, 'unknown');
    const text = describePlan(p, { root: true }).join('\n');
    assert.match(text, /Would write[^\n]*\n {2}picture › backlight: "50" -> "80"\n {2}sound › soundOutput: "external_arc" -> "tv_speaker"/);
    for (const secret of ['SECRET-TV-NAME', 'OTHER-NAME', '1234', '0000']) assert.ok(!text.includes(secret), secret);
    assert.match(text, /To set by hand[\s\S]*value not shown/);
    assert.match(text, /Not on this TV now \(left alone\): 1 \(picture\)/);
    assert.ok(!sh.log.some((c) => /setSystemSettings/.test(c)), 'a dry run writes nothing');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('restore with root: only the backup\'s differing keys, per category, read back; the TV then matches', async () => {
  const dir = scratch();
  try {
    const data = await rootBackup(dir);
    const sh = changedTv();
    const g = guarded(sh);
    const p = await plan(wanted(data), rootReader(g));
    const r = await apply(g, p.rows);
    assert.deepEqual(r, { ok: true, written: ['picture', 'sound'] });
    const sets = sh.log.filter((c) => /setSystemSettings/.test(c)).map((c) => JSON.parse(c.slice(c.lastIndexOf(" '") + 2, -1)));
    assert.deepEqual(sets, [{ category: 'picture', settings: { backlight: '80' } }, { category: 'sound', settings: { soundOutput: 'tv_speaker' } }]);
    assert.equal(sh.state.settings.network.deviceName, 'OTHER-NAME', 'network is left alone');
    assert.equal(sh.state.settings.lock.parentalPin, '0000', 'the PIN is left alone');
    assert.equal(sh.state.settings.option.eulaAgreed, 'false', 'agreements are left alone');
    assert.ok(!sh.log.some((c) => NEVER.test(c)));
    const again = await plan(wanted(data), rootReader(g));
    assert.equal(again.rows.filter((x) => x.state === 'differs' && x.writable).length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('restore stops at the first error: a refused write, or a value that reads back different', async () => {
  const dir = scratch();
  try {
    const data = await rootBackup(dir);
    const a = changedTv();
    a.state.failSet = 'picture';
    const pa = await plan(wanted(data), rootReader(a));
    const ra = await apply(a, pa.rows);
    assert.deepEqual(ra, { ok: false, written: [], category: 'picture', error: 'refused by the settings service' });
    assert.equal(a.log.filter((c) => /setSystemSettings/.test(c)).length, 1, 'sound is not tried after picture failed');
    assert.equal(a.state.settings.sound.soundOutput, 'external_arc');

    const b = changedTv();
    b.state.failReadBack = 'picture';
    const rb = await apply(b, (await plan(wanted(data), rootReader(b))).rows);
    assert.equal(rb.ok, false);
    assert.match(rb.error, /read back different: backlight/);
    assert.equal(b.state.settings.sound.soundOutput, 'external_arc');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('restore pre-checks: root, the same model; another software version or input is a note', async () => {
  const data = { tv: { model: '43UT8000AUA', software: '33.31.61', foreground: 'com.webos.app.home' } };
  assert.deepEqual(await precheck(fakeShell(), data), { ok: true, notes: [] });
  assert.equal((await precheck(fakeShell({ ...freshState(), uid: '1000' }), data)).ok, false);
  const other = await precheck(fakeShell({ ...freshState(), model: '55C4' }), data);
  assert.deepEqual(other, { ok: false, error: 'this TV is a 55C4, the backup is from a 43UT8000AUA', notes: [] });
  const s = freshState();
  s.sw.minor_ver = '40.10';
  s.foreground = 'com.webos.app.hdmi1';
  const notes = (await precheck(fakeShell(s), data)).notes.join('\n');
  assert.match(notes, /software is 33\.40\.10/);
  assert.match(notes, /kept per input/);
});

test('without root, the plan is menu steps for the remote', () => {
  assert.equal(menuStep({ category: 'sound', key: 'soundOutput', backup: 'tv_speaker', now: 'external_arc' }),
    'Settings › All Settings › Sound › Sound Out: set it to "tv_speaker" (now "external_arc")');
  assert.match(menuStep({ category: 'picture', key: 'dynamicTone', backup: 'on', now: 'off' }), /^Search All Settings \(the magnifier\) for "dynamicTone" \(picture\): set it to "on"/);
});

function run(args, env, input) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, args, { env: { ...process.env, ...env } });
    let out = '';
    p.stdout.on('data', (d) => {
      out += d;
      if (input !== undefined && /anything else stops\): $/.test(out)) p.stdin.write(input + '\n');
    });
    p.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => p.kill(), 20000);
    p.on('exit', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

test('hometv-lg restore without root: reads over the remote connection, prints menu steps, writes nothing', async () => {
  const dir = scratch();
  try {
    const handlers = {
      ...HANDLERS,
      'settings/getSystemSettings': (p) => (p.category === 'picture' && p.keys[0] === 'backlight'
        ? { returnValue: true, settings: { backlight: '40' } } : { returnValue: false, errorText: 'no such key' })
    };
    await withTv(HANDLERS, async (port) => {
      const tv = await connect(port);
      await backup(tv, dir, { now: new Date('2026-11-05T10:00:00Z') });
      tv.close();
    });
    const file = path.join(dir, 'lg-backup-2026-11-05-10-00-00.json');
    assert.equal(loadBackup(file).tv.model, '43UT8000AUA');
    await withTv(handlers, async (port, seen) => {
      const r = await run(['tools/hometv-lg.mjs', 'restore', file, '127.0.0.1'], { HOMETV_DIR: dir, HOMETV_TEST_WS_PORT: String(port) });
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /To set by hand with the remote/);
      assert.match(r.out, /Picture › Brightness › Screen Brightness[^\n]*set it to "80" \(now "40"\)/);
      assert.match(r.out, /Nothing was changed on the TV/);
      assert.ok(seen.requests.every((q) => /\/get[A-Z]/.test(q.uri)), seen.requests.map((q) => q.uri).join(', '));
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('hometv-lg restore --root: dry run first, writes only after "restore" is typed, stops on another model', async () => {
  const dir = scratch();
  try {
    const data = await rootBackup(dir);
    const file = path.join(dir, 'b.json');
    fs.writeFileSync(file, JSON.stringify(data));
    fs.writeFileSync(path.join(dir, 'lg-root-key'), 'not a real key');
    const stateFile = path.join(dir, 'tv.json');
    const logFile = path.join(dir, 'ssh.log');
    const reset = (patch = {}) => { fs.writeFileSync(stateFile, JSON.stringify({ ...changedTv().state, ...patch })); fs.writeFileSync(logFile, ''); };
    const env = { HOMETV_DIR: dir, HOMETV_SSH: path.resolve('tests/fake-shell.mjs'), FAKE_TV_STATE: stateFile, FAKE_TV_LOG: logFile };
    const cmds = () => fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const tvNow = () => JSON.parse(fs.readFileSync(stateFile, 'utf8')).settings;

    reset();
    const dry = await run(['tools/hometv-lg.mjs', 'restore', file, '192.168.1.50', '--root', '--dry-run'], env);
    assert.equal(dry.code, 0, dry.out);
    assert.match(dry.out, /Would write/);
    assert.match(dry.out, /Dry run: nothing written/);
    assert.equal(tvNow().picture.backlight, '50');
    assert.ok(!cmds().some((c) => /setSystemSettings/.test(c.cmd)));
    const sshArgs = cmds()[0].args;
    assert.ok(sshArgs.includes('BatchMode=yes') && sshArgs.includes('root@192.168.1.50'), sshArgs.join(' '));

    reset();
    const no = await run(['tools/hometv-lg.mjs', 'restore', file, '192.168.1.50', '--root'], env, 'yes');
    assert.match(no.out, /Stopped: nothing written/);
    assert.ok(!cmds().some((c) => /setSystemSettings/.test(c.cmd)));

    reset();
    const yes = await run(['tools/hometv-lg.mjs', 'restore', file, '192.168.1.50', '--root'], env, 'restore');
    assert.equal(yes.code, 0, yes.out);
    assert.match(yes.out, /Done: picture, sound written and read back/);
    assert.equal(tvNow().picture.backlight, '80');
    assert.equal(tvNow().network.deviceName, 'OTHER-NAME');
    assert.ok(!cmds().some((c) => NEVER.test(c.cmd)));
    assert.ok(!yes.out.includes('SECRET-TV-NAME') && !yes.out.includes('OTHER-NAME'));

    reset({ failSet: 'picture' });
    const fail = await run(['tools/hometv-lg.mjs', 'restore', file, '192.168.1.50', '--root'], env, 'restore');
    assert.equal(fail.code, 1);
    assert.match(fail.out, /Stopped at picture: refused by the settings service\.\nNothing was written/);
    assert.equal(tvNow().sound.soundOutput, 'external_arc');

    reset({ model: '55C4' });
    const other = await run(['tools/hometv-lg.mjs', 'restore', file, '192.168.1.50', '--root'], env, 'restore');
    assert.equal(other.code, 1);
    assert.match(other.out, /Stopped, nothing written: this TV is a 55C4/);
    assert.ok(!cmds().some((c) => /getSystemSettings|setSystemSettings/.test(c.cmd)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('hometv-lg check --backup --root: the backup is a separate file with the root part; the report stays allowlisted', async () => {
  const dir = scratch();
  try {
    const stateFile = path.join(dir, 'tv.json');
    const logFile = path.join(dir, 'ssh.log');
    fs.writeFileSync(stateFile, JSON.stringify(freshState()));
    fs.writeFileSync(logFile, '');
    fs.writeFileSync(path.join(dir, 'lg-root-key'), 'not a real key');
    await withTv(HANDLERS, async (port) => {
      const out = await new Promise((resolve, reject) => {
        execFile(process.execPath, ['tools/tv-check.mjs', '127.0.0.1', '--backup', '--root', '--ws-port', String(port)],
          { env: { ...process.env, HOMETV_DIR: dir, HOMETV_SSH: path.resolve('tests/fake-shell.mjs'), FAKE_TV_STATE: stateFile, FAKE_TV_LOG: logFile }, timeout: 20000 },
          (err, stdout) => (err ? reject(err) : resolve(stdout)));
      });
      assert.match(out, /Backup: .*lg-backup-.*\.json/);
      assert.match(out, /stays on this laptop/);
      assert.ok(!out.includes('SECRET-TV-NAME'));
      const backups = fs.readdirSync(path.join(dir, 'backups'));
      assert.equal(backups.filter((f) => f.endsWith('.json')).length, 1);
      assert.equal(backups.filter((f) => f.endsWith('-files.tar')).length, 1);
      const saved = JSON.parse(fs.readFileSync(path.join(dir, 'backups', backups.find((f) => f.endsWith('.json'))), 'utf8'));
      assert.equal(saved.root.ok, true);
      const report = fs.readdirSync(dir).find((f) => f.startsWith('lg-check-'));
      const text = fs.readFileSync(path.join(dir, report), 'utf8');
      assert.ok(!text.includes('SECRET-TV-NAME') && !text.includes('db8') && !text.includes('parentalPin'));
      assert.equal(JSON.parse(text).settings.picture.backlight.value, '80');
      const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l).cmd);
      for (const c of lines) assert.ok(isReadOnlyCommand(c), c);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
