// Install step 1 (the laptop check) and step 3 (the settings backup), over LG's remote-control connection.
//
//   node tools/tv-check.mjs <tv address> [--backup] [--launch]
//
// Without flags: read-only checks (model and firmware, apps, inputs, sound output). --backup also reads the settings
// the TV lets a paired app read. --launch then opens Netflix, YouTube and a YouTube video, asking first and asking
// what happened. The TV shows "Allow" the first time; the key it gives is kept in %USERPROFILE%\HomeTV (never in the
// repo). The report goes there too, without the TV's address, serial number or device id, so it can be shared.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { open } from './lib/ssap.mjs';
import { readOnlyChecks, readSettings, launch, toast, LAUNCHES } from './lib/checks.mjs';

const args = process.argv.slice(2);
const host = args.find((a) => !a.startsWith('--'));
if (!host || !/^[0-9A-Za-z.\-:]+$/.test(host)) {
  console.error('Usage: node tools/tv-check.mjs <tv address> [--backup] [--launch]');
  process.exit(2);
}
const dir = process.env.HOMETV_DIR || path.join(os.homedir(), 'HomeTV');
fs.mkdirSync(dir, { recursive: true });
const keyFile = path.join(dir, 'lg-client-key');
const clientKey = fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8').trim() : undefined;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const say = (s) => console.log(s);

say('Connecting to the TV…');
const tv = await open(host, { clientKey, onPrompt: () => say('Press "Allow" on the TV (the remote\'s OK button).') });
if (tv.clientKey && tv.clientKey !== clientKey) fs.writeFileSync(keyFile, tv.clientKey, { mode: 0o600 });

const report = await readOnlyChecks(tv);
const c = report.checks;
say('Model: ' + (c.software.model_name || c.system.modelName || '?') + ', software ' +
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

await toast(tv, 'HomeTV check finished. Thank you!');
tv.close();
rl.close();

const file = path.join(dir, 'lg-check-' + report.at.slice(0, 19).replace(/[:T]/g, '-') + '.json');
fs.writeFileSync(file, JSON.stringify(report, null, 2));
say('Report: ' + file);
