// The settings backup, taken before anything changes on the TV (docs/backup.md). Two parts:
//   1. Over LG's remote-control connection (SSAP), with the fewest permissions: the settings a paired app may read,
//      the app list, the inputs and the software version. Every read says which permission it falls under and
//      whether the TV answered, so the TV shows what it allowed.
//   2. With root (a shell on a rooted TV, tools/lib/root-shell.mjs), read only: whole settings categories through
//      LG's settings service, the settings service's and the app manager's database records, and a copy of Luna's
//      preferences folder. Nothing is written on the TV: every command is checked against a read-only list first.
// Saved on the laptop only, outside any report. A backup may hold identifiers (network names, the TV's name, a
// parental PIN): it is never printed and never sent anywhere.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PERMISSIONS } from './ssap.mjs';
import { luna } from './root-shell.mjs';

export const FORMAT = 'hometv-lg-backup';
export const VERSION = 1;

export const WARNING = 'The backup stays on this laptop. It may hold identifiers (the TV\'s name, network names, a ' +
  'parental PIN): keep it, don\'t send or share it.';

// Settings the TV lets a paired app read. Each key is asked for alone, so one the TV doesn't know doesn't hide the
// others; what fails is recorded as such. The list is a start, to be confirmed on the test TV.
export const BACKUP_SETTINGS = [
  { category: 'picture', keys: ['pictureMode', 'backlight', 'brightness', 'contrast', 'color', 'sharpness', 'colorTemperature', 'energySaving'] },
  { category: 'sound', keys: ['soundMode', 'soundOutput'] },
  { category: 'option', keys: ['country', 'localeInfo', 'audioGuidance', 'quickStartMode'] },
  { category: 'general', keys: ['homeAutoLaunch', 'powerOnScreen', 'alwaysReady'] },
  { category: 'aiPicture', keys: ['ai_Picture'] }
];

export async function readSettings(tv, list = BACKUP_SETTINGS) {
  const out = {};
  for (const { category, keys } of list) {
    out[category] = {};
    for (const key of keys) {
      const r = await tv.request('settings/getSystemSettings', { category, keys: [key] });
      out[category][key] = r.returnValue === false || !r.settings || !(key in r.settings)
        ? { ok: false, error: r.errorText || 'not returned' }
        : { ok: true, value: r.settings[key] };
    }
  }
  return out;
}

// LG doesn't publish which permission each call needs. These are our reading of the names in the pairing manifest
// (Home Assistant's aiowebostv); getSystemInfo answers even before pairing there. The TV's answers are the proof.
export const SSAP_READS = [
  { what: 'software', uri: 'com.webos.service.update/getCurrentSWInformation', permission: 'READ_UPDATE_INFO' },
  { what: 'system', uri: 'system/getSystemInfo', permission: 'none (answered before pairing)' },
  { what: 'apps', uri: 'com.webos.applicationManager/listLaunchPoints', permission: 'READ_INSTALLED_APPS' },
  { what: 'foreground', uri: 'com.webos.applicationManager/getForegroundAppInfo', permission: 'READ_RUNNING_APPS' },
  { what: 'inputs', uri: 'tv/getExternalInputList', permission: 'READ_INPUT_DEVICE_LIST' },
  { what: 'soundOutput', uri: 'com.webos.service.apiadapter/audio/getSoundOutput', permission: 'READ_SETTINGS' }
];
const SETTINGS_PERMISSION = 'READ_SETTINGS';

// Not needed to put settings back, so dropped even from the laptop's copy.
const PRIVATE = /serial|device_?id|^mac|mac$|^ip|address|uuid|email|ssid|token|icon|image|password|^pin$/i;

function strip(v) {
  if (Array.isArray(v)) return v.map(strip);
  if (!v || typeof v !== 'object') return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) if (!PRIVATE.test(k)) out[k] = strip(x);
  return out;
}

const APP_KEYS = ['id', 'launchPointId', 'title', 'lptype', 'removable', 'systemApp', 'visible'];
function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
}

async function readSsap(tv, settingsList) {
  const out = { permissionsAsked: PERMISSIONS.slice(), reads: [] };
  for (const r of SSAP_READS) {
    const p = await tv.request(r.uri);
    const ok = p.returnValue !== false;
    out.reads.push({ what: r.what, uri: r.uri, permission: r.permission, ok, ...(ok ? {} : { error: p.errorText || 'error' }) });
    if (!ok) continue;
    const { returnValue, ...rest } = p;
    if (r.what === 'apps') out.apps = Array.isArray(p.launchPoints) ? p.launchPoints.map((a) => pick(a, APP_KEYS)) : [];
    else if (r.what === 'inputs') out.inputs = Array.isArray(p.devices) ? strip(p.devices) : [];
    else if (r.what === 'foreground') out.foreground = String(p.appId || '');
    else out[r.what] = strip(rest);
  }
  out.settings = await readSettings(tv, settingsList);
  for (const [category, keys] of Object.entries(out.settings)) {
    for (const [key, v] of Object.entries(keys)) {
      out.reads.push({ what: 'setting', uri: 'settings/getSystemSettings', category, key, permission: SETTINGS_PERMISSION, ok: v.ok, ...(v.ok ? {} : { error: v.error }) });
    }
  }
  return out;
}

// --- With root: read only -------------------------------------------------------------------------------------

/** Settings categories asked for whole, besides any found in the settings database. */
export const ROOT_CATEGORIES = ['picture', 'sound', 'option', 'general', 'time', 'network', 'caption', 'lock', 'aiPicture', 'aiSound', 'channel', 'other'];
/**
 * Database kinds copied, as webOS Open Source Edition names them (settingsservice's SettingsService.h, sam's DB8.cpp);
 * LG's own names may differ: a kind the TV doesn't know is recorded as such.
 */
export const DB8_KINDS = ['com.webos.settings.system:1', 'com.webos.applicationManager.launchpoints:2', 'com.webos.applicationManager.launchpoints:1'];
const DB8_SERVICES = ['com.webos.service.db', 'com.palm.db'];
/** Small state files: Developer Mode's flag, Homebrew Channel's switches, the app at power-on (docs/root-plan.md). */
export const PREF_DIRS = ['var/luna/preferences'];

const LUNA_READS = [
  'com.webos.settingsservice/getSystemSettings',
  'com.webos.service.tv.systemproperty/getSystemInfo',
  'com.webos.service.update/getCurrentSWInformation',
  'com.webos.applicationManager/getForegroundAppInfo',
  ...DB8_SERVICES.map((s) => s + '/find')
];
const SAFE_WORD = /^'(?:[^']|'\\'')*'$/;

/** True for the only commands a backup may run: `id -u`, read-only Luna calls, and tar to the laptop. */
export function isReadOnlyCommand(cmd) {
  if (cmd === 'id -u') return true;
  if (cmd === 'tar -cf - -C / ' + PREF_DIRS.join(' ') + ' 2>/dev/null') return true;
  const m = /^luna-send -n 1 -w \d+ '(luna:\/\/[^']+)' ('.*')$/.exec(cmd);
  return !!(m && LUNA_READS.includes(m[1].replace('luna://', '')) && SAFE_WORD.test(m[2]));
}

/** A shell that refuses anything outside the read-only list. */
export function readOnly(shell) {
  return {
    run(cmd, o) {
      if (!isReadOnlyCommand(cmd)) throw new Error('refused, not a read-only command: ' + cmd);
      return shell.run(cmd, o);
    }
  };
}

async function db8Find(shell, kind) {
  let lastError = '';
  for (const service of DB8_SERVICES) {
    const results = [];
    let page;
    let ok = true;
    for (let i = 0; i < 50; i++) {
      const r = await luna(shell, service + '/find', { query: { from: kind, limit: 500, ...(page ? { page } : {}) } });
      if (r.returnValue === false || !Array.isArray(r.results)) { ok = false; lastError = r.errorText || 'no results'; break; }
      results.push(...r.results);
      if (!r.next) break;
      page = r.next;
    }
    if (ok) return { ok: true, service, results };
  }
  return { ok: false, error: lastError };
}

async function readRoot(shell) {
  const ro = readOnly(shell);
  const id = await ro.run('id -u');
  if (id.code !== 0 || String(id.stdout).trim() !== '0') return { ok: false, error: 'the shell is not root' };
  const out = { ok: true, db8: {}, settings: {} };

  const sys = await luna(ro, 'com.webos.service.tv.systemproperty/getSystemInfo', { keys: ['modelName', 'sdkVersion'] });
  if (sys.returnValue !== false) out.system = pick(sys, ['modelName', 'sdkVersion']);
  const sw = await luna(ro, 'com.webos.service.update/getCurrentSWInformation', {});
  if (sw.returnValue !== false) out.software = pick(sw, ['product_name', 'model_name', 'major_ver', 'minor_ver']);
  const fg = await luna(ro, 'com.webos.applicationManager/getForegroundAppInfo', {});
  if (fg.returnValue !== false) out.foreground = String(fg.appId || '');

  for (const kind of DB8_KINDS) out.db8[kind] = await db8Find(ro, kind);

  // Every category the settings database holds (its records' category is "name" or "name$dimension"), plus the list.
  const found = new Set(ROOT_CATEGORIES);
  const settingsDb = out.db8[DB8_KINDS[0]];
  if (settingsDb.ok) for (const r of settingsDb.results) if (typeof r.category === 'string' && r.category) found.add(r.category.split('$')[0]);
  for (const category of found) {
    const r = await luna(ro, 'com.webos.settingsservice/getSystemSettings', { category });
    out.settings[category] = r.returnValue === false || !r.settings || typeof r.settings !== 'object'
      ? { ok: false, error: r.errorText || 'not returned' }
      : { ok: true, values: r.settings };
  }

  const tar = await ro.run('tar -cf - -C / ' + PREF_DIRS.join(' ') + ' 2>/dev/null', { binary: true });
  const buf = Buffer.isBuffer(tar.stdout) ? tar.stdout : Buffer.from(String(tar.stdout || ''), 'binary');
  out.files = buf.length > 0
    ? { ok: true, paths: PREF_DIRS.map((p) => '/' + p), bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), data: buf }
    : { ok: false, paths: PREF_DIRS.map((p) => '/' + p), error: (String(tar.stderr || '').trim() || 'empty') + ' (exit ' + tar.code + ')' };
  return out;
}

/**
 * Takes the backup and saves it in `dir` (created if needed). `tv` is an open SSAP connection (or null with a shell
 * only); `opts.shell` a root shell (optional); `opts.settings` the SSAP settings list. Returns the file names, the
 * data, and a summary that holds no values (safe to print).
 */
export async function backup(tv, dir, opts = {}) {
  const at = (opts.now || new Date()).toISOString();
  const data = { format: FORMAT, version: VERSION, at, warning: WARNING, tv: {}, ssap: null, root: null };
  if (tv) data.ssap = await readSsap(tv, opts.settings || BACKUP_SETTINGS);
  let tarData = null;
  if (opts.shell) {
    data.root = await readRoot(opts.shell);
    if (data.root.files && data.root.files.data) { tarData = data.root.files.data; delete data.root.files.data; }
  }

  const s = data.ssap || {};
  const r = data.root || {};
  data.tv = {
    model: (s.system && s.system.modelName) || (r.system && r.system.modelName) || '',
    software: version(s.software) || version(r.software),
    webos: (s.software && s.software.product_name) || (r.system && r.system.sdkVersion) || '',
    // Picture and sound settings are kept per input: the app on screen says which one this backup holds.
    foreground: s.foreground || r.foreground || ''
  };

  fs.mkdirSync(dir, { recursive: true });
  const base = 'lg-backup-' + at.slice(0, 19).replace(/[:T]/g, '-');
  let tarFile = null;
  if (tarData) {
    tarFile = path.join(dir, base + '-files.tar');
    fs.writeFileSync(tarFile, tarData, { mode: 0o600 });
    data.root.files.tar = path.basename(tarFile);
  }
  const file = path.join(dir, base + '.json');
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
  return { file, tarFile, data, summary: summarize(data) };
}

export function version(sw) {
  return sw && sw.major_ver ? sw.major_ver + '.' + sw.minor_ver : '';
}

/** Counts only: what was read and refused. Never values. */
export function summarize(data) {
  const sum = { settingsRead: 0, settingsRefused: 0, refused: [], apps: 0, inputs: 0, root: null };
  if (data.ssap) {
    for (const r of data.ssap.reads) {
      if (r.what === 'setting') { if (r.ok) sum.settingsRead++; else sum.settingsRefused++; }
      else if (!r.ok) sum.refused.push(r.what + ' (' + r.permission + ')');
    }
    sum.apps = (data.ssap.apps || []).length;
    sum.inputs = (data.ssap.inputs || []).length;
  }
  if (data.root) {
    const cats = Object.values(data.root.settings || {});
    sum.root = data.root.ok ? {
      categories: cats.filter((c) => c.ok).length,
      categoriesRefused: cats.filter((c) => !c.ok).length,
      db8: Object.entries(data.root.db8 || {}).filter(([, v]) => v.ok).map(([k, v]) => k + ': ' + v.results.length),
      files: data.root.files && data.root.files.ok ? data.root.files.bytes : 0
    } : { error: data.root.error };
  }
  return sum;
}

/** Plain lines for the screen, from the summary. */
export function describe(sum) {
  const lines = [];
  lines.push('Settings read over the remote connection: ' + sum.settingsRead + (sum.settingsRefused ? ' (' + sum.settingsRefused + ' refused or unknown; photograph those)' : '') +
    '; apps ' + sum.apps + '; inputs ' + sum.inputs + '.');
  if (sum.refused.length) lines.push('The TV refused: ' + sum.refused.join(', ') + '.');
  if (sum.root) {
    lines.push(sum.root.error ? 'Root backup not taken: ' + sum.root.error + '.'
      : 'With root: ' + sum.root.categories + ' settings categories' + (sum.root.categoriesRefused ? ' (' + sum.root.categoriesRefused + ' refused)' : '') +
        '; database records ' + (sum.root.db8.join(', ') || 'none') + '; preferences copy ' + (sum.root.files ? sum.root.files + ' bytes' : 'not taken') + '.');
  }
  return lines;
}
