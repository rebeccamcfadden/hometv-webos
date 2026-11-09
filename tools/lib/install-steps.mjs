// hometv-lg install: the steps from "Developer Mode on" to "HomeTV is Home (root edition)" on the test TV, in the order
// decided in docs/root-plan.md. Each step says what it does and how it's undone, checks before it changes anything,
// and stops at the first check that fails. The steps are data (STEPS); what's finished is kept on the laptop
// (install-state.json in the HomeTV folder), so running it again carries on where it stopped. Nothing it prints or
// keeps holds the TV's address, serial number, device id or MAC address.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sea from 'node:sea';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { open } from './ssap.mjs';
import { backup, describe, WARNING, FORMAT } from './backup.mjs';
import { sshShell, isRoot, luna, sq } from './root-shell.mjs';
import { reach } from './reach.mjs';
import { PINNED, sha256 } from './fetch.mjs';
import { telnetShell, pushFile, portOpen, q } from './telnet.mjs';
import { laptopKey, keyPaths } from './sshkey.mjs';
import { checkStick } from './recovery.mjs';

export const ROOT_SW = '33.31.61';
const APP = 'com.hometv.app';
const HOME = 'com.webos.app.home';
const DEVMODE = 'com.palmdts.devmode';
const HBC = 'org.webosbrew.hbchannel';
const HBC_SERVICE = 'luna://org.webosbrew.hbchannel.service/';

/** Where things are on the TV (root/lib.sh's defaults; the tests point them at a folder on the PC). */
export const TV_PATHS = {
  dir: '/media/developer/hometv',
  app: '/media/developer/apps/usr/palm/applications/' + APP,
  initd: '/var/lib/webosbrew/init.d',
  ssh: '/home/root/.ssh',
  tmp: '/tmp'
};

export const RESTART = 'unplug the TV from the wall, wait 30 seconds, plug it back in and turn it on (the remote\'s power ' +
  'button isn\'t a restart: Quick Start+ keeps the TV half-awake)';
const KEY_FILE = '%USERPROFILE%\\HomeTV\\lg-root-key';
const yes = (a) => /^\s*y/i.test(a || '');
const UPDATES_WHERE = 'Settings > All Settings > Support > Software Update';
// Homebrew Channel's services/startup.sh gives root this password ("alpine") at each start while
// /home/root/.ssh/authorized_keys is missing; with the key there it sets none.
const DEFAULT_PASSWORD_HASH = 'xGVw8H4GqkKg6';
// Homebrew Channel's switches the lock-down sets (docs/root-plan.md, step 7)
const LOCK = { telnetDisabled: 'Telnet off', sshdEnabled: 'SSH on', blockUpdates: 'Block system updates on' };

/** The way back, lightest first (docs/root-plan.md, "The way back"), as it can be done today. */
export const WAY_BACK = [
  '0  One-off trouble: press Home three times within two seconds while HomeTV is Home: LG\'s Home until the next ' +
    'restart. Or unplug the TV for 30 seconds for a fresh start.',
  '1  LG\'s Home for good, HomeTV kept as an app: in HomeTV, Settings > Use LG\'s Home, then restart (or from the laptop: ' +
    'ssh -i ' + KEY_FILE + ' root@<tv ip> sh ' + TV_PATHS.dir + '/undo-home.sh). Back: hometv-lg root <tv ip> --home-again.',
  '2  Remove HomeTV\'s root edition: hometv-lg unroot-home <tv ip> (LG\'s Home back, checked after a restart), then ' +
    'uninstall HomeTV in Homebrew Channel if you like. Homebrew Channel stays.',
  '3  Full unroot: Settings > General > System > Reset to Initial Settings (a factory reset), then set the TV up again ' +
    'with the backup, the photos and the sign-in list (hometv-lg restore puts back what it can).',
  '4  The TV won\'t finish starting: unplug it for 30 seconds and let Homebrew Channel\'s failsafe start skip every ' +
    'customisation (a "Failsafe mode!" message: choose Reboot later); then level 3. Steps: docs/recovery.md.',
  '5  Still won\'t start: LG\'s USB recovery, the firmware file in LG_DTV on the FAT32 stick (hometv-lg get recovery <drive> ' +
    'checks it): TV off, stick in, TV on. Steps: docs/recovery.md.',
  '6  Nothing works: LG service.'
];

/** Takes out anything that identifies the TV or the laptop's user: addresses, MACs, the home folder. */
export function scrub(text, host) {
  let s = String(text);
  if (host) s = s.split(host).join('<tv ip>');
  const home = os.homedir();
  if (home) s = s.split(home).join('%USERPROFILE%');
  return s
    .replace(/\b(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g, '<ip>')
    .replace(/\b([0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi, '<mac>');
}

export async function withTv(ctx, fn) {
  const keyFile = path.join(ctx.dir, 'lg-client-key');
  const clientKey = fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8').trim() : undefined;
  const tv = await open(ctx.host, {
    clientKey,
    onPrompt: () => ctx.say('  Press "Allow" on the TV (the remote\'s OK button).'),
    ports: ctx.ssapPorts
  });
  if (tv.clientKey && tv.clientKey !== clientKey) fs.writeFileSync(keyFile, tv.clientKey, { mode: 0o600 });
  try { return await fn(tv); } finally { tv.close(); }
}

export async function appIds(tv) {
  const r = await tv.request('com.webos.applicationManager/listLaunchPoints');
  if (r.returnValue === false || !Array.isArray(r.launchPoints)) throw new Error('the TV didn\'t list its apps (' + (r.errorText || 'no list') + ')');
  return new Set(r.launchPoints.map((a) => String(a.id)));
}

export async function foreground(tv) {
  const r = await tv.request('com.webos.applicationManager/getForegroundAppInfo');
  return r.returnValue === false ? '' : String(r.appId || '');
}

async function softwareVersion(tv) {
  const sw = await tv.request('com.webos.service.update/getCurrentSWInformation');
  // only these two fields are read: never device_id or serial
  return sw.returnValue === false || !sw.major_ver ? '' : String(sw.major_ver) + '.' + String(sw.minor_ver);
}

async function modelName(tv) {
  const r = await tv.request('system/getSystemInfo');
  // only the model name is read: never the serial number
  return r.returnValue === false ? '' : String(r.modelName || '');
}

/**
 * Reads Allow Automatic Updates over the remote-control connection (read only, never set): 'on', 'off', or '' when the
 * TV doesn't say. LG doesn't document the setting's name, so a few likely ones are tried (as devmode.mjs does).
 */
export async function readAutoUpdate(tv) {
  const norm = (v) => (/^(on|true|1|yes)$/i.test(String(v)) ? 'on' : /^(off|false|0|no)$/i.test(String(v)) ? 'off' : '');
  for (const category of ['option', 'general', 'network']) {
    let r;
    try { r = await tv.request('settings/getSystemSettings', { category, keys: ['autoUpdate', 'automaticUpdate', 'allowAutoUpdate'] }); } catch { continue; }
    if (!r || r.returnValue === false || !r.settings) continue;
    for (const [k, v] of Object.entries(r.settings)) if (/auto.*update/i.test(k) && norm(v)) return norm(v);
  }
  return '';
}

/** Allow Automatic Updates must be off: read from the TV; asked only when the TV doesn't say and it wasn't confirmed. */
async function updatesOff(ctx, confirmed) {
  const v = await withTv(ctx, readAutoUpdate);
  if (v === 'on') return stop('The TV says Allow Automatic Updates is on.', 'Switch it off (' + UPDATES_WHERE + '), then run this again.');
  if (v === 'off') { ctx.say('  ✓ Allow Automatic Updates is off (the TV says)'); return null; }
  if (confirmed) { ctx.say('  ✓ Allow Automatic Updates is off (confirmed in the checklist)'); return null; }
  if (!yes(await ctx.ask('  Is Allow Automatic Updates switched off (' + UPDATES_WHERE + ')? [y/N] '))) {
    return stop('LG\'s automatic updates may still be on.', 'Switch Allow Automatic Updates off, then run this again.');
  }
  return null;
}

const STICK_NOT_READY = 'The USB stick with LG\'s firmware isn\'t ready';
const STICK_NEXT = 'It\'s the way back if the TV ever won\'t start (docs/root-plan.md, level 5). Prepare it as docs/recovery.md ' +
  'says (hometv-lg get recovery <drive letter> checks it), then run this again.';

/**
 * The USB stick for level 5, read on this laptop (tools/lib/recovery.mjs), never only taken on trust: the person
 * gives its drive letter; what the check can't read (the format, a file name without the model) is asked, one line each.
 */
async function stickReady(ctx, tv) {
  const a = (await ctx.ask('  Which drive is the USB stick with LG\'s firmware for this TV? Type its letter (for example E), ' +
    'or press Enter if it isn\'t ready: ')).trim();
  if (!a || /^(n|no)$/i.test(a)) return stop(STICK_NOT_READY + '.', STICK_NEXT);
  const r = (ctx.checkStick || checkStick)(a, tv);
  for (const l of r.good) ctx.say('  ✓ USB stick: ' + l);
  if (r.problems.length) return stop(STICK_NOT_READY + ': ' + r.problems.join('; ') + '.', STICK_NEXT);
  for (const u of r.unsure) {
    if (!yes(await ctx.ask('  Check by hand: ' + u + '. Is it so? [y/N] '))) return stop(STICK_NOT_READY + ': ' + u + ' isn\'t confirmed.', STICK_NEXT);
  }
  return null;
}

/** The newest backup hometv-lg made on this laptop (lg-backup-<date>.json in the HomeTV folder), or null. */
export function latestBackup(dir) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => /^lg-backup-.*\.json$/.test(f)).sort().reverse(); } catch { return null; }
  for (const file of names) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (data && data.format === FORMAT) return { file, data };
    } catch { /* not a backup this tool can read: try the one before */ }
  }
  return null;
}

// Done in this same run: an older record may no longer describe the TV (a restart not done since, a factory reset), so
// only what was checked in this run spares a question.
const doneNow = (ctx, id) => !!(ctx.thisRun && ctx.thisRun.has(id));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** HomeTV's .ipk: --ipk, else the newest com.hometv.app_*.ipk next to the tool, in the HomeTV folder or in dist/. */
export function findIpk(ctx) {
  if (ctx.ipk) return fs.existsSync(ctx.ipk) ? ctx.ipk : null;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dirs = [process.cwd(), path.dirname(process.execPath), ctx.dir, path.resolve(here, '..', '..', 'dist')];
  for (const d of dirs) {
    let names = [];
    try { names = fs.readdirSync(d).filter((f) => /^com\.hometv\.app_.*\.ipk$/.test(f)).sort(); } catch { continue; }
    if (names.length) return path.join(d, names[names.length - 1]);
  }
  return null;
}

/** root/'s files for the TV (all but README.md), line ends made Unix ones: from the exe's own copy, or the repo. */
export function rootFiles() {
  const files = [];
  if (sea.isSea()) {
    for (const k of sea.getAssetKeys().filter((k) => k.startsWith('root/')).sort()) files.push({ name: k.slice(5), data: sea.getAsset(k, 'utf8') });
  } else {
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'root');
    for (const f of fs.readdirSync(dir).filter((f) => f !== 'README.md').sort()) files.push({ name: f, data: fs.readFileSync(path.join(dir, f), 'utf8') });
  }
  return files.map((f) => ({ name: f.name, data: Buffer.from(f.data.replace(/\r\n/g, '\n')) }));
}

export function rootKit(dir) {
  const tools = path.join(dir, 'tools');
  return { python: path.join(tools, 'python', 'python.exe'), slopbro: path.join(tools, PINNED.slopbro.file) };
}

/** Runs SlopBro, unmodified, with the TV's address; its own messages go straight to the window. */
export function runSlopbro(kit, host) {
  return new Promise((resolve) => {
    const p = spawn(kit.python, [kit.slopbro, host], { cwd: path.dirname(kit.slopbro), stdio: 'inherit' });
    p.on('error', () => resolve(127));
    p.on('exit', (code) => resolve(code === null ? 1 : code));
  });
}

async function kitProblem(kit) {
  if (!fs.existsSync(kit.python)) return 'Python isn\'t in the HomeTV folder';
  if (!fs.existsSync(kit.slopbro)) return 'SlopBro isn\'t in the HomeTV folder';
  // kit.sha256 is for the tests only (a pretend SlopBro); the real kit is always held to the pinned one
  if ((await sha256(kit.slopbro)) !== (kit.sha256 || PINNED.slopbro.sha256)) return 'the SlopBro file isn\'t the checked one (its SHA-256 differs)';
  return '';
}

const stop = (why, next) => ({ stop: why, next });

// --- The steps. `run` returns {note} when done, {stop, next} when a check fails, {pause} when the person stops.
export const STEPS = [
  {
    id: 'backup',
    title: 'Back up what the laptop can read',
    what: 'Saves on this laptop the TV\'s model, software, apps, inputs and the picture and sound settings it can read, ' +
      'before anything changes. Nothing on the TV changes.',
    undo: 'Nothing to undo.',
    async run(ctx) {
      // tools/lib/backup.mjs (docs/backup.md): the same backup as hometv-lg check --backup
      const b = await withTv(ctx, (tv) => backup(tv, ctx.dir));
      for (const line of describe(b.summary)) ctx.say('  ' + line);
      ctx.say('  ' + WARNING);
      return { note: 'saved ' + path.basename(b.file) + ' in the HomeTV folder' };
    }
  },
  {
    id: 'dev-install',
    title: 'HomeTV without root (Developer Mode)',
    what: 'You install HomeTV with webOS Dev Manager; the laptop then checks the TV lists HomeTV and that it opens.',
    undo: 'Home > edit the app list > delete HomeTV. Deleting the Developer Mode app removes it too.',
    async run(ctx) {
      let apps = await withTv(ctx, appIds);
      if (apps.has(HBC)) return { note: 'skipped: the TV is already rooted (Homebrew Channel is installed)' };
      if (!apps.has(APP)) {
        const ipk = findIpk(ctx);
        if (!ipk) return stop('HomeTV\'s .ipk file isn\'t here.', 'Put the com.hometv.app_….ipk file you were sent in the HomeTV folder (or name it with --ipk), then run this again.');
        ctx.say([
          '  1. On the TV: open the Developer Mode app, sign in, switch Dev Mode Status on (the TV restarts), open it',
          '     again and switch Key Server on. It shows a six-letter passphrase.',
          '  2. On this laptop, if Dev Manager isn\'t installed yet: hometv-lg get dev-manager',
          '  3. In Dev Manager: Add device > the TV\'s address and the passphrase > Save.',
          '  4. Install > choose ' + path.basename(ipk) + ' (in ' + path.dirname(ipk) + ') > Install.'
        ].join('\n'));
        const a = await ctx.ask('  Press Enter when Dev Manager says HomeTV is installed (or type q to stop here): ');
        if (/^\s*q/i.test(a)) return { pause: 'Stopped before HomeTV was installed. Run this again to carry on.' };
        apps = await withTv(ctx, appIds);
        if (!apps.has(APP)) return stop('The TV doesn\'t list HomeTV.', 'Check Dev Manager\'s message, install again, then run this again.');
      }
      const opened = await withTv(ctx, async (tv) => {
        const r = await tv.request('com.webos.applicationManager/launch', { id: APP });
        if (r.returnValue === false) return false;
        for (const until = Date.now() + (ctx.launchWaitMs || 10000); Date.now() < until; await sleep(250)) {
          if ((await foreground(tv)) === APP) return true;
        }
        return false;
      });
      if (!opened) return stop('HomeTV is installed but didn\'t open on the TV.', 'Open it from its tile and note what shows; tell the HomeTV team.');
      ctx.say('  In the Developer Mode app, switch Key Server off again: it\'s only needed to install.');
      return { note: 'HomeTV is installed and opens' };
    }
  },
  {
    id: 'go-on',
    title: 'Root now, or stop here',
    what: 'HomeTV works without root now. The next steps root the TV. Stopping here is fine: HomeTV stays installed, ' +
      'and running this again carries on from here.',
    undo: 'Nothing to undo.',
    async run(ctx) {
      if (!yes(await ctx.ask('  Go on to the root steps now? [y/N] '))) return { pause: 'Stopped before root. Nothing more changed on the TV.' };
      return { note: 'going on to root' };
    }
  },
  {
    id: 'root-checks',
    title: 'Before root: the checks',
    what: 'Checks everything root needs, and stops at the first that isn\'t right. Changes nothing on the TV ' +
      '(the TV\'s browser opens for a moment to check it can reach this laptop).',
    undo: 'Nothing to undo.',
    async run(ctx) {
      let tvInfo = {};
      const tvDone = await withTv(ctx, async (tv) => {
        const apps = await appIds(tv);
        if (apps.has(HBC)) return { note: 'skipped: the TV is already rooted (Homebrew Channel is installed)' };
        const sw = await softwareVersion(tv);
        tvInfo = { software: sw, model: await modelName(tv) };
        if (sw !== ROOT_SW) {
          return stop('The TV\'s software is ' + (sw || 'unknown') + ', not ' + ROOT_SW + ' (the version SlopBro is known to work on).',
            'Don\'t root. Tell the HomeTV team: root has to be checked again on CanI.RootMy.TV for this version.');
        }
        ctx.say('  ✓ software ' + sw);
        // either back on the TV: "Clear the way" has to be done again
        if ((apps.has(DEVMODE) || apps.has(APP)) && ctx.state) delete ctx.state.steps['clear-the-way'];
        if (apps.has(DEVMODE)) {
          return stop('The Developer Mode app is still installed.',
            'Delete it (Home > edit the app list > Developer Mode > delete), restart the TV (' + RESTART + '), then run this ' +
            'again. It must go before root, never after: on this exact software a TV lost Homebrew Channel when it was ' +
            'deleted after root (SlopBro issue 22).');
        }
        ctx.say('  ✓ the Developer Mode app is deleted');
        // docs/root-plan.md, step 5: root goes on a TV back to stock; HomeTV comes back after root (root-install)
        if (apps.has(APP)) {
          return stop('HomeTV\'s Developer Mode copy is still installed.',
            'Delete it (Home > edit the app list > HomeTV > delete), restart the TV (' + RESTART + '), then run this again. ' +
            'Root goes on a TV back to stock (docs/root-plan.md, step 5); HomeTV comes back after root.');
        }
        ctx.say('  ✓ HomeTV\'s Developer Mode copy is deleted');
        return null;
      });
      if (tvDone) return tvDone;
      if (doneNow(ctx, 'clear-the-way')) {
        ctx.say('  ✓ restarted since (checked in "Clear the way")');
      } else if (!yes(await ctx.ask('  Has the TV been restarted since the Developer Mode app was deleted? [y/N] '))) {
        return stop('The TV needs a restart after the Developer Mode app is deleted.', 'Restart it: ' + RESTART + '. Then run this again.');
      }
      const kit = ctx.kit || rootKit(ctx.dir);
      const bad = await kitProblem(kit);
      if (bad) return stop('The root kit isn\'t ready: ' + bad + '.', 'Run: hometv-lg get root-kit   then run this again.');
      ctx.say('  ✓ the root kit (Python, and SlopBro with its SHA-256 checked)');
      const checklist = doneNow(ctx, 'root-preflight');
      if (checklist) {
        ctx.say('  ✓ the USB stick with LG\'s firmware (checked in the checklist)');
      } else {
        const stick = await stickReady(ctx, tvInfo);
        if (stick) return stick;
      }
      const upd = await updatesOff(ctx, checklist);
      if (upd) return upd;
      const r = await withTv(ctx, (tv) => reach(tv, ctx.host, { address: ctx.reachAddress, waitMs: ctx.reachWaitMs }));
      if (!r.ok) {
        return stop('The TV can\'t reach this laptop (' + r.error + '). SlopBro needs that.',
          'Keep the laptop on the same Wi-Fi as the TV, choose Allow when Windows asks about private networks, then run this again.');
      }
      ctx.say('  ✓ the TV reaches this laptop');
      return { note: 'ready for root' };
    }
  },
  {
    id: 'root',
    title: 'Root with SlopBro',
    what: 'SlopBro (v0.1.0, by throwaway96; the checked copy) runs on this laptop. The TV opens a page it serves, an LG ' +
      'bug gives it a root shell for a moment, and it installs Homebrew Channel (an app store for rooted TVs) set to ' +
      'start with the TV. It changes only the TV\'s writable storage, never LG\'s signed firmware.',
    undo: 'There is no unroot button. The full undo is LG\'s Reset to Initial Settings (a factory reset): it removes root, ' +
      'Homebrew Channel and all they installed, keeps the firmware, and also clears the TV\'s settings, apps and sign-ins ' +
      '(step 1\'s backup and the photos are for that). See docs/root-plan.md, "The way back".',
    async run(ctx) {
      if ((await withTv(ctx, appIds)).has(HBC)) return { note: 'skipped: Homebrew Channel is already installed' };
      const kit = ctx.kit || rootKit(ctx.dir);
      const bad = await kitProblem(kit);
      if (bad) return stop('The root kit isn\'t ready: ' + bad + '.', 'Run: hometv-lg get root-kit   then run this again.');
      ctx.say([
        '  What happens: the TV asks to "Allow" once more (SlopBro pairs on its own), then shows SlopBro\'s messages.',
        '  When it says "Rooting complete" and offers "Reboot now", choose Reboot now.',
        '  If it says the Developer Mode app is installed, choose OK, don\'t restart, and stop: tell the HomeTV team.'
      ].join('\n'));
      const phrase = (await ctx.ask('  To start, type  root the TV  and press Enter (just Enter stops here): ')).trim().replace(/\s+/g, ' ').toLowerCase();
      if (phrase !== 'root the tv') return { pause: 'Not started: nothing changed on the TV. Run this again when you\'re ready.' };
      const code = await (ctx.runSlopbro || runSlopbro)(kit, ctx.host);
      if (code !== 0) {
        return stop('SlopBro stopped with an error (exit code ' + code + '). Nothing more was done.',
          'Its messages are above (they show the TV\'s address: don\'t post them publicly). Restart the TV; LG\'s Home should ' +
          'be as before. Tell the HomeTV team before trying again.');
      }
      await ctx.ask('  Press Enter once the TV has restarted and shows its Home screen: ');
      return { note: 'SlopBro finished' };
    }
  },
  {
    id: 'hbc-check',
    title: 'After root: Homebrew Channel',
    what: 'Checks Homebrew Channel is on the TV after root\'s restart.',
    undo: 'Nothing to undo.',
    async run(ctx) {
      if (!(await withTv(ctx, appIds)).has(HBC)) {
        return stop('Homebrew Channel isn\'t on the TV after root. This is what was reported on this exact software ' +
          '(SlopBro issue 22): stop here.',
          'Don\'t run SlopBro again and don\'t install the Developer Mode app. The TV works as before with LG\'s Home. Tell the ' +
          'HomeTV team. If the TV misbehaves, the way back is LG\'s Reset to Initial Settings (docs/root-plan.md, level 3).');
      }
      return { note: 'Homebrew Channel is installed' };
    }
  },
  {
    id: 'root-install',
    title: 'HomeTV\'s root edition, and locking the TV down',
    what: 'Through Homebrew Channel\'s root shell (Telnet: no password, this Wi-Fi only, closed by this step): copies ' +
      'HomeTV\'s root scripts to ' + TV_PATHS.dir + ', puts HomeTV back if root\'s set-up removed it, runs install.sh ' +
      '(two start-up hooks: HomeTV takes over LG\'s Home at each start, in memory only), adds this laptop\'s SSH key, and ' +
      'asks Homebrew Channel to switch Telnet off and SSH on from the next restart.',
    undo: 'LG\'s Home back for good: HomeTV\'s Settings > Use LG\'s Home, or over SSH sh ' + TV_PATHS.dir + '/undo-home.sh ' +
      '(back: hometv-lg root <tv address> --home-again); remove it: hometv-lg unroot-home <tv address>, then uninstall HomeTV in Homebrew Channel. ' +
      'Telnet and SSH: Homebrew Channel > Settings, then restart. The SSH key: the line ending "hometv-lg" in ' + TV_PATHS.ssh + '/authorized_keys.',
    async run(ctx) {
      const P = { ...TV_PATHS, ...ctx.tvPaths };
      const port = ctx.telnetPort || 23;
      if (!(await portOpen(ctx.host, port))) {
        return stop('Homebrew Channel\'s Telnet isn\'t answering.',
          'On the TV, open Homebrew Channel > Settings: Telnet should be on and Root status "ok". Restart the TV (' + RESTART + ') and run this again.');
      }
      const sh = await telnetShell(ctx.host, { port, timeoutMs: ctx.telnetTimeoutMs || 60000 });
      try {
        const id = await sh.run('echo "uid=$(id -u)"');
        if ((id.out.match(/uid=(\d+)/) || [])[1] !== '0') return stop('Telnet\'s shell isn\'t root.', 'Tell the HomeTV team.');
        const tools = await sh.run('for c in base64 sha256sum node luna-send; do command -v $c >/dev/null 2>&1 || echo "missing:$c"; done');
        const missing = [...tools.out.matchAll(/missing:([\w-]+)/g)].map((m) => m[1]);
        if (missing.length) return stop('The TV lacks what this step uses: ' + missing.join(', ') + '.', 'Tell the HomeTV team.');
        if ((await sh.run('[ -d ' + q(P.initd) + ' ]')).code !== 0) return stop('Homebrew Channel\'s start-up hooks folder is missing (' + P.initd + ').', 'Restart the TV and run this again; if it stays, tell the HomeTV team.');
        const conf = await hbcConfig(sh);
        if (!conf.root) {
          return stop('Homebrew Channel\'s service isn\'t running as root (its Settings show Root status other than "ok").',
            'Restart the TV (' + RESTART + ') and run this again.');
        }
        ctx.say('  ✓ root shell, Homebrew Channel running as root');

        if ((await sh.run('mkdir -p ' + q(P.dir))).code !== 0) return stop('Couldn\'t make ' + P.dir + ' on the TV.', 'Tell the HomeTV team.');
        const files = (ctx.rootFiles || rootFiles)();
        for (const f of files) await pushFile(sh, P.dir + '/' + f.name, f.data, { mode: /\.sh$|^\d\d-/.test(f.name) ? '755' : '644' });
        ctx.say('  ✓ ' + files.length + ' root scripts copied and checked (SHA-256)');

        if ((await sh.run('[ -f ' + q(P.app + '/index.html') + ' ]')).code !== 0) {
          const ipk = findIpk(ctx);
          if (!ipk) return stop('HomeTV isn\'t on the TV any more (deleting the Developer Mode app removes it), and its .ipk file isn\'t here.', 'Put the com.hometv.app_….ipk file in the HomeTV folder (or name it with --ipk), then run this again.');
          const tmp = P.tmp + '/hometv.ipk';
          const out = P.tmp + '/hometv-install.out';
          await pushFile(sh, tmp, fs.readFileSync(ipk));
          // As Homebrew Channel's own tools/install.sh and SlopBro's autoroot.sh: LG's installer, as root
          const payload = JSON.stringify({ id: 'com.ares.defaultName', ipkUrl: tmp, subscribe: true });
          await sh.run('rm -f ' + q(out) + '; luna-send -w 60000 -i ' + q('luna://com.webos.appInstallService/dev/install') + ' ' + q(payload) +
            ' > ' + q(out) + ' 2>&1 & p=$!; i=0; while [ $i -lt 90 ] && ! grep -q -e installed -e failed ' + q(out) +
            '; do sleep 1; i=$((i+1)); done; kill $p 2>/dev/null; rm -f ' + q(tmp), { ms: 120000 });
          const ok = await sh.run('grep -q installed ' + q(out) + ' && [ -f ' + q(P.app + '/index.html') + ' ]');
          if (ok.code !== 0) return stop('HomeTV couldn\'t be installed again on the rooted TV.', 'Install it from Homebrew Channel, or tell the HomeTV team.');
          ctx.say('  ✓ HomeTV installed again (' + path.basename(ipk) + ')');
        } else {
          ctx.say('  ✓ HomeTV is installed');
        }

        const inst = await sh.run('sh ' + q(P.dir + '/install.sh') + ' 2>&1', { ms: 60000 });
        if (inst.code !== 0) {
          const why = (inst.out.match(/install: .*/g) || ['no reason given']).pop();
          return stop('install.sh refused: ' + scrub(why, ctx.host), 'Nothing was hooked in. Fix what it says, then run this again.');
        }
        ctx.say('  ✓ install.sh: HomeTV becomes Home at the next restart');

        const key = laptopKey(ctx.dir);
        const ak = P.ssh + '/authorized_keys';
        const k = await sh.run('mkdir -p ' + q(P.ssh) + ' && chmod 700 ' + q(P.ssh) + ' && touch ' + q(ak) + ' && { grep -qxF ' +
          q(key.publicLine) + ' ' + q(ak) + ' || echo ' + q(key.publicLine) + ' >> ' + q(ak) + '; } && chmod 600 ' + q(ak));
        if (k.code !== 0) return stop('Couldn\'t add the SSH key on the TV.', 'Tell the HomeTV team.');
        ctx.say('  ✓ SSH key added (Homebrew Channel then sets no default password); the laptop\'s half: ' + KEY_FILE);

        // Homebrew Channel's own switches (services/service.ts, setConfiguration): only the three named are changed.
        // Block system updates is a second layer behind Allow Automatic Updates off (decided; docs/install.md)
        const setConf = (o) => sh.run('luna-send -n 1 -w 10000 -f ' + q(HBC_SERVICE + 'setConfiguration') + ' ' + q(JSON.stringify(o)) + ' >/dev/null 2>&1');
        await setConf(Object.fromEntries(Object.keys(LOCK).map((k) => [k, true])));
        let after = await hbcConfig(sh);
        const missed = Object.keys(LOCK).filter((k) => !after[k]);
        if (missed.length) {
          // once more, only what didn't take
          await setConf(Object.fromEntries(missed.map((k) => [k, true])));
          after = await hbcConfig(sh);
        }
        const still = Object.keys(LOCK).filter((k) => !after[k]);
        if (still.length) {
          return stop('Homebrew Channel didn\'t take the change (Telnet off, SSH on, Block system updates on); not on: ' + still.map((k) => LOCK[k]).join(', ') + '.',
            'In Homebrew Channel > Settings, switch Telnet off, SSH Server on and Block system updates on, then run this again.');
        }
        ctx.say('  ✓ Homebrew Channel: Telnet off, SSH on and Block system updates on, from the next restart');
        ctx.say('    (undo for the update block: switch it off in Homebrew Channel > Settings, then restart)');
        return { note: 'HomeTV\'s root edition is installed; Telnet closes at the next restart' };
      } finally {
        sh.close();
      }
    }
  },
  {
    id: 'restart-check',
    title: 'Restart: HomeTV as Home',
    what: 'After a restart, HomeTV should open as the TV\'s Home. The laptop checks Home is on screen, Telnet is closed, ' +
      'SSH logs in with the laptop\'s key only (no default password) and Homebrew Channel\'s three switches are on; you say ' +
      'whether it\'s HomeTV (the takeover keeps LG\'s Home app name, so the laptop can\'t tell).',
    undo: 'LG\'s Home back for good: ssh -i ' + KEY_FILE + ' root@<tv ip> sh ' + TV_PATHS.dir + '/undo-home.sh . ' +
      'All the levels, up to a factory reset: docs/root-plan.md, "The way back".',
    async run(ctx) {
      ctx.say('  Restart the TV: ' + RESTART + '.');
      await ctx.ask('  Press Enter once the TV is back on: ');
      let fg = await withTv(ctx, foreground);
      if (fg !== HOME && fg !== APP) {
        await ctx.ask('  Press Home on the remote, then Enter here: ');
        fg = await withTv(ctx, foreground);
      }
      if (fg !== HOME && fg !== APP) return stop('Home isn\'t on screen.', 'Press Home on the remote; if LG\'s Home or nothing shows, tell the HomeTV team.');
      if (!yes(await ctx.ask('  Is it HomeTV on screen (not LG\'s own Home)? [y/N] '))) {
        return stop('HomeTV didn\'t take over Home. LG\'s Home works as before.',
          'Its start-up notes are in /tmp/hometv-boot.log on the TV: ssh -i ' + KEY_FILE + ' root@<tv ip> cat /tmp/hometv-boot.log . Send them to the HomeTV team.');
      }
      if (await portOpen(ctx.host, ctx.telnetPort || 23)) {
        return stop('Telnet is still on: anyone on this Wi-Fi can get a root shell.', 'In Homebrew Channel > Settings, switch Telnet off, then restart the TV.');
      }
      const sshPort = ctx.sshPort || 22;
      if (!(await portOpen(ctx.host, sshPort))) {
        return stop('HomeTV is Home, but SSH isn\'t answering, so the laptop has no way in.',
          'In Homebrew Channel > Settings, switch SSH Server on, then restart the TV. Tell the HomeTV team.');
      }
      // A real login with the key (tools/lib/root-shell.mjs, as hometv-lg restore uses it); the TV's host key is
      // trusted this first time and kept in lg-known-hosts.
      const { key, knownHosts } = keyPaths(ctx.dir);
      const shell = (ctx.rootShell || sshShell)({ host: ctx.host, port: sshPort, key, knownHosts });
      if (!(await isRoot(shell))) {
        return stop('SSH answers, but the laptop\'s key doesn\'t log in as root.',
          'Check that Windows\' OpenSSH client is installed (Settings > System > Optional features), then run this again ' +
          'with --from restart-check. Tell the HomeTV team if it stays.');
      }
      // Step 7, after the restart: SSH by key only, and Homebrew Channel's three switches still on. The password check
      // runs on the TV: no hash comes back to the laptop.
      const P = { ...TV_PATHS, ...ctx.tvPaths };
      const pw = await shell.run('[ -s ' + sq(P.ssh + '/authorized_keys') + ' ] && echo authorized-keys; grep -q ' +
        sq('^root:' + DEFAULT_PASSWORD_HASH + ':') + ' /etc/shadow && echo default-password; true');
      const pwOut = String(pw.stdout || '');
      if (!/authorized-keys/.test(pwOut) || /default-password/.test(pwOut)) {
        return stop('SSH still takes Homebrew Channel\'s default root password ("alpine"), not only the laptop\'s key.',
          'The key has to be on the TV before a restart: run this again with --from root-install, then restart. Tell the HomeTV team if it stays.');
      }
      const conf = await luna(shell, HBC_SERVICE.replace('luna://', '') + 'getConfiguration');
      const off = Object.keys(LOCK).filter((k) => conf[k] !== true);
      if (off.length) {
        return stop('After the restart, Homebrew Channel\'s switches aren\'t all set; not on: ' + off.map((k) => LOCK[k]).join(', ') + '.',
          'In Homebrew Channel > Settings, switch Telnet off, SSH Server on and Block system updates on, restart the TV, then ' +
          'run this again with --from restart-check.');
      }
      return { note: 'HomeTV is Home (root edition); Telnet off, SSH by key only, Block system updates on' };
    }
  }
];

async function hbcConfig(sh) {
  const r = await sh.run('luna-send -n 1 -w 10000 -f ' + q(HBC_SERVICE + 'getConfiguration') + ' ' + q('{}'));
  const flag = (k) => new RegExp('"' + k + '"\\s*:\\s*true').test(r.out);
  return { root: flag('root'), telnetDisabled: flag('telnetDisabled'), sshdEnabled: flag('sshdEnabled'), blockUpdates: flag('blockUpdates') };
}

// --- hometv-lg root: the checklist and "Clear the way" (docs/root-plan.md, steps 3-5), then the root steps above

const PREFLIGHT = [
  ['Have you photographed the TV\'s settings screens: picture, sound, the privacy switches, the home-row order, Power ' +
    'On Screen and Quick Start+, HDMI device links (SIMPLINK), the channel list if you use an aerial, accessibility? [y/N] ',
  'The photos of the TV\'s settings aren\'t taken.',
  'After a factory reset they are how the settings go back by hand (docs/root-plan.md, Backup, part 2). Take them, then run this again.'],
  ['Have you written down which apps you would need to sign in to again, the LG account if there is one, and the ' +
    'Wi-Fi name (no passwords)? [y/N] ',
  'The sign-in list isn\'t written.',
  'It\'s what a factory reset would ask for again (docs/root-plan.md, Backup, part 3). Write it, then run this again.']
];

export const ROOT_PRE = [
  {
    id: 'root-preflight',
    title: 'Before root: the checklist',
    what: 'Checks the TV answers and this laptop holds its backup, then asks what has to be ready before root, one line ' +
      'at a time, and stops at the first "no". Changes nothing on the TV.',
    undo: 'Nothing to undo.',
    async run(ctx) {
      const tv = await withTv(ctx, async (t) => ({ apps: await appIds(t), model: await modelName(t), software: await softwareVersion(t) }));
      if (tv.apps.has(HBC)) return { note: 'skipped: the TV is already rooted (Homebrew Channel is installed)' };
      ctx.say('  ✓ the TV answers and knows this laptop');
      const b = latestBackup(ctx.dir);
      if (!b) {
        return stop('There\'s no backup of this TV on this laptop.',
          'Run hometv-lg install <tv address> first (its first step is the backup), or hometv-lg check <tv address> --backup, then run this again.');
      }
      const was = (b.data.tv && b.data.tv.model) || '';
      if (was && tv.model && was !== tv.model) {
        return stop('The newest backup on this laptop (' + b.file + ') is of another TV model (' + was + ').',
          'Back this TV up: hometv-lg check <tv address> --backup, then run this again.');
      }
      ctx.say('  ✓ the backup on this laptop: ' + b.file);
      for (const [question, why, next] of PREFLIGHT) {
        if (!yes(await ctx.ask('  ' + question))) return stop(why, next);
      }
      const stick = await stickReady(ctx, { model: tv.model, software: tv.software });
      if (stick) return stick;
      const upd = await updatesOff(ctx, false);
      if (upd) return upd;
      ctx.say('  Root changes the TV\'s writable storage, never LG\'s signed firmware. There is no unroot button: the full undo\n' +
        '  is a factory reset (level 3 below), which also clears the TV\'s settings, apps and sign-ins.');
      const a = (await ctx.ask('  If the TV\'s owner agrees to root it, type  root  and press Enter (anything else stops here): ')).trim().toLowerCase();
      if (a !== 'root') return stop('The TV\'s owner hasn\'t agreed to root it.', 'Nothing changed on the TV. Run this again when they agree.');
      return { note: 'backup ' + b.file + '; photos and sign-in list confirmed; USB stick checked; automatic updates off; the owner agreed' };
    }
  },
  {
    id: 'clear-the-way',
    title: 'Clear the way: HomeTV and the Developer Mode app deleted, then a restart',
    what: 'Root goes on a TV back to stock (docs/root-plan.md, step 5): you delete HomeTV\'s Developer Mode copy and the ' +
      'Developer Mode app and restart the TV; the laptop then checks they\'re gone, LG\'s Home is on screen and the apps in ' +
      'the backup are all there. HomeTV comes back after root, through Homebrew Channel\'s root shell.',
    undo: 'HomeTV without root again: hometv-lg devmode <tv address>. Only if you stop here for good: on this software the ' +
      'Developer Mode app must not be on the TV when it is rooted, nor deleted after (SlopBro issue 22).',
    async run(ctx) {
      let apps = await withTv(ctx, appIds);
      if (apps.has(HBC)) return { note: 'skipped: the TV is already rooted (Homebrew Channel is installed)' };
      const left = () => [apps.has(APP) && 'HomeTV', apps.has(DEVMODE) && 'the Developer Mode app'].filter(Boolean);
      if (left().length) {
        ctx.say([
          '  On the TV, delete ' + left().join(' and ') + ': Home > edit the app list > the app > delete.',
          '  Then restart the TV: ' + RESTART + '.'
        ].join('\n'));
        const a = await ctx.ask('  Press Enter when they\'re deleted and the TV is on again (or type q to stop here): ');
        if (/^\s*q/i.test(a)) return { pause: 'Stopped before anything was deleted by this step. Run this again to carry on.' };
      } else if (!yes(await ctx.ask('  Has the TV been restarted since the Developer Mode app was deleted? [y/N] '))) {
        ctx.say('  Restart the TV now: ' + RESTART + '.');
        await ctx.ask('  Press Enter when the TV is on again: ');
      }
      apps = await withTv(ctx, appIds);
      if (left().length) {
        return stop(left().join(' and ') + ' still on the TV.',
          'Delete ' + (left().length > 1 ? 'them' : 'it') + ' (Home > edit the app list), restart the TV (' + RESTART + '), then run this again.');
      }
      ctx.say('  ✓ HomeTV\'s Developer Mode copy and the Developer Mode app are deleted');
      let fg = await withTv(ctx, foreground);
      if (fg !== HOME) {
        await ctx.ask('  Press Home on the remote, then Enter here: ');
        fg = await withTv(ctx, foreground);
      }
      if (fg !== HOME) {
        return stop('LG\'s Home isn\'t on screen after the restart.',
          'Press Home and check the TV works as before. If it doesn\'t, don\'t root: tell the HomeTV team.');
      }
      ctx.say('  ✓ LG\'s Home is on screen');
      const b = latestBackup(ctx.dir);
      const before = b && b.data.ssap && Array.isArray(b.data.ssap.apps) ? b.data.ssap.apps.map((x) => String(x.id)) : [];
      const missing = before.filter((id) => ![APP, DEVMODE, HBC].includes(id) && !apps.has(id));
      if (missing.length) {
        return stop('Apps in the backup aren\'t on the TV any more: ' + missing.join(', ') + '.',
          'Check them on the TV before root. If you deleted one on purpose, back up again (hometv-lg check <tv address> --backup), then run this again.');
      }
      ctx.say('  ✓ the apps in the backup are all on the TV');
      return { note: 'back to stock: HomeTV and the Developer Mode app deleted, restarted, LG\'s Home and the apps there' };
    }
  }
];

/** hometv-lg root: the checklist, "Clear the way", then the same steps as hometv-lg install from root-checks on. */
export const ROOT_STEPS = [...ROOT_PRE, ...STEPS.slice(STEPS.findIndex((s) => s.id === 'root-checks'))];

// --- The runner

const stateFile = (dir) => path.join(dir, 'install-state.json');

export function loadState(dir) {
  try { return JSON.parse(fs.readFileSync(stateFile(dir), 'utf8')); } catch { return { steps: {} }; }
}

function saveState(dir, state) {
  fs.writeFileSync(stateFile(dir), JSON.stringify(state, null, 2));
}

/** What a step's record says, in a word: done, skipped, stopped, paused or not run. */
function statusWord(rec) {
  if (!rec) return 'not run';
  if (rec.status === 'done' && /^skipped/.test(rec.note || '')) return 'skipped';
  return rec.status;
}

/** The report: each step's status, what it noted, its undo, and the way back. Nothing that identifies the TV. */
export function reportText(steps, state, result, name) {
  const end = result.done ? 'all steps done' : (result.stopped ? 'stopped at ' : 'paused at ') +
    '"' + steps.find((s) => s.id === (result.stopped || result.paused)).title + '"';
  const lines = [
    'HomeTV for LG: hometv-lg ' + name + ' report',
    'Written ' + new Date().toISOString().slice(0, 19).replace('T', ' ') + ' (UTC). Result: ' + end + '.',
    'No TV address, serial number, device id or MAC address is in this report.',
    ''
  ];
  for (const [i, s] of steps.entries()) {
    const rec = state.steps[s.id];
    lines.push((i + 1) + '. [' + statusWord(rec) + '] ' + s.title + (rec && rec.at ? ' (' + rec.at.slice(0, 16).replace('T', ' ') + ')' : ''));
    if (rec && (rec.note || rec.why)) lines.push('   ' + (rec.why || rec.note));
    lines.push('   Undo: ' + s.undo);
  }
  lines.push('', 'The way back, lightest first (docs/root-plan.md, "The way back"):', ...WAY_BACK.map((l) => '  ' + l));
  return lines.join('\n') + '\n';
}

/**
 * Runs the steps not done yet (or from `from` on). Returns {done}, {paused: id} or {stopped: id}. `steps` is STEPS
 * (hometv-lg install) or ROOT_STEPS (hometv-lg root); both keep their progress in the same state file, so a step done
 * by one is done for the other. With `report`, writes lg-<name>-report-<date>.txt in the HomeTV folder at the end.
 */
export async function runInstall(ctx, { from, steps = STEPS, name = 'install', report = false } = {}) {
  const rawSay = ctx.say;
  const logFile = path.join(ctx.dir, 'install-log.txt');
  const say = (s) => {
    const clean = scrub(s, ctx.host);
    rawSay(clean);
    fs.appendFileSync(logFile, clean + '\n');
  };
  fs.mkdirSync(ctx.dir, { recursive: true });
  const state = loadState(ctx.dir);
  const thisRun = new Set();
  const c = { ...ctx, say, state, thisRun };
  if (from) {
    const i = steps.findIndex((s) => s.id === from);
    if (i < 0) throw new Error('no step named ' + from + ' (steps: ' + steps.map((s) => s.id).join(', ') + ')');
    for (const s of steps.slice(i)) delete state.steps[s.id];
  }
  say('\n[' + new Date().toISOString().slice(0, 19) + '] hometv-lg ' + name);
  const result = await (async () => {
    for (const [i, step] of steps.entries()) {
      const head = '\nStep ' + (i + 1) + ' of ' + steps.length + ': ' + step.title;
      const prev = state.steps[step.id];
      if (prev && prev.status === 'done') { say(head + ' (done ' + prev.at.slice(0, 10) + ')'); continue; }
      say(head + '\n  ' + step.what + '\n  Undo: ' + step.undo);
      let r;
      try {
        r = await step.run(c);
      } catch (e) {
        r = stop('Something went wrong: ' + (e && e.message ? e.message : e) + '.', 'Run this again: finished steps are skipped.');
      }
      const at = new Date().toISOString();
      if (r.pause) {
        state.steps[step.id] = { status: 'paused', at };
        saveState(ctx.dir, state);
        say('  ' + r.pause);
        return { paused: step.id };
      }
      if (r.stop) {
        state.steps[step.id] = { status: 'stopped', at, why: scrub(r.stop, ctx.host) };
        saveState(ctx.dir, state);
        say('  STOPPED: ' + r.stop + '\n  Next: ' + r.next);
        return { stopped: step.id };
      }
      state.steps[step.id] = { status: 'done', at, note: scrub(r.note || '', ctx.host) };
      thisRun.add(step.id);
      saveState(ctx.dir, state);
      say('  ✓ ' + (r.note || 'done'));
    }
    say('\nAll steps done: HomeTV is Home.');
    return { done: true };
  })();
  if (report) {
    const file = path.join(ctx.dir, 'lg-' + name + '-report-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.txt');
    const text = scrub(reportText(steps, state, result, name), ctx.host);
    fs.writeFileSync(file, text);
    say('\n' + text + '\nThis report is saved as ' + path.basename(file) + ' in the HomeTV folder.');
  }
  return result;
}

export function listSteps(dir, steps = STEPS) {
  const state = loadState(dir);
  return steps.map((s, i) => (i + 1) + '. ' + s.id.padEnd(15) + statusWord(state.steps[s.id]).padEnd(9) + s.title);
}
