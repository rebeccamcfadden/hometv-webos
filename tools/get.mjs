// hometv-lg get dev-manager | root-kit: fetches the laptop's other tools (tools/lib/fetch.mjs), checked, into
// %USERPROFILE%\HomeTV\tools. dev-manager then starts its installer (Windows asks to allow it); root-kit unpacks Python
// next to SlopBro and stops there: rooting is a separate, later step.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { PINNED, download } from './lib/fetch.mjs';

const what = process.argv[2];
const dir = path.join(process.env.HOMETV_DIR || path.join(os.homedir(), 'HomeTV'), 'tools');
const log = (s) => console.log('  ' + s);

if (what === 'dev-manager') {
  const msi = await download(PINNED['dev-manager'], dir, { log });
  if (process.platform === 'win32' && !process.env.HOMETV_NO_RUN) {
    log('starting the installer: Windows may ask "Do you want to allow this app to make changes?": choose Yes.');
    spawn('msiexec.exe', ['/i', msi], { detached: true, stdio: 'ignore' }).unref();
  } else {
    log('installer ready: ' + msi);
  }
} else if (what === 'root-kit') {
  const zip = await download(PINNED.python, dir, { log });
  const py = path.join(dir, 'python');
  if (!fs.existsSync(path.join(py, 'python.exe'))) {
    fs.mkdirSync(py, { recursive: true });
    execFileSync('tar', ['-xf', zip, '-C', py]);
    log('Python unpacked (nothing installed in Windows): ' + py);
  }
  await download(PINNED.slopbro, dir, { log });
  log('root kit ready in ' + dir + '. Nothing has been run on the TV.');
} else if (what === 'recovery') {
  // Reads the stick only: nothing is downloaded or written, nothing touches the TV (docs/recovery.md)
  const { checkStick, describeStick } = await import('./lib/recovery.mjs');
  const { latestBackup } = await import('./lib/install-steps.mjs');
  const args = process.argv.slice(3);
  const val = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] || '' : null; };
  const drive = args.find((a, i) => !a.startsWith('--') && !['--model', '--software'].includes(args[i - 1]));
  if (!drive) {
    console.log('hometv-lg get recovery <stick drive letter, for example E> [--model <model>] [--software <version>]');
    process.exitCode = 2;
  } else {
    const b = latestBackup(path.dirname(dir));
    const tv = (b && b.data.tv) || {};
    const model = val('--model') ?? tv.model ?? '';
    const software = val('--software') ?? tv.software ?? '';
    log('The USB stick for LG\'s USB recovery (level 5), for ' + (model || 'a TV of unknown model') +
      (software ? ', software ' + software : '') + (val('--model') === null && b ? ' (from the backup ' + b.file + ')' : '') + ':');
    const r = checkStick(drive, { model, software });
    for (const l of describeStick(r)) log('  ' + l);
    if (r.ok) log('Ready. Keep the stick with the TV. Steps: docs/recovery.md, level 5.');
    else if (!r.problems.length) log('Ready once you have checked the "?" lines by hand.');
    else { log('Not ready yet. How to prepare it: docs/recovery.md, "The USB stick".'); process.exitCode = 1; }
  }
} else {
  console.log('hometv-lg get dev-manager   webOS Dev Manager (checked), then its installer\n' +
    'hometv-lg get root-kit      Python (no install) and SlopBro (checked), for the root step; runs nothing\n' +
    'hometv-lg get recovery <E>  checks the USB stick for LG\'s USB recovery (FAT32, LG_DTV, one firmware file); reads only');
  process.exitCode = 2;
}
