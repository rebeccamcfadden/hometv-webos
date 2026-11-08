// A pretend ssh for the Developer Mode tests (HOMETV_SSH=<this file>): it acts as the TV's `prisoner` account.
// It logs every call (FAKE_LOG, one JSON line each), keeps the TV's apps and foreground in FAKE_STATE (a JSON file the
// test's pretend remote-control side reads), saves a copied .ipk under FAKE_PUTS, and with `-N -L` forwards the local
// port to the pretend inspector at FAKE_CDP_PORT. FAKE_INSTALL: ok (default), fail, or silent (no answer at all).
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const argv = process.argv.slice(2);
const at = argv.findIndex((a) => /^[a-z]+@/.test(a));
const target = argv[at];
const command = argv.slice(at + 1).join(' ');
const log = (o) => fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(o) + '\n');
const opt = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
const state = () => JSON.parse(fs.readFileSync(process.env.FAKE_STATE, 'utf8'));
const save = (s) => fs.writeFileSync(process.env.FAKE_STATE, JSON.stringify(s));
const entry = { user: target.split('@')[0], port: opt('-p'), key: path.basename(opt('-i') || ''), options: argv.filter((a, i) => argv[i - 1] === '-o'), command };

if (argv.includes('-N')) {
  const [local, , remote] = opt('-L').split(':');
  log({ ...entry, forward: { local: Number(local), remote: Number(remote) } });
  if (process.env.FAKE_NO_FORWARD) process.exit(255);
  net.createServer((c) => {
    const up = net.connect(Number(process.env.FAKE_CDP_PORT), '127.0.0.1');
    c.pipe(up).pipe(c);
    c.on('error', () => up.destroy());
    up.on('error', () => c.destroy());
  }).listen(Number(local), '127.0.0.1');
  setInterval(() => {}, 1000);
} else {
  log(entry);
  let m;
  if (command === 'id -un') {
    process.stdout.write('prisoner\n');
  } else if ((m = command.match(/^mkdir -p \/media\/developer\/temp && cat > '(\/media\/developer\/temp\/[^']+)'$/))) {
    const parts = [];
    process.stdin.on('data', (d) => parts.push(d));
    process.stdin.on('end', () => {
      const body = Buffer.concat(parts);
      fs.mkdirSync(process.env.FAKE_PUTS, { recursive: true });
      fs.writeFileSync(path.join(process.env.FAKE_PUTS, path.basename(m[1])), body);
      const s = state();
      s.version = (m[1].match(/_(\d+\.\d+\.\d+)_/) || [])[1];
      s.copied = m[1];
      save(s);
      log({ put: m[1], bytes: body.length });
    });
  } else if (command.startsWith('luna-send-pub -i') && command.includes('/dev/install')) {
    const mode = process.env.FAKE_INSTALL || 'ok';
    const say = (o) => process.stdout.write(JSON.stringify(o) + '\n');
    if (mode !== 'silent') {
      say({ returnValue: true, details: { state: 'installing' } });
      setTimeout(() => {
        if (mode === 'fail') say({ returnValue: false, details: { state: 'failed', errorCode: -5, reason: 'FAILED_IPK_SIGNATURE' } });
        else {
          const s = state();
          if (!s.apps.includes('com.hometv.app')) s.apps.push('com.hometv.app');
          save(s);
          say({ returnValue: true, details: { state: 'installed' } });
        }
      }, 150);
    }
    setInterval(() => {}, 1000);
  } else if (command.includes('settingsservice/getSystemSettings')) {
    const s = state();
    process.stdout.write(JSON.stringify(s.autoUpdate
      ? { returnValue: true, category: 'option', settings: { autoUpdate: s.autoUpdate } }
      : { returnValue: false, errorText: 'no such key' }) + '\n');
  } else if (command.includes('applicationManager/launch')) {
    const s = state();
    s.foreground = 'com.hometv.app';
    save(s);
    process.stdout.write('{"returnValue":true}\n');
  } else if (command.includes('applicationManager/getAppInfo')) {
    process.stdout.write(JSON.stringify({ returnValue: true, appInfo: { version: state().version } }) + '\n');
  } else if ((m = command.match(/^rm -f '([^']+)'$/))) {
    log({ removed: m[1] });
  } else {
    process.stderr.write('sh: not found\n');
    process.exitCode = 127;
  }
}
