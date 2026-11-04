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
  assert.doesNotMatch(off, /from '\.\/(screens|data)\//);
  assert.match(read('vite.config.ts'), /V1 \? 'app\/src\/v1\.ts' : 'app\/src\/v1-off\.ts'/);
});

test('v1 screens are reached only through @v1, the nav and Home behind V1', () => {
  assert.doesNotMatch(read('app/src/main.ts'), /screens\/(library|search|person|title)/);
  assert.match(read('app/src/ui/widgets.ts'), /const tabs: \[TabId, string\]\[\] = V1/);
  assert.match(read('app/src/screens/home.ts'), /if \(V1\) right\.insertBefore\(search/);
});

test('packaging refuses the sample catalogue for a TV', () => {
  const pkg = read('tools/package-webos.mjs');
  assert.match(pkg, /--allow-sample/);
  const catalog = read('app/src/data/catalog.ts');
  // The titles the guard looks for are still in the sample catalogue.
  for (const t of ['Knives Out', 'Past Lives', 'Severance']) assert.ok(catalog.includes(t), t);
});
