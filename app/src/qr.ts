/*
 * A QR code for the API keys page's address, ported to TypeScript from the Android launcher's Qr.java
 * (hometv-launcher, launcher/app/src/main/java/com/hometv/launcher/Qr.java), itself adapted from Project Nayuki's QR
 * Code generator library (Java) by way of cleanyourtv-ui's Qr.java.
 *
 * Copyright (c) Project Nayuki. (MIT License)
 * https://www.nayuki.io/page/qr-code-generator-library
 *
 * Copyright (c) 2026 Matheus Caldeira (MIT License)
 * https://github.com/matheus-caldeira/cleanyourtv-ui
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 * - The above copyright notice and this permission notice shall be included in
 *   all copies or substantial portions of the Software.
 * - The Software is provided "as is", without warranty of any kind, express or
 *   implied, including but not limited to the warranties of merchantability,
 *   fitness for a particular purpose and noninfringement. In no event shall the
 *   authors or copyright holders be liable for any claim, damages or other
 *   liability, whether in an action of contract, tort or otherwise, arising from,
 *   out of or in connection with the Software or the use or other dealings in the
 *   Software.
 */

// The text as UTF-8 in byte mode, versions 1 to 40, the smallest version that fits, the error correction raised while
// the version stays the same, and the mask with the lowest penalty, as Nayuki's encoder chooses them. No DOM: the
// screen draws `dark` as squares with a light border of 4 modules. tests/qr.test.mjs compares what it makes with
// Nayuki's own encoder (the vectors of the launcher's QrTest.java).

/** Error correction, from the least to the most; the order matters to the tables and to raising the level. */
export type Ecc = 'L' | 'M' | 'Q' | 'H';
const ECC_ORDER: Ecc[] = ['L', 'M', 'Q', 'H'];
const FORMAT_BITS: Record<Ecc, number> = { L: 1, M: 0, Q: 3, H: 2 };

export interface Qr {
  version: number;
  /** Modules per side: version × 4 + 17. */
  size: number;
  ecc: Ecc;
  mask: number;
  /** Rows first: modules[y][x] is true for dark. */
  modules: boolean[][];
}

/** Whether the module at column x, row y is dark; outside the code is light. */
export function dark(qr: Qr, x: number, y: number): boolean {
  return x >= 0 && x < qr.size && y >= 0 && y < qr.size && qr.modules[y][x];
}

function utf8(text: string): number[] {
  const s = unescape(encodeURIComponent(text));
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
  return out;
}

/**
 * A QR code for `text`. `mask` is 0 to 7, or -1 to choose the best; with `boost` the level is raised while the data
 * still fits the same version. Throws when the text is too long for any version.
 */
export function encodeQr(text: string, ecc: Ecc = 'M', mask = -1, boost = true): Qr {
  if (mask < -1 || mask > 7) throw new Error('mask out of range');
  const data = utf8(text);
  let e = ECC_ORDER.indexOf(ecc);
  let version = 1;
  let used = 0;
  for (; ; version++) {
    used = 4 + (version <= 9 ? 8 : 16) + data.length * 8;
    if (data.length < (version <= 9 ? 1 << 8 : 1 << 16) && used <= dataCodewords(version, e) * 8) break;
    if (version >= 40) throw new Error('text too long for a QR code');
  }
  if (boost) {
    for (let i = 0; i < ECC_ORDER.length; i++) if (used <= dataCodewords(version, i) * 8) e = Math.max(e, i);
  }
  const capacity = dataCodewords(version, e) * 8;
  const bits: number[] = [];
  const append = (value: number, count: number) => {
    for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  append(0x4, 4);
  append(data.length, version <= 9 ? 8 : 16);
  for (const b of data) append(b, 8);
  append(0, Math.min(4, capacity - bits.length));
  append(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) append(pad, 8);
  const codewords: number[] = [];
  for (let i = 0; i < capacity / 8; i++) codewords.push(0);
  for (let i = 0; i < bits.length; i++) if (bits[i]) codewords[i >>> 3] |= 1 << (7 - (i & 7));
  return build(version, e, codewords, mask);
}

function build(version: number, e: number, dataCodewords: number[], msk: number): Qr {
  const size = version * 4 + 17;
  const ecc = ECC_ORDER[e];
  const modules: boolean[][] = [];
  const isFunction: boolean[][] = [];
  for (let y = 0; y < size; y++) {
    modules.push([]);
    isFunction.push([]);
    for (let x = 0; x < size; x++) {
      modules[y].push(false);
      isFunction[y].push(false);
    }
  }

  const setFunction = (x: number, y: number, isDark: boolean) => {
    modules[y][x] = isDark;
    isFunction[y][x] = true;
  };

  function drawFormatBits(m: number) {
    const value = (FORMAT_BITS[ecc] << 3) | m;
    let rem = value;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const fmt = ((value << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) setFunction(8, i, bit(fmt, i));
    setFunction(8, 7, bit(fmt, 6));
    setFunction(8, 8, bit(fmt, 7));
    setFunction(7, 8, bit(fmt, 8));
    for (let i = 9; i < 15; i++) setFunction(14 - i, 8, bit(fmt, i));
    for (let i = 0; i < 8; i++) setFunction(size - 1 - i, 8, bit(fmt, i));
    for (let i = 8; i < 15; i++) setFunction(8, size - 15 + i, bit(fmt, i));
    setFunction(8, size - 8, true);
  }

  function drawVersion() {
    if (version < 7) return;
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const v = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const b = bit(v, i);
      const a = size - 11 + (i % 3);
      const c = Math.floor(i / 3);
      setFunction(a, c, b);
      setFunction(c, a, b);
    }
  }

  function drawFinder(x: number, y: number) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFunction(xx, yy, dist !== 2 && dist !== 4);
      }
    }
  }

  function drawFunctionPatterns() {
    for (let i = 0; i < size; i++) {
      setFunction(6, i, i % 2 === 0);
      setFunction(i, 6, i % 2 === 0);
    }
    drawFinder(3, 3);
    drawFinder(size - 4, 3);
    drawFinder(3, size - 4);
    const align = alignmentPositions(version, size);
    const n = align.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            setFunction(align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
          }
        }
      }
    }
    drawFormatBits(0);
    drawVersion();
  }

  function drawCodewords(data: number[]) {
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!isFunction[y][x] && i < data.length * 8) {
            modules[y][x] = bit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  }

  function applyMask(m: number) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let invert: boolean;
        switch (m) {
          case 0:
            invert = (x + y) % 2 === 0;
            break;
          case 1:
            invert = y % 2 === 0;
            break;
          case 2:
            invert = x % 3 === 0;
            break;
          case 3:
            invert = (x + y) % 3 === 0;
            break;
          case 4:
            invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
            break;
          case 5:
            invert = ((x * y) % 2) + ((x * y) % 3) === 0;
            break;
          case 6:
            invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
            break;
          default:
            invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
            break;
        }
        if (invert && !isFunction[y][x]) modules[y][x] = !modules[y][x];
      }
    }
  }

  function addHistory(run: number, history: number[]) {
    if (history[0] === 0) run += size;
    for (let i = history.length - 1; i > 0; i--) history[i] = history[i - 1];
    history[0] = run;
  }

  function countFinderLike(hh: number[]): number {
    const n = hh[1];
    const core = n > 0 && hh[2] === n && hh[3] === n * 3 && hh[4] === n && hh[5] === n;
    return (core && hh[0] >= n * 4 && hh[6] >= n ? 1 : 0) + (core && hh[6] >= n * 4 && hh[0] >= n ? 1 : 0);
  }

  function terminateAndCount(runColor: boolean, run: number, history: number[]): number {
    if (runColor) {
      addHistory(run, history);
      run = 0;
    }
    run += size;
    addHistory(run, history);
    return countFinderLike(history);
  }

  /** The standard's penalty for the current modules; the mask with the lowest wins. */
  function penalty(): number {
    let result = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let a = 0; a < size; a++) {
        let runColor = false;
        let run = 0;
        const history = [0, 0, 0, 0, 0, 0, 0];
        for (let b = 0; b < size; b++) {
          const c = pass === 0 ? modules[a][b] : modules[b][a];
          if (c === runColor) {
            run++;
            if (run === 5) result += N1;
            else if (run > 5) result++;
          } else {
            addHistory(run, history);
            if (!runColor) result += countFinderLike(history) * N3;
            runColor = c;
            run = 1;
          }
        }
        result += terminateAndCount(runColor, run, history) * N3;
      }
    }
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = modules[y][x];
        if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) result += N2;
      }
    }
    let darkCount = 0;
    for (const row of modules) for (const c of row) if (c) darkCount++;
    const total = size * size;
    const k = Math.floor((Math.abs(darkCount * 20 - total * 10) + total - 1) / total) - 1;
    return result + k * N4;
  }

  drawFunctionPatterns();
  drawCodewords(addEccAndInterleave(version, e, dataCodewords));
  if (msk === -1) {
    let min = Infinity;
    for (let i = 0; i < 8; i++) {
      applyMask(i);
      drawFormatBits(i);
      const p = penalty();
      if (p < min) {
        msk = i;
        min = p;
      }
      applyMask(i);
    }
  }
  applyMask(msk);
  drawFormatBits(msk);
  return { version, size, ecc, mask: msk, modules };
}

function alignmentPositions(version: number, size: number): number[] {
  if (version === 1) return [];
  const n = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
  const out: number[] = [6];
  for (let i = 1; i < n; i++) out.push(0);
  for (let i = n - 1, pos = size - 7; i >= 1; i--, pos -= step) out[i] = pos;
  return out;
}

function addEccAndInterleave(version: number, e: number, data: number[]): number[] {
  const blocks = BLOCKS[e][version];
  const eccLen = ECC_PER_BLOCK[e][version];
  const raw = Math.floor(rawModules(version) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks);
  const divisor = rsDivisor(eccLen);
  const all: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1));
    k += dat.length;
    const block = dat.slice();
    while (block.length < shortLen + 1) block.push(0);
    const rem = rsRemainder(dat, divisor);
    for (let j = 0; j < rem.length; j++) block[block.length - eccLen + j] = rem[j];
    all.push(block);
  }
  const out: number[] = [];
  for (let i = 0; i < all[0].length; i++) {
    for (let j = 0; j < blocks; j++) {
      // The short blocks have no byte at this index.
      if (i !== shortLen - eccLen || j >= shortBlocks) out.push(all[j][i]);
    }
  }
  return out;
}

function rawModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    result -= (25 * n - 10) * n - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function dataCodewords(ver: number, e: number): number {
  return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[e][ver] * BLOCKS[e][ver];
}

function rsDivisor(degree: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < degree; i++) result.push(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = multiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = multiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result: number[] = [];
  for (let i = 0; i < divisor.length; i++) result.push(0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    for (let i = 0; i < result.length; i++) result[i] ^= multiply(divisor[i], factor);
  }
  return result;
}

/** The product in GF(2^8) modulo 0x11D. */
function multiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function bit(x: number, i: number): boolean {
  return ((x >>> i) & 1) !== 0;
}

const N1 = 3;
const N2 = 3;
const N3 = 40;
const N4 = 10;

// Index 0 is padding; the rows are L, M, Q, H (ECC_ORDER).
const ECC_PER_BLOCK: number[][] = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];

const BLOCKS: number[][] = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];
