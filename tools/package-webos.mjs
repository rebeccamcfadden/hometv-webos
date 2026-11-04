// Builds HomeTV's LG app (.ipk): the page from `vite build` (dist/app), its appinfo.json and icons, and HomeTV's
// service (service/). Uses LG's packager from @webos-tools/cli (pinned, run through npx); nothing is installed on a TV.
// Usage: npm run package:app  [-- --allow-sample (a v1 preview build, never for a TV)] [-- --stage-only]
//
// As hometv-tizen's tools/package-tizen.mjs: a page holding the sample catalogue (a v1 build) is refused for a TV.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { png } from './lib/png.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const ARES = '@webos-tools/cli@3.2.6';

/** The sample catalogue's titles (app/src/data/catalog.ts) in a built page. */
export const sampleIn = (js) => /Knives Out|Past Lives|Severance/.test(js);

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
  const page = path.join(root, 'dist', 'app');
  const js = path.join(page, 'assets', 'app.js');
  if (!fs.existsSync(js)) throw new Error('no dist/app: run `npx vite build` first (npm run package:app does)');
  if (sampleIn(fs.readFileSync(js, 'utf8')) && !args.includes('--allow-sample')) {
    throw new Error('this build holds the sample catalogue (a v1 build): never for a TV. --allow-sample for a preview only.');
  }
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const out = path.join(root, 'dist', 'hometv-app');
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(page, out, { recursive: true });
  fs.writeFileSync(path.join(out, 'appinfo.json'), JSON.stringify(appinfo(version), null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'icon.png'), png(80));
  fs.writeFileSync(path.join(out, 'largeIcon.png'), png(130));
  console.log('staged ' + path.relative(root, out));
  if (args.includes('--stage-only')) return;
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  execFileSync(npx, ['-y', '-p', ARES, 'ares-package', out, path.join(root, 'service'), '-o', path.join(root, 'dist')], {
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
