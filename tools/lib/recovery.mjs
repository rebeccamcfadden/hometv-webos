// The USB stick for LG's USB recovery (docs/root-plan.md, level 5; docs/recovery.md): reads a stick the person picked
// and says whether it is ready. Reads only: never writes to the stick, never downloads, never touches the TV.
// Ready means: FAT32, a folder LG_DTV at the top, exactly one firmware file (.epk) in it, whole, for this TV's model
// family and not older than the TV's software (LG's USB update takes the same version or newer only).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** LG's firmware files are a few hundred MB to about 2 GB; anything under this was cut short. */
export const MIN_FIRMWARE = 50 * 1024 * 1024;
/** Free space a stick needs before the firmware file is copied on. */
export const FREE_FOR_FIRMWARE = 2 * 1024 * 1024 * 1024;

const GB = (n) => (n / 1024 / 1024 / 1024).toFixed(1) + ' GB';

/**
 * An LG model name's family: the panel type and the series, without the screen size and the region letters, the part
 * firmware is shared across ("OLED65C46LA" → "OLEDC4", "43UT73006LA" → "UT73", "65QNED86T6A" → "QNED86"). null
 * when it doesn't look like one.
 */
export function modelFamily(model) {
  const s = String(model || '').toUpperCase().replace(/[\s-]/g, '');
  // OLED65C46LA: OLED, the size, a letter and one digit (the next digit is the region). 43UT73006LA, 65QNED86T6A:
  // the size, then letters and two digits.
  const m = /^OLED\d{2}([A-Z]{1,2}\d)/.exec(s);
  if (m) return 'OLED' + m[1];
  const o = /^\d{2}(QNED\d{2}|NANO\d{2}|[A-Z]{2,3}\d{2})/.exec(s);
  return o ? o[1] : null;
}

/** The model families a file name names, if any (LG's zip and file names sometimes carry the model, sometimes not). */
export function familiesIn(name) {
  const out = new Set();
  const re = /(?:^|[^A-Z0-9])(OLED\d{2}[A-Z]{1,2}\d[A-Z0-9]*|\d{2}(?:QNED|NANO|[A-Z]{2,3})\d{2}[A-Z0-9]*)/g;
  for (const m of String(name).toUpperCase().matchAll(re)) {
    const f = modelFamily(m[1]);
    if (f) out.add(f);
  }
  return [...out];
}

/** A firmware version in a file name ("..._33.31.61_..."), or ''. */
export function versionIn(name) {
  const m = /(?<![\d.])(\d{2}\.\d{2}\.\d{2})(?!\.?\d)/.exec(String(name));
  return m ? m[1] : '';
}

/** -1, 0 or 1, comparing "33.31.61"-like versions part by part. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** "E", "e:", "E:\", "E:\LG_DTV" → "E:\"; any other path stays a path (the tests' folders). */
export function stickRoot(where) {
  const s = String(where || '').trim().replace(/^"|"$/g, '');
  const d = /^([A-Za-z]):?(?:[\\/](?:LG_DTV[\\/]?)?)?$/i.exec(s);
  if (d) return d[1].toUpperCase() + ':\\';
  return path.basename(s).toUpperCase() === 'LG_DTV' ? path.dirname(s) : s;
}

/**
 * The drive's format and free space, from Windows (Get-Volume). null when it can't be read: then the format is
 * "can't tell", never assumed. `root` false when the folder isn't the top of a drive.
 */
export function readVolume(root) {
  const d = /^([A-Z]):\\$/.exec(root);
  if (!d) return { root: false };
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-Volume -DriveLetter ' + d[1] + ' | Select-Object FileSystemType,SizeRemaining,DriveType | ConvertTo-Json'],
    { encoding: 'utf8', timeout: 20000, windowsHide: true });
    const v = JSON.parse(out);
    return { root: true, format: String(v.FileSystemType || ''), free: Number(v.SizeRemaining), type: String(v.DriveType || '') };
  } catch {
    return null;
  }
}

/**
 * Checks the stick at `where` for this TV. Returns { ok, root, file, good: [...], problems: [...], unsure: [...] }:
 * ok only with no problem and nothing unsure. `unsure` holds what the check can't read and the person checks by hand.
 * opts: model (the TV's model name), software (its version, "33.31.61"); volume (root → readVolume's shape) and
 * minFirmware for the tests.
 */
export function checkStick(where, { model = '', software = '', volume = readVolume, minFirmware = MIN_FIRMWARE } = {}) {
  const root = stickRoot(where);
  const good = [];
  const problems = [];
  const unsure = [];
  const done = (file = '') => ({ ok: !problems.length && !unsure.length, root, file, good, problems, unsure });

  if (!root) { problems.push('no drive given'); return done(); }
  const sys = (process.env.SystemDrive || 'C:').toUpperCase() + '\\';
  if (root.toUpperCase() === sys) { problems.push(root + ' is this laptop\'s own drive, not a USB stick'); return done(); }
  let names;
  try {
    names = fs.readdirSync(root);
  } catch {
    problems.push('nothing found at ' + root + ' (is the stick in, and is that its letter in File Explorer?)');
    return done();
  }

  const vol = volume(root);
  if (vol && vol.root === false) {
    problems.push('LG_DTV has to be at the top of the stick: give the stick\'s drive letter, for example E');
    return done();
  }
  const format = vol && vol.format ? vol.format.toUpperCase() : '';
  if (format === 'FAT32') good.push('formatted FAT32');
  else if (format) problems.push('the stick is formatted ' + vol.format + ', not FAT32 (format it FAT32 in File Explorer: this erases it)');
  else unsure.push('the stick\'s format (File Explorer > the stick > Properties: File system should say FAT32)');

  const dirName = names.find((n) => n.toUpperCase() === 'LG_DTV' && fs.statSync(path.join(root, n)).isDirectory());
  if (!dirName) {
    const zip = names.find((n) => /\.zip$/i.test(n));
    problems.push('no folder LG_DTV at the top of the stick' + (zip ? ' (' + zip + ' is still zipped: unzip it, then copy its LG_DTV folder to the stick)' : ''));
    if (vol && Number.isFinite(vol.free) && vol.free < FREE_FOR_FIRMWARE) {
      problems.push('only ' + GB(vol.free) + ' free; LG\'s firmware file needs up to ' + GB(FREE_FOR_FIRMWARE));
    }
    return done();
  }
  good.push('a folder LG_DTV at the top');

  const inDir = fs.readdirSync(path.join(root, dirName)).filter((n) => fs.statSync(path.join(root, dirName, n)).isFile());
  const epk = inDir.filter((n) => /\.epk$/i.test(n));
  if (epk.length === 0) {
    const zip = inDir.find((n) => /\.zip$/i.test(n));
    problems.push('no firmware file (.epk) in LG_DTV' + (zip ? ' (' + zip + ' is still zipped: unzip it on the laptop first)' : ''));
    if (vol && Number.isFinite(vol.free) && vol.free < FREE_FOR_FIRMWARE) {
      problems.push('only ' + GB(vol.free) + ' free; LG\'s firmware file needs up to ' + GB(FREE_FOR_FIRMWARE));
    }
    return done();
  }
  if (epk.length > 1) {
    problems.push(epk.length + ' firmware files in LG_DTV (' + epk.join(', ') + '): keep only the one for this TV');
    return done();
  }
  const file = epk[0];
  const size = fs.statSync(path.join(root, dirName, file)).size;
  if (size < minFirmware) {
    problems.push(file + ' is only ' + Math.round(size / 1024 / 1024) + ' MB: the copy looks cut short (copy it again)');
    return done(file);
  }
  good.push('one firmware file: ' + file + ' (' + GB(size) + ')');

  const family = modelFamily(model);
  const named = familiesIn(file);
  if (named.length && family) {
    if (named.includes(family)) good.push('its name matches this TV\'s model family (' + family + ')');
    else problems.push(file + ' names another model family (' + named.join(', ') + '), not this TV\'s ' + model + ' (' + family + ')');
  } else {
    unsure.push('that ' + file + ' is the file LG\'s support page gives for ' + (model || 'this TV\'s model') + ' (its name doesn\'t say the model)');
  }

  const v = versionIn(file);
  if (v && software) {
    if (compareVersions(v, software) < 0) problems.push(file + ' is version ' + v + ', older than the TV\'s ' + software + ' (LG\'s USB update takes the same version or newer only)');
    else good.push('version ' + v + ', not older than the TV\'s ' + software);
  } else if (software) {
    unsure.push('that the file\'s version is ' + software + ' or newer (LG\'s support page lists it next to the download)');
  } else {
    unsure.push('that the file\'s version is at least the TV\'s (Settings > All Settings > Support > TV Information)');
  }
  return done(file);
}

/** Plain lines for the screen. */
export function describeStick(r) {
  return [
    ...r.good.map((s) => '✓ ' + s),
    ...r.problems.map((s) => '✗ ' + s),
    ...r.unsure.map((s) => '? check by hand: ' + s)
  ];
}
