// Downloads the laptop's other tools, each pinned to one version and checked against its SHA-256 before use (a file
// that doesn't match is deleted). Official sources only. Decided 2026-11-04: the tool fetches webOS Dev Manager for the
// unrooted install, and Python and SlopBro for the root step (SlopBro is downloaded, never run by this; the root step
// runs it, unmodified, after its own checks).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const PINNED = {
  'dev-manager': {
    what: 'webOS Dev Manager 1.99.21 (webosbrew, Apache-2.0): installs apps on a TV in Developer Mode',
    url: 'https://github.com/webosbrew/dev-manager-desktop/releases/download/v1.99.21/webOS.Dev.Manager_1.99.21_x64_en-US.msi',
    file: 'webOS.Dev.Manager_1.99.21_x64_en-US.msi',
    size: 14180352,
    // GitHub's published digest for the release asset
    sha256: '8dab4ef7876bcb78a92d15e9d59836278e2365a32584b6af4c8501299bcff78d'
  },
  python: {
    what: 'Python 3.13.9, the no-install zip from python.org (for SlopBro)',
    url: 'https://www.python.org/ftp/python/3.13.9/python-3.13.9-embed-amd64.zip',
    file: 'python-3.13.9-embed-amd64.zip',
    size: 10926675,
    // computed from two downloads over HTTPS on 2026-11-04 (python.org signs with Sigstore, publishes no SHA-256)
    sha256: '91d828c2da3a029b41699e918674a0cb379c02cf20dab9c501306885f837402a'
  },
  slopbro: {
    what: 'SlopBro at f76b717 (throwaway96, AGPL-3.0; main on 2026-11-09): the root tool for webOS 25 (research; run only in the root step)',
    // Built here from its sources at this commit, as its Makefile does (tools/package_single_file.py, ported in
    // packSlopbro below); each source and the built file are checked. The same build of v0.1.0's sources gives
    // v0.1.0's released slopbro_packed.py byte for byte (SHA-256 b0a7cb12…; checked 2026-11-18).
    repo: 'throwaway96/slopbro',
    commit: 'f76b717c7e7b537158bca9969a2675f847019c51',
    file: 'slopbro_packed.py',
    size: 78438,
    sha256: 'bf50473e794b787c02458535807c84b98f8b4dc3e945d41644bef08c6e878c9f',
    sources: [
      { path: 'slopbro.py', sha256: '3ddfe1b031acfa304637340d68c627cae6027c229b1cd130389858d43b0360cd' },
      // the Makefile's WWWROOT_FILES, in its order
      { path: 'wwwroot/index.html', sha256: '0430d93c45885de73ba5f3e2f32b1e4ef9e713234de818162f0cb8ac20a1ff36' },
      { path: 'wwwroot/autoroot.sh', sha256: '16bedff5ee8f8c754e6e302e3251dfc904f6aa7ca71c0b0483f7e5fc6bbb3611' },
      { path: 'wwwroot/package.json', sha256: 'f573657cb5db54fd8b0f724ae69d8f8fd6903ec6ca0f038ce2b47e4f45ef1ef0' },
      { path: 'wwwroot/main.js', sha256: '3a6830ac858bb71f0bd0b9f45514ff1fd85d707170f59941e6771d454102f791' }
    ]
  },
  'hometv-v0': {
    what: 'HomeTV v0 for LG (app-v0.0.1), the earlier version',
    url: 'https://github.com/rebeccamcfadden/hometv-webos/releases/download/app-v0.0.1/com.hometv.app_0.0.1_all.ipk',
    file: 'com.hometv.app_0.0.1_all.ipk',
    size: null,
    sha256: '945d9c0d00a6258b4d7ba4d558be9c1264950c53d5f3d5c40ea87afae9f003d8'
  },
  'hometv-v2': {
    what: 'HomeTV v2 for LG (app-v0.2.0)',
    url: 'https://github.com/rebeccamcfadden/hometv-webos/releases/download/app-v0.2.0/com.hometv.app_0.2.0_all.ipk',
    file: 'com.hometv.app_0.2.0_all.ipk',
    size: 146124,
    sha256: '4f8fb46d1ab909d04c04292468c01092f8d307a77cd8ccc41518cb3a7315719b'
  },
  // The root edition's HomeTV (hometv-lg install / root, prepare, root --home-again): app-v0.2.1 (the heartbeat fixes, its settings kept by its service, page and root update feeds on)
  // while HomeTV is LG's Home (call #2). The Developer Mode install (devmode) stays on hometv-v2.
  'hometv-root': {
    what: 'HomeTV for LG, root edition (app-v0.2.1)',
    url: 'https://github.com/rebeccamcfadden/hometv-webos/releases/download/app-v0.2.1/com.hometv.app_0.2.1_all.ipk',
    file: 'com.hometv.app_0.2.1_all.ipk',
    size: 148186,
    sha256: '7f86c38b5f83b0a46afb548163c2de16440ae6980a9bfdd94bc7aed7fea8f7d8'
  },
  'hometv-lg-v3': {
    what: 'hometv-lg.exe from the hometv-lg-v3 release: the check and the Developer Mode install, no root',
    url: 'https://github.com/rebeccamcfadden/hometv-webos/releases/download/hometv-lg-v3/hometv-lg.exe',
    file: 'hometv-lg.exe',
    size: 100487496,
    // GitHub's published digest for the release asset (read 2026-11-18)
    sha256: 'd723cfadc7a2513c59a8a2040c2c3e742baa50edc0c74dca5f9932d1baaeefca'
  }
};

export async function download(item, dir, { fetchImpl = fetch, log = () => {} } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, item.file);
  if (fs.existsSync(dest) && (await sha256(dest)) === item.sha256) {
    log('already here and checked: ' + item.file);
    return dest;
  }
  log('downloading ' + item.file + ' …');
  const res = await fetchImpl(item.url, { redirect: 'follow' });
  if (!res.ok) throw new Error('download failed: HTTP ' + res.status);
  const body = Buffer.from(await res.arrayBuffer());
  const got = crypto.createHash('sha256').update(body).digest('hex');
  if (got !== item.sha256 || (item.size && body.length !== item.size)) {
    throw new Error(item.file + ' is not the expected file (SHA-256 ' + got + '); it was not kept');
  }
  fs.writeFileSync(dest + '.part', body);
  fs.renameSync(dest + '.part', dest);
  log('checked: ' + item.file + ' (SHA-256 matches)');
  return dest;
}

export function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

const BEGIN = '# --- BEGIN EMBEDDED WWWROOT ---';
const END = '# --- END EMBEDDED WWWROOT ---';

/**
 * SlopBro's single file: slopbro.py with its page files embedded, as its tools/package_single_file.py writes it on
 * Linux (base64 per file, json.dumps(sort_keys=True, indent=4), LF line ends). `assets`: { 'index.html': Buffer, … }.
 */
export function packSlopbro(source, assets) {
  const text = String(source).replace(/\r\n/g, '\n');
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start < 0 || end < 0 || end < start) throw new Error('slopbro.py has no embedded-asset markers');
  const body = text.indexOf('\n', start);
  const map = {};
  for (const name of Object.keys(assets).sort()) map[name] = { data: Buffer.from(assets[name]).toString('base64'), encoding: 'base64' };
  return text.slice(0, body + 1) + '\nEMBEDDED_WWWROOT = ' + JSON.stringify(map, null, 4) + '\n' + text.slice(end);
}

/**
 * Builds SlopBro's single file in `dir` from its sources at the pinned commit: each source downloaded and held to its
 * SHA-256, then packed (packSlopbro) and held to the pinned SHA-256. Nothing is kept on any mismatch; nothing is run.
 */
export async function buildSlopbro(item, dir, { fetchImpl = fetch, log = () => {} } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, item.file);
  if (fs.existsSync(dest) && (await sha256(dest)) === item.sha256) {
    log('already here and checked: ' + item.file);
    return dest;
  }
  const got = {};
  for (const s of item.sources) {
    log('downloading SlopBro\'s ' + s.path + ' at ' + item.commit.slice(0, 7) + ' …');
    const res = await fetchImpl('https://raw.githubusercontent.com/' + item.repo + '/' + item.commit + '/' + s.path, { redirect: 'follow' });
    if (!res.ok) throw new Error('download failed: HTTP ' + res.status);
    const body = Buffer.from(await res.arrayBuffer());
    if (crypto.createHash('sha256').update(body).digest('hex') !== s.sha256) {
      throw new Error('SlopBro\'s ' + s.path + ' is not the expected file (its SHA-256 differs); nothing was kept');
    }
    got[s.path] = body;
  }
  const assets = {};
  for (const s of item.sources.slice(1)) assets[s.path.replace(/^wwwroot\//, '')] = got[s.path];
  const packed = Buffer.from(packSlopbro(got[item.sources[0].path].toString('utf8'), assets), 'utf8');
  const sum = crypto.createHash('sha256').update(packed).digest('hex');
  if (sum !== item.sha256 || (item.size && packed.length !== item.size)) {
    throw new Error(item.file + ' as built is not the expected file (SHA-256 ' + sum + '); it was not kept');
  }
  fs.writeFileSync(dest + '.part', packed);
  fs.renameSync(dest + '.part', dest);
  log('built and checked: ' + item.file + ' (SlopBro ' + item.commit.slice(0, 7) + ', SHA-256 matches)');
  return dest;
}

/**
 * The root kit in `dir` (the HomeTV folder's tools): Python's no-install zip (checked, then unpacked; nothing installed in
 * Windows) and SlopBro (built from its pinned sources, checked). Runs nothing. Returns the folder.
 */
export async function getRootKit(dir, { fetchImpl = fetch, log = () => {} } = {}) {
  const zip = await download(PINNED.python, dir, { fetchImpl, log });
  const py = path.join(dir, 'python');
  if (!fs.existsSync(path.join(py, 'python.exe'))) {
    fs.mkdirSync(py, { recursive: true });
    execFileSync('tar', ['-xf', zip, '-C', py]);
    log('Python unpacked (nothing installed in Windows): ' + py);
  }
  await buildSlopbro(PINNED.slopbro, dir, { fetchImpl, log });
  return dir;
}
