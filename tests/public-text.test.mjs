// This repo is public: no personal names or family wording in the tracked text (the project's private notes live in
// the gitignored private/ folder).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const SKIP = /^(vendor\/|package-lock\.json$|LICENSE$)/;
const PERSONAL = [/\bRebecca\b(?! Ferguson)/, /\b(my|her|his) (dad|mum|mom|father|mother)\b/i, /\bfamily member\b/i, /\bthe family'?s TV\b/i];

test('tracked text has no personal names or family wording', () => {
  const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter((f) => f && !SKIP.test(f));
  const hits = [];
  for (const f of files) {
    const p = path.join(root, f);
    if (!fs.existsSync(p) || fs.statSync(p).size > 2_000_000) continue;
    const text = fs.readFileSync(p, 'utf8');
    if (text.indexOf('\u0000') >= 0) continue;
    text.split('\n').forEach((line, i) => {
      if (PERSONAL.some((re) => re.test(line))) hits.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, []);
});
