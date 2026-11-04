// Downloads the laptop's other tools, each pinned to one version and checked against its SHA-256 before use (a file
// that doesn't match is deleted). Official sources only. Decided 2026-11-04: the tool fetches webOS Dev Manager for the
// unrooted install, and Python and SlopBro for the root step (SlopBro is downloaded, never run by this; the root step
// runs it, unmodified, after its own checks).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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
    what: 'SlopBro v0.1.0 (throwaway96, AGPL-3.0): the root tool for webOS 25 (research; run only in the root step)',
    url: 'https://github.com/throwaway96/slopbro/releases/download/v0.1.0/slopbro_packed.py',
    file: 'slopbro_packed.py',
    size: null,
    // GitHub's published digest for the release asset
    sha256: 'b0a7cb1294daf37d0f6eac404604dab468af700462de7a7ed41a0ed8df7f1ad8'
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
