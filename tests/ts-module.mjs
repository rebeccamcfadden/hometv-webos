// Loads the page's TypeScript modules in Node for a test: esbuild (Vite's own) bundles them with their imports,
// @hometv/core resolved as Vite resolves it, CSS left out, and the bundle is imported from memory (no files written).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'app', 'src');

/**
 * `entry` is a path relative to app/src ('screens/searchModel.ts'), or { name: path, … } to load several in one
 * bundle, so they share their modules (the offers and the settings they read): each comes back under its name.
 */
export async function loadTs(entry) {
  const many = typeof entry === 'object';
  const contents = many
    ? Object.keys(entry)
        .map((name) => `export * as ${name} from ${JSON.stringify('./' + entry[name].replace(/\\/g, '/'))};`)
        .join('\n')
    : '';
  const out = await build({
    ...(many ? { stdin: { contents, resolveDir: src, sourcefile: 'entry.ts', loader: 'ts' } } : { entryPoints: [path.join(src, entry)] }),
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    target: 'es2020',
    alias: { '@hometv/core': path.join(root, 'vendor', 'hometv-launcher', 'packages', 'core', 'src') },
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  });
  const code = out.outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}
