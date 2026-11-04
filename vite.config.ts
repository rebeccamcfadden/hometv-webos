import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// HomeTV's page for LG (dist/app, then tools/package-webos.mjs makes the .ipk). Built as hometv-tizen builds it: one
// classic script (iife) for older engines (webOS 4 has Chromium 53), so the screens' build is the same on both TVs.
// No AeroTizen here: on LG the bridge talks to the TV through Luna (app/src/webos/).
const classicScript = (): Plugin => ({
  name: 'classic-script',
  apply: 'build',
  enforce: 'post',
  transformIndexHtml(html) {
    return html
      .replace(/<script type="module" crossorigin src=/g, '<script defer src=')
      .replace(/<link rel="stylesheet" crossorigin href=/g, '<link rel="stylesheet" href=');
  },
});

const V1 = process.env.HOMETV_V1 === '1';
const VERSION = (JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as { version: string }).version;

export default defineConfig({
  root: 'app',
  base: './',
  plugins: [classicScript()],
  // The shared package (hometv-tizen's docs/shared-package.md), a submodule pinned to a hometv-launcher commit.
  resolve: {
    alias: {
      '@hometv/core': path.resolve(__dirname, 'vendor/hometv-launcher/packages/core/src'),
      // v1's screens only with HOMETV_V1=1 (app/src/features.ts).
      '@v1': path.resolve(__dirname, V1 ? 'app/src/v1.ts' : 'app/src/v1-off.ts'),
    },
  },
  define: { __HOMETV_V1__: JSON.stringify(V1), __HOMETV_VERSION__: JSON.stringify(VERSION) },
  server: { port: 5181, strictPort: true },
  build: {
    outDir: '../dist/app',
    emptyOutDir: true,
    target: 'chrome53',
    modulePreload: false,
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    rollupOptions: {
      output: { format: 'iife', entryFileNames: 'assets/app.js', assetFileNames: 'assets/[name][extname]' },
    },
  },
});
