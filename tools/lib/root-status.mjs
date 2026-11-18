// "An LG update ended root" from the laptop (docs/root-plan.md, When an LG update ends root): `hometv-lg check` says
// plainly whether a TV this laptop rooted still is, and if not, what's wrong and the next step (the project lead's choice,
// 2026-11-18): Homebrew Channel in LG's app list (SSAP, works unrooted), then one read-only command over its SSH (who it
// logs in as, and the start-up hook's start note). A TV this laptop never rooted gets no root line at all.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { sq } from './root-shell.mjs';

const HBC = 'org.webosbrew.hbchannel';

/** The choices once root has ended, as root-plan.md gives them. */
export const ROOT_ENDED_CHOICES = [
  'Leave it: the TV works as LG made it, and HomeTV is an app on its tile.',
  'A factory reset to clean up (level 3, with the backup to hand), then HomeTV as a Developer Mode app (hometv-lg devmode).',
  'Root again, only if a tool exists for this TV\'s new software (check CanI.RootMy.TV first).'
];

/**
 * This laptop rooted this TV before: the root steps are done in install-state.json, or the root key is here, and this
 * address is in the TV host keys kept since then (lg-known-hosts, written by the first SSH login). So a second TV
 * checked from the same laptop isn't told its root "ended". A TV that changed address gets no root line (safe).
 */
export function rootedBefore(dir, host, keyFile = path.join(dir, 'lg-root-key')) {
  let steps = {};
  try { steps = JSON.parse(fs.readFileSync(path.join(dir, 'install-state.json'), 'utf8')).steps || {}; } catch { /* none */ }
  const done = (id) => !!(steps[id] && steps[id].status === 'done');
  return (done('root') || done('root-install') || fs.existsSync(keyFile)) && knownHost(path.join(dir, 'lg-known-hosts'), host);
}

/** `host` (port 22) has a line in an OpenSSH known_hosts file, plain or hashed (|1|salt|hash). */
export function knownHost(file, host) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return false; }
  return text.split(/\r?\n/).some((line) => {
    const first = line.trim().split(/\s+/)[0] || '';
    if (first.startsWith('#') || !first) return false;
    if (first.startsWith('|1|')) {
      const [, , salt, hash] = first.split('|');
      try {
        return crypto.createHmac('sha1', Buffer.from(salt, 'base64')).update(host).digest('base64') === hash;
      } catch { return false; }
    }
    return first.split(',').some((name) => name === host || name === '[' + host + ']:22');
  });
}

/**
 * SSH's failure in fixed words: never its own text, which names the TV's address (and, on a timeout, the key's path).
 * kind: 'off' (refused or no answer on port 22: Homebrew Channel's SSH Server isn't running, or root ended), 'route'
 * (this laptop can't reach that address at all), 'other'.
 */
function sshFailure(r) {
  const err = String(r.stderr || '');
  if (/Connection refused/i.test(err)) return { kind: 'off', why: 'SSH refuses the connection' };
  if (/timed out/i.test(err)) return { kind: 'off', why: 'SSH doesn\'t answer' };
  if (/Permission denied/i.test(err)) return { kind: 'other', why: 'SSH answers but the root key doesn\'t log in' };
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(err)) {
    return { kind: 'other', why: 'the TV\'s SSH key changed since root (a reset, or another TV at this address)' };
  }
  if (/No route to host|Network is unreachable|Could not resolve/i.test(err)) return { kind: 'route', why: 'this laptop can\'t reach the TV over SSH' };
  if (/Connection reset|Connection closed|closed by remote/i.test(err)) return { kind: 'other', why: 'SSH closed the connection' };
  return { kind: 'other', why: 'SSH failed (exit ' + r.code + ')' };
}

/** Where the start-up hook keeps its start note on the TV (root/lib.sh STARTED and BOOT_ID; TV_PATHS in install-steps). */
export const NOTE_PATHS = {
  dir: '/media/developer/hometv',
  initd: '/var/lib/webosbrew/init.d',
  bootId: '/proc/sys/kernel/random/boot_id'
};

/** One read-only command: who SSH logs in as, this start's id, the hook's note of the last start it ran at, its state. */
export function noteCommand(p = NOTE_PATHS) {
  const hook = sq(p.initd + '/10-hometv-home');
  return 'echo "uid=$(id -u)"; echo "boot=$(cat ' + sq(p.bootId) + ' 2>/dev/null)"; ' +
    'echo "noted=$(cat ' + sq(p.dir + '/started') + ' 2>/dev/null)"; ' +
    'if [ -e ' + hook + ' ] || [ -L ' + hook + ' ]; then echo hooked=1; fi; ' +
    'if [ -e ' + sq(p.dir + '/DISABLE') + ' ]; then echo chosen=1; fi';
}

const CANT_TELL_HBC = 'the TV\'s app list couldn\'t be read, so this can\'t tell whether root has ended or only the laptop ' +
  'can\'t log in';

/**
 * { state, why }: 'never' (this laptop didn't root it), 'rooted', 'ended', 'no-login' (Homebrew Channel is in the
 * TV's app list but its SSH refuses or doesn't answer), 'unreachable' (the TV answers neither LG's remote-control
 * connection nor SSH), or 'unknown' (can't tell; `why` says what it couldn't tell). `noteEnded`: ended because the
 * start-up hook's note holds an older start.
 * `tvAnswers`: LG's remote-control connection (SSAP, works unrooted) answered. `apps`: the TV's app ids read over it,
 * or null when that list couldn't be read.
 */
export async function rootStatus({ wasRooted, tvAnswers = true, apps, shell, paths = NOTE_PATHS }) {
  if (!wasRooted) return { state: 'never', why: '' };
  const hbc = tvAnswers && apps ? apps.includes(HBC) : null;
  if (hbc === false) return { state: 'ended', why: 'Homebrew Channel isn\'t in the TV\'s app list any more' };
  if (!shell) {
    if (!tvAnswers) return { state: 'unreachable', why: '' };
    return { state: 'unknown', why: 'no root key on this laptop' };
  }
  const r = await shell.run(noteCommand(paths));
  if (r.code === 0) {
    const v = {};
    for (const line of String(r.stdout).split(/\r?\n/)) {
      const m = line.trim().match(/^(\w+)=(.*)$/);
      if (m) v[m[1]] = m[2].trim();
    }
    if (v.uid !== '0') return { state: 'unknown', why: 'SSH logs in, but not as root' };
    // the TV's own notice reads it the same way (service.js rootStateOf, rootEdition.ts rootEnded): the hook is linked,
    // not set aside by "Use LG's Home", and its note holds an older start's id
    if (v.hooked && !v.chosen && v.boot && v.noted && v.noted !== v.boot) {
      return { state: 'ended', why: 'HomeTV\'s start note says its start-up hook didn\'t run at this start', noteEnded: true };
    }
    return { state: 'rooted', why: '' };
  }
  const f = sshFailure(r);
  if (!tvAnswers && f.kind !== 'other') return { state: 'unreachable', why: '' };
  if (f.kind === 'other') return { state: 'unknown', why: f.why };
  if (hbc === true) return { state: 'no-login', why: f.why };
  return { state: 'unknown', why: f.why + '; ' + CANT_TELL_HBC, hbcUnread: true };
}

export const GUIDE_AFTER_UPDATE = 'https://rebeccamcfadden.github.io/hometv-webos/root/#after-an-update';

/** What `hometv-lg check` prints; [] for a TV this laptop never rooted. */
export function describeRootStatus(s) {
  if (s.state === 'never') return [];
  if (s.state === 'rooted') return ['Root: still on (HomeTV\'s root edition can start as Home).'];
  if (s.state === 'unreachable') return ['Can\'t reach the TV. Check it\'s on and on the same Wi-Fi, then run this again.'];
  if (s.state === 'no-login') {
    return ['Root looks fine, but the laptop can\'t log in (' + s.why + '). On the TV, open Homebrew Channel > ' +
      'Settings, check SSH Server is on, then run this again.'];
  }
  if (s.state === 'unknown' && s.hbcUnread) {
    return ['Root: can\'t tell (' + s.why + ').', 'Look for Homebrew Channel in the TV\'s apps. There: open it > Settings, check SSH ' +
      'Server is on, then run this again. Gone: root has ended (' + GUIDE_AFTER_UPDATE + ').'];
  }
  if (s.state === 'unknown') return ['Root: can\'t tell (' + s.why + ').'];
  return [
    (s.noteEnded ? 'Root has ended (an update may have removed it). ' : 'Root has ended. ') + s.why + '. ' +
      'This is what an LG software update does. LG\'s Home is back at each start, HomeTV works as an app on its tile, ' +
      'and nothing is broken.',
    'Choices:',
    ...ROOT_ENDED_CHOICES.map((c, i) => '  ' + (i + 1) + '. ' + c),
    'More: ' + GUIDE_AFTER_UPDATE
  ];
}
