// The Homebrew Channel repository (tools/hbc-repo.mjs, tools/lib/ipk.mjs): built from a pretend .ipk made here, then
// read back the way Homebrew Channel reads it (its frontend's URL rules, its service's SHA-256 check), over a local
// server on this PC only.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readIpk, readAr, readTar } from '../tools/lib/ipk.mjs';
import { buildRepo, writeRepo, inspectIpk, addRepositoryLaunch, DEFAULT_BASE_URL } from '../tools/hbc-repo.mjs';
import { startPageServer } from '../tools/page-serve.mjs';
import { appinfo as makeAppinfo } from '../tools/package-webos.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- a pretend .ipk, as ares-package lays one out: ar(debian-binary, control.tar.gz, data.tar.gz) ----

function tarHeader(name, size, type = '0') {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, 'utf8');
  h.write('0000644\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(size.toString(8).padStart(11, '0') + '\0', 124);
  h.write('00000000000\0', 136);
  h.write('        ', 148);
  h.write(type, 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}

function makeTar(entries) {
  const parts = [];
  for (const [name, data] of entries) {
    const body = Buffer.from(data);
    if (Buffer.byteLength(name) > 99) {
      parts.push(tarHeader('././@LongLink', Buffer.byteLength(name) + 1, 'L'), Buffer.from(name + '\0'), Buffer.alloc((512 - ((Buffer.byteLength(name) + 1) % 512)) % 512));
    }
    parts.push(tarHeader(name.slice(0, 99), body.length), body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

function makeAr(members) {
  const parts = [Buffer.from('!<arch>\n', 'latin1')];
  for (const [name, data] of members) {
    const head = (name + '/').padEnd(16) + '0'.padEnd(12) + '0'.padEnd(6) + '0'.padEnd(6) + '100644'.padEnd(8) + String(data.length).padEnd(10) + '`\n';
    parts.push(Buffer.from(head, 'latin1'), data);
    if (data.length % 2) parts.push(Buffer.from('\n'));
  }
  return Buffer.concat(parts);
}

function makeIpk({ id = 'com.hometv.app', version = '1.2.3', infoVersion = version, appJs = 'window.x = 1;', long = false } = {}) {
  const info = { ...makeAppinfo(infoVersion), id };
  const dir = `./usr/palm/applications/${id}/`;
  const control = `Package: ${id}\nVersion: ${version}\nSection: misc\nPriority: optional\nArchitecture: all\nInstalled-Size: 1000\n`;
  const data = [
    [dir + 'appinfo.json', JSON.stringify(info)],
    [dir + 'index.html', '<script src="./boot.js"></script>'],
    [dir + 'assets/app.js', appJs],
    [dir + 'largeIcon.png', Buffer.from('PNG-ICON')],
    ['./usr/palm/services/com.hometv.app.service/service.js', '// service'],
  ];
  if (long) data.push([dir + 'assets/' + 'a'.repeat(120) + '.js', 'long']);
  return makeAr([
    ['debian-binary', Buffer.from('2.0\n')],
    ['control.tar.gz', zlib.gzipSync(makeTar([['./control', control]]))],
    ['data.tar.gz', zlib.gzipSync(makeTar(data))],
  ]);
}

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

/**
 * Homebrew Channel's frontend/baseurl.js resolveURL resolves a relative address against a base as RFC 3986 does;
 * for the http(s) addresses here Node's URL gives the same answer.
 */
const hbcResolveUrl = (url, base) => new URL(url, base).href;

/**
 * What Homebrew Channel does with a repository address, from its source: BrowserPanel.js reads `packages`;
 * DetailsPanel.js takes the package's `manifest` (else fetches `manifestUrl`), resolves `ipkUrl` against `manifestUrl`
 * (or the repository address) and calls install with `ipkHash.sha256`; service.ts install downloads and refuses a
 * file whose SHA-256 differs. Returns the installed bytes, or throws as the service does.
 */
async function hbcInstall(repoUrl, id) {
  const data = await (await fetch(repoUrl)).json();
  assert.ok(Array.isArray(data.packages), 'a repository has packages');
  const pkg = data.packages.find((p) => p.id === id);
  assert.ok(pkg, `${id} is listed`);
  const manifest = pkg.manifest || (await (await fetch(hbcResolveUrl(pkg.manifestUrl, repoUrl))).json());
  const ipkUrl = hbcResolveUrl(manifest.ipkUrl, pkg.manifestUrl || repoUrl);
  const res = await fetch(ipkUrl);
  if (res.status !== 200) throw new Error(`download failed: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const checksum = sha256(bytes);
  if (checksum !== manifest.ipkHash.sha256) {
    throw new Error(`Invalid file checksum (${manifest.ipkHash.sha256} expected, got ${checksum}`);
  }
  return { manifest, bytes };
}

test('the .ipk reader: control fields and files, ar or tar.gz outside, long names', () => {
  const ipk = makeIpk({ long: true });
  assert.deepEqual(readAr(ipk).map((m) => m.name), ['debian-binary', 'control.tar.gz', 'data.tar.gz']);
  const r = readIpk(ipk);
  assert.equal(r.control.Package, 'com.hometv.app');
  assert.equal(r.control.Version, '1.2.3');
  assert.equal(JSON.parse(r.files.get('usr/palm/applications/com.hometv.app/appinfo.json')).version, '1.2.3');
  assert.ok(r.files.has('usr/palm/applications/com.hometv.app/assets/' + 'a'.repeat(120) + '.js'), 'GNU long name');
  const wrapped = zlib.gzipSync(makeTar(readAr(ipk).map((m) => [m.name, m.data])));
  assert.equal(readIpk(wrapped).control.Version, '1.2.3');
  assert.equal(readTar(makeTar([['a', 'x']])).length, 1);
  assert.throws(() => readIpk(Buffer.from('not an ipk at all')), /not an ar archive/);
  assert.throws(() => readIpk(makeAr([['debian-binary', Buffer.from('2.0\n')]])), /no control\.tar\.gz/);
});

test('only HomeTV’s own, consistent, TV-safe .ipk is listed', () => {
  const name = (v = '1.2.3') => `com.hometv.app_${v}_all.ipk`;
  assert.equal(inspectIpk(makeIpk(), name()).appinfo.version, '1.2.3');
  assert.throws(() => inspectIpk(makeIpk({ id: 'com.other.app' }), name()), /not HomeTV's \.ipk/);
  assert.throws(() => inspectIpk(makeIpk({ infoVersion: '1.2.4' }), name()), /control says 1\.2\.3, appinfo\.json 1\.2\.4/);
  assert.throws(() => inspectIpk(makeIpk(), name('1.2.4')), /is named com\.hometv\.app_1\.2\.3_all\.ipk/);
  assert.throws(() => inspectIpk(makeIpk({ appJs: 'const t = "Knives Out";' }), name()), /sample catalogue/);
});

test('the manifest names the .ipk on its GitHub release, with its SHA-256 and size', () => {
  const ipk = makeIpk();
  const b = buildRepo({ ipk, fileName: 'com.hometv.app_1.2.3_all.ipk' });
  const m = b.manifest;
  assert.equal(m.id, 'com.hometv.app');
  assert.equal(m.version, '1.2.3');
  assert.equal(m.type, 'web');
  assert.equal(m.title, 'HomeTV');
  assert.equal(m.ipkHash.sha256, sha256(ipk));
  assert.match(m.ipkHash.sha256, /^[0-9a-f]{64}$/);
  assert.equal(m.ipkSize, ipk.length);
  assert.equal(m.ipkUrl, 'https://github.com/rebeccamcfadden/hometv-webos/releases/download/app-v1.2.3/com.hometv.app_1.2.3_all.ipk');
  assert.equal(m.rootRequired, 'optional');
  assert.equal(m.iconUri, DEFAULT_BASE_URL + 'icon.png');
  assert.deepEqual(b.icon, Buffer.from('PNG-ICON'), 'the icon from the .ipk');
  // webosbrew/apps-repo repogen's PackageManifest fields, nothing else
  const allowed = ['id', 'title', 'version', 'type', 'appDescription', 'iconUri', 'sourceUrl', 'rootRequired', 'ipkUrl', 'ipkHash', 'ipkSize', 'installedSize'];
  assert.deepEqual(Object.keys(m).filter((k) => !allowed.includes(k)), []);

  const p = b.repo.packages[0];
  assert.deepEqual(b.repo.packages.length, 1);
  assert.deepEqual(p.manifest, m);
  assert.equal(p.manifestUrl, DEFAULT_BASE_URL + 'com.hometv.app.manifest.json');
  for (const k of ['id', 'title', 'iconUri', 'manifestUrl']) assert.equal(typeof p[k], 'string', k);
  assert.equal(b.repoUrl, DEFAULT_BASE_URL + 'apps.json');

  assert.match(buildRepo({ ipk, fileName: 'com.hometv.app_1.2.3_all.ipk', tag: 'v 1' }).manifest.ipkUrl, /\/download\/v%201\//);
  assert.throws(() => buildRepo({ ipk, fileName: 'com.hometv.app_1.2.3_all.ipk', baseUrl: 'http://example.org/' }), /https/);
  assert.equal(buildRepo({ ipk, fileName: 'com.hometv.app_1.2.3_all.ipk', baseUrl: 'https://example.org/x' }).repoUrl, 'https://example.org/x/apps.json');
});

test('Homebrew Channel, as its source reads a repository, installs exactly this .ipk and refuses a changed one', async () => {
  const work = path.join(root, '.data', `test-hbc-${process.pid}`);
  try {
    const ipk = makeIpk();
    fs.mkdirSync(work, { recursive: true });
    fs.writeFileSync(path.join(work, 'com.hometv.app_1.2.3_all.ipk'), ipk);
    const s = await startPageServer({ dir: work, port: 0 });
    try {
      const base = `http://127.0.0.1:${s.port}/`;
      // On a real repository both addresses are https; this local test serves them from this PC.
      const built = buildRepo({ ipk, fileName: 'com.hometv.app_1.2.3_all.ipk', ipkUrl: base + 'com.hometv.app_1.2.3_all.ipk' });
      built.repo.packages[0].manifestUrl = base + 'com.hometv.app.manifest.json';
      writeRepo(work, built);
      const got = await hbcInstall(base + 'apps.json', 'com.hometv.app');
      assert.deepEqual(got.bytes, ipk);
      assert.equal(got.manifest.version, '1.2.3');

      // Without the embedded manifest Homebrew Channel fetches manifestUrl: the same answer.
      const lean = JSON.parse(fs.readFileSync(path.join(work, 'apps.json'), 'utf8'));
      delete lean.packages[0].manifest;
      fs.writeFileSync(path.join(work, 'apps.json'), JSON.stringify(lean));
      assert.deepEqual((await hbcInstall(base + 'apps.json', 'com.hometv.app')).bytes, ipk);

      const changed = Buffer.from(ipk);
      changed[changed.length - 3] ^= 1;
      fs.writeFileSync(path.join(work, 'com.hometv.app_1.2.3_all.ipk'), changed);
      await assert.rejects(hbcInstall(base + 'apps.json', 'com.hometv.app'), /Invalid file checksum/);
    } finally {
      await s.close();
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('the "Add repository" launch matches Homebrew Channel’s launchMode', () => {
  assert.deepEqual(addRepositoryLaunch('https://example.org/hbc/apps.json'), {
    id: 'org.webosbrew.hbchannel',
    params: { launchMode: 'addRepository', url: 'https://example.org/hbc/apps.json' },
  });
});

test('hbc-repo.mjs writes the three files and publishes nothing', () => {
  const work = path.join(root, '.data', `test-hbc-cli-${process.pid}`);
  try {
    fs.mkdirSync(work, { recursive: true });
    const ipkPath = path.join(work, 'com.hometv.app_1.2.3_all.ipk');
    fs.writeFileSync(ipkPath, makeIpk());
    const out = path.join(work, 'hbc');
    const text = execFileSync(process.execPath, [path.join(root, 'tools', 'hbc-repo.mjs'), '--ipk', ipkPath, '--out', out, '--tag', 'app-v1.2.3'], {
      encoding: 'utf8',
    });
    assert.deepEqual(fs.readdirSync(out).sort(), ['apps.json', 'com.hometv.app.manifest.json', 'icon.png']);
    const repo = JSON.parse(fs.readFileSync(path.join(out, 'apps.json'), 'utf8'));
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'com.hometv.app.manifest.json'), 'utf8'));
    assert.deepEqual(repo.packages[0].manifest, manifest);
    assert.equal(manifest.ipkHash.sha256, sha256(fs.readFileSync(ipkPath)));
    assert.match(text, /Nothing is published/);
    assert.match(text, /Add repository/);
    assert.match(text, /launchMode/);
    assert.throws(
      () => execFileSync(process.execPath, [path.join(root, 'tools', 'hbc-repo.mjs'), '--ipk', path.join(work, 'nope.ipk')], { stdio: 'pipe' }),
      (e) => e.status === 1 && /no .*nope\.ipk/.test(e.stderr.toString()),
    );
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});
