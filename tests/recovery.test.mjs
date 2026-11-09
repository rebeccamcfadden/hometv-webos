// The USB stick check for LG's USB recovery (tools/lib/recovery.mjs; docs/recovery.md, level 5), on pretend sticks:
// folders on the PC, with the drive's format and free space handed in as Windows would say them. Nothing reads a
// real drive and nothing writes to one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { checkStick, describeStick, modelFamily, familiesIn, versionIn, compareVersions, stickRoot } from '../tools/lib/recovery.mjs';

const MODEL = '43UT73006LA';
const SW = '33.31.61';
const MIN = 1000;

function stick(files = {}) {
  const d = path.resolve('dist', 'test-stick-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(d, { recursive: true });
  for (const [name, size] of Object.entries(files)) {
    const f = path.join(d, name);
    if (size === 'dir') { fs.mkdirSync(f, { recursive: true }); continue; }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, Buffer.alloc(size));
  }
  return d;
}
const fat32 = () => ({ root: true, format: 'FAT32', free: 8 * 2 ** 30 });
const check = (d, o = {}) => checkStick(d, { model: MODEL, software: SW, volume: fat32, minFirmware: MIN, ...o });

test('right: FAT32, LG_DTV at the top, one firmware file of this model family, not older', () => {
  const d = stick({ 'LG_DTV/43UT7300_33.31.61.epk': 2000 });
  try {
    const r = check(d);
    assert.equal(r.ok, true, describeStick(r).join('\n'));
    assert.equal(r.file, '43UT7300_33.31.61.epk');
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.unsure, []);
    assert.match(describeStick(r).join('\n'), /✓ formatted FAT32[\s\S]*✓ its name matches this TV's model family \(UT73\)[\s\S]*✓ version 33.31.61/);
    // a newer version is fine too (LG's USB update takes the same or newer)
    fs.renameSync(path.join(d, 'LG_DTV', '43UT7300_33.31.61.epk'), path.join(d, 'LG_DTV', '43UT7300_33.40.10.epk'));
    assert.equal(check(d).ok, true);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('wrong format, or a format that can\'t be read: never taken as FAT32', () => {
  const d = stick({ 'LG_DTV/43UT7300_33.31.61.epk': 2000 });
  try {
    const exfat = check(d, { volume: () => ({ root: true, format: 'exFAT', free: 2 ** 33 }) });
    assert.equal(exfat.ok, false);
    assert.match(exfat.problems.join(), /formatted exFAT, not FAT32/);
    for (const volume of [() => null, () => ({ root: true, format: '' })]) {
      const unknown = check(d, { volume });
      assert.equal(unknown.ok, false);
      assert.deepEqual(unknown.problems, []);
      assert.match(unknown.unsure.join(), /the stick's format/);
      assert.match(describeStick(unknown).join('\n'), /\? check by hand: the stick's format/);
    }
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('missing LG_DTV: at the top only; a zip still zipped, and too little room, are named', () => {
  const nested = stick({ 'firmware/LG_DTV/43UT7300_33.31.61.epk': 2000 });
  const zipped = stick({ '43UT7300_33.31.61.zip': 2000 });
  const empty = stick({ 'LG_DTV': 'dir' });
  try {
    assert.match(check(nested).problems.join(), /no folder LG_DTV at the top of the stick/);
    assert.match(check(zipped).problems.join(), /still zipped: unzip it/);
    const full = check(zipped, { volume: () => ({ root: true, format: 'FAT32', free: 2 ** 29 }) });
    assert.match(full.problems.join(), /only 0\.5 GB free/);
    assert.match(check(empty).problems.join(), /no firmware file \(\.epk\) in LG_DTV/);
    // the folder name is matched as FAT32 does, any case
    fs.renameSync(path.join(empty, 'LG_DTV'), path.join(empty, 'lg_dtv'));
    fs.writeFileSync(path.join(empty, 'lg_dtv', '43UT7300_33.31.61.epk'), Buffer.alloc(2000));
    assert.equal(check(empty).ok, true);
    // given as the LG_DTV folder itself, the stick is its parent
    assert.equal(check(path.join(empty, 'lg_dtv')).ok, true);
  } finally {
    for (const d of [nested, zipped, empty]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('two firmware files, or one cut short: not ready', () => {
  const two = stick({ 'LG_DTV/43UT7300_33.31.61.epk': 2000, 'LG_DTV/43UT8000_33.31.61.epk': 2000 });
  const short = stick({ 'LG_DTV/43UT7300_33.31.61.epk': 10 });
  try {
    const r = check(two);
    assert.equal(r.ok, false);
    assert.match(r.problems.join(), /2 firmware files in LG_DTV .*keep only the one for this TV/);
    assert.match(check(short).problems.join(), /the copy looks cut short/);
  } finally {
    for (const d of [two, short]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('wrong model, an older version, or a name that says neither', () => {
  const other = stick({ 'LG_DTV/OLED65C4PUA_33.31.61.epk': 2000 });
  const older = stick({ 'LG_DTV/43UT7300_33.20.05.epk': 2000 });
  const plain = stick({ 'LG_DTV/o24_firmware.epk': 2000 });
  try {
    const r = check(other);
    assert.equal(r.ok, false);
    assert.match(r.problems.join(), /names another model family \(OLEDC4\), not this TV's 43UT73006LA \(UT73\)/);
    assert.match(check(older).problems.join(), /version 33\.20\.05, older than the TV's 33\.31\.61/);
    const p = check(plain);
    assert.equal(p.ok, false);
    assert.deepEqual(p.problems, []);
    assert.match(p.unsure.join('\n'), /is the file LG's support page gives for 43UT73006LA/);
    assert.match(p.unsure.join('\n'), /version is 33\.31\.61 or newer/);
  } finally {
    for (const d of [other, older, plain]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('the drive: a letter is the top of a stick; this laptop\'s own drive, a folder below the top, or nothing there stop', () => {
  for (const s of ['E', 'e:', 'E:\\', 'E:/', 'E:\\LG_DTV', ' "E:" ']) assert.equal(stickRoot(s), 'E:\\', s);
  const sys = (process.env.SystemDrive || 'C:').slice(0, 1);
  assert.match(checkStick(sys, { volume: fat32 }).problems.join(), /this laptop's own drive/);
  assert.match(checkStick(path.resolve('dist', 'no-such-stick'), { volume: fat32 }).problems.join(), /nothing found at/);
  const d = stick({ 'LG_DTV/43UT7300_33.31.61.epk': 2000 });
  try {
    assert.match(check(d, { volume: () => ({ root: false }) }).problems.join(), /LG_DTV has to be at the top of the stick/);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('model families and versions from LG\'s names', () => {
  assert.equal(modelFamily('43UT73006LA'), 'UT73');
  assert.equal(modelFamily('OLED65C46LA'), 'OLEDC4');
  assert.equal(modelFamily('OLED77G45LW'), 'OLEDG4');
  assert.equal(modelFamily('65QNED86T6A'), 'QNED86');
  assert.equal(modelFamily('55NANO756QA'), 'NANO75');
  assert.equal(modelFamily(''), null);
  assert.deepEqual(familiesIn('LG_DTV_OLED65C4PUA_33.31.61.epk'), ['OLEDC4']);
  assert.deepEqual(familiesIn('webos_o24_33.31.61.epk'), []);
  assert.equal(versionIn('x_33.31.61.epk'), '33.31.61');
  assert.equal(versionIn('x_133.31.61.epk'), '');
  assert.equal(versionIn('x_33.31.61.2.epk'), '');
  assert.equal(compareVersions('33.31.61', '33.31.61'), 0);
  assert.equal(compareVersions('33.40.1', '33.31.61'), 1);
  assert.equal(compareVersions('33.20.99', '33.31.61'), -1);
});
