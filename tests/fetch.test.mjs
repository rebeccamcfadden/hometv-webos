// tools/lib/fetch.mjs: a download is kept only when its SHA-256 (and size) match the pinned value.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { download, PINNED } from '../tools/lib/fetch.mjs';

const body = Buffer.from('pretend installer');
const good = { url: 'https://example.invalid/x.msi', file: 'x.msi', size: body.length, sha256: crypto.createHash('sha256').update(body).digest('hex') };
const fakeFetch = (bytes, status = 200) => async () => ({ ok: status === 200, status, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) });

test('a matching file is kept, and not downloaded again', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hometv-fetch-'));
  try {
    let calls = 0;
    const f = async (...a) => { calls++; return fakeFetch(body)(...a); };
    const p = await download(good, dir, { fetchImpl: f });
    assert.deepEqual(fs.readFileSync(p), body);
    await download(good, dir, { fetchImpl: f });
    assert.equal(calls, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a file that differs is refused and nothing is left behind', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hometv-fetch-'));
  try {
    await assert.rejects(download(good, dir, { fetchImpl: fakeFetch(Buffer.from('something else')) }), /not the expected file/);
    await assert.rejects(download(good, dir, { fetchImpl: fakeFetch(body, 404) }), /HTTP 404/);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('every pinned tool has an https source and a SHA-256', () => {
  for (const [name, p] of Object.entries(PINNED)) {
    assert.match(p.url, /^https:\/\/(github\.com|www\.python\.org)\//, name);
    assert.match(p.sha256, /^[0-9a-f]{64}$/, name);
  }
});
