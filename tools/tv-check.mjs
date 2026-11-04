// Install step 1 (the laptop check) and step 3 (the settings backup), over LG's remote-control connection.
//
//   node tools/tv-check.mjs <tv address> [--backup] [--launch] [--reach]   (or: hometv-lg check …)
//
// Without flags: read-only checks (model and firmware, apps, inputs, sound output) and what v0 needs (root status for
// the software, Developer Mode app, Homebrew Channel). --backup also reads the settings the TV lets a paired app read.
// --launch then opens Netflix, YouTube and a YouTube video, asking first and asking what happened. --reach checks the
// TV can reach this laptop (needed for root). The TV shows "Allow" the first time; the key it gives is kept in
// %USERPROFILE%\HomeTV (never in the repo). The report goes there too, without the TV's or laptop's address, serial
// number or device id, so it can be shared.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { open } from './lib/ssap.mjs';
import { readOnlyChecks, readSettings, launch, toast, readiness, LAUNCHES } from './lib/checks.mjs';
import { reach } from './lib/reach.mjs';

const args = process.argv.slice(2);
const VALUED = ['--ws-port', '--reach-address'];
const host = args.find((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]));
const wsPortArg = args.indexOf('--ws-port');
const wsPort = wsPortArg >= 0 ? Number(args[wsPortArg + 1]) : 0;
// Tests only: the address the TV should use for this laptop.
const reachAddrArg = args.indexOf('--reach-address');
const reachAddr = reachAddrArg >= 0 ? args[reachAddrArg + 1] : '';
if (!host || !/^[0-9A-Za-z.\-:]+$/.test(host)) {
  console.error('Usage: hometv-lg check <tv address> [--backup] [--launch] [--reach]');
  process.exit(2);
}
const dir = process.env.HOMETV_DIR || path.join(os.homedir(), 'HomeTV');
fs.mkdirSync(dir, { recursive: true });
const keyFile = path.join(dir, 'lg-client-key');
const clientKey = fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8').trim() : undefined;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const say = (s) => console.log(s);

say('Connecting to the TV…');
const tv = await open(host, {
  clientKey,
  onPrompt: () => say('Press "Allow" on the TV (the remote\'s OK button).'),
  // Tests only: a pretend TV on plain ws at this port.
  ports: wsPort ? [{ url: 'ws://' + host + ':' + wsPort + '/', insecure: false }] : undefined
});
if (tv.clientKey && tv.clientKey !== clientKey) fs.writeFileSync(keyFile, tv.clientKey, { mode: 0o600 });

const report = await readOnlyChecks(tv);
const c = report.checks;
say('Model: ' + (c.system.modelName || c.software.model_name || '?') + ', software ' +
  (c.software.major_ver ? c.software.major_ver + '.' + c.software.minor_ver : '?'));
say('Apps: ' + (c.apps.ok ? c.apps.count + '; streaming: ' + (c.apps.streaming.map((a) => a.name).join(', ') || 'none known') : c.apps.error));
say('Inputs: ' + (c.inputs.ok ? c.inputs.devices.map((d) => d.label).join(', ') : c.inputs.error));

if (args.includes('--backup')) {
  report.settings = await readSettings(tv);
  const got = Object.values(report.settings).flatMap((cat) => Object.values(cat)).filter((v) => v.ok).length;
  say('Settings read for the backup: ' + got + ' (the rest are photographed).');
}

if (args.includes('--launch')) {
  report.launches = {};
  for (const l of LAUNCHES) {
    const go = (await rl.question(l.label + ' on the TV now? [y/N] ')).trim().toLowerCase() === 'y';
    if (!go) { report.launches[l.id] = { skipped: true }; continue; }
    const r = await launch(tv, l);
    const seen = r.ok ? (await rl.question('What happened on the TV? ')).trim() : '';
    report.launches[l.id] = { ...r, seen };
    if (r.ok) await rl.question('Press Back or Home on the remote to leave it, then Enter here. ');
  }
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

await toast(tv, 'HomeTV check finished. Thank you!');
tv.close();
rl.close();

const file = path.join(dir, 'lg-check-' + report.at.slice(0, 19).replace(/[:T]/g, '-') + '.json');
fs.writeFileSync(file, JSON.stringify(report, null, 2));
say('Report: ' + file);
