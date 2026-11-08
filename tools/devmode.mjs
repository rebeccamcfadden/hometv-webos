// hometv-lg devmode <tv address> [--v0 <file>] [--v1 <file>] [--any-ipk] [--only v0|v1]
// HomeTV v0, then v1 over it, on a TV in Developer Mode (no root, no Dev Manager), with the checks a laptop can make on
// its own; asks the person yes or no only for what it can't see (tools/lib/devmode.mjs; docs/install.md).
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { runDevmode } from './lib/devmode.mjs';

const args = process.argv.slice(2);
// hometv-lg passes its name for this command as argv[1] (hometv-lg.mjs, DEVMODE_CMD)
const NAME = /\.[cm]?js$/.test(process.argv[1] || '') ? 'devmode' : process.argv[1];
const VALUED = ['--v0', '--v1', '--only', '--ws-port', '--key-port', '--ssh-port', '--stay-ms'];
const val = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const host = args.find((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]));
const dir = process.env.HOMETV_DIR || path.join(os.homedir(), 'HomeTV');
const only = val('--only');

if (!host || !/^[0-9A-Za-z.\-:]+$/.test(host) || (only && !['v0', 'v1'].includes(only))) {
  console.error('Usage: hometv-lg ' + NAME + ' <tv address> [--v0 <file>] [--v1 <file>] [--any-ipk] [--only v0|v1]\n\n' +
    'Installs HomeTV v0, then v1 over it, on a TV in Developer Mode (Key Server on), and checks both.\n' +
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
    host, dir, ask, say: (s) => console.log(s), v0: val('--v0'), v1: val('--v1'), anyIpk: args.includes('--any-ipk'), only,
    ssapPorts: wsPort ? [{ url: 'ws://' + host + ':' + wsPort + '/', insecure: false }] : undefined,
    keyPort: num('--key-port', 'HOMETV_TEST_KEY_PORT'), sshPort: num('--ssh-port', 'HOMETV_TEST_SSH_PORT'),
    stayMs: num('--stay-ms', 'HOMETV_TEST_STAY_MS')
  });
  if (r.stopped || r.failed) process.exitCode = 1;
}
