// Makes a signed page release from dist/app/: manifest.json, its signature manifest.json.sig, and the page's files under
// <version>/. Upload the whole folder to the update address the app was built with (HOMETV_UPDATE_URL points at
// manifest.json); a local test: tools/page-serve.mjs. From hometv-tizen's tools/page-release.mjs (5ac0b52).
//
// Usage: npm run build:app && node tools/page-release.mjs --key <path outside the repo> [--out <dir>] [--min-shell x.y.z]
//   The key can also come from env HOMETV_PAGE_KEY_FILE (a path) or HOMETV_PAGE_PRIVATE_KEY (the PEM text).
//   --out defaults to .data/page-release (git-ignored). --min-shell defaults to the app version dist/app was built for.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIST, SHELL_FILES, readShellConfig } from './page-build.mjs';
import { insideRepo, rawPublicKey, root } from './page-key.mjs';

export const FORMAT = 1;
export const APP = 'hometv-webos';

function walk(dir, base = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const rel = base ? `${base}/${d.name}` : d.name;
    return d.isDirectory() ? walk(path.join(dir, d.name), rel) : [rel];
  });
}

/** The page in a built dist/app/: its version, entry, the app version it was built for, and its files (shell excluded). */
export function readDist(dist) {
  const config = readShellConfig(dist);
  const files = walk(dist)
    .filter((p) => !SHELL_FILES.includes(p))
    .sort()
    .map((p) => ({ path: p, data: fs.readFileSync(path.join(dist, p)) }));
  return { version: config.page.version, entry: config.page.entry, shellVersion: config.shellVersion, keys: config.keys, files };
}

/**
 * On the TV a downloaded page's other files (images, fonts) have blob: addresses that only its CSS is pointed at
 * (app/loader/boot.js). A script that names one by its path would load the installed app's copy, or nothing: refused.
 */
export function checkScriptsUseNoFiles({ entry, files }) {
  const scripts = files.filter((f) => entry.js.includes(f.path)).map((f) => ({ path: f.path, text: f.data.toString('utf8') }));
  const others = files.filter((f) => !entry.js.includes(f.path) && !entry.css.includes(f.path));
  for (const s of scripts) {
    for (const f of others) {
      if (s.text.includes(f.path)) {
        throw new Error(`${s.path} loads ${f.path} by its path: a downloaded page's scripts can't (docs/updates.md). Inline it, or use it from the CSS.`);
      }
    }
  }
}

export function makeManifest({ version, minShell, entry, files }) {
  return {
    format: FORMAT,
    app: APP,
    version,
    minShell,
    entry,
    files: files.map((f) => ({
      path: f.path,
      size: f.data.length,
      sha512: crypto.createHash('sha512').update(f.data).digest('hex'),
    })),
  };
}

/** Signs the manifest's exact bytes with Ed25519. Returns what goes on the server. */
export function makeRelease({ version, minShell, entry, files, privateKey }) {
  checkScriptsUseNoFiles({ entry, files });
  const manifest = makeManifest({ version, minShell, entry, files });
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 1) + '\n', 'utf8');
  const signature = crypto.sign(null, manifestBytes, privateKey).toString('base64');
  return { manifest, manifestBytes, signature, files };
}

export function writeRelease(out, release) {
  const dir = path.join(out, release.manifest.version);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const f of release.files) {
    fs.mkdirSync(path.dirname(path.join(dir, f.path)), { recursive: true });
    fs.writeFileSync(path.join(dir, f.path), f.data);
  }
  // Files first, the manifest last: a TV never sees a manifest whose files aren't there yet.
  fs.writeFileSync(path.join(out, 'manifest.json.sig'), release.signature + '\n');
  fs.writeFileSync(path.join(out, 'manifest.json'), release.manifestBytes);
}

/** The private key from a path (outside the repo, or in the git-ignored .data/ for test keys) or PEM text. */
export function loadPrivateKey({ keyPath, pem }) {
  if (!pem) {
    if (!keyPath) throw new Error('No key: pass --key <path>, or set HOMETV_PAGE_KEY_FILE or HOMETV_PAGE_PRIVATE_KEY.');
    const rel = path.relative(root, path.resolve(keyPath)).split(path.sep).join('/');
    if (insideRepo(keyPath) && !rel.startsWith('.data/')) {
      throw new Error(`Refused: ${keyPath} is inside the repo. Keep the private key outside it.`);
    }
    pem = fs.readFileSync(keyPath, 'utf8');
  }
  const key = crypto.createPrivateKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error(`Not an Ed25519 key (${key.asymmetricKeyType}).`);
  return key;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

export function releaseFromDist({ dist, out, privateKey, minShell }) {
  const page = readDist(dist);
  const release = makeRelease({ ...page, minShell: minShell || page.shellVersion, privateKey });
  writeRelease(out, release);
  return { page, release };
}

function main() {
  const privateKey = loadPrivateKey({
    keyPath: arg('--key') || process.env.HOMETV_PAGE_KEY_FILE,
    pem: process.env.HOMETV_PAGE_PRIVATE_KEY,
  });
  const dist = path.resolve(arg('--dist') || DIST);
  const out = path.resolve(arg('--out') || path.join(root, '.data', 'page-release'));
  const minShell = arg('--min-shell');
  if (minShell && !/^\d+\.\d+\.\d+$/.test(minShell)) throw new Error(`--min-shell ${minShell} is not x.y.z`);
  const { page, release } = releaseFromDist({ dist, out, privateKey, minShell });
  const pub = rawPublicKey(privateKey);
  console.log(`Page ${release.manifest.version} (needs app ${release.manifest.minShell} or newer), ${page.files.length} files: ${out}`);
  console.log('Upload the folder as it is; manifest.json goes last.');
  if (!page.keys.includes(pub)) {
    console.warn(`Note: dist/app wasn't built with this key (${pub}). An app built that way refuses this release.`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
