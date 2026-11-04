// A pretend Homebrew Channel Telnet (the rooted TV's port 23 root shell) for the tests: Git's sh behind a TCP port,
// with what a terminal adds (Telnet option questions, each line sent back until `stty -echo`, CR LF line ends, stray
// option bytes in the output). Commands run on this PC in a folder that stands for the TV; the stub luna-send keeps
// Homebrew Channel's switches as files there, as its service does in /var/luna/preferences.
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const IAC = 255;
export const SH = ['C:/Program Files/Git/bin/sh.exe', '/bin/sh', '/usr/bin/sh'].find((p) => fs.existsSync(p));
export const fwd = (p) => p.replace(/\\/g, '/');
// PATH entries for Git's sh: C:/x would split at the colon, so /c/x.
export const msys = (p) => fwd(p).replace(/^([A-Za-z]):/, (m, d) => '/' + d.toLowerCase());

export const STUBS = {
  id: 'echo 0',
  stty: 'exit 0',
  'luna-send': `echo "luna $*" >> "$STUB_LOG"
case "$*" in
  *hbchannel.service/setConfiguration*)
    if [ -z "$STUB_HBC_IGNORE" ]; then
      case "$*" in *'"telnetDisabled":true'*) touch "$STUB_PREFS/webosbrew_telnet_disabled";; esac
      case "$*" in *'"sshdEnabled":true'*) touch "$STUB_PREFS/webosbrew_sshd_enabled";; esac
    fi
    echo '{"returnValue": true}';;
  *hbchannel.service/getConfiguration*)
    f() { [ -e "$STUB_PREFS/$1" ] && echo true || echo false; }
    printf '{\\n    "returnValue": true,\\n    "root": %s,\\n    "telnetDisabled": %s,\\n    "sshdEnabled": %s,\\n    "blockUpdates": %s,\\n    "failsafe": false\\n}\\n' \\
      "\${STUB_HBC_ROOT:-true}" "$(f webosbrew_telnet_disabled)" "$(f webosbrew_sshd_enabled)" "$(f webosbrew_block_updates)";;
  *appInstallService/dev/install*)
    if [ -n "$STUB_INSTALL_FAIL" ]; then echo '{"details": {"state": "install failed"}}'
    else mkdir -p "$STUB_APP" && echo '<title>HomeTV</title>' > "$STUB_APP/index.html" && echo '{"details": {"state": "installed"}}'; fi;;
  *getForegroundAppInfo*) echo '{"appId": "com.webos.app.home"}';;
  *) echo '{"returnValue": true}';;
esac`
};

/** A folder standing for the rooted TV, the stub commands, and the environment its shell runs with. */
export function fakeRootedTv(t, extraEnv = {}) {
  const p = (...x) => path.join(t, ...x);
  for (const d of ['bin', 'hometv', 'app', 'initd', 'ssh', 'tmp', 'prefs', 'stock-home']) fs.mkdirSync(p(d), { recursive: true });
  for (const [name, body] of Object.entries(STUBS)) fs.writeFileSync(p('bin', name), '#!/bin/sh\n' + body + '\n');
  fs.writeFileSync(p('stock-home', 'appinfo.json'), JSON.stringify({ id: 'com.webos.app.home', type: 'flutter', main: 'lib/app', title: 'Home' }));
  fs.writeFileSync(p('mounts'), 'rootfs / rootfs ro 0 0\n');
  const pathVar = [msys(p('bin')), msys(path.dirname(process.execPath)), '/usr/bin', '/bin'].join(':');
  const env = {
    ...process.env,
    HOMETV_DIR: fwd(p('hometv')), HOMETV_APP: fwd(p('app')), HOMETV_INITD: fwd(p('initd')),
    HOMETV_DEVMODE_APP: fwd(p('devmode-app')), HOMETV_HOME_INFO: fwd(p('stock-home', 'appinfo.json')),
    HOMETV_MOUNTS: fwd(p('mounts')), HOMETV_LOG: fwd(p('boot.log')), HOMETV_PATH: pathVar,
    STUB_LOG: fwd(p('stub.log')), STUB_PREFS: fwd(p('prefs')), STUB_APP: fwd(p('app')),
    ...extraEnv
  };
  const tvPaths = { dir: fwd(p('hometv')), app: fwd(p('app')), initd: fwd(p('initd')), ssh: fwd(p('ssh')), tmp: fwd(p('tmp')) };
  return { env, tvPaths, setup: 'export PATH="' + pathVar + '"' };
}

export function fakeTelnet({ sh = SH, env, setup = '' }) {
  const seen = { connections: 0, text: '' };
  const sockets = new Set();
  const server = net.createServer((sock) => {
    seen.connections++;
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    const child = spawn(sh, ['-s'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let echo = true;
    const toSock = (d) => {
      if (!sock.destroyed) sock.write(Buffer.concat([Buffer.from([IAC, 241]), Buffer.from(d.toString('utf8').replace(/\n/g, '\r\n'))]));
    };
    child.stdout.on('data', toSock);
    child.stderr.on('data', toSock);
    child.on('exit', () => sock.end());
    child.stdin.on('error', () => {});
    sock.on('error', () => {});
    sock.on('close', () => child.kill());
    sock.write(Buffer.from([IAC, 253, 1, IAC, 253, 31, IAC, 251, 1, IAC, 251, 3]));
    sock.write('\r\nwebOS TV\r\n# ');
    child.stdin.write(setup + '\n');
    sock.on('data', (d) => {
      const out = [];
      for (let i = 0; i < d.length; i++) { if (d[i] === IAC) { i += 2; continue; } out.push(d[i]); }
      const text = Buffer.from(out).toString('utf8');
      seen.text += text;
      if (echo) sock.write(text.replace(/\n/g, '\r\n'));
      if (/stty -echo/.test(text)) echo = false;
      child.stdin.write(text);
    });
  });
  // The TV restarting with Telnet switched off: the port closes.
  const stop = () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); });
  return { server, seen, stop };
}
