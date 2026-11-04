// hometv-lg: the laptop tool for HomeTV on LG, one Windows file (built with `npm run exe`).
//   hometv-lg                    double-clicked: asks for the TV's address, then runs the full check
//   hometv-lg check <tv address> [--backup] [--launch] [--reach]
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline/promises';

const [cmd, ...rest] = process.argv.slice(2);

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

async function guided() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log([
    '',
    '  HomeTV check for LG TVs (work in progress, not tested on a real TV)',
    '  ------------------------------------------------------------------',
    '  This reads your TV\'s model, software version, apps and inputs, and a few picture and',
    '  sound settings. It changes nothing on the TV. It opens Netflix and YouTube only if you say',
    '  yes. At the end it saves a report on this laptop for you to send back.',
    '',
    '  Keep the laptop on the same Wi-Fi as the TV, and the TV on.',
    '',
    '  The TV\'s address: on the TV, Settings > All Settings > General > Network >',
    '  Wi-Fi Connection > your network > Advanced Wi-Fi Settings > IP Address.',
    '  It looks like four numbers with dots, for example 192.168.1.50.',
    ''
  ].join('\n'));
  let host = '';
  for (;;) {
    host = (await rl.question('  Type the TV\'s address and press Enter: ')).trim();
    if (IPV4.test(host)) break;
    console.log('  That doesn\'t look like four numbers with dots. Try again.');
  }
  const launch = !/^n/i.test((await rl.question('  Open Netflix and YouTube on the TV to check them? [Y/n] ')).trim());
  console.log('\n  The TV will ask to "Allow" this laptop: press OK on the remote.');
  console.log('  Windows may ask to allow this tool on private networks: choose Allow.\n');
  rl.close();
  process.argv = [process.argv[0], 'tv-check', host, '--backup', '--reach', ...(launch ? ['--launch'] : [])];
  let failed = false;
  try {
    await import('./tv-check.mjs');
  } catch (e) {
    failed = true;
    console.log('\n  The check stopped: ' + (e && e.message ? e.message : e));
  }
  const dir = process.env.HOMETV_DIR || path.join(os.homedir(), 'HomeTV');
  if (!failed) {
    console.log('\n  Done. Send the report file (lg-check-…json, in the folder that opens now) to the person');
    console.log('  who sent you the link, as an email or message attachment.');
    if (process.platform === 'win32' && !process.env.HOMETV_NO_EXPLORER) spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref();
  }
  const end = readline.createInterface({ input: process.stdin, output: process.stdout });
  await end.question('\n  Press Enter to close. ');
  end.close();
}

if (cmd === 'check') {
  process.argv = [process.argv[0], 'tv-check', ...rest];
  await import('./tv-check.mjs');
} else if (!cmd) {
  await guided();
} else {
  console.log('HomeTV for LG\n\n  hometv-lg                      (double-click) asks for the TV\'s address, then checks it\n' +
    '  hometv-lg check <tv address> [--backup] [--launch] [--reach]\n\n' +
    'check   reads the TV (model, apps, inputs, what v0 needs) after its "Allow" prompt;\n' +
    '        --backup also saves the settings it can read; --launch opens Netflix and YouTube, asking first;\n' +
    '        --reach checks the TV can reach this laptop (the TV\'s browser opens for a moment).');
  process.exitCode = 2;
}
