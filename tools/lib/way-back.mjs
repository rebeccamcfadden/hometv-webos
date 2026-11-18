// The light ways back from the laptop (docs/root-plan.md, "The way back"), over the SSH key the root install left:
//   hometv-lg root <tv address> --home-again   HomeTV as Home again after "Use LG's Home" (level 1 undone): install.sh
//                                              links the start-up hooks again and removes DISABLE; restart; checked
//   hometv-lg unroot-home <tv address>         level 2: root/uninstall.sh (LG's Home back, HomeTV's hooks and folder
//                                              gone; the HomeTV app and Homebrew Channel stay); restart; the laptop
//                                              checks LG's Home is back and Homebrew Channel still opens
// Each says what it does and how it's undone before it changes anything, checks first and stops at the first failed
// check. Nothing it prints holds the TV's address. The full unroot is level 3, a factory reset.
import { sshShell, isRoot, sq } from './root-shell.mjs';
import { keyPaths } from './sshkey.mjs';
import { TV_PATHS, WAY_BACK, RESTART, withTv, foreground, appIds, scrub, homeCameUp, rollBack, runInstallSh } from './install-steps.mjs';

const HOME = 'com.webos.app.home';
const HBC = 'org.webosbrew.hbchannel';
const KEY_FILE = '%USERPROFILE%\\HomeTV\\lg-root-key';
const yes = (a) => /^\s*y/i.test(a || '');
const stop = (why, next) => ({ stop: why, next });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A root shell over SSH with the laptop's key, or a stop. */
async function rootShellFor(ctx) {
  const { key, knownHosts } = keyPaths(ctx.dir);
  const shell = (ctx.rootShell || sshShell)({ host: ctx.host, port: ctx.sshPort || 22, key, knownHosts });
  if (!(await isRoot(shell))) {
    return { stopped: stop('The laptop\'s key doesn\'t log in to the TV as root over SSH.',
      'Is the TV on, on this Wi-Fi, and rooted with HomeTV\'s root install from this laptop (its key: ' + KEY_FILE + ')? ' +
      'Check that Windows\' OpenSSH client is installed (Settings > System > Optional features). Without SSH, use the ' +
      'TV: Settings > Use LG\'s Home in HomeTV, or level 3 (docs/root-plan.md).') };
  }
  return { shell };
}

const P = (ctx) => ({ ...TV_PATHS, ...ctx.tvPaths });
const test = async (shell, cond) => (await shell.run('if ' + cond + '; then echo yes; else echo no; fi')).stdout.trim() === 'yes';

/** What the TV holds of the root edition: root/ there, its hook linked, "Use LG's Home" chosen, HomeTV installed. */
export async function rootState(shell, p) {
  return {
    edition: await test(shell, '[ -f ' + sq(p.dir + '/install.sh') + ' ]'),
    hooked: await test(shell, '[ -e ' + sq(p.initd + '/10-hometv-home') + ' ] || [ -L ' + sq(p.initd + '/10-hometv-home') + ' ]'),
    chosen: await test(shell, '[ -e ' + sq(p.dir + '/DISABLE') + ' ]'),
    // the start-up hook left LG's Home after the software changed to one not in compat.json
    compatStopped: await test(shell, '[ -e ' + sq(p.dir + '/compat-stopped') + ' ]'),
    app: await test(shell, '[ -f ' + sq(p.app + '/index.html') + ' ]')
  };
}

/** The restart, then Home on screen (one press of Home asked for if it isn't). Returns the app on screen. */
async function restartToHome(ctx) {
  ctx.say('  Restart the TV: ' + RESTART + '.');
  await ctx.ask('  Press Enter once the TV is back on: ');
  let fg = await withTv(ctx, foreground);
  if (fg !== HOME) {
    await ctx.ask('  Press Home on the remote, then Enter here: ');
    fg = await withTv(ctx, foreground);
  }
  return fg;
}

/** Level 1 undone: HomeTV as Home again after "Use LG's Home". */
export async function homeAgain(ctx) {
  ctx.say('HomeTV as Home again (undoes "Use LG\'s Home", docs/root-plan.md level 1)');
  const { shell, stopped } = await rootShellFor(ctx);
  if (stopped) return stopped;
  const p = P(ctx);
  const s = await rootState(shell, p);
  if (!s.edition) {
    return stop('HomeTV\'s root edition isn\'t on the TV (hometv-lg unroot-home removes it).',
      'To put it back: hometv-lg root <tv address> --from root-install (needs HomeTV in Homebrew Channel or its .ipk here).');
  }
  if (!s.app) {
    return stop('HomeTV isn\'t installed on the TV (uninstalled in Homebrew Channel?).',
      'Install HomeTV from Homebrew Channel, or run hometv-lg root <tv address> --from root-install with its .ipk here, then this again.');
  }
  if (s.hooked && !s.chosen && !s.compatStopped && !ctx.watch) {
    ctx.say('  ✓ HomeTV is already Home from each start: nothing to do. (Not on screen? Restart the TV: ' + RESTART + '.)');
    return { done: true, note: 'already Home' };
  }
  if (s.hooked && !s.chosen && !s.compatStopped) {
    ctx.say('  HomeTV is already Home from each start: nothing to change; the restart and the watch follow.');
  } else {
    const r0 = await enableAgain(ctx, shell, p, s);
    if (r0) return r0;
  }
  const fg0 = await restartToHome(ctx);
  // --watch: what the heartbeat and the boot notes say, for up to 3 minutes, before deciding (call #2)
  if (ctx.watch) await watchHome(ctx, shell, p);
  const fg = ctx.watch ? await withTv(ctx, foreground) : fg0;
  // as the install's restart check: a takeover that didn't come up is rolled back (hooks out, LG's Home back)
  if (fg !== HOME) return rollBack(ctx, 'no Home on screen after the restart', shell);
  if (!yes(await ctx.ask('  Is it HomeTV on screen (not LG\'s own Home)? [y/N] '))) return rollBack(ctx, 'you saw LG\'s own Home', shell);
  const why = await homeCameUp(shell, p, ctx.verifyWaitMs, { say: ctx.say, host: ctx.host, firstBeatMs: ctx.watch ? 0 : ctx.firstBeatMs });
  if (why) return rollBack(ctx, why, shell);
  ctx.say('  ✓ HomeTV is Home again');
  return { done: true, note: 'HomeTV is Home again' };
}

/** install.sh again: the hooks linked, DISABLE gone. Returns a stop, or null when done. */
async function enableAgain(ctx, shell, p, s) {
  if (s.compatStopped) ctx.say('  HomeTV stepped back at the last start: the TV\'s software changed to one not in root/compat.json.');
  ctx.say('  This runs install.sh on the TV again: HomeTV\'s two start-up hooks linked again, the "Use LG\'s Home" mark ' +
    'removed. HomeTV becomes Home at the next restart.\n' +
    '  Undo: Settings > Use LG\'s Home in HomeTV, or ssh -i ' + KEY_FILE + ' root@<tv ip> sh ' + p.dir + '/undo-home.sh');
  if (!yes(await ctx.ask('  Make HomeTV the TV\'s Home again? [y/N] '))) return { stop: 'Not asked to; nothing changed.', next: 'Run this again when you want HomeTV as Home.' };
  const r = await runInstallSh(ctx, (c) => shell.run(c), p.dir);
  const after = await rootState(shell, p);
  if (r.code !== 0 || !after.hooked || after.chosen) {
    const why = (r.out.match(/install: .*/g) || ['no reason given']).pop();
    return stop('install.sh didn\'t put HomeTV back: ' + scrub(why, ctx.host), 'LG\'s Home stays. Fix what it says, then run this again.');
  }
  ctx.say('  ✓ the start-up hooks are back; HomeTV becomes Home at the next restart');
  return null;
}

/** The boot notes --watch shows: the start-up hook's, the heartbeat's, the service's, the watchdog's and the roll back's. */
const WATCH_NOTES = 'home: |after-sam: |service: |heartbeat: |watchdog: |undo-home: |elevate';

/**
 * --watch: every `ctx.watchEveryMs` (15 s) for up to `ctx.watchMs` (3 minutes) after the restart, one line on what the TV
 * says (HomeTV mounted, the heartbeat's age, the app on screen) and the boot log's new notes, masked. Changes nothing;
 * stops early once the heartbeat is fresh twice running, or HomeTV is no longer mounted (the watchdog gave LG's Home back).
 */
export async function watchHome(ctx, shell, p) {
  const total = ctx.watchMs !== undefined ? ctx.watchMs : 180000;
  const every = ctx.watchEveryMs !== undefined ? ctx.watchEveryMs : 15000;
  const age = 'var s;try{s=require("fs").statSync(process.argv[1])}catch(e){}console.log(s?"age "+Math.round((Date.now()-s.mtime.getTime())/1000):"age none")';
  const cmd = 'grep -q ' + sq(' ' + p.home + ' ') + ' ' + sq(p.mounts) + ' && echo mounted; node -e ' + sq(age) + ' ' + sq(p.alive) + ' 2>/dev/null; ' +
    'luna-send -n 1 -w 5000 -f luna://com.webos.applicationManager/getForegroundAppInfo \'{}\' 2>/dev/null | sed -n \'s/.*"appId": *"\\([^"]*\\)".*/fg \\1/p\' | head -n 1; ' +
    'echo ---; grep -E ' + sq(WATCH_NOTES) + ' ' + sq(p.log) + ' 2>/dev/null | tail -n 60; true';
  ctx.say('  Watching HomeTV for up to ' + Math.round(total / 60000 * 10) / 10 + ' minutes (nothing is changed while it watches):');
  const t0 = Date.now();
  const seen = new Set();
  let fresh = 0;
  for (let n = 0; ; n++) {
    const out = String((await shell.run(cmd)).stdout || '');
    const [head, notes = ''] = out.split('---');
    const mounted = /mounted/.test(head);
    const a = (head.match(/age (\d+|none)/) || [])[1];
    const fg = (head.match(/fg (\S+)/) || [])[1] || 'unknown';
    const secs = Math.round((Date.now() - t0) / 1000);
    const clock = Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
    ctx.say('    ' + clock + '  ' + (mounted ? 'HomeTV mounted' : 'HomeTV not mounted') + ', heartbeat ' +
      (a === undefined || a === 'none' ? 'never' : a + ' s ago') + ', on screen: ' + scrub(fg, ctx.host));
    for (const l of notes.split('\n').map((x) => x.trim()).filter(Boolean)) {
      if (seen.has(l)) continue;
      seen.add(l);
      ctx.say('      ' + scrub(l, ctx.host));
    }
    fresh = a !== undefined && a !== 'none' && Number(a) < 30 ? fresh + 1 : 0;
    if (fresh >= 2) {
      ctx.say('  ✓ HomeTV\'s page answers');
      return 'answers';
    }
    if (!mounted && n > 0) {
      ctx.say('  HomeTV isn\'t mounted over LG\'s Home any more (the watchdog may have given LG\'s Home back)');
      return 'unmounted';
    }
    if (Date.now() - t0 + every > total) return 'timed out';
    await sleep(every);
  }
}

/** Level 2: HomeTV's root edition removed; LG's Home back; Homebrew Channel checked. */
export async function unrootHome(ctx) {
  ctx.say('Remove HomeTV\'s root edition (docs/root-plan.md level 2)');
  const { shell, stopped } = await rootShellFor(ctx);
  if (stopped) return stopped;
  const p = P(ctx);
  const s = await rootState(shell, p);
  ctx.say('  This runs uninstall.sh on the TV: LG\'s Home back now, HomeTV\'s start-up hooks and its folder (' + p.dir + ') ' +
    'deleted. The HomeTV app and Homebrew Channel stay; root stays.\n' +
    '  Undo: hometv-lg root <tv address> --from root-install puts it back.\n' +
    '  This isn\'t the full unroot: that is level 3, LG\'s Reset to Initial Settings (a factory reset).');
  if (!yes(await ctx.ask('  Remove HomeTV\'s root edition from the TV? [y/N] '))) return { stop: 'Not asked to; nothing changed.', next: 'Run this again when you want it removed.' };
  if (s.edition) {
    const r = await shell.run('sh ' + sq(p.dir + '/uninstall.sh') + ' 2>&1');
    if (r.code !== 0) ctx.say('  uninstall.sh: ' + scrub(String(r.stdout).trim().split('\n').pop() || 'exit ' + r.code, ctx.host));
  } else {
    ctx.say('  HomeTV\'s folder is already gone; removing any start-up hook left behind');
  }
  // the hooks left behind when HomeTV's folder went another way (they're HomeTV's own two names)
  await shell.run('rm -f ' + sq(p.initd + '/10-hometv-home') + ' ' + sq(p.initd + '/15-hometv-debloat'));
  const after = await rootState(shell, p);
  const left = await test(shell, '[ -e ' + sq(p.dir) + ' ] || [ -e ' + sq(p.initd + '/15-hometv-debloat') + ' ]');
  if (after.hooked || after.edition || left) {
    return stop('HomeTV\'s start-up hooks or folder are still on the TV.',
      'If uninstall.sh said LG\'s Home isn\'t back yet (HomeTV\'s mount busy), the folder is kept on purpose: restart the TV (' +
      RESTART + '), then run this again. Otherwise run this again; if it stays: ssh -i ' + KEY_FILE + ' root@<tv ip> sh ' + p.dir +
      '/uninstall.sh , and tell the HomeTV team.');
  }
  ctx.say('  ✓ HomeTV\'s start-up hooks and folder are gone');
  const fg = await restartToHome(ctx);
  if (fg !== HOME) return stop('LG\'s Home isn\'t on screen after the restart.', 'Press Home on the remote. If the TV doesn\'t work as before, see docs/root-plan.md levels 3-5.');
  if (!yes(await ctx.ask('  Is it LG\'s own Home on screen? [y/N] '))) {
    return stop('HomeTV still shows as Home after the restart, with its start-up hooks gone.',
      'Restart once more (' + RESTART + '). If it stays, tell the HomeTV team.');
  }
  ctx.say('  ✓ LG\'s Home is back');
  const opened = await withTv(ctx, async (tv) => {
    if (!(await appIds(tv)).has(HBC)) return 'missing';
    const r = await tv.request('com.webos.applicationManager/launch', { id: HBC });
    if (r.returnValue === false) return 'refused';
    for (let i = 0; i < 10; i++) {
      if ((await foreground(tv)) === HBC) return 'open';
      await sleep(ctx.launchWaitMs ? ctx.launchWaitMs / 10 : 1000);
    }
    return 'not on screen';
  });
  if (opened !== 'open') {
    return stop('Homebrew Channel didn\'t open (' + opened + ').',
      'LG\'s Home works. Open Homebrew Channel from the app list; if it\'s gone, an LG update may have ended root (docs/updates.md).');
  }
  ctx.say('  ✓ Homebrew Channel opens (press Home to leave it)');
  ctx.say('  The HomeTV app is still on the TV: uninstall it in Homebrew Channel if you don\'t want it. The full unroot is level 3:\n' +
    '    ' + WAY_BACK[3]);
  return { done: true, note: 'HomeTV\'s root edition removed; LG\'s Home and Homebrew Channel work' };
}

/** Runs one of them with the TV's address scrubbed from what it says. Returns {done} or {stopped}. */
export async function runWayBack(ctx, which) {
  const say = ctx.say;
  const c = { ...ctx, say: (t) => say(scrub(t, ctx.host)) };
  let r;
  try {
    r = await (which === 'home-again' ? homeAgain : unrootHome)(c);
  } catch (e) {
    r = stop('Something went wrong: ' + (e && e.message ? e.message : e) + '.', 'Run this again.');
  }
  if (r.stop) {
    c.say('  STOPPED: ' + r.stop + '\n  Next: ' + r.next);
    return { stopped: true, why: r.stop };
  }
  return { done: true, note: r.note };
}
