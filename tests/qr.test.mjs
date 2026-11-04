// app/src/qr.ts against Project Nayuki's own encoder, with the vectors of the Android launcher's QrTest.java: made
// with his Python library (qrcodegen 1.8), each the version, level and mask he chose and the SHA-256 of the modules
// read row by row as "1" for dark and "0" for light. Node runs the TypeScript as it is (type stripping).

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { encodeQr, dark } from '../app/src/qr.ts';

const ALPHA = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.';
/** A stand-in for TMDB's v4 request token, as long as a real one; not a token. */
const TOKEN = ALPHA.repeat(4).slice(0, 250);
const V4_URL = 'https://www.themoviedb.org/auth/access?request_token=' + TOKEN;
const V3_URL = 'https://www.themoviedb.org/authenticate/0123456789abcdef0123456789abcdef01234567';

const rows = (q) => {
  const out = [];
  for (let y = 0; y < q.size; y++) {
    let r = '';
    for (let x = 0; x < q.size; x++) r += dark(q, x, y) ? '#' : '.';
    out.push(r);
  }
  return out;
};
const sha = (q) => crypto.createHash('sha256').update(rows(q).join('').replace(/#/g, '1').replace(/\./g, '0')).digest('hex');

function check(q, version, ecc, mask, hash) {
  assert.equal(q.version, version, 'version');
  assert.equal(q.size, version * 4 + 17, 'size');
  assert.equal(q.ecc, ecc, 'level');
  assert.equal(q.mask, mask, 'mask');
  assert.equal(sha(q), hash, 'modules');
}

test('Hello, world! matches module for module', () => {
  const q = encodeQr('Hello, world!', 'L', 2, false);
  assert.equal(q.version, 1);
  assert.deepEqual(rows(q), [
    '#######...###.#######',
    '#.....#.###.#.#.....#',
    '#.###.#...###.#.###.#',
    '#.###.#.##..#.#.###.#',
    '#.###.#..#..#.#.###.#',
    '#.....#.#..#..#.....#',
    '#######.#.#.#.#######',
    '.........#...........',
    '#####.###..#.#.#.#.#.',
    '#...##..#.#.##..###.#',
    '##.##.#.#.#.###..###.',
    '.##..#.##..###.#.##..',
    '..#####.#...#.##....#',
    '........##...#####...',
    '#######.#...####..##.',
    '#.....#..#..##.#.###.',
    '#.###.#.#.#####.#..##',
    '#.###.#.###....###...',
    '#.###.#.#..##.##..#..',
    '#.....#.###.##..###..',
    '#######.##.#..#.#..#.',
  ]);
});

test('the automatic choices match Nayuki’s', () => {
  check(encodeQr('Hello, world!', 'M', -1, true), 1, 'M', 2, '9ec093e9c8e6ca1bb4c4a28edde04d1b1c96221e49a45ee3e26f278397d05d72');
  check(encodeQr(V3_URL), 5, 'M', 2, '89575d6f5166d9769dc8a58c400d96a5f83a02d1eedb5cc59ac057953f66a431');
  assert.equal(V4_URL.length, 303);
  check(encodeQr(V4_URL), 13, 'M', 3, '2258b78bcccf856a184ed1c5b9b86b5833c53724d7e18a12270db6db04c35fb4');
});

test('a fixed mask at level H, with version information', () => {
  check(encodeQr(V4_URL, 'H', 5, false), 18, 'H', 5, '1609818257b58aa784494a6bf1c365f974f991f196b94aae4de569482ab6cc86');
});

test('UTF-8 text, raised to Q still', () => {
  check(encodeQr('Smörgåsbord ☕', 'Q', -1, true), 2, 'Q', 2, 'e1782d23e7ca5b51b3af1f9c158cbfba99dda3310b1591f4ef70069e987d7966');
});

test('16-bit lengths from version 10, and the largest version', () => {
  check(encodeQr('x'.repeat(1000), 'L', -1, true), 22, 'L', 0, '99f475e4071e6b7428bd675d21f44530883326c98290d86edf4bf3c63c6a8e71');
  check(encodeQr('a'.repeat(2953), 'L', -1, true), 40, 'L', 1, 'c27a04b5479583f147f7a50ff0707d1cd63ee3f0a5af3365cdd06bb9091adb1e');
});

test('empty text is raised to H', () => {
  check(encodeQr(''), 1, 'H', 6, 'eda56944c6388497decff5606742aa3abb818ced31a14a4b7d67a957c8c2584d');
});

test('too long, or a bad mask, throws', () => {
  assert.throws(() => encodeQr('a'.repeat(2954), 'L', -1, true));
  assert.throws(() => encodeQr('a'.repeat(2332)));
  assert.throws(() => encodeQr('x', 'L', 8, false));
});

test('outside the code is light', () => {
  const q = encodeQr(V3_URL);
  assert.equal(dark(q, 0, 0), true);
  assert.equal(dark(q, -1, 0), false);
  assert.equal(dark(q, 0, q.size), false);
});

test('the key page’s address fits a small code', () => {
  const q = encodeQr('http://192.168.100.200:8766/keys#K7QM4PXT');
  assert.ok(q.version <= 4, `version ${q.version}`);
});
