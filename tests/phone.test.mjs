// The phone page server (checks/service/phone.js) on the PC: the routes, the code, the limits. Its ES5 is checked too,
// since 2016-2019 LG TVs run services on Node 0.12.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createPhoneServer, newCode, sameCode, ALPHABET } = require('../checks/service/phone.js');

async function withServer(fn) {
  const phone = createPhoneServer({ code: 'ABC234', now: () => new Date(2026, 10, 4, 21, 5, 9) });
  await new Promise((r) => phone.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + phone.server.address().port;
  try { await fn(base, phone.state); } finally { await new Promise((r) => phone.server.close(r)); }
}

const post = (base, body) => fetch(base + '/hello', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body)
});

test('codes are six letters from the alphabet without look-alikes', () => {
  for (let i = 0; i < 50; i++) {
    const c = newCode();
    assert.equal(c.length, 6);
    for (const ch of c) assert.ok(ALPHABET.includes(ch));
  }
  assert.ok(!/[01IOL]/.test(ALPHABET));
  assert.ok(sameCode('abc234', 'ABC234'));
  assert.ok(!sameCode('ABC23', 'ABC234'));
  assert.ok(!sameCode(undefined, 'ABC234'));
});

test('the page loads, with no-store and nosniff', async () => {
  await withServer(async (base) => {
    const r = await fetch(base + '/');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(await r.text(), /HomeTV check/);
  });
});

test('a note with the right code is kept; control characters become spaces', async () => {
  await withServer(async (base, state) => {
    const r = await post(base, { code: 'abc234', note: '  The\u0007Bear  ' });
    assert.equal(r.status, 200);
    assert.deepEqual(state.lastPhone, { at: '21:05:09' });
    assert.deepEqual(state.notes, ['The Bear']);
  });
});

test('wrong codes are refused, and ten of them make a new code', async () => {
  await withServer(async (base, state) => {
    for (let i = 0; i < 9; i++) assert.equal((await post(base, { code: 'ZZZZZZ' })).status, 403);
    assert.equal(state.code, 'ABC234');
    assert.equal((await post(base, { code: 'ZZZZZZ' })).status, 403);
    assert.notEqual(state.code, 'ABC234');
    assert.equal(state.lastPhone, null);
  });
});

test('bad JSON, big bodies and other routes are refused', async () => {
  await withServer(async (base) => {
    assert.equal((await post(base, 'not json')).status, 400);
    const big = await post(base, { code: 'ABC234', note: 'x'.repeat(5000) }).catch(() => ({ status: 413 }));
    assert.equal(big.status, 413);
    assert.equal((await fetch(base + '/keys')).status, 404);
    assert.equal((await fetch(base + '/hello')).status, 404);
  });
});

test('notes are capped at 200 characters and the last 10', async () => {
  await withServer(async (base, state) => {
    for (let i = 0; i < 12; i++) await post(base, { code: 'ABC234', note: 'n' + i + 'y'.repeat(300) });
    assert.equal(state.notes.length, 10);
    assert.ok(state.notes[0].startsWith('n2'));
    assert.equal(state.notes[9].length, 200);
  });
});

test('the report needs the code; a malformed one is refused, not a crash', async () => {
  await withServer(async (base, state) => {
    state.report = { info: { state: 'ok', text: '43UT8000AUA' } };
    assert.equal((await fetch(base + '/report?code=NOPE22')).status, 403);
    assert.equal((await fetch(base + '/report?code=%')).status, 403);
    assert.equal((await fetch(base + '/report?code=%E0%A4%A')).status, 403);
    const r = await fetch(base + '/report?code=ABC234');
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), state.report);
  });
});

test('the service files are ES5 (no let, const, arrows, classes or template strings)', () => {
  for (const f of ['checks/service/phone.js', 'checks/service/service.js']) {
    const src = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/'(?:[^'\\]|\\.)*'/g, "''");
    assert.ok(!/\b(let|const|class)\s/.test(src), f + ': let/const/class');
    assert.ok(!/=>/.test(src), f + ': arrow');
    assert.ok(!/`/.test(src), f + ': template string');
  }
});
