// Reads an .ipk (a webOS package, as LG's ares-package writes it) with Node's own modules: an `ar` archive holding
// debian-binary, control.tar.gz and data.tar.gz (some packagers wrap the three in a .tar.gz instead; both are read).
// Used by tools/hbc-repo.mjs to check the package it lists is the one it says.

import zlib from 'node:zlib';

/** The members of an `ar` archive: [{ name, data }]. */
export function readAr(buf) {
  if (buf.subarray(0, 8).toString('latin1') !== '!<arch>\n') throw new Error('not an ar archive');
  const out = [];
  let at = 8;
  while (at + 60 <= buf.length) {
    const head = buf.subarray(at, at + 60).toString('latin1');
    if (head.slice(58, 60) !== '`\n') throw new Error(`ar: bad header at byte ${at}`);
    const name = head.slice(0, 16).trim().replace(/\/$/, '');
    const size = parseInt(head.slice(48, 58).trim(), 10);
    if (!(size >= 0) || at + 60 + size > buf.length) throw new Error(`ar: bad size for ${name}`);
    out.push({ name, data: buf.subarray(at + 60, at + 60 + size) });
    at += 60 + size + (size % 2);
  }
  return out;
}

/** The files of a tar archive (ustar, GNU long names, pax paths): [{ path, type, data }], "./" taken off. */
export function readTar(buf) {
  const out = [];
  let at = 0;
  let longName = null;
  let paxPath = null;
  while (at + 512 <= buf.length) {
    const h = buf.subarray(at, at + 512);
    if (h.every((b) => b === 0)) break;
    const str = (o, n) => h.subarray(o, o + n).toString('utf8').replace(/\0[\s\S]*$/, '');
    const size = parseInt(str(124, 12).trim() || '0', 8);
    const type = str(156, 1) || '0';
    const prefix = str(257, 6).startsWith('ustar') ? str(345, 155) : '';
    const data = buf.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') {
      longName = data.toString('utf8').replace(/\0[\s\S]*$/, '');
      continue;
    }
    if (type === 'x') {
      const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString('utf8'));
      paxPath = m ? m[1] : null;
      continue;
    }
    if (type === 'g') continue;
    const name = paxPath || longName || (prefix ? prefix + '/' : '') + str(0, 100);
    longName = paxPath = null;
    out.push({ path: name.replace(/^\.\//, '').replace(/^\//, ''), type, data });
  }
  return out;
}

/** "Key: value" lines of a control file. */
export function parseControl(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

/** The parts of an .ipk: its control fields and its files (data.tar.gz), by path. */
export function readIpk(buf) {
  let members;
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    members = readTar(zlib.gunzipSync(buf)).map((f) => ({ name: f.path, data: f.data }));
  } else {
    members = readAr(buf);
  }
  const get = (name) => {
    const m = members.find((x) => x.name === name);
    if (!m) throw new Error(`not an .ipk: no ${name}`);
    return m.data;
  };
  const tar = (name) => readTar(zlib.gunzipSync(get(name)));
  const controlFile = tar('control.tar.gz').find((f) => f.path === 'control');
  if (!controlFile) throw new Error('not an .ipk: no control file');
  const files = new Map();
  for (const f of tar('data.tar.gz')) if (f.type === '0') files.set(f.path, f.data);
  return { control: parseControl(controlFile.data.toString('utf8')), files };
}
