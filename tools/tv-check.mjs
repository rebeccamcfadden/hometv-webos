// Install step 1 (the laptop check) and step 3 (the settings backup), over LG's remote-control connection.
//
//   node tools/tv-check.mjs <tv address> [--backup [--root]] [--launch] [--reach]   (or: hometv-lg check …)
//
// Without flags: read-only checks (model and firmware, apps, inputs, sound output) and what v0 needs (root status for
// the software, Developer Mode app, Homebrew Channel). On a TV this laptop rooted, also whether root is still on or an LG
// update ended it, with the choices then (tools/lib/root-status.mjs). --backup also saves a backup of what the TV lets a paired app
// read (settings, apps, inputs) in %USERPROFILE%\HomeTV\backups, apart from the report (tools/lib/backup.mjs); with
// --root, also what a rooted TV's shell can read (docs/backup.md).
// --launch then opens Netflix, YouTube and a YouTube video, asking first and asking what happened. --reach checks the
// TV can reach this laptop (needed for root). The TV shows "Allow" the first time; the key it gives is kept in
// %USERPROFILE%\HomeTV (never in the repo). The report goes there too, without the TV's or laptop's address, serial
// number or device id, so it can be shared.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { open } from './lib/ssap.mjs';
import { readOnlyChecks, launch, toast, readiness, LAUNCHES } from './lib/checks.mjs';
import { backup, describe, WARNING } from './lib/backup.mjs';
import { sshShell } from './lib/root-shell.mjs';
import { rootedBefore, rootStatus, describeRootStatus } from './lib/root-status.mjs';
import { reach } from './lib/reach.mjs';

const args = process.argv.slice(2);
const VALUED = ['--ws-port', '--reach-address'];
const host = args.find((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]));
const wsPortArg = args.indexOf('--ws-port');
const wsPort = wsPortArg >= 0 ? Number(args[wsPortArg + 1]) : Number(process.env.HOMETV_TEST_WS_PORT || 0);
// Tests only: the address the TV should use for this laptop.
const reachAddrArg = args.indexOf('--reach-address');
const reachAddr = reachAddrArg >= 0 ? args[reachAddrArg + 1] : process.env.HOMETV_TEST_REACH_ADDRESS || '';
if (!host || !/^[0-9A-Za-z.\-:]+$/.test(host)) {
  console.error('Usage: hometv-lg check <tv address> [--backup [--root]] [--launch] [--reach]');
  process.exit(2);
}
const dir = process.env.HOMETV_DIR || path.join(os.homedir(), 'HomeTV');
fs.mkdirSync(dir, { recursive: true });
const keyFile = path.join(dir, 'lg-client-key');
const rootKeyFile = process.env.HOMETV_ROOT_KEY || path.join(dir, 'lg-root-key');
const clientKey = fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8').trim() : undefined;

const say = (s) => console.log(s);

say('Connecting to the TV…');
const tv = await open(host, {
  clientKey,
  onPrompt: () => say('Press "Allow" on the TV (the remote\'s OK button).'),
  // Tests only: a pretend TV on plain ws at this port.
  ports: wsPort ? [{ url: 'ws://' + host + ':' + wsPort + '/', insecure: false }] : undefined
}).catch((e) => {
  console.error('Could not connect to the TV at ' + host + ' (' + (e.code || e.message) + '). Check the TV is on and ' +
    'on the same network as this laptop, then run this again.');
  process.exit(1);
});
if (tv.clientKey && tv.clientKey !== clientKey) fs.writeFileSync(keyFile, tv.clientKey, { mode: 0o600 });

const report = await readOnlyChecks(tv);
const c = report.checks;
say('Model: ' + (c.system.modelName || c.software.model_name || '?') + ', software ' +
  (c.software.major_ver ? c.software.major_ver + '.' + c.software.minor_ver : '?'));
say('Apps: ' + (c.apps.ok ? c.apps.count + '; streaming: ' + (c.apps.streaming.map((a) => a.name).join(', ') || 'none known') : c.apps.error));
say('Inputs: ' + (c.inputs.ok ? c.inputs.devices.map((d) => d.label).join(', ') : c.inputs.error));

if (args.includes('--backup')) {
  let shell = null;
  if (args.includes('--root')) {
    if (fs.existsSync(rootKeyFile)) shell = sshShell({ host, key: rootKeyFile, knownHosts: path.join(dir, 'lg-known-hosts') });
    else say('No root key at ' + rootKeyFile + ': the backup is taken without root.');
  }
  const b = await backup(tv, path.join(dir, 'backups'), { shell });
  // The report keeps only the allowlisted settings, as before; the full backup is a separate file, never sent.
  report.settings = b.data.ssap.settings;
  for (const line of describe(b.summary)) say(line);
  say('Backup: ' + b.file);
  say(WARNING);
}

if (args.includes('--launch')) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  report.launches = {};
  for (const l of LAUNCHES) {
    const go = (await rl.question(l.label + ' on the TV now? [y/N] ')).trim().toLowerCase() === 'y';
    if (!go) { report.launches[l.id] = { skipped: true }; continue; }
    const r = await launch(tv, l);
    const seen = r.ok ? (await rl.question('What happened on the TV? ')).trim() : '';
    report.launches[l.id] = { ...r, seen };
    if (r.ok) await rl.question('Press Back or Home on the remote to leave it, then Enter here. ');
  }
  rl.close();
}

if (args.includes('--reach')) {
  say('Checking the TV can reach this laptop (the TV\'s browser opens for a moment; Windows may ask to allow it)…');
  report.reach = await reach(tv, host, { address: reachAddr || undefined });
  say('TV reaches the laptop: ' + (report.reach.ok ? 'yes' : 'no (' + report.reach.error + ')'));
}

report.readiness = readiness(report);
const rd = report.readiness;
say('For v0: root ' + rd.root + '; Developer Mode app ' + (rd.developerModeApp ? 'installed' : 'not installed') +
  '; Homebrew Channel ' + (rd.homebrewChannel ? 'installed' : 'not installed') + '.');

// A TV this laptop rooted: is root still on, or did an LG update end it? (one `id -u` over SSH; nothing changes)
if (rootedBefore(dir, rootKeyFile)) {
  const rootShell = fs.existsSync(rootKeyFile) ? sshShell({ host, key: rootKeyFile, knownHosts: path.join(dir, 'lg-known-hosts') }) : null;
  const rs = await rootStatus({ wasRooted: true, apps: rd.appList ? c.apps.all.map((a) => a.id) : null, shell: rootShell });
  report.rootStatus = rs;
  for (const line of describeRootStatus(rs)) say(line);
}

await toast(tv, 'HomeTV check finished. Thank you!');
tv.close();

const file = path.join(dir, 'lg-check-' + report.at.slice(0, 19).replace(/[:T]/g, '-') + '.json');
fs.writeFileSync(file, JSON.stringify(report, null, 2));
say('Report: ' + file);
