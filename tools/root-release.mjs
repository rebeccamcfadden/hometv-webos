// Makes the signed root-edition update (Settings › Updates on a rooted TV, service/update.js): the .ipk and the root
// scripts, and hometv-root.json listing each with its size and SHA-512, signed with the LG page key (Ed25519, as
// tools/page-release.mjs; the private key stays outside the repo). Writes .data/root-release/ (git-ignored); publishes
// nothing: the files go up as assets of one GitHub release, hometv-root.json and its .sig last (docs/updates.md).
// Usage: node tools/root-release.mjs --key <private key> [--ipk dist/com.hometv.app_<v>_all.ipk] [--tag app-v<v>] [--out dir]
//   (the key may also come from HOMETV_PAGE_KEY_FILE or HOMETV_PAGE_PRIVATE_KEY)

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { inspectIpk, APP_ID } from './hbc-repo.mjs';
import { readIpk } from './lib/ipk.mjs';
import { loadPrivateKey } from './page-release.mjs';
import { appVersion } from './page-build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const U = createRequire(import.meta.url)('../service/update.js');

/** The release: its manifest, the manifest's exact bytes and signature, and the files ({ name, data }). */
export function makeRootRelease({ ipk, ipkName, scripts, tag, privateKey }) {
  const { appinfo } = inspectIpk(ipk, ipkName);
  const svc = readIpk(ipk).files.get(`usr/palm/services/${APP_ID}.service/package.json`);
  const svcVersion = svc ? JSON.parse(svc.toString('utf8')).version : '';
  // update-apply.js waits for the new service to answer with this version: one that never would always rolls back.
  if (svcVersion !== appinfo.version) throw new Error(`${ipkName}: its service says ${svcVersion || 'no version'}, the app ${appinfo.version}`);
  const names = scripts.map((s) => s.name).sort();
  if (names.join() !== [...U.ROOT_FILES].sort().join()) throw new Error('the root scripts differ from update.js ROOT_FILES: ' + names.join(', '));
  const files = [{ name: ipkName, data: ipk }, ...scripts];
  const manifest = {
    format: U.FORMAT,
    app: U.APP,
    version: appinfo.version,
    ...(tag ? { tag } : {}),
    files: files.map((f) => ({ name: f.name, size: f.data.length, sha512: crypto.createHash('sha512').update(f.data).digest('hex') })),
  };
  const why = U.validate(manifest);
  if (why) throw new Error('refused: ' + why);
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 1) + '\n', 'utf8');
  const signature = crypto.sign(null, manifestBytes, privateKey).toString('base64');
  return { manifest, manifestBytes, signature, files };
}

/** The root scripts as they go to the TV (root/, as update.js ROOT_FILES lists them), Unix line ends. */
export function rootScripts(dir = path.join(root, 'root')) {
  return U.ROOT_FILES.map((name) => ({ name, data: Buffer.from(fs.readFileSync(path.join(dir, name), 'utf8').replace(/\r\n/g, '\n'), 'utf8') }));
}

export function writeRootRelease(out, rel) {
  fs.mkdirSync(out, { recursive: true });
  for (const f of rel.files) fs.writeFileSync(path.join(out, f.name), f.data);
  // The files first, the manifest last: a TV never sees a manifest whose files aren't there.
  fs.writeFileSync(path.join(out, U.MANIFEST + '.sig'), rel.signature + '\n');
  fs.writeFileSync(path.join(out, U.MANIFEST), rel.manifestBytes);
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function main() {
  const v = appVersion();
  const ipkPath = arg('--ipk') || path.join(root, 'dist', `${APP_ID}_${v}_all.ipk`);
  const privateKey = loadPrivateKey({ keyPath: arg('--key') || process.env.HOMETV_PAGE_KEY_FILE, pem: process.env.HOMETV_PAGE_PRIVATE_KEY });
  const out = arg('--out') || path.join(root, '.data', 'root-release');
  const rel = makeRootRelease({ ipk: fs.readFileSync(ipkPath), ipkName: path.basename(ipkPath), scripts: rootScripts(), tag: arg('--tag') || `app-v${v}`, privateKey });
  writeRootRelease(out, rel);
  console.log(`Root update ${rel.manifest.version} (${rel.files.length} files) in ${out}. Nothing was published.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error('root-release: ' + e.message);
    process.exit(1);
  }
}
