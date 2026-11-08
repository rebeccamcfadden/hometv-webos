// "An LG update ended root" from the laptop (docs/root-plan.md, When an LG update ends root): `hometv-lg check` says
// plainly whether a TV this laptop rooted still is, with the choices when it isn't. Read-only: one `id -u` over
// Homebrew Channel's SSH, which only runs while root does. A TV this laptop never rooted gets no root line at all.
import fs from 'node:fs';
import path from 'node:path';

const HBC = 'org.webosbrew.hbchannel';

/** The choices once root has ended, as root-plan.md gives them. */
export const ROOT_ENDED_CHOICES = [
  'Leave it: the TV works as LG made it, and HomeTV is an app on its tile.',
  'A factory reset to clean up (level 3, with the backup to hand), then HomeTV as a Developer Mode app (hometv-lg devmode).',
  'Root again, only if a tool exists for this TV\'s new software (check CanI.RootMy.TV first).'
];

/** This laptop rooted a TV before: the root steps are done in install-state.json, or the root key is here. */
export function rootedBefore(dir, keyFile = path.join(dir, 'lg-root-key')) {
  let steps = {};
  try { steps = JSON.parse(fs.readFileSync(path.join(dir, 'install-state.json'), 'utf8')).steps || {}; } catch { /* none */ }
  const done = (id) => !!(steps[id] && steps[id].status === 'done');
  return done('root') || done('root-install') || fs.existsSync(keyFile);
}

/** SSH's own words for "nothing listens there" (no root), against "something answered but won't let us in". */
const NOT_THERE = /Connection refused|timed out|No route to host|Connection reset|Connection closed|closed by remote/i;

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
  const err = String(r.stderr || '');
  if (NOT_THERE.test(err)) return { state: 'ended', why: 'Homebrew Channel\'s SSH doesn\'t answer, and it only runs while root does' };
  if (/Permission denied/i.test(err)) return { state: 'unknown', why: 'SSH answers but the root key doesn\'t log in' };
  return { state: 'unknown', why: (err.trim().split('\n').pop() || 'no answer').slice(0, 120) };
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
