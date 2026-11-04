// The laptop check against a pretend TV: a small WebSocket server speaking SSAP's register/request messages. Checks
// pairing (prompt, then key; key reused), the read-only checks, and that nothing outside the allowlist (device id,
// serial) reaches the report.
import test from 'node:test';
import assert from 'node:assert/strict';
import { open } from '../tools/lib/ssap.mjs';
import { readOnlyChecks, launch } from '../tools/lib/checks.mjs';
import { readSettings } from '../tools/lib/backup.mjs';
import { fakeTv, HANDLERS } from './fake-ssap.mjs';

async function withTv(fn) {
  const tv = fakeTv(HANDLERS);
  await new Promise((r) => tv.server.listen(0, '127.0.0.1', r));
  const port = tv.server.address().port;
  try { await fn(port, tv.seen); } finally { tv.server.close(); }
}

test('pairing asks once, keeps the key, and asks for no write or power permissions', async () => {
  await withTv(async (port, seen) => {
    let prompted = 0;
    const ports = [{ url: 'ws://127.0.0.1:' + port + '/', insecure: false }];
    const a = await open('127.0.0.1', { ports, onPrompt: () => prompted++ });
    assert.equal(a.clientKey, 'KEY123');
    assert.equal(prompted, 1);
    a.close();
    const b = await open('127.0.0.1', { ports, clientKey: 'KEY123', onPrompt: () => prompted++ });
    assert.equal(prompted, 1);
    b.close();
    const perms = seen.registers[0].manifest.permissions;
    for (const p of ['WRITE_SETTINGS', 'CONTROL_POWER', 'CONTROL_INPUT_TEXT', 'CONTROL_MOUSE_AND_KEYBOARD']) assert.ok(!perms.includes(p), p);
    assert.equal(seen.registers[1]['client-key'], 'KEY123');
  });
});

test('the read-only checks keep only allowlisted values (no device id, no serial)', async () => {
  await withTv(async (port) => {
    const tv = await open('127.0.0.1', { ports: [{ url: 'ws://127.0.0.1:' + port + '/' }] });
    const r = await readOnlyChecks(tv);
    tv.close();
    const text = JSON.stringify(r);
    assert.ok(!text.includes('SECRET123'));
    assert.ok(!text.includes('aa:bb:cc'));
    assert.equal(r.checks.software.major_ver, '33');
    assert.equal(r.checks.system.modelName, '43UT8000AUA');
    assert.deepEqual(r.checks.apps.streaming.map((a) => a.name), ['Netflix', 'YouTube']);
    assert.equal(r.checks.foreground.appId, 'com.webos.app.home');
    assert.deepEqual(r.checks.inputs.devices, [{ id: 'HDMI_1', label: 'HDMI 1', connected: true, appId: 'com.webos.app.hdmi1' }]);
  });
});

test('the settings backup asks key by key and records what the TV refuses', async () => {
  await withTv(async (port, seen) => {
    const tv = await open('127.0.0.1', { ports: [{ url: 'ws://127.0.0.1:' + port + '/' }] });
    const s = await readSettings(tv, [{ category: 'picture', keys: ['backlight', 'contrast'] }]);
    tv.close();
    assert.deepEqual(s.picture.backlight, { ok: true, value: '80' });
    assert.equal(s.picture.contrast.ok, false);
    assert.equal(seen.requests.filter((r) => r.uri === 'settings/getSystemSettings').length, 2);
  });
});

test('the command line: pairs, keeps the key, writes an allowlisted report with the backup', async () => {
  const { execFile } = await import('node:child_process');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hometv-'));
  try {
    await withTv(async (port) => {
      const run = () => new Promise((resolve, reject) => {
        execFile(process.execPath, ['tools/tv-check.mjs', '127.0.0.1', '--backup', '--reach', '--reach-address', '127.0.0.1', '--ws-port', String(port)],
          { env: { ...process.env, HOMETV_DIR: dir }, timeout: 20000 },
          (err, stdout) => (err ? reject(err) : resolve(stdout)));
      });
      const out = await run();
      assert.match(out, /Press "Allow"/);
      assert.match(out, /Model: 43UT8000AUA, software 33\.31\.61/);
      assert.equal(fs.readFileSync(path.join(dir, 'lg-client-key'), 'utf8'), 'KEY123');
      const second = await run();
      assert.doesNotMatch(second, /Press "Allow"/);
      const reports = fs.readdirSync(dir).filter((f) => f.startsWith('lg-check-'));
      assert.ok(reports.length >= 1);
      const text = fs.readFileSync(path.join(dir, reports[0]), 'utf8');
      assert.ok(!text.includes('SECRET123') && !text.includes('aa:bb:cc') && !text.includes('127.0.0.1'));
      const saved = JSON.parse(text);
      assert.equal(saved.settings.picture.backlight.value, '80');
      assert.equal(saved.reach.ok, true);
      assert.match(out, /TV reaches the laptop: yes/);
      assert.deepEqual(saved.readiness, {
        software: '33.31.61', root: 'SlopBro: the newest version known to work (CanI.RootMy.TV, read 2026-11-04)',
        developerModeApp: true, homebrewChannel: false, appList: true, launchesWork: null
      });
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('double-clicked: asks for the address until it looks right, runs the full check, says where the report is', async () => {
  const { spawn } = await import('node:child_process');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hometv-guided-'));
  try {
    await withTv(async (port) => {
      const out = await new Promise((resolve, reject) => {
        const p = spawn(process.execPath, ['tools/hometv-lg.mjs'], {
          env: { ...process.env, HOMETV_DIR: dir, HOMETV_NO_EXPLORER: '1', HOMETV_TEST_WS_PORT: String(port), HOMETV_TEST_REACH_ADDRESS: '127.0.0.1' }
        });
        let text = '';
        const timer = setTimeout(() => { p.kill(); reject(new Error('timed out:\n' + text)); }, 20000);
        p.stdout.on('data', (d) => {
          text += d;
          if (/\[1\]: $/.test(text)) p.stdin.write('\n'); // the menu: Enter = check
          else if (/address and press Enter: $/.test(text) && !text.includes('[sent bad]')) { text += '[sent bad]'; p.stdin.write('the tv\n'); }
          else if (/Try again\.\s*\n\s*Type the TV's address and press Enter: $/.test(text)) p.stdin.write('127.0.0.1\n');
          else if (/\[Y\/n\] $/.test(text)) p.stdin.write('n\n');
          else if (/Press Enter to close\. $/.test(text)) p.stdin.write('\n');
        });
        p.on('exit', () => { clearTimeout(timer); resolve(text); });
      });
      assert.match(out, /doesn't look like four numbers/);
      assert.match(out, /TV reaches the laptop: yes/);
      assert.match(out, /Send the report file/);
      assert.equal(fs.readdirSync(dir).filter((f) => f.startsWith('lg-check-')).length, 1);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('launch reports success and failure; an unknown method is an error, not a hang', async () => {
  await withTv(async (port) => {
    const tv = await open('127.0.0.1', { ports: [{ url: 'ws://127.0.0.1:' + port + '/' }] });
    assert.deepEqual(await launch(tv, { app: 'netflix' }), { ok: true });
    assert.equal((await launch(tv, { app: 'hulu' })).ok, false);
    const r = await tv.request('nope/nothing');
    assert.equal(r.returnValue, false);
    tv.close();
  });
});
