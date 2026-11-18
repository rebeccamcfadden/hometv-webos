// HomeTV's saved keys (the TMDB token, and the Watchmode and Movie of the Night keys if any) through root: "Clear the
// way" deletes HomeTV and the keys its key page saved (service/pages.js, hometv-keys-v1.json), so hometv-lg root reads
// them first over Developer Mode's SSH, keeps them on the laptop encrypted for the current Windows user (DPAPI), and
// after root writes them into the root edition's HomeTV over root SSH, has HomeTV's service read them, then deletes the
// laptop's copy. A key is never printed, logged or put on a command line: only its last 4 characters are shown.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { sq, luna } from './root-shell.mjs';
import { lockFile } from './sshkey.mjs';

/** As service/pages.js STORE_FILE and KEY_IDS. */
export const KEYS_FILE = 'hometv-keys-v1.json';
const IDS = ['tmdb', 'watchmode', 'motn'];
const NAMES = { tmdb: 'TMDB', watchmode: 'Watchmode', motn: 'Movie of the Night' };
/** The laptop's copy, in the HomeTV folder. */
export const KEPT_FILE = 'lg-keys-kept.dpapi';
const FORMAT = 'hometv-lg-kept-keys';
const MARK = '--hometv-keys--';
const UNREADABLE = '--hometv-keys-unreadable--';

/** Where Developer Mode's HomeTV keeps them (service/pages.js DATA_DIRS: the first it could write). */
export const DEVMODE_KEY_DIRS = ['/media/developer/.hometv-private', '/media/developer/apps/usr/palm/services/com.hometv.app.service/.private'];
/** Where the root edition's HomeTV keeps them: its service runs as root (root/10-hometv-home elevates it), so the first. */
export const ROOT_KEY_DIR = DEVMODE_KEY_DIRS[0];

/** The first 12 hex characters of a key's SHA-256, as service/pages.js fingerprints(): tells the same key without it. */
export const fingerprint = (key) => crypto.createHash('sha256').update(String(key), 'utf8').digest('hex').slice(0, 12);

/** "TMDB …abcd, Watchmode …wxyz": what may be shown of the keys. */
export function describeKeys(keys) {
  return IDS.filter((id) => keys[id]).map((id) => NAMES[id] + ' …' + keys[id].key.slice(-4)).join(', ');
}

/** The saved keys in a keys file's text: { tmdb: { key, state }, … } with only the ids that have a key; null when none. */
export function keysIn(text) {
  let o;
  try { o = JSON.parse(text); } catch { return null; }
  const out = {};
  for (const id of IDS) {
    const e = o && o.keys && o.keys[id];
    if (e && typeof e.key === 'string' && e.key) out[id] = { key: e.key, state: String(e.state || '') };
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Windows' DPAPI for the current user (System.Security.Cryptography.ProtectedData), through Windows PowerShell; the data
 * goes on standard input, never on the command line. Only that user on this laptop can open what it protects.
 */
export function windowsVault() {
  const run = (verb, buf) => {
    if (process.platform !== 'win32') throw new Error('the laptop\'s encryption (DPAPI) is Windows only');
    const script = 'Add-Type -AssemblyName System.Security; $b = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); ' +
      '[Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::' + verb + '($b, $null, \'CurrentUser\')))';
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { input: buf.toString('base64'), encoding: 'utf8', windowsHide: true, timeout: 60000 });
    if (r.status !== 0 || !r.stdout) throw new Error('Windows couldn\'t ' + (verb === 'Protect' ? 'encrypt' : 'open') + ' it (DPAPI)');
    return Buffer.from(r.stdout.trim(), 'base64');
  };
  return { protect: (buf) => run('Protect', buf), unprotect: (buf) => run('Unprotect', buf) };
}

/**
 * Reads the keys over a shell on the TV (Developer Mode's, or root's): { keys } or { keys: null, why } in plain words.
 * The file's text comes back only to be parsed here.
 */
export async function readKeys(shell, dirs) {
  const files = dirs.map((d) => sq(d + '/' + KEYS_FILE)).join(' ');
  const r = await shell.run('for f in ' + files + '; do if [ -r "$f" ]; then echo ' + MARK + '; cat "$f"; echo; ' +
    'elif [ -e "$f" ]; then echo ' + UNREADABLE + '; fi; done; true');
  const out = String(r.stdout || '');
  if (r.code !== 0) return { keys: null, why: 'the TV didn\'t answer the read' };
  for (const part of out.split(MARK).slice(1)) {
    const keys = keysIn(part.split(UNREADABLE)[0].trim());
    if (keys) return { keys };
  }
  if (out.includes(UNREADABLE)) return { keys: null, why: 'Developer Mode\'s account isn\'t allowed to read HomeTV\'s keys file' };
  return { keys: null, why: '', none: true };
}

/** Keeps the keys in the HomeTV folder, encrypted by `vault`; the file is locked to this user like the SSH key. */
export function keepKeys(dir, keys, vault) {
  const blob = vault.protect(Buffer.from(JSON.stringify({ format: FORMAT, keys }), 'utf8'));
  const file = path.join(dir, KEPT_FILE);
  fs.writeFileSync(file, blob, { mode: 0o600 });
  try { lockFile(file); } catch { /* the encryption is what keeps it */ }
  return file;
}

/** The laptop's copy: { keys }, { keys: null } when there's none, or { keys: null, why } when it can't be opened. */
export function keptKeys(dir, vault) {
  const file = path.join(dir, KEPT_FILE);
  if (!fs.existsSync(file)) return { keys: null };
  try {
    const o = JSON.parse(vault.unprotect(fs.readFileSync(file)).toString('utf8'));
    if (!o || o.format !== FORMAT) throw new Error('not the kept keys');
    const keys = keysIn(JSON.stringify({ keys: o.keys }));
    return keys ? { keys } : { keys: null, why: 'the copy holds no key' };
  } catch {
    return { keys: null, why: 'the copy opens only for the Windows user who kept it' };
  }
}

export function forgetKeys(dir) {
  fs.rmSync(path.join(dir, KEPT_FILE), { force: true });
}

/**
 * Writes `keys` into the root edition's keys file over root SSH, keeping what else is there (the phone code, other keys),
 * then asks HomeTV's service to read the file again (keysSaved) and compares fingerprints. '' when HomeTV reads them all,
 * else why not, in plain words.
 */
export async function putKeysBack(shell, keys, dir = ROOT_KEY_DIR, { tries = 3, waitMs = 3000 } = {}) {
  const file = dir + '/' + KEYS_FILE;
  const now = await shell.run('cat ' + sq(file) + ' 2>/dev/null; true');
  let data = {};
  try { data = JSON.parse(String(now.stdout || '')) || {}; } catch { data = {}; }
  const merged = { code: typeof data.code === 'string' ? data.code : '', keys: {} };
  for (const id of IDS) {
    const e = data.keys && data.keys[id];
    merged.keys[id] = keys[id] ? { key: keys[id].key, state: keys[id].state || 'ok' } :
      e && typeof e.key === 'string' ? { key: e.key, state: String(e.state || '') } : { key: '', state: '' };
  }
  const tmp = dir + '/.hometv-keys.tmp';
  const w = await shell.run('umask 077; mkdir -p ' + sq(dir) + ' && chmod 700 ' + sq(dir) + ' && cat > ' + sq(tmp) + ' && chmod 600 ' + sq(tmp) +
    ' && mv -f ' + sq(tmp) + ' ' + sq(file) + ' && echo keys-written', { input: Buffer.from(JSON.stringify(merged), 'utf8') });
  if (w.code !== 0 || !/keys-written/.test(String(w.stdout || ''))) return 'the keys file couldn\'t be written on the TV';
  let why = '';
  for (let i = 0; i < tries; i++) {
    if (i) await new Promise((r) => setTimeout(r, waitMs));
    const r = await luna(shell, 'com.hometv.app.service/keysSaved', {});
    if (r.returnValue !== true || !r.keys) {
      why = /no key page/.test(String(r.errorText || '')) ? 'the HomeTV on the TV has no key page (a v0 build)' : 'HomeTV\'s service didn\'t answer';
      continue;
    }
    const off = IDS.filter((id) => keys[id] && r.keys[id] !== fingerprint(keys[id].key));
    if (!off.length) return '';
    why = 'HomeTV reads another ' + off.map((id) => NAMES[id]).join(' and ') + ' key, or none';
  }
  return why;
}
