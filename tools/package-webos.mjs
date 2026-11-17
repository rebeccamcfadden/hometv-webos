// Builds HomeTV's LG app (.ipk): the loader and page from `npm run build:app` (dist/app), its appinfo.json and icons,
// and HomeTV's service (service/). docs/updates.md: what a new .ipk changes, against a page update. Uses LG's packager from @webos-tools/cli (pinned, run through npx); nothing is installed on a TV.
// Usage: npm run package:app  [-- --v0 (the offline v0 build instead of v1)] [-- --allow-sample (a preview build,
//   never for a TV)] [-- --no-build (package the existing dist/app)] [-- --stage-only]
//
// Builds the page itself, with HOMETV_V1=1 (live data: TMDB, prices, the key page) unless --v0. As hometv-tizen's
// tools/package-tizen.mjs: a page holding any sample title is refused for a TV ("no sample data on the TV").

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { png } from './lib/png.mjs';
import { appVersion, KEYS_FILE, parseKeys } from './page-build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const ARES = '@webos-tools/cli@3.2.6';

/** The sample catalogue's titles (tests/fixtures/sample-catalog.ts) in a built page. */
export const sampleIn = (js) => /Knives Out|Past Lives|Severance/.test(js);

/** Text files under a folder (the page's JS, HTML, CSS, JSON): the guard reads all of them, not only app.js. */
function textFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return textFiles(p);
    return /\.(js|mjs|html|css|json|txt|svg|map)$/.test(d.name) ? [p] : [];
  });
}

/** Files in a built page that hold a sample title (empty when it is clean). */
export function samplesInPage(dir) {
  return textFiles(dir).filter((f) => sampleIn(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(dir, f));
}

/**
 * What the service's own updater (service/update.js, the root edition's Settings › Updates) is built with: the signed
 * manifest's address (HOMETV_ROOT_UPDATE_URL, https; empty: off, the default until the project lead's go) and the same
 * public keys as the page updates (app/loader/page-keys.txt plus HOMETV_PAGE_KEYS).
 */
export function rootUpdateConfig(env = process.env) {
  const url = (env.HOMETV_ROOT_UPDATE_URL || '').trim();
  if (url && !/^https:\/\/[^\s]+$/.test(url)) throw new Error(`HOMETV_ROOT_UPDATE_URL is not an https address: ${url}`);
  const keysText = (fs.existsSync(KEYS_FILE) ? fs.readFileSync(KEYS_FILE, 'utf8') : '') + '\n' + (env.HOMETV_PAGE_KEYS || '');
  return { url, keys: parseKeys(keysText) };
}

/**
 * The service folder as it goes in the .ipk: never its private keys, dev data or a test's files. The offline v0 leaves
 * out the key page too (pages.js checks keys against TMDB, Watchmode and Movie of the Night): service.js then only
 * has `alive`, and says so to the key methods.
 */
export const serviceStage = (out, v1 = true) => {
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(path.join(root, 'service'), out, {
    recursive: true,
    filter: (src) =>
      !/[\\/](\.private|\.data|node_modules)([\\/]|$)/.test(src) && (v1 || !/[\\/](pages\.js|keys-page\.html)$/.test(src)),
  });
  // The updater checks signatures with TweetNaCl, answers with the app's version, and has its address and keys.
  fs.copyFileSync(path.join(root, 'vendor', 'tweetnacl', 'nacl-fast.min.js'), path.join(out, 'nacl-fast.min.js'));
  const pkg = JSON.parse(fs.readFileSync(path.join(out, 'package.json'), 'utf8'));
  pkg.version = appVersion();
  fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'update-config.json'), JSON.stringify(rootUpdateConfig(), null, 2) + '\n');
};

/** HomeTV's appinfo.json for LG. Back reaches the page (disableBackHistoryAPI); the page handles it. */
export function appinfo(version) {
  return {
    id: 'com.hometv.app',
    version,
    vendor: 'HomeTV',
    type: 'web',
    main: 'index.html',
    title: 'HomeTV',
    icon: 'icon.png',
    largeIcon: 'largeIcon.png',
    resolution: '1920x1080',
    disableBackHistoryAPI: true,
    bgColor: '#0d1117',
  };
}

function main() {
  const v1 = !args.includes('--v0');
  const page = path.join(root, 'dist', 'app');
  if (!args.includes('--no-build')) {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const env = { ...process.env };
    if (v1) env.HOMETV_V1 = '1';
    else delete env.HOMETV_V1;
    execFileSync(npm, ['run', 'build:app'], { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' });
  }
  const js = path.join(page, 'assets', 'app.js');
  if (!fs.existsSync(js)) throw new Error('no dist/app: run `npm run build:app` first');
  const samples = samplesInPage(page);
  if (samples.length && !args.includes('--allow-sample')) {
    throw new Error('this build holds sample titles (' + samples.join(', ') + '): never for a TV. --allow-sample for a preview only.');
  }
  if (!fs.existsSync(path.join(page, 'shell-config.js'))) {
    throw new Error('dist/app has no loader (shell-config.js): run `npm run build:app` (npm run package:app does)');
  }
  // The .ipk's version is the app's (package.json "appVersion"); the page inside has its own ("version").
  const version = appVersion();
  const out = path.join(root, 'dist', 'hometv-app');
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(page, out, { recursive: true });
  fs.writeFileSync(path.join(out, 'appinfo.json'), JSON.stringify(appinfo(version), null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'icon.png'), png(80));
  fs.writeFileSync(path.join(out, 'largeIcon.png'), png(130));
  const svc = path.join(root, 'dist', 'stage', 'service');
  serviceStage(svc, v1);
  console.log('staged ' + path.relative(root, out) + ' and ' + path.relative(root, svc) + (v1 ? ' (v1)' : ' (v0)'));
  if (args.includes('--stage-only')) return;
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  execFileSync(npx, ['-y', '-p', ARES, 'ares-package', out, svc, '-o', path.join(root, 'dist')], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error('package-webos: ' + e.message);
    process.exit(1);
  }
}
