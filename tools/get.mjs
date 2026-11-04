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
} else {
  console.log('hometv-lg get dev-manager   webOS Dev Manager (checked), then its installer\n' +
    'hometv-lg get root-kit      Python (no install) and SlopBro (checked), for the root step; runs nothing');
  process.exitCode = 2;
}
