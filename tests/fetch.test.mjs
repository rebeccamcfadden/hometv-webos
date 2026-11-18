// tools/lib/fetch.mjs: a download is kept only when its SHA-256 (and size) match the pinned value.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { download, buildSlopbro, packSlopbro, PINNED } from '../tools/lib/fetch.mjs';

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
    if (p.url) assert.match(p.url, /^https:\/\/(github\.com|www\.python\.org)\//, name);
    else {
      assert.match(p.commit, /^[0-9a-f]{40}$/, name + ': a whole commit id');
      for (const s of p.sources) assert.match(s.sha256, /^[0-9a-f]{64}$/, s.path);
    }
    assert.match(p.sha256, /^[0-9a-f]{64}$/, name);
  }
});

// SlopBro's single file, built from its sources at the pinned commit (tools/package_single_file.py's output on Linux)
const PY = 'print("pretend")\r\n# --- BEGIN EMBEDDED WWWROOT ---\r\nEMBEDDED_WWWROOT = {}\r\n# --- END EMBEDDED WWWROOT ---\r\nmain()\r\n';
const SRC = { 'slopbro.py': PY, 'wwwroot/index.html': '<p>x</p>', 'wwwroot/autoroot.sh': '#!/bin/sh\n', 'wwwroot/package.json': '{}', 'wwwroot/main.js': '1' };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const PACKED = 'print("pretend")\n# --- BEGIN EMBEDDED WWWROOT ---\n\nEMBEDDED_WWWROOT = {\n    "autoroot.sh": {\n        "data": "IyEvYmluL3NoCg==",\n' +
  '        "encoding": "base64"\n    },\n    "index.html": {\n        "data": "PHA+eDwvcD4=",\n        "encoding": "base64"\n    },\n' +
  '    "main.js": {\n        "data": "MQ==",\n        "encoding": "base64"\n    },\n    "package.json": {\n        "data": "e30=",\n' +
  '        "encoding": "base64"\n    }\n}\n# --- END EMBEDDED WWWROOT ---\nmain()\n';
const COMMIT = 'a'.repeat(40);
const pretend = { repo: 'someone/slopbro', commit: COMMIT, file: 'slopbro_packed.py', sha256: sha(PACKED),
  sources: Object.keys(SRC).map((p) => ({ path: p, sha256: sha(SRC[p]) })) };
const sourceFetch = (src, seen = []) => async (url) => {
  seen.push(url);
  const p = url.split('/' + COMMIT + '/')[1];
  return src[p] === undefined ? fakeFetch(Buffer.alloc(0), 404)() : fakeFetch(Buffer.from(src[p]))();
};

test('SlopBro: packed as its packer does (sorted, base64, indent 4, LF), from each checked source at the pinned commit', async () => {
  assert.equal(packSlopbro(PY, { 'main.js': Buffer.from('1'), 'index.html': Buffer.from('<p>x</p>'), 'package.json': Buffer.from('{}'),
    'autoroot.sh': Buffer.from('#!/bin/sh\n') }), PACKED);
  assert.throws(() => packSlopbro('no markers', {}), /no embedded-asset markers/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hometv-fetch-'));
  try {
    const seen = [];
    const p = await buildSlopbro(pretend, dir, { fetchImpl: sourceFetch(SRC, seen) });
    assert.equal(fs.readFileSync(p, 'utf8'), PACKED);
    assert.ok(seen.every((u) => u.startsWith('https://raw.githubusercontent.com/someone/slopbro/' + COMMIT + '/')), 'only the pinned commit');
    await buildSlopbro(pretend, dir, { fetchImpl: async () => { throw new Error('not again'); } });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('SlopBro: a changed source, or a build that differs from the pin, keeps nothing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hometv-fetch-'));
  try {
    await assert.rejects(buildSlopbro(pretend, dir, { fetchImpl: sourceFetch({ ...SRC, 'wwwroot/autoroot.sh': '#!/bin/sh\nrm -rf /\n' }) }),
      /wwwroot\/autoroot\.sh is not the expected file/);
    await assert.rejects(buildSlopbro({ ...pretend, sha256: 'b'.repeat(64) }, dir, { fetchImpl: sourceFetch(SRC) }), /as built is not the expected file/);
    await assert.rejects(buildSlopbro(pretend, dir, { fetchImpl: sourceFetch({}) }), /HTTP 404/);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
