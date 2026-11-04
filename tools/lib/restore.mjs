// Putting the TV's settings back from a backup (tools/lib/backup.mjs; docs/backup.md). Always a dry run first: what
// the backup holds against what the TV has now. Then:
//   - with root: only keys present in the backup, only where they differ, through LG's settings service
//     (setSystemSettings), one category at a time, each read back; the first error stops it;
//   - without root: the menu steps for each setting that differs (a paired app can't write settings).
// Never a factory reset, never a key the backup doesn't hold.
import fs from 'node:fs';
import { FORMAT, VERSION, version, isReadOnlyCommand } from './backup.mjs';
import { luna } from './root-shell.mjs';

const SETTINGS_WRITE = /^luna-send -n 1 -w \d+ 'luna:\/\/com\.webos\.settingsservice\/setSystemSettings' '(?:[^']|'\\'')*'$/;

/** A shell for restore: the backup's read-only commands and LG's settings write, nothing else. */
export function guarded(shell) {
  return {
    run(cmd, o) {
      if (!isReadOnlyCommand(cmd) && !SETTINGS_WRITE.test(cmd)) throw new Error('refused, not a restore command: ' + cmd);
      return shell.run(cmd, o);
    }
  };
}

export function loadBackup(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!data || data.format !== FORMAT) throw new Error('not a HomeTV backup for LG');
  if (data.version !== VERSION) throw new Error('backup version ' + data.version + ' is not one this tool knows (' + VERSION + ')');
  return data;
}

/**
 * Categories the tool may write. Others (network, lock with its PIN, channels, LG's service menus) are listed as
 * "by hand" and their values are never shown: writing them could cut the TV off the network or lock it.
 */
export const RESTORE_CATEGORIES = ['picture', 'sound', 'option', 'general', 'time', 'caption', 'aiPicture', 'aiSound'];
/** Agreements and consents are the person's own choice in LG's screens, never set behind them. */
const BY_HAND_KEYS = /eula|agree|terms|policy|consent|privacy|password|pin$/i;

export function writable(category, key) {
  return RESTORE_CATEGORIES.includes(category) && !BY_HAND_KEYS.test(key);
}

/** What the backup holds, by category: the remote connection's keys, then root's whole categories over them. */
export function wanted(data) {
  const want = {};
  const s = data.ssap && data.ssap.settings;
  if (s) for (const [category, keys] of Object.entries(s)) {
    for (const [key, v] of Object.entries(keys)) if (v && v.ok) (want[category] ||= {})[key] = v.value;
  }
  const r = data.root && data.root.ok && data.root.settings;
  if (r) for (const [category, c] of Object.entries(r)) {
    if (c && c.ok) for (const [key, value] of Object.entries(c.values)) (want[category] ||= {})[key] = value;
  }
  return want;
}

const canon = (v) => (Array.isArray(v) ? v.map(canon)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

/** Reads the TV now through `read(category, keys)` -> { ok, values, error }, and compares. */
export async function plan(want, read) {
  const rows = [];
  const unread = [];
  for (const [category, keys] of Object.entries(want)) {
    const now = await read(category, Object.keys(keys));
    if (!now.ok) { unread.push({ category, error: now.error }); continue; }
    for (const [key, value] of Object.entries(keys)) {
      const known = Object.prototype.hasOwnProperty.call(now.values, key);
      rows.push({
        category, key, backup: value, now: known ? now.values[key] : undefined,
        state: !known ? 'unknown' : same(value, now.values[key]) ? 'same' : 'differs',
        writable: writable(category, key)
      });
    }
  }
  return { rows, unread };
}

/** Root: one call for the category, the backup's keys only. */
export function rootReader(shell) {
  return async (category, keys) => {
    const r = await luna(shell, 'com.webos.settingsservice/getSystemSettings', { category, keys });
    return r.returnValue === false || !r.settings ? { ok: false, error: r.errorText || 'not returned' } : { ok: true, values: r.settings };
  };
}

/** The remote connection: key by key, as the backup read them; a key the TV refuses is left out. */
export function ssapReader(tv) {
  return async (category, keys) => {
    const values = {};
    let any = false;
    let error = '';
    for (const key of keys) {
      const r = await tv.request('settings/getSystemSettings', { category, keys: [key] });
      if (r.returnValue !== false && r.settings && key in r.settings) { values[key] = r.settings[key]; any = true; } else error = r.errorText || 'not returned';
    }
    return any ? { ok: true, values } : { ok: false, error };
  };
}

// Where each setting is on the test TV's year (webOS 23-25, US English). LG moves things between years: medium
// confidence; docs/privacy.md has the paths for other years. Anything else: the settings search (2023+).
export const MENU = {
  'picture.pictureMode': 'Picture › Select Mode',
  'picture.backlight': 'Picture › Brightness › Screen Brightness (Backlight on older sets)',
  'picture.brightness': 'Picture › Brightness › Brightness',
  'picture.contrast': 'Picture › Brightness › Contrast',
  'picture.color': 'Picture › Color › Color Depth',
  'picture.sharpness': 'Picture › Clarity › Sharpness',
  'picture.colorTemperature': 'Picture › Color › Color Temperature',
  'picture.energySaving': 'General › Power and Energy Saving › Energy Saving Step',
  'sound.soundMode': 'Sound › Sound Mode',
  'sound.soundOutput': 'Sound › Sound Out',
  'option.country': 'General › System › Location › Broadcast Country',
  'option.localeInfo': 'General › System › Language',
  'option.audioGuidance': 'General › Accessibility › Audio Guidance',
  'option.quickStartMode': 'General › System › Additional Settings › Quick Start+',
  'general.homeAutoLaunch': 'General › System › Additional Settings › Home Settings › Home Auto Launch (2019-2022 name)',
  'general.powerOnScreen': 'General › System › Additional Settings › Home Settings › Power On Screen',
  'general.alwaysReady': 'General › Always Ready',
  'aiPicture.ai_Picture': 'General › AI Service › AI Picture Pro'
};

export function show(v) {
  const t = JSON.stringify(v);
  return t === undefined ? '(not set)' : t.length > 60 ? t.slice(0, 57) + '…' : t;
}

/** The plain lines for one row the person sets with the remote. Values only for categories the tool knows. */
export function menuStep(row) {
  const known = MENU[row.category + '.' + row.key];
  const where = known ? 'Settings › All Settings › ' + known : 'Search All Settings (the magnifier) for "' + row.key + '" (' + row.category + ')';
  if (!RESTORE_CATEGORIES.includes(row.category)) return where + ': set it as in the photos (value not shown: it may be private)';
  return where + ': set it to ' + show(row.backup) + ' (now ' + show(row.now) + ')';
}

/** The dry run's text. Values of categories outside RESTORE_CATEGORIES are never shown. */
export function describePlan({ rows, unread }, { root }) {
  const lines = [];
  const differs = rows.filter((r) => r.state === 'differs');
  const write = root ? differs.filter((r) => r.writable) : [];
  const hand = differs.filter((r) => !root || !r.writable);
  lines.push('Compared ' + rows.length + ' settings from the backup with the TV: ' + differs.length + ' differ.');
  if (write.length) {
    lines.push('', 'Would write (root, through LG\'s settings service, one category at a time):');
    for (const r of write) lines.push('  ' + r.category + ' › ' + r.key + ': ' + show(r.now) + ' -> ' + show(r.backup));
  }
  if (hand.length) {
    lines.push('', root ? 'To set by hand (the tool doesn\'t write these):' : 'To set by hand with the remote (without root the tool can\'t write settings):');
    for (const r of hand) lines.push('  ' + menuStep(r));
  }
  const unknown = rows.filter((r) => r.state === 'unknown');
  if (unknown.length) lines.push('', 'Not on this TV now (left alone): ' + unknown.length + ' (' + [...new Set(unknown.map((r) => r.category))].join(', ') + ').');
  if (unread.length) lines.push('', 'Could not read now: ' + unread.map((u) => u.category + ' (' + u.error + ')').join(', ') + '.');
  return lines;
}

/**
 * Root pre-checks: the shell is root, the TV is the backup's model. Returns { ok, error?, notes[] }. Notes (a
 * different software version, another input on screen) don't stop it; the typed confirmation covers them.
 */
export async function precheck(shell, data) {
  const id = await shell.run('id -u');
  if (id.code !== 0 || String(id.stdout).trim() !== '0') return { ok: false, error: 'the shell is not root', notes: [] };
  const sys = await luna(shell, 'com.webos.service.tv.systemproperty/getSystemInfo', { keys: ['modelName', 'sdkVersion'] });
  const model = sys.returnValue === false ? '' : String(sys.modelName || '');
  if (!data.tv || !data.tv.model) return { ok: false, error: 'the backup doesn\'t say which model it is from', notes: [] };
  if (!model) return { ok: false, error: 'could not read the TV\'s model (' + (sys.errorText || 'no answer') + ')', notes: [] };
  if (model !== data.tv.model) return { ok: false, error: 'this TV is a ' + model + ', the backup is from a ' + data.tv.model, notes: [] };
  const notes = [];
  const sw = version(await luna(shell, 'com.webos.service.update/getCurrentSWInformation', {}));
  if (data.tv.software && sw && sw !== data.tv.software) notes.push('The TV\'s software is ' + sw + ', the backup\'s ' + data.tv.software + ': some settings may have moved.');
  const fg = await luna(shell, 'com.webos.applicationManager/getForegroundAppInfo', {});
  const now = fg.returnValue === false ? '' : String(fg.appId || '');
  if (data.tv.foreground && now && now !== data.tv.foreground) {
    notes.push('Picture and sound settings are kept per input: the backup was taken with ' + data.tv.foreground + ' on screen, the TV now shows ' + now + '. Switch to it first for those to land on the same input.');
  }
  return { ok: true, notes };
}

/**
 * Writes the differing, writable rows: per category one setSystemSettings with those keys only, then reads them
 * back. Stops at the first error. Returns { ok, written: [category], error?, category? }.
 */
export async function apply(shell, rows, { log = () => {} } = {}) {
  const byCat = new Map();
  for (const r of rows) if (r.state === 'differs' && r.writable) {
    if (!byCat.has(r.category)) byCat.set(r.category, {});
    byCat.get(r.category)[r.key] = r.backup;
  }
  const written = [];
  const read = rootReader(shell);
  for (const [category, settings] of byCat) {
    log('Writing ' + category + ' (' + Object.keys(settings).length + ')…');
    const r = await luna(shell, 'com.webos.settingsservice/setSystemSettings', { category, settings });
    if (r.returnValue !== true) return { ok: false, written, category, error: r.errorText || 'the settings service refused' };
    const back = await read(category, Object.keys(settings));
    if (!back.ok) return { ok: false, written, category, error: 'could not read it back (' + back.error + ')' };
    const wrong = Object.keys(settings).filter((k) => !same(settings[k], back.values[k]));
    if (wrong.length) return { ok: false, written, category, error: 'read back different: ' + wrong.join(', ') };
    written.push(category);
  }
  return { ok: true, written };
}
