// Makes the Homebrew Channel repository for HomeTV: the JSON a rooted LG TV's Homebrew Channel reads to offer HomeTV
// and its updates, pointing at HomeTV's .ipk on a GitHub release, with its SHA-256. Writes files only; publishes
// nothing (where it goes is the project lead's call, docs/updates.md).
//
// Usage: node tools/hbc-repo.mjs [--ipk dist/com.hometv.app_<appVersion>_all.ipk] [--tag app-v<appVersion>]
//          [--base-url https://rebeccamcfadden.github.io/hometv-webos/hbc/] [--ipk-url <full address>] [--out dist/hbc]
//
// The format is Homebrew Channel's own (webosbrew/webos-homebrew-channel, read at 6e928d0, v0.7.3 the same):
// frontend/views/BrowserPanel.js reads `packages` from each repository address; frontend/views/DetailsPanel.js uses a
// package's `manifest` (or fetches `manifestUrl`), resolves `ipkUrl` against `manifestUrl`, and asks its service to
// install it with `ipkHash.sha256`; services/service.ts `install` refuses a download whose SHA-256 differs. The fields
// follow webosbrew/apps-repo's repogen (read at f3c6464): pkg_info.py PackageInfo, pkg_manifest.py PackageManifest.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readIpk } from './lib/ipk.mjs';
import { png } from './lib/png.mjs';
import { sampleIn } from './package-webos.mjs';
import { appVersion } from './page-build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const APP_ID = 'com.hometv.app';
export const GITHUB_REPO = 'rebeccamcfadden/hometv-webos';
export const DEFAULT_BASE_URL = 'https://rebeccamcfadden.github.io/hometv-webos/hbc/';
export const HBC_ID = 'org.webosbrew.hbchannel';

/** What's inside an .ipk that matters here, checked: HomeTV's id, one version in control and appinfo, no sample data. */
export function inspectIpk(buf, fileName) {
  const { control, files } = readIpk(buf);
  const dir = `usr/palm/applications/${APP_ID}/`;
  const infoBytes = files.get(dir + 'appinfo.json');
  if (!infoBytes) throw new Error(`${fileName}: no ${dir}appinfo.json: not HomeTV's .ipk`);
  const appinfo = JSON.parse(infoBytes.toString('utf8'));
  if (appinfo.id !== APP_ID || control.Package !== APP_ID) throw new Error(`${fileName}: it's ${appinfo.id}, not ${APP_ID}`);
  if (control.Version !== appinfo.version) {
    throw new Error(`${fileName}: control says ${control.Version}, appinfo.json ${appinfo.version}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(appinfo.version)) throw new Error(`${fileName}: version ${appinfo.version} is not x.y.z`);
  const expected = `${APP_ID}_${appinfo.version}_${control.Architecture || 'all'}.ipk`;
  if (fileName !== expected) throw new Error(`${fileName}: an .ipk of ${appinfo.version} is named ${expected}`);
  const js = files.get(dir + 'assets/app.js');
  if (js && sampleIn(js.toString('utf8'))) throw new Error(`${fileName} holds the sample catalogue (a v1 build): never for a TV`);
  return { control, appinfo, icon: files.get(dir + (appinfo.largeIcon || appinfo.icon || 'largeIcon.png')) || null };
}

const httpsUrl = (u, what) => {
  if (!/^https:\/\/[^\s]+$/.test(u)) throw new Error(`${what} must be an https address: ${u}`);
  return u;
};

/** Homebrew Channel's manifest for one .ipk. */
export function makeManifest({ appinfo, ipk, ipkUrl, iconUri }) {
  return {
    id: appinfo.id,
    version: appinfo.version,
    type: appinfo.type,
    title: appinfo.title,
    appDescription: appinfo.appDescription || 'HomeTV: a TV home screen (your apps, the catalogue, where to watch).',
    iconUri,
    sourceUrl: `https://github.com/${GITHUB_REPO}`,
    // HomeTV runs as an app without root; it becomes LG's Home only on a rooted TV (root/).
    rootRequired: 'optional',
    ipkUrl,
    ipkHash: { sha256: crypto.createHash('sha256').update(ipk).digest('hex') },
    ipkSize: ipk.length,
  };
}

/** The repository JSON: HomeTV alone, its manifest inside (so Homebrew Channel needs one download less). */
export function makeRepo({ manifest, baseUrl }) {
  return {
    paging: { page: 1, count: 1, maxPage: 1, itemsTotal: 1, prevUrl: null, nextUrl: null },
    packages: [
      {
        id: manifest.id,
        title: manifest.title,
        iconUri: manifest.iconUri,
        manifestUrl: baseUrl + `${manifest.id}.manifest.json`,
        manifest,
        pool: 'main',
        shortDescription: manifest.appDescription,
      },
    ],
  };
}

/** The launch that opens Homebrew Channel's "Add repository" box with the address typed in (MainView.js). */
export function addRepositoryLaunch(repoUrl) {
  return { id: HBC_ID, params: { launchMode: 'addRepository', url: repoUrl } };
}

export function buildRepo({ ipk, fileName, tag, baseUrl = DEFAULT_BASE_URL, ipkUrl }) {
  baseUrl = httpsUrl(baseUrl.replace(/\/?$/, '/'), '--base-url');
  const { appinfo, icon } = inspectIpk(ipk, fileName);
  const url = ipkUrl || `https://github.com/${GITHUB_REPO}/releases/download/${encodeURIComponent(tag || `app-v${appinfo.version}`)}/${fileName}`;
  if (!/^https?:\/\/[^\s]+$/.test(url)) throw new Error(`--ipk-url must be an http(s) address: ${url}`);
  const manifest = makeManifest({ appinfo, ipk, ipkUrl: url, iconUri: baseUrl + 'icon.png' });
  return { manifest, repo: makeRepo({ manifest, baseUrl }), icon: icon || png(130), repoUrl: baseUrl + 'apps.json' };
}

export function writeRepo(out, built) {
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'icon.png'), built.icon);
  fs.writeFileSync(path.join(out, `${built.manifest.id}.manifest.json`), JSON.stringify(built.manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'apps.json'), JSON.stringify(built.repo, null, 2) + '\n');
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function main() {
  const ipkPath = path.resolve(arg('--ipk') || path.join(root, 'dist', `${APP_ID}_${appVersion()}_all.ipk`));
  if (!fs.existsSync(ipkPath)) throw new Error(`no ${ipkPath}: run \`npm run package:app\` first, or pass --ipk`);
  const out = path.resolve(arg('--out') || path.join(root, 'dist', 'hbc'));
  const built = buildRepo({
    ipk: fs.readFileSync(ipkPath),
    fileName: path.basename(ipkPath),
    tag: arg('--tag'),
    baseUrl: arg('--base-url') || DEFAULT_BASE_URL,
    ipkUrl: arg('--ipk-url'),
  });
  writeRepo(out, built);
  const m = built.manifest;
  console.log(`Homebrew Channel repository for HomeTV ${m.version} (SHA-256 ${m.ipkHash.sha256}): ${out}
Nothing is published. To publish (the project lead's call):
  1. the .ipk as a release asset, so that this address works: ${m.ipkUrl}
  2. apps.json, ${m.id}.manifest.json and icon.png at ${built.repoUrl.replace(/apps\.json$/, '')}
On the TV: Homebrew Channel > Settings (the gear) > Add repository > ${built.repoUrl}
Or, from the TV's root shell, open that box with the address already typed in (the person still presses Add):
  luna-send -n 1 luna://com.webos.applicationManager/launch '${JSON.stringify(addRepositoryLaunch(built.repoUrl))}'`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error('hbc-repo: ' + e.message);
    process.exit(1);
  }
}
