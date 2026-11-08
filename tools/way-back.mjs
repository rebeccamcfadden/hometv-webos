// hometv-lg root <tv address> --home-again   |   hometv-lg unroot-home <tv address>
// The light ways back from the laptop, over the root install's SSH key (tools/lib/way-back.mjs; docs/root-plan.md,
// "The way back", levels 1 and 2). Each asks first and checks the TV after the restart.
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { runWayBack } from './lib/way-back.mjs';

// hometv-lg passes its command as argv[1]
const which = process.argv[1] === 'unroot-home' ? 'unroot-home' : 'home-again';
const args = process.argv.slice(2).filter((a) => a !== '--home-again');
const VALUED = ['--ws-port'];
const val = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const host = args.find((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]));
const dir = process.env.HOMETV_DIR || path.join(os.homedir(), 'HomeTV');

if (!host || !/^[0-9A-Za-z.\-:]+$/.test(host)) {
  console.error(which === 'unroot-home'
    ? 'Usage: hometv-lg unroot-home <tv address>   (removes HomeTV\'s root edition: LG\'s Home back, Homebrew Channel stays)'
    : 'Usage: hometv-lg root <tv address> --home-again   (HomeTV as Home again after "Use LG\'s Home")');
  process.exitCode = 2;
} else {
  // Tests only: a pretend TV on plain ws at this port, and its SSH port.
  const wsPort = Number(val('--ws-port') || process.env.HOMETV_TEST_WS_PORT || 0);
  const ask = async (question) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try { return await rl.question(question); } finally { rl.close(); }
  };
  const r = await runWayBack({
    host, dir, ask,
    say: (s) => console.log(s),
    ssapPorts: wsPort ? [{ url: 'ws://' + host + ':' + wsPort + '/', insecure: false }] : undefined,
    sshPort: Number(process.env.HOMETV_TEST_SSH_PORT || 0) || undefined
  }, which);
  if (r.stopped) process.exitCode = 1;
}
