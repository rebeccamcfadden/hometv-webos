// HomeTV's LG service (service/service.js) and the key page behind it: who may call each Luna method, that the token is
// given only once the server holds its port and is never written to disk, that the keys come back to the page, and that
// the process is kept alive while the key page is open and let go after. A fake activityManager; real HTTP on loopback;
// no network beyond it. `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const svc = require('../service/service.js');
const pages = require('../service/pages.js');

const APP = 'com.hometv.app';
const dirs = [];
const dir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hometv-svc-'));
  dirs.push(d);
  return d;
};
test.after(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

/** A service with a fake activityManager, a clock and a timer that only runs when a test says so. */
function make({ dataDir = dir(), port = 0 } = {}) {
  const log = { created: [], completed: [], timers: [], cleared: 0 };
  const clock = { t: 1_000_000 };
  const activities = {
    create: (name, cb) => {
      const a = { name };
      log.created.push(name);
      cb(a);
    },
    complete: (a, cb) => {
      log.completed.push(a.name);
      cb();
    },
  };
  const methods = svc.createMethods({
    pages,
    activities,
    options: { port, dataDir, now: () => clock.t, testAddresses: true },
    setTimer: (fn, ms) => (log.timers.push({ fn, ms }), { unref() {} }),
    clearTimer: () => log.cleared++,
  });
  return { methods, log, clock, dataDir };
}

const call = (methods, name, sender = APP) =>
  new Promise((resolve) => methods[name]({ sender, respond: resolve }));

function http1(port, method, url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers }, (res) => {
      let t = '';
      res.on('data', (d) => (t += d));
      res.on('end', () => resolve({ status: res.statusCode, text: t }));
    });
    req.on('error', reject);
    req.end(method === 'POST' ? '{}' : undefined);
  });
}

test('the key methods answer HomeTV’s page and Home mounting it, and refuse everyone else, even an unnamed caller', async () => {
  const { methods } = make();
  for (const name of ['start', 'stop', 'token', 'tmdbKey', 'priceKeys']) {
    for (const sender of ['com.example.other', '', null, 'com.hometv.app.evil']) {
      const r = await call(methods, name, sender);
      assert.deepEqual(r, { returnValue: false, errorText: 'not HomeTV' }, `${name} ${sender}`);
    }
  }
  assert.equal(methods.instance(), null, 'a refused caller started nothing');
  // `alive` lets a TV that doesn't name its caller through (it only touches one empty file); the others never do.
  assert.equal(svc.allowed({}), true);
  assert.equal(svc.strict({}), false);
  assert.equal(svc.strict({ sender: 'com.webos.app.home' }), true);
  assert.equal(svc.strict({ sender: 'com.hometv.app 1234' }), true);
  assert.equal(svc.strict({ sender: 'com.hometv.app-1234' }), true);
  assert.equal(svc.strict({ sender: 'com.hometv.app-0b6f9c5e-1d2a-4c3b-8e7f-123456789abc' }), true);
  assert.equal(svc.strict({ sender: 'com.hometv.app-evil' }), false, 'an app whose id only starts with HomeTV’s');
  assert.equal(svc.strict({ sender: 'com.hometv.app.service' }), false);
});

test('an activity still being made when the key page lets go is completed at once, and start makes one at a time', async () => {
  const made = [];
  const completed = [];
  const methods = svc.createMethods({
    pages,
    activities: { create: (name, cb) => made.push(cb), complete: (a, cb) => (completed.push(a.name), cb()) },
    options: { port: 0, dataDir: dir() },
    setTimer: () => ({ unref() {} }),
    clearTimer: () => {},
  });
  await call(methods, 'start');
  await call(methods, 'start');
  assert.equal(made.length, 1, 'a second start while the first activity is being made makes no second');
  await call(methods, 'stop');
  made[0]({ name: 'late' });
  assert.deepEqual(completed, ['late']);
});

test('a build without pages.js (v0): the key methods say so', async () => {
  const methods = svc.createMethods({ pages: undefined, options: {} });
  const Module = require('node:module');
  const original = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === './pages.js') throw new Error('Cannot find module');
    return original.call(this, request, ...rest);
  };
  try {
    for (const name of ['start', 'tmdbKey', 'priceKeys']) {
      assert.deepEqual(await call(methods, name), { returnValue: false, errorText: 'no key page in this build' }, name);
    }
  } finally {
    Module._resolveFilename = original;
  }
});

test('a keys folder that was already there is tightened to 0700, its file 0600', { skip: process.platform === 'win32' }, () => {
  const d = dir();
  fs.chmodSync(d, 0o755);
  const p = pages.create({ dataDir: d });
  p.keyOf('tmdb');
  assert.equal(fs.statSync(d).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(d, 'hometv-keys-v1.json')).mode & 0o777, 0o600);
});

test('token: none before the server holds its port; then 48 hex, for the loopback routes only, and never on disk', async () => {
  const { methods, dataDir } = make();
  const early = await call(methods, 'token');
  assert.equal(early.returnValue, false);
  assert.ok(!('token' in early));
  const started = await call(methods, 'start');
  assert.equal(started.returnValue, true);
  assert.ok(started.port > 0);
  const { token } = await call(methods, 'token');
  assert.match(token, /^[0-9a-f]{48}$/);
  assert.equal((await http1(started.port, 'GET', '/tv/keys', { 'X-Test-Remote': '127.0.0.1', 'X-HomeTV-Token': token })).status, 200);
  assert.equal((await http1(started.port, 'GET', '/tv/keys', { 'X-Test-Remote': '127.0.0.1' })).status, 403);
  assert.equal((await http1(started.port, 'GET', '/tv/keys', { 'X-Test-Remote': '192.168.1.50', 'X-HomeTV-Token': token })).status, 403);
  for (const f of fs.readdirSync(dataDir)) assert.ok(!fs.readFileSync(path.join(dataDir, f), 'utf8').includes(token), f);
  await call(methods, 'stop');
});

test('tmdbKey and priceKeys give back what the key page kept, "" for the rest, without the server running', async () => {
  const dataDir = dir();
  fs.writeFileSync(
    path.join(dataDir, 'hometv-keys-v1.json'),
    JSON.stringify({ code: 'ABCD2345', keys: { tmdb: { key: 'fake.good-tmdb-token', state: 'ok' }, motn: { key: 'fake-good-motn', state: 'ok' } } }),
  );
  const { methods } = make({ dataDir });
  assert.deepEqual(await call(methods, 'tmdbKey'), { returnValue: true, key: 'fake.good-tmdb-token' });
  assert.deepEqual(await call(methods, 'priceKeys'), { returnValue: true, watchmode: '', motn: 'fake-good-motn' });
  assert.equal(methods.instance().listening(), false, 'reading a key opens no port');
  const none = make();
  assert.deepEqual(await call(none.methods, 'tmdbKey'), { returnValue: true, key: '' });
  assert.deepEqual(await call(none.methods, 'priceKeys'), { returnValue: true, watchmode: '', motn: '' });
});

test('start keeps the process alive once, sweeps while idle, and lets go when the screen stops holding', async () => {
  const { methods, log, clock } = make();
  const first = await call(methods, 'start');
  const again = await call(methods, 'start');
  assert.equal(first.returnValue && again.returnValue, true);
  assert.deepEqual(log.created, ['hometv-keys-keepalive']);
  assert.equal(log.timers.length, 1);
  const { token } = await call(methods, 'token');
  const inst = methods.instance();
  // The screen holds the routes: not idle, however long.
  await http1(first.port, 'POST', '/tv/keys/hold', { 'X-Test-Remote': '127.0.0.1', 'X-HomeTV-Token': token, 'Content-Type': 'application/json' });
  clock.t += 10_000;
  methods.sweep();
  assert.equal(inst.listening(), true);
  // It stops holding: after the idle time the server closes and the activity completes.
  clock.t += svc.IDLE_MS + 20_000;
  methods.sweep();
  assert.equal(inst.listening(), false);
  assert.equal(methods.instance(), null);
  assert.deepEqual(log.completed, ['hometv-keys-keepalive']);
  assert.ok(log.cleared >= 1);
  assert.equal((await call(methods, 'token')).returnValue, false);
  // And it starts again, with a new token.
  const restarted = await call(methods, 'start');
  assert.equal(restarted.returnValue, true);
  assert.notEqual((await call(methods, 'token')).token, token);
  await call(methods, 'stop');
  assert.equal(log.completed.length, 2);
});

test('a port another program holds: start says so, and nothing is kept alive', async () => {
  const blocker = http.createServer();
  await new Promise((r) => blocker.listen(0, r));
  const { methods, log } = make({ port: blocker.address().port });
  const r = await call(methods, 'start');
  assert.equal(r.returnValue, false);
  assert.match(r.errorText, /EADDRINUSE/);
  assert.deepEqual(log.completed, ['hometv-keys-keepalive']);
  assert.equal((await call(methods, 'token')).returnValue, false, 'no token for a program that doesn’t hold its port');
  await new Promise((r2) => blocker.close(r2));
  const again = await call(methods, 'start');
  assert.equal(again.returnValue, true);
  await call(methods, 'stop');
});

test('the service registers the methods the app calls, with the real library missing (a PC)', () => {
  for (const name of ['alive', 'start', 'stop', 'token', 'tmdbKey', 'priceKeys']) assert.equal(typeof svc.methods[name], 'function', name);
});

test('the key page’s private folders: HomeTV’s own, never the page’s storage', () => {
  const src = fs.readFileSync(new URL('../service/pages.js', import.meta.url), 'utf8');
  assert.match(src, /DATA_DIRS = \['\/media\/developer\/\.hometv-private'/);
  assert.ok(!/localStorage\./.test(src) && !/indexedDB/i.test(src.replace(/\/\*[\s\S]*?\*\//g, '')));
});
