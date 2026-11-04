// hometv-lg: the laptop tool for HomeTV on LG, one Windows file (built with `npm run exe`).
//   hometv-lg                    double-clicked: check the TV (asks for its address, then the full check), or install
//   hometv-lg check <tv address> [--backup] [--launch] [--reach]
//   hometv-lg install <tv address> [--ipk <file>] [--from <step>]   (docs/install.md)
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
    '  HomeTV for LG TVs (work in progress, not tested on a real TV)',
    '  ------------------------------------------------------------',
    '  1  Check the TV: reads it and changes nothing (the usual choice)',
    '  2  Install HomeTV, step by step: only if you were asked to (it can root the TV, and asks first)',
    ''
  ].join('\n'));
  const choice = (await rl.question('  Type 1 or 2 and press Enter [1]: ')).trim();
  if (choice === '2') {
    rl.close();
    return guidedInstall();
  }
  console.log([
    '',
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

async function guidedInstall() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('\n  The TV\'s address: on the TV, Settings > All Settings > General > Network > Wi-Fi Connection >\n' +
    '  your network > Advanced Wi-Fi Settings > IP Address. It looks like 192.168.1.50.\n');
  let host = '';
  for (;;) {
    host = (await rl.question('  Type the TV\'s address and press Enter: ')).trim();
    if (IPV4.test(host)) break;
    console.log('  That doesn\'t look like four numbers with dots. Try again.');
  }
  rl.close();
  process.argv = [process.argv[0], 'install', host];
  try {
    await import('./install.mjs');
  } catch (e) {
    console.log('\n  The install stopped: ' + (e && e.message ? e.message : e));
  }
  const end = readline.createInterface({ input: process.stdin, output: process.stdout });
  await end.question('\n  Press Enter to close. ');
  end.close();
}

if (cmd === 'check') {
  process.argv = [process.argv[0], 'tv-check', ...rest];
  await import('./tv-check.mjs');
} else if (cmd === 'install') {
  process.argv = [process.argv[0], 'install', ...rest];
  await import('./install.mjs');
} else if (cmd === 'get') {
  process.argv = [process.argv[0], 'get', ...rest];
  await import('./get.mjs');
} else if (!cmd) {
  await guided();
} else {
  console.log('HomeTV for LG\n\n  hometv-lg                      (double-click) asks: check the TV, or install HomeTV step by step\n' +
    '  hometv-lg check <tv address> [--backup] [--launch] [--reach]\n' +
    '  hometv-lg install <tv address> [--ipk <file>] [--from <step>]   (or: install --list)\n' +
    '  hometv-lg get dev-manager | root-kit\n\n' +
    'check   reads the TV (model, apps, inputs, what v0 needs) after its "Allow" prompt;\n' +
    '        --backup also saves the settings it can read; --launch opens Netflix and YouTube, asking first;\n' +
    '        --reach checks the TV can reach this laptop (the TV\'s browser opens for a moment).\n' +
    'install takes the TV from Developer Mode to HomeTV as Home (root edition), one checked step at a time;\n' +
    '        run again, it carries on where it stopped (docs/install.md).');
  process.exitCode = 2;
}
