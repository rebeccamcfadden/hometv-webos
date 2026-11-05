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
import { appVersion } from './page-build.mjs';

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

/** The service folder as it goes in the .ipk: never its private keys, dev data or a test's files. */
const serviceStage = (out) => {
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(path.join(root, 'service'), out, {
    recursive: true,
    filter: (src) => !/[\\/](\.private|\.data|node_modules)([\\/]|$)/.test(src),
  });
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
  serviceStage(svc);
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
