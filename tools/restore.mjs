// Puts the TV's settings back from a backup taken with `hometv-lg check --backup` (docs/backup.md).
//
//   hometv-lg restore <backup file> <tv address> [--root] [--dry-run]
//
// Always shows first what would change. Without --root: reads the TV over LG's remote-control connection and lists
// the menu steps for each setting that differs; nothing is written. With --root (a rooted TV, SSH with the key in
// %USERPROFILE%\HomeTV\lg-root-key): checks the shell is root and the TV is the backup's model, asks you to type
// "restore", then writes only the backup's keys that differ, one category at a time, and stops at the first error.
// Never a factory reset.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { open } from './lib/ssap.mjs';
import { sshShell } from './lib/root-shell.mjs';
import { loadBackup, wanted, plan, rootReader, ssapReader, describePlan, precheck, apply, guarded } from './lib/restore.mjs';

const args = process.argv.slice(2);
const VALUED = ['--ws-port'];
const [file, host] = args.filter((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]));
const wsPortArg = args.indexOf('--ws-port');
const wsPort = wsPortArg >= 0 ? Number(args[wsPortArg + 1]) : Number(process.env.HOMETV_TEST_WS_PORT || 0);
const root = args.includes('--root');
const dryRun = args.includes('--dry-run');
const say = (s) => console.log(s);

if (!file || !host || !/^[0-9A-Za-z.\-:]+$/.test(host)) {
  console.error('Usage: hometv-lg restore <backup file> <tv address> [--root] [--dry-run]');
  process.exit(2);
}

let data;
try {
  if (!fs.existsSync(file)) throw new Error('no file at ' + path.resolve(file));
  data = loadBackup(file);
} catch (e) {
  console.error('Can\'t use that backup: ' + e.message);
  process.exit(1);
}
say('Backup from ' + data.at.slice(0, 16).replace('T', ' ') + ', ' + (data.tv.model || 'model unknown') + (data.tv.software ? ', software ' + data.tv.software : '') + '.');

const dir = process.env.HOMETV_DIR || path.join(os.homedir(), 'HomeTV');
class Stop extends Error {}
const stop = (msg) => { throw new Stop(msg); };

async function main() {
  let read;
  let shell = null;
  let tv = null;
  if (root) {
    const key = process.env.HOMETV_ROOT_KEY || path.join(dir, 'lg-root-key');
    if (!fs.existsSync(key)) stop('no root key at ' + key + ' (set up by the root install).');
    shell = guarded(sshShell({ host, key, knownHosts: path.join(dir, 'lg-known-hosts') }));
    say('Checking the TV (root)…');
    const pre = await precheck(shell, data);
    if (!pre.ok) stop(pre.error + '.');
    for (const n of pre.notes) say('Note: ' + n);
    read = rootReader(shell);
  } else {
    fs.mkdirSync(dir, { recursive: true });
    const keyFile = path.join(dir, 'lg-client-key');
    const clientKey = fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8').trim() : undefined;
    say('Connecting to the TV…');
    tv = await open(host, {
      clientKey,
      onPrompt: () => say('Press "Allow" on the TV (the remote\'s OK button).'),
      ports: wsPort ? [{ url: 'ws://' + host + ':' + wsPort + '/', insecure: false }] : undefined
    });
    if (tv.clientKey && tv.clientKey !== clientKey) fs.writeFileSync(keyFile, tv.clientKey, { mode: 0o600 });
    const sys = await tv.request('system/getSystemInfo');
    const model = sys.returnValue === false ? '' : String(sys.modelName || '');
    if (data.tv.model && model && model !== data.tv.model) { tv.close(); stop('this TV is a ' + model + ', the backup is from a ' + data.tv.model + '.'); }
    read = ssapReader(tv);
  }

  const p = await plan(wanted(data), read);
  say('');
  for (const line of describePlan(p, { root })) say(line);
  say('');

  if (!root) {
    tv.close();
    say('Nothing was changed on the TV. (Writing settings needs root: hometv-lg restore … --root.)');
    return 0;
  }

  const writes = p.rows.filter((r) => r.state === 'differs' && r.writable);
  if (!writes.length) { say('Nothing to write.'); return 0; }
  if (dryRun) { say('Dry run: nothing written.'); return 0; }

  const cats = new Set(writes.map((r) => r.category)).size;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('Type restore and press Enter to write these ' + writes.length + ' settings in ' + cats + ' categories (anything else stops): ')).trim();
  rl.close();
  if (answer !== 'restore') { say('Stopped: nothing written.'); return 0; }

  const r = await apply(shell, p.rows, { log: say });
  if (!r.ok) {
    say('Stopped at ' + r.category + ': ' + r.error + '.');
    say(r.written.length ? 'Written before it: ' + r.written.join(', ') + '. Everything after it is unchanged.' : 'Nothing was written.');
    return 1;
  }
  say('Done: ' + r.written.join(', ') + ' written and read back.');
  return 0;
}

try {
  process.exitCode = await main();
} catch (e) {
  if (!(e instanceof Stop)) throw e;
  say('Stopped, nothing written: ' + e.message);
  process.exitCode = 1;
}
