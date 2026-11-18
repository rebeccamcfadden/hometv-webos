// hometv-lg-root prepare <tv address> [--from <step>]   |   prepare --list   |   prepare --undo
// Getting ready for the call, step by step (tools/lib/prepare.mjs; docs/root.md, "Before the call"). It never changes
// the TV and never roots. Finished steps are skipped when it's run again; --from runs again from a step on. --undo puts
// back what it changed on this laptop's firewall. Its notes and report are in %USERPROFILE%\HomeTV, without the TV's address.
import os from 'node:os';
import path from 'node:path';
import sea from 'node:sea';
import readline from 'node:readline/promises';
import { runPrepare, undoPrepare, listSteps, PREPARE_STEPS } from './lib/prepare.mjs';

const args = process.argv.slice(2);
const VALUED = ['--from', '--ws-port', '--reach-address'];
const val = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const host = args.find((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]));
const dir = process.env.HOMETV_DIR || path.join(os.homedir(), 'HomeTV');
const ask = async (question) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { return await rl.question(question); } finally { rl.close(); }
};
const say = (s) => console.log(s);

if (args.includes('--list')) {
  console.log(listSteps(dir).join('\n'));
} else if (args.includes('--undo')) {
  const r = await undoPrepare({ dir, say });
  if (r.stopped) process.exitCode = 1;
} else if (!host || !/^[0-9A-Za-z.\-:]+$/.test(host) || (val('--from') && !PREPARE_STEPS.some((s) => s.id === val('--from')))) {
  console.error('Usage: hometv-lg-root prepare <tv address> [--from <step>]   |   prepare --list   |   prepare --undo\n' +
    'Steps: ' + PREPARE_STEPS.map((s) => s.id).join(', '));
  process.exitCode = 2;
} else {
  // Tests only: a pretend TV on plain ws at this port, and the laptop's address for it.
  const wsPort = Number(val('--ws-port') || process.env.HOMETV_TEST_WS_PORT || 0);
  const r = await runPrepare({
    host, dir, ask, say,
    exePath: sea.isSea() ? process.execPath : undefined,
    ssapPorts: wsPort ? [{ url: 'ws://' + host + ':' + wsPort + '/', insecure: false }] : undefined,
    reachAddress: val('--reach-address') || process.env.HOMETV_TEST_REACH_ADDRESS || undefined
  }, { from: val('--from') });
  if (r.stopped) process.exitCode = 1;
}
