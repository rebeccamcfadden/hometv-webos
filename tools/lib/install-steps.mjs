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
import { backup, describe, WARNING } from './backup.mjs';
import { sshShell, isRoot } from './root-shell.mjs';
import { reach } from './reach.mjs';
import { PINNED, sha256 } from './fetch.mjs';
import { telnetShell, pushFile, portOpen, q } from './telnet.mjs';
import { laptopKey, keyPaths } from './sshkey.mjs';

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

const RESTART = 'unplug the TV from the wall, wait 30 seconds, plug it back in and turn it on (the remote\'s power ' +
  'button isn\'t a restart: Quick Start+ keeps the TV half-awake)';
const KEY_FILE = '%USERPROFILE%\\HomeTV\\lg-root-key';
const yes = (a) => /^\s*y/i.test(a || '');

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
      const tvDone = await withTv(ctx, async (tv) => {
        const sw = await softwareVersion(tv);
        if (sw !== ROOT_SW) {
          return stop('The TV\'s software is ' + (sw || 'unknown') + ', not ' + ROOT_SW + ' (the version SlopBro is known to work on).',
            'Don\'t root. Tell the HomeTV team: root has to be checked again on CanI.RootMy.TV for this version.');
        }
        ctx.say('  ✓ software ' + sw);
        if ((await appIds(tv)).has(DEVMODE)) {
          return stop('The Developer Mode app is still installed.',
            'Delete it (Home > edit the app list > Developer Mode > delete), restart the TV (' + RESTART + '), then run this ' +
            'again. It must go before root, never after: on this exact software a TV lost Homebrew Channel when it was ' +
            'deleted after root (SlopBro issue 22).');
        }
        ctx.say('  ✓ the Developer Mode app is deleted');
        return null;
      });
      if (tvDone) return tvDone;
      if (!yes(await ctx.ask('  Has the TV been restarted since the Developer Mode app was deleted? [y/N] '))) {
        return stop('The TV needs a restart after the Developer Mode app is deleted.', 'Restart it: ' + RESTART + '. Then run this again.');
      }
      const kit = ctx.kit || rootKit(ctx.dir);
      const bad = await kitProblem(kit);
      if (bad) return stop('The root kit isn\'t ready: ' + bad + '.', 'Run: hometv-lg get root-kit   then run this again.');
      ctx.say('  ✓ the root kit (Python, and SlopBro with its SHA-256 checked)');
      if (!yes(await ctx.ask('  Is LG\'s firmware file for this TV on a USB stick, in a folder named LG_DTV? [y/N] '))) {
        return stop('The USB stick with LG\'s firmware isn\'t ready.', 'It\'s the way back if the TV ever won\'t start (docs/root-plan.md, level 5). Prepare it, then run this again.');
      }
      if (!yes(await ctx.ask('  Is Allow Automatic Updates switched off (Settings > All Settings > Support > Software Update)? [y/N] '))) {
        return stop('LG\'s automatic updates may still be on.', 'Switch Allow Automatic Updates off, then run this again.');
      }
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
    undo: 'LG\'s Home back for good: over SSH, sh ' + TV_PATHS.dir + '/undo-home.sh (HomeTV\'s own "Use LG\'s Home" setting ' +
      'is still to build); remove it: sh ' + TV_PATHS.dir + '/uninstall.sh, restart, then uninstall HomeTV in Homebrew Channel. ' +
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
        await sh.run('luna-send -n 1 -w 10000 -f ' + q(HBC_SERVICE + 'setConfiguration') + ' ' + q(JSON.stringify({ telnetDisabled: true, sshdEnabled: true, blockUpdates: true })) + ' >/dev/null 2>&1');
        const after = await hbcConfig(sh);
        if (!after.telnetDisabled || !after.sshdEnabled || !after.blockUpdates) {
          return stop('Homebrew Channel didn\'t take the change (Telnet off, SSH on, Block system updates on).',
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
    what: 'After a restart, HomeTV should open as the TV\'s Home. The laptop checks Home is on screen, Telnet is closed ' +
      'and SSH answers; you say whether it\'s HomeTV (the takeover keeps LG\'s Home app name, so the laptop can\'t tell).',
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
      return { note: 'HomeTV is Home (root edition); Telnet closed, SSH logs in with the laptop\'s key' };
    }
  }
];

async function hbcConfig(sh) {
  const r = await sh.run('luna-send -n 1 -w 10000 -f ' + q(HBC_SERVICE + 'getConfiguration') + ' ' + q('{}'));
  const flag = (k) => new RegExp('"' + k + '"\\s*:\\s*true').test(r.out);
  return { root: flag('root'), telnetDisabled: flag('telnetDisabled'), sshdEnabled: flag('sshdEnabled'), blockUpdates: flag('blockUpdates') };
}

// --- The runner

const stateFile = (dir) => path.join(dir, 'install-state.json');

export function loadState(dir) {
  try { return JSON.parse(fs.readFileSync(stateFile(dir), 'utf8')); } catch { return { steps: {} }; }
}

function saveState(dir, state) {
  fs.writeFileSync(stateFile(dir), JSON.stringify(state, null, 2));
}

/** Runs the steps not done yet (or from `from` on). Returns {done}, {paused: id} or {stopped: id}. */
export async function runInstall(ctx, { from } = {}) {
  const rawSay = ctx.say;
  const logFile = path.join(ctx.dir, 'install-log.txt');
  const say = (s) => {
    const clean = scrub(s, ctx.host);
    rawSay(clean);
    fs.appendFileSync(logFile, clean + '\n');
  };
  const c = { ...ctx, say };
  fs.mkdirSync(ctx.dir, { recursive: true });
  const state = loadState(ctx.dir);
  if (from) {
    const i = STEPS.findIndex((s) => s.id === from);
    if (i < 0) throw new Error('no step named ' + from + ' (steps: ' + STEPS.map((s) => s.id).join(', ') + ')');
    for (const s of STEPS.slice(i)) delete state.steps[s.id];
  }
  say('\n[' + new Date().toISOString().slice(0, 19) + '] hometv-lg install');
  for (const [i, step] of STEPS.entries()) {
    const head = '\nStep ' + (i + 1) + ' of ' + STEPS.length + ': ' + step.title;
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
    saveState(ctx.dir, state);
    say('  ✓ ' + (r.note || 'done'));
  }
  say('\nAll steps done: HomeTV is Home.');
  return { done: true };
}

export function listSteps(dir) {
  const state = loadState(dir);
  return STEPS.map((s, i) => (i + 1) + '. ' + s.id.padEnd(14) + (state.steps[s.id] ? state.steps[s.id].status : 'not run').padEnd(9) + s.title);
}
