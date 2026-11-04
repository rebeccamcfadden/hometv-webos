// hometv-lg install <tv address> [--ipk <file>] [--from <step>]   |   hometv-lg install --list
// The guided install, step by step (tools/lib/install-steps.mjs; docs/install.md). Finished steps are skipped when it's
// run again; --from runs again from a step on. Keeps its notes in %USERPROFILE%\HomeTV (install-state.json,
// install-log.txt), without the TV's address.
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { runInstall, listSteps, STEPS } from './lib/install-steps.mjs';

const args = process.argv.slice(2);
const VALUED = ['--ipk', '--from', '--ws-port', '--reach-address'];
const val = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const host = args.find((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]));
const dir = process.env.HOMETV_DIR || path.join(os.homedir(), 'HomeTV');

if (args.includes('--list')) {
  console.log(listSteps(dir).join('\n'));
} else if (!host || !/^[0-9A-Za-z.\-:]+$/.test(host) || (val('--from') && !STEPS.some((s) => s.id === val('--from')))) {
  console.error('Usage: hometv-lg install <tv address> [--ipk <file>] [--from <step>]   |   hometv-lg install --list\n' +
    'Steps: ' + STEPS.map((s) => s.id).join(', '));
  process.exitCode = 2;
} else {
  // Tests only: a pretend TV on plain ws at this port, its Telnet and SSH ports, and the laptop's address for it.
  const wsPort = Number(val('--ws-port') || process.env.HOMETV_TEST_WS_PORT || 0);
  const env = process.env;
  const ask = async (question) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try { return await rl.question(question); } finally { rl.close(); }
  };
  const r = await runInstall({
    host, dir, ask,
    say: (s) => console.log(s),
    ipk: val('--ipk'),
    ssapPorts: wsPort ? [{ url: 'ws://' + host + ':' + wsPort + '/', insecure: false }] : undefined,
    reachAddress: val('--reach-address') || env.HOMETV_TEST_REACH_ADDRESS || undefined,
    telnetPort: Number(env.HOMETV_TEST_TELNET_PORT || 0) || undefined,
    sshPort: Number(env.HOMETV_TEST_SSH_PORT || 0) || undefined
  }, { from: val('--from') });
  if (r.stopped) process.exitCode = 1;
}
