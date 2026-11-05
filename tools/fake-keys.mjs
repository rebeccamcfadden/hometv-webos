// Stand-ins for the three services that check API keys (TMDB, Watchmode, Movie of the Night), for the pages service
// (service/pages.js, its `checkBase`) on a PC: `npm run dev` and the tests. Each answers the same free request the TV
// makes, at <base>/<id>/<the real path>, judging the key it finds in the real header:
// - a key with "good" in it works (200), one with "offline" can't be reached (the connection drops), any other is
//   refused (401). Real keys never come here.
// `received` keeps what was asked, the key included, so tests can check it went in the header and not the address.

import http from 'node:http';

const PATHS = {
  tmdb: '/tmdb/3/authentication',
  watchmode: '/watchmode/v1/regions/',
  motn: '/motn/v4/countries/us',
};

export function startFakeKeyChecks({ log = () => {} } = {}) {
  const received = [];
  const server = http.createServer((req, res) => {
    const id = Object.keys(PATHS).filter((k) => PATHS[k] === req.url)[0];
    const auth = String(req.headers.authorization || '');
    const key = id === 'tmdb' ? (/^Bearer (.*)$/.exec(auth) || [])[1] || '' : String(req.headers['x-api-key'] || '');
    received.push({ id: id || null, url: req.url, method: req.method, key, headers: req.headers });
    if (!id) {
      res.writeHead(404);
      return res.end();
    }
    if (/offline/i.test(key)) {
      log(`key check for ${id}: can't be reached`);
      return req.socket.destroy();
    }
    const ok = /good/i.test(key);
    log(`key check for ${id}: ${ok ? 'works' : 'refused'}`);
    res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' });
    res.end(ok ? '{"success":true}' : '{"success":false}');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, received, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}
