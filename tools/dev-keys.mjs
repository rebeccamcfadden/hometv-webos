// The PC's stand-in for the key page's service (service/pages.js, which on the TV HomeTV's webOS service starts over
// Luna): the pages service on 8767 with fake key checks (tools/fake-keys.mjs: "good" in a key works, "offline" can't be
// reached) and the keys kept in `.data/` (gitignored), plus the dev server's routes the app's platform.ts reads in place
// of Luna: /__hometv/pages-token, /__hometv/tmdb-key, /__hometv/price-keys. Used by vite.config.ts (serve only) and the tests.

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startFakeKeyChecks } from './fake-keys.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = /^(localhost|127\.0\.0\.1)(:\d+)?$/;

/** On a PC the 8766 port may be taken, so this takes 8767 (the TV's screen looks on both). */
export async function startDevPages({ port = Number(process.env.HOMETV_DEV_PAGES_PORT) || 8767, dataDir = path.join(root, '.data'), now, log = () => {}, testAddresses = false, requestDeadlineMs } = {}) {
  const checks = await startFakeKeyChecks({ log });
  const pages = createRequire(import.meta.url)('../service/pages.js');
  const instance = pages.create({ port, dataDir, now, checkBase: checks.base, devOrigins: true, testAddresses, requestDeadlineMs });
  await new Promise((resolve, reject) => instance.start((e) => (e ? reject(e) : resolve())));
  return {
    port: instance.port(),
    checks,
    instance,
    pages,
    dataDir,
    close() {
      instance.stop();
      checks.server.close();
    },
  };
}

/** Same-origin only, by the PC's own name: another site in the browser (or a rebinding name) can't read these. */
function route(server, url, type, body) {
  server.middlewares.use(url, (req, res) => {
    if (!HOST.test(String(req.headers.host || ''))) {
      res.statusCode = 403;
      return res.end();
    }
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'no-store');
    res.end(body());
  });
}

/** A Vite plugin (serve only): starts the dev pages service and serves the three /__hometv/ routes. */
export function devKeysPlugin(options = {}) {
  let dev = null;
  return {
    name: 'hometv-dev-keys',
    apply: 'serve',
    async configureServer(server) {
      dev = await startDevPages({ log: (s) => console.log(`[fake keys] ${s}`), ...options });
      console.log(`key page (dev): http://127.0.0.1:${dev.port}/keys  (a key with "good" in it works, "offline" can't be reached)`);
      server.httpServer?.on('close', () => dev && dev.close());
      route(server, '/__hometv/pages-token', 'text/plain; charset=utf-8', () => dev.instance.tvToken());
      route(server, '/__hometv/tmdb-key', 'text/plain; charset=utf-8', () => dev.instance.keyOf('tmdb'));
      route(server, '/__hometv/price-keys', 'application/json; charset=utf-8', () =>
        JSON.stringify({ watchmode: dev.instance.keyOf('watchmode'), motn: dev.instance.keyOf('motn') }),
      );
    },
  };
}
