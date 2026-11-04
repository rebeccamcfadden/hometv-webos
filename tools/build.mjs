// Builds the HomeTV checks app into dist/checks-app: copies checks/app, turns src/qr.ts into plain JS (window.HomeTvQr)
// with Node's own type stripping, and draws the two icons LG's packager wants. Then `npm run package` makes the .ipk.
import { stripTypeScriptTypes } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { png } from './lib/png.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist', 'checks-app');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync(path.join(root, 'checks', 'app'), out, { recursive: true });

const ts = fs.readFileSync(path.join(root, 'src', 'qr.ts'), 'utf8');
const js = stripTypeScriptTypes(ts, { mode: 'strip' })
  .replace(/^export (function|const) /gm, '$1 ');
fs.writeFileSync(path.join(out, 'qr.js'),
  '(function () {\n' + js + '\nwindow.HomeTvQr = { encodeQr: encodeQr, dark: dark };\n})();\n');

fs.writeFileSync(path.join(out, 'icon.png'), png(80));
fs.writeFileSync(path.join(out, 'largeIcon.png'), png(130));

console.log('built ' + path.relative(root, out));
