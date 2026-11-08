// Builds dist/hometv-lg.exe: Node's own single-executable build (`--build-sea`), with the laptop tool's modules in
// its read-only virtual file system. The exe is this PC's Node with the tool inside (~90 MB); it needs no Node on
// the target laptop. Unsigned: Windows shows "unknown publisher".
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });

const files = ['tools/hometv-lg.mjs', 'tools/tv-check.mjs', 'tools/get.mjs', 'tools/restore.mjs', 'tools/lib/ws.mjs', 'tools/lib/ssap.mjs', 'tools/lib/checks.mjs', 'tools/lib/reach.mjs', 'tools/lib/fetch.mjs', 'tools/lib/backup.mjs', 'tools/lib/restore.mjs', 'tools/lib/root-shell.mjs',
  'tools/install.mjs', 'tools/lib/install-steps.mjs', 'tools/lib/telnet.mjs', 'tools/lib/sshkey.mjs',
  'tools/devmode.mjs', 'tools/lib/devmode.mjs', 'tools/lib/devmode-key.mjs', 'tools/lib/devmode-cdp.mjs'];
// The root install (hometv-lg install) stays out of a released exe until it is reviewed:
// `npm run exe -- --root` puts it in; without it the exe carries a no-root marker and hometv-lg hides it.
const withRoot = process.argv.includes('--root');
const assets = {};
for (const f of files.slice(1)) if (withRoot || f !== 'tools/install.mjs') assets[f.replace(/^tools\//, '')] = path.join(root, f);
// HomeTV's root scripts, which hometv-lg install copies to a rooted TV (read with node:sea's getAsset)
if (withRoot) {
  for (const f of fs.readdirSync(path.join(root, 'root'))) if (f !== 'README.md') assets['root/' + f] = path.join(root, 'root', f);
} else {
  const marker = path.join(dist, 'no-root.txt');
  fs.writeFileSync(marker, 'This hometv-lg leaves out the root install.\n');
  assets['no-root'] = marker;
}

const config = {
  main: path.join(root, files[0]),
  mainFormat: 'module',
  output: path.join(dist, process.platform === 'win32' ? 'hometv-lg.exe' : 'hometv-lg'),
  disableExperimentalSEAWarning: true,
  useVfs: true,
  assets
};
const configFile = path.join(dist, 'sea-config.json');
fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
execFileSync(process.execPath, ['--build-sea', configFile], { stdio: 'inherit' });
console.log('built ' + path.relative(root, config.output));
