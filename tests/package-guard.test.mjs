// tools/package-webos.mjs refuses a page holding any sample title, in any file (not only app.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { samplesInPage, sampleIn, serviceStage } from '../tools/package-webos.mjs';

function page(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hometv-page-'));
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
  }
  return dir;
}

test('sampleIn finds the sample titles', () => {
  assert.equal(sampleIn('title:"Past Lives"'), true);
  assert.equal(sampleIn('title:"Heat"'), false);
});

test('samplesInPage: clean page passes, a sample title in any file is named', () => {
  const clean = page({ 'assets/app.js': 'var a=1', 'index.html': '<p>HomeTV</p>' });
  const dirty = page({ 'assets/app.js': 'var a=1', 'assets/extra.js': 'x="Severance"', 'data.json': '{"t":"Knives Out"}' });
  try {
    assert.deepEqual(samplesInPage(clean), []);
    assert.deepEqual(samplesInPage(dirty).map((f) => f.replace(/\\/g, '/')).sort(), ['assets/extra.js', 'data.json']);
  } finally {
    fs.rmSync(clean, { recursive: true, force: true });
    fs.rmSync(dirty, { recursive: true, force: true });
  }
});

test('the built v1 page, when present, holds no sample title', { skip: !fs.existsSync('dist/app/assets/app.js') }, () => {
  assert.deepEqual(samplesInPage('dist/app'), []);
});

test('the service in the package: v1 has the key page, v0 does not; neither has private keys', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'hometv-svc-stage-'));
  try {
    fs.mkdirSync('service/.private', { recursive: true });
    fs.writeFileSync('service/.private/probe.json', '{}');
    serviceStage(out, true);
    const updater = ['nacl-fast.min.js', 'update-apply.js', 'update-config.json', 'update.js'];
    assert.deepEqual(fs.readdirSync(out).sort(), ['keys-page.html', 'package.json', 'pages.js', 'service.js', 'services.json', ...updater].sort());
    serviceStage(out, false);
    assert.deepEqual(fs.readdirSync(out).sort(), ['package.json', 'service.js', 'services.json', ...updater].sort());
    // The root edition's updater: off without HOMETV_ROOT_UPDATE_URL; the service answers with the app's version.
    const conf = JSON.parse(fs.readFileSync(path.join(out, 'update-config.json'), 'utf8'));
    if (!process.env.HOMETV_ROOT_UPDATE_URL) assert.equal(conf.url, '');
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'package.json'), 'utf8')).version, JSON.parse(fs.readFileSync('package.json', 'utf8')).appVersion);
  } finally {
    fs.rmSync('service/.private', { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});
