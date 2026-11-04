// Serves a page release on this PC, to try page updates without any public server. Not for the internet.
// From hometv-tizen's tools/page-serve.mjs (5ac0b52).
//
// node tools/page-serve.mjs [<release folder>] [--port 8790] [--host 0.0.0.0]
//   Serves a folder made by tools/page-release.mjs (default .data/page-release) with CORS.
// node tools/page-serve.mjs --dev
//   Also makes a test key (.data/page-dev-key.pem, git-ignored; never for a real release) and a release of dist/app
//   with it, then serves it, and prints the build command for an app that trusts that key.

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { makeKeyPair, rawPublicKey, root } from './page-key.mjs';
import { releaseFromDist } from './page-release.mjs';
import { DIST } from './page-build.mjs';

const TYPES = {
  '.json': 'application/json; charset=utf-8',
  '.sig': 'text/plain; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

export function startPageServer({ dir, port = 8790, host = '127.0.0.1', log = () => {} }) {
  const base = path.resolve(dir);
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    let file;
    try {
      file = path.resolve(base, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname));
    } catch {
      res.writeHead(400).end();
      return;
    }
    const rel = path.relative(base, file);
    if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      log(`404 ${req.url}`);
      res.writeHead(404).end();
      return;
    }
    log(`200 ${req.url}`);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': /manifest\.json/.test(file) ? 'no-store' : 'max-age=3600',
    });
    res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({ server, port: server.address().port, close: () => new Promise((r) => server.close(r)) }));
  });
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return '192.168.1.50';
}

async function main() {
  const port = Number(arg('--port') || 8790);
  const host = arg('--host') || '0.0.0.0';
  const dir = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(root, '.data', 'page-release');
  if (process.argv.includes('--dev')) {
    const keyFile = path.join(root, '.data', 'page-dev-key.pem');
    if (!fs.existsSync(keyFile)) {
      fs.mkdirSync(path.dirname(keyFile), { recursive: true });
      fs.writeFileSync(keyFile, makeKeyPair().privatePem, { mode: 0o600 });
    }
    const privateKey = crypto.createPrivateKey(fs.readFileSync(keyFile, 'utf8'));
    const pub = rawPublicKey(privateKey);
    const url = `http://${lanAddress()}:${port}/manifest.json`;
    console.log(`Test key (this PC only): ${pub}
An app that trusts it and checks this PC (PowerShell):
  $env:HOMETV_PAGE_KEYS='${pub}'; $env:HOMETV_UPDATE_URL='${url}'; npm run package:app
Install that app, then raise package.json's "version", build again the same way and rerun this to offer the newer page.`);
    if (fs.existsSync(path.join(DIST, 'shell-config.js'))) {
      const { release } = releaseFromDist({ dist: DIST, out: dir, privateKey });
      console.log(`Released page ${release.manifest.version} from dist/app into ${dir}`);
    }
  }
  if (!fs.existsSync(dir)) {
    console.error(`No release at ${dir}: run tools/page-release.mjs (or this with --dev) first.`);
    process.exit(1);
  }
  const s = await startPageServer({ dir, port, host, log: (line) => console.log(line) });
  console.log(`Serving ${dir} on http://${host}:${s.port}/manifest.json (Ctrl+C stops)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
