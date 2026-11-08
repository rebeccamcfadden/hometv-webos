// "An LG update ended root" from the laptop (docs/root-plan.md, When an LG update ends root): `hometv-lg check` says
// plainly whether a TV this laptop rooted still is, with the choices when it isn't. Read-only: one `id -u` over
// Homebrew Channel's SSH, which only runs while root does. A TV this laptop never rooted gets no root line at all.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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
 * `ended` only for "nothing listens there": Homebrew Channel's SSH runs only while root does.
 */
function sshFailure(r) {
  const err = String(r.stderr || '');
  if (/Connection refused/i.test(err)) return { ended: true, why: 'Homebrew Channel\'s SSH refuses the connection; it only runs while root does' };
  if (/timed out/i.test(err)) return { ended: true, why: 'Homebrew Channel\'s SSH doesn\'t answer; it only runs while root does' };
  if (/Permission denied/i.test(err)) return { ended: false, why: 'SSH answers but the root key doesn\'t log in' };
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(err)) {
    return { ended: false, why: 'the TV\'s SSH key changed since root (a reset, or another TV at this address)' };
  }
  if (/No route to host|Network is unreachable|Could not resolve/i.test(err)) return { ended: false, why: 'this laptop can\'t reach the TV over SSH' };
  if (/Connection reset|Connection closed|closed by remote/i.test(err)) return { ended: false, why: 'SSH closed the connection' };
  return { ended: false, why: 'SSH failed (exit ' + r.code + ')' };
}
/**
 * { state, why }: 'never' (this laptop didn't root it), 'rooted', 'ended', or 'unknown' (can't tell; why says why).
 * `apps` are the TV's app ids, read over LG's remote-control connection just before, so the TV is known to be there
 * (null when that list couldn't be read).
 */
export async function rootStatus({ wasRooted, apps, shell }) {
  if (!wasRooted) return { state: 'never', why: '' };
  if (apps && !apps.includes(HBC)) return { state: 'ended', why: 'Homebrew Channel isn\'t on the TV any more' };
  if (!shell) return { state: 'unknown', why: 'no root key on this laptop' };
  const r = await shell.run('id -u');
  if (r.code === 0 && String(r.stdout).trim() === '0') return { state: 'rooted', why: '' };
  if (r.code === 0) return { state: 'unknown', why: 'SSH logs in, but not as root' };
  const f = sshFailure(r);
  return { state: f.ended ? 'ended' : 'unknown', why: f.why };
}

/** What `hometv-lg check` prints; [] for a TV this laptop never rooted. */
export function describeRootStatus(s) {
  if (s.state === 'never') return [];
  if (s.state === 'rooted') return ['Root: still on (HomeTV\'s root edition can start as Home).'];
  if (s.state === 'unknown') return ['Root: can\'t tell (' + s.why + ').'];
  return [
    'Root: ended (' + s.why + '). This is what an LG software update does. LG\'s Home is back at each start, HomeTV works ' +
      'as an app on its tile, and nothing is broken.',
    'Choices:',
    ...ROOT_ENDED_CHOICES.map((c, i) => '  ' + (i + 1) + '. ' + c),
    'More: docs/root-plan.md, When an LG update ends root.'
  ];
}
