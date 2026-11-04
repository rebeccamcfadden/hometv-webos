// Builds dist/hometv-lg.exe: Node's own single-executable build (`--build-sea`), with the laptop tool's modules in
// its read-only virtual file system. The exe is this PC's Node with the tool inside (~90 MB); it needs no Node on
// the family's laptop. Unsigned: Windows shows "unknown publisher".
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });

const files = ['tools/hometv-lg.mjs', 'tools/tv-check.mjs', 'tools/lib/ws.mjs', 'tools/lib/ssap.mjs', 'tools/lib/checks.mjs', 'tools/lib/reach.mjs'];
const assets = {};
for (const f of files.slice(1)) assets[f.replace(/^tools\//, '')] = path.join(root, f);

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
