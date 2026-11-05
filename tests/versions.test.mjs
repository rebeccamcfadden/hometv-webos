// v0 and v1 (app/src/features.ts): a v0 build holds no v1 screen and no sample data, and the
// packaging refuses sample data for a TV.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test("a v0 build's @v1 import brings in no screen and no data", () => {
  const off = read('app/src/v1-off.ts');
  assert.doesNotMatch(off, /from '\.\/(screens|data|live)\//);
  assert.match(read('vite.config.ts'), /V1 \? 'app\/src\/v1\.ts' : 'app\/src\/v1-off\.ts'/);
});

test('v1 screens are reached only through @v1, the nav and Home behind V1', () => {
  assert.doesNotMatch(read('app/src/main.ts'), /screens\/(library|search|person|title)/);
  assert.match(read('app/src/ui/widgets.ts'), /const tabs: \[TabId, string\]\[\] = V1/);
  assert.match(read('app/src/screens/home.ts'), /if \(V1\) right\.insertBefore\(search/);
});

test('packaging refuses a page with the sample catalogue, and no sample title is in app/src', () => {
  const pkg = read('tools/package-webos.mjs');
  assert.match(pkg, /--allow-sample/);
  const sample = read('tests/fixtures/sample-catalog.ts');
  // The titles the guard looks for are in the fixture, and the guard's pattern finds them there.
  for (const t of ['Knives Out', 'Past Lives', 'Severance']) assert.ok(sample.includes(t), t);
  const guard = new RegExp(pkg.match(/sampleIn = \(js\) => \/(.+)\/\.test/)[1]);
  assert.ok(guard.test(sample));
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const files = walk(path.join(root, 'app', 'src')).filter((f) => /\.(ts|css)$/.test(f));
  assert.ok(files.length > 20);
  for (const f of files) assert.ok(!guard.test(fs.readFileSync(f, 'utf8')), `${path.relative(root, f)} has a sample title`);
});
