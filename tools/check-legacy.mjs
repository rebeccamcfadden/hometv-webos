// Checks that what goes to the TV runs on the oldest engines we aim for: webOS 4's page (Chromium 53) and the service's
// Node on older LG TVs. Run by `npm run build:app` and `npm run check`; exits 1 with the reasons. From hometv-tizen's
// tools/check-legacy.mjs, with LG's floor (Chromium 53; research.md section 5).
//
// - service/service.js, service/pages.js and the phone page's script in service/keys-page.html must parse as ES5 (no
//   let/const, arrows, template strings, classes). The phone page's script runs on phones, but is held to ES5 too.
// - dist/app/**/*.js must parse as an ES2016 classic script (the bundler lowers async/await and spread to the target;
//   no modules: <script type="module"> is Chromium 61), and the built page must not call built-ins newer than Chromium 53.
// - dist/app/**/*.css must avoid CSS that Chromium 53 lacks.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

function parseAs(file, ecmaVersion, sourceType) {
  try {
    parse(fs.readFileSync(file, 'utf8'), { ecmaVersion, sourceType, allowHashBang: true });
  } catch (e) {
    problems.push(`${path.relative(root, file)}: not ES${ecmaVersion}: ${e.message}`);
  }
}

function walk(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p, ext) : p.endsWith(ext) ? [p] : [];
  });
}

const CSS_RULES = [
  [/display\s*:\s*(inline-)?grid/, 'CSS grid (Chromium 57)'],
  [/(^|[;{\s])(row-|column-)?gap\s*:/, 'gap (flexbox gap is Chromium 84)'],
  [/:focus-visible/, ':focus-visible (Chromium 86)'],
  [/:(is|where)\(/, ':is() / :where() (Chromium 88)'],
  [/aspect-ratio\s*:/, 'aspect-ratio (Chromium 88)'],
  [/(^|[;{\s])inset\s*:/, 'inset (Chromium 87)'],
];

/** Built-ins newer than Chromium 53 that a bundler doesn't lower. Method names survive minifying. */
const JS_BUILTINS = [
  [/\.matchAll\(/, 'String.prototype.matchAll (Chromium 73)'],
  [/\.padStart\(|\.padEnd\(/, 'padStart/padEnd (Chromium 57)'],
  [/Object\.fromEntries\(/, 'Object.fromEntries (Chromium 73)'],
  [/Object\.(entries|values)\(/, 'Object.entries/values (Chromium 54)'],
  [/\.flatMap\(|\.flat\(\)/, 'Array.prototype.flat/flatMap (Chromium 69)'],
  [/\.replaceAll\(/, 'String.prototype.replaceAll (Chromium 85)'],
  [/\.replaceChildren\(/, 'replaceChildren (Chromium 86)'],
  [/structuredClone\(/, 'structuredClone (Chromium 98)'],
  [/\.trimStart\(|\.trimEnd\(/, 'trimStart/trimEnd (Chromium 66)'],
  [/Object\.hasOwn\(/, 'Object.hasOwn (Chromium 93)'],
  [/\bglobalThis\b/, 'globalThis (Chromium 71)'],
  [/new AbortController\(/, 'AbortController (Chromium 66)'],
];

for (const f of ['service.js', 'pages.js']) {
  const file = path.join(root, 'service', f);
  if (fs.existsSync(file)) parseAs(file, 5, 'script');
}
const keysPage = path.join(root, 'service', 'keys-page.html');
if (fs.existsSync(keysPage)) {
  const scripts = /<script>([\s\S]*?)<\/script>/g;
  const html = fs.readFileSync(keysPage, 'utf8');
  for (let m = scripts.exec(html); m; m = scripts.exec(html)) {
    try {
      parse(m[1], { ecmaVersion: 5, sourceType: 'script' });
    } catch (e) {
      problems.push(`service/keys-page.html: script not ES5: ${e.message}`);
    }
  }
}

const dist = path.join(root, 'dist', 'app');
if (process.argv.includes('--service-only')) {
  // The service only (npm test runs this; the page needs a build first).
} else if (!fs.existsSync(dist)) problems.push('dist/app is missing: run `npm run build:app` first');
else {
  // The app's shell (tools/page-build.mjs) runs before anything else: ES5.
  for (const name of ['shell-config.js', 'boot.js', 'update.js']) if (fs.existsSync(path.join(dist, name))) parseAs(path.join(dist, name), 5, 'script');
  for (const file of walk(dist, '.js')) {
    parseAs(file, 2016, 'script');
    if (path.basename(file) === 'nacl-fast.min.js') continue;
    const js = fs.readFileSync(file, 'utf8');
    for (const [re, what] of JS_BUILTINS) if (re.test(js)) problems.push(`${path.relative(root, file)}: uses ${what}`);
  }
  for (const file of walk(dist, '.html')) {
    const html = fs.readFileSync(file, 'utf8');
    if (/type=["']?module/.test(html)) problems.push(`${path.relative(root, file)}: <script type="module"> (Chromium 61)`);
    if (/rel=["']?modulepreload/.test(html)) problems.push(`${path.relative(root, file)}: modulepreload (Chromium 66)`);
  }
  for (const file of walk(dist, '.css')) {
    const css = fs.readFileSync(file, 'utf8');
    for (const [re, what] of CSS_RULES) if (re.test(css)) problems.push(`${path.relative(root, file)}: uses ${what}`);
  }
}

if (problems.length) {
  console.error('Not safe for the oldest TVs:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log('check-legacy: service is ES5' + (process.argv.includes('--service-only') ? '.' : '; page JS is ES2016; CSS fits Chromium 53.'));
