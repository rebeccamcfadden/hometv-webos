// hometv-lg devmode <tv address> [--v2 <file>] [--from-v0] [--v0 <file>] [--any-ipk] [--only v0|v2]
// HomeTV v2 (0.2.0) on a TV in Developer Mode (no root, no Dev Manager), over the HomeTV already there (its settings are
// checked through the update) or as a first install; --from-v0 installs v0 first and v2 over it. The checks a laptop can make on
// its own; asks the person yes or no only for what it can't see (tools/lib/devmode.mjs; docs/install.md).
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { runDevmode } from './lib/devmode.mjs';

const args = process.argv.slice(2);
// hometv-lg passes its name for this command as argv[1] (hometv-lg.mjs, DEVMODE_CMD)
const NAME = /\.[cm]?js$/.test(process.argv[1] || '') ? 'devmode' : process.argv[1];
const VALUED = ['--v0', '--v2', '--only', '--ws-port', '--key-port', '--ssh-port', '--stay-ms'];
const val = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const host = args.find((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]));
const dir = process.env.HOMETV_DIR || path.join(os.homedir(), 'HomeTV');
const only = val('--only');

if (!host || !/^[0-9A-Za-z.\-:]+$/.test(host) || (only && !['v0', 'v2'].includes(only)) || (only && args.includes('--from-v0'))) {
  console.error('Usage: hometv-lg ' + NAME + ' <tv address> [--v2 <file>] [--from-v0] [--v0 <file>] [--any-ipk] [--only v0|v2]\n\n' +
    'Installs HomeTV v2 (0.2.0) on a TV in Developer Mode (Key Server on), over the HomeTV already there or on its own,\n' +
    'and checks it; --from-v0 installs v0 first and v2 over it.\n' +
    'Nothing on the TV is changed outside Developer Mode\'s own folder; no root.');
  process.exitCode = 2;
} else {
  // Tests only: a pretend TV on plain ws at this port, and its other ports.
  const env = process.env;
  const num = (k, e) => Number(val(k) || env[e] || 0) || undefined;
  const wsPort = num('--ws-port', 'HOMETV_TEST_WS_PORT');
  const ask = async (question) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try { return await rl.question(question); } finally { rl.close(); }
  };
  console.log([
    '', '  Before this: on the TV open the Developer Mode app, switch "Dev Mode Status" and "Key Server" on.',
    '  The TV will ask to "Allow" this laptop: press OK on the remote. Windows may ask to allow this tool on',
    '  private networks: choose Allow. Nothing outside Developer Mode\'s own folder is changed on the TV.'
  ].join('\n'));
  const r = await runDevmode({
    host, dir, ask, say: (s) => console.log(s), v0: val('--v0'), v2: val('--v2'), fromV0: args.includes('--from-v0'), anyIpk: args.includes('--any-ipk'), only,
    ssapPorts: wsPort ? [{ url: 'ws://' + host + ':' + wsPort + '/', insecure: false }] : undefined,
    keyPort: num('--key-port', 'HOMETV_TEST_KEY_PORT'), sshPort: num('--ssh-port', 'HOMETV_TEST_SSH_PORT'),
    stayMs: num('--stay-ms', 'HOMETV_TEST_STAY_MS')
  });
  if (r.stopped || r.failed) process.exitCode = 1;
}
