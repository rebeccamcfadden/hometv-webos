// A root shell on a rooted TV, from the laptop: Homebrew Channel's SSH (root, port 22) with a key, through Windows'
// own OpenSSH client (ssh.exe, in Windows 10 and 11). Node has no SSH of its own and the tool adds no dependencies.
// Password logins are refused (BatchMode): the plan locks SSH to a key and switches Telnet off (docs/root-plan.md,
// step 7). The TV's host key is kept in the HomeTV folder, trusted the first time and checked after that.
//
// A shell is { run(command, { binary }) -> { code, stdout, stderr } }; tests pass a fake one.
import { execFile, spawn } from 'node:child_process';

/** One shell word: single quotes, with any single quote inside closed, escaped and reopened. */
export function sq(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

export function sshShell({ host, key, knownHosts, port = 22, user = 'root', timeoutMs = 30000, options = [] }) {
  // Tests only: a pretend ssh (a .mjs file run with this Node).
  const bin = process.env.HOMETV_SSH || 'ssh';
  const pre = /\.mjs$/.test(bin) ? [bin] : [];
  const exe = pre.length ? process.execPath : bin;
  const base = [
    '-p', String(port), '-i', key,
    '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=10',
    '-o', 'StrictHostKeyChecking=accept-new', '-o', 'UserKnownHostsFile=' + knownHosts,
    ...options,
    user + '@' + host
  ];
  return {
    /** `input` (a Buffer) goes to the command's standard input. */
    run(command, { binary = false, input = null } = {}) {
      return new Promise((resolve) => {
        const child = execFile(exe, [...pre, ...base, command],
          { encoding: binary ? 'buffer' : 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
          (err, stdout, stderr) => {
            const code = err ? (typeof err.code === 'number' ? err.code : 255) : 0;
            resolve({ code, stdout, stderr: String(stderr || (err && !stderr ? err.message : '')) });
          });
        child.stdin.on('error', () => {});
        child.stdin.end(input || undefined);
      });
    },
    /**
     * A command that never ends on its own (luna-send-pub -i): each output line goes to `until`, and the first
     * answer it gives other than undefined is the result; the command is stopped then, or after `ms`. It runs on a
     * terminal (-tt), so the TV hangs it up when this laptop closes the connection, rather than leaving it running.
     */
    stream(command, until, ms = timeoutMs) {
      return new Promise((resolve) => {
        const child = spawn(exe, [...pre, ...base.slice(0, -1), '-tt', base[base.length - 1], command], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        let rest = '';
        let done = false;
        const finish = (verdict) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          try { child.kill(); } catch { /* already gone */ }
          resolve({ verdict, stdout: out, stderr: err });
        };
        const timer = setTimeout(() => finish(undefined), ms);
        const feed = (line) => {
          const v = until(line.trim());
          if (v !== undefined) finish(v);
        };
        child.stdout.on('data', (d) => {
          out += d;
          rest += d;
          const lines = rest.split('\n');
          rest = lines.pop();
          for (const line of lines) { feed(line); if (done) return; }
        });
        child.stderr.on('data', (d) => { err += d; });
        child.on('error', (e) => { err += e.message; finish(undefined); });
        // 'close', not 'exit': the output has been read to its end by then
        child.on('close', () => { if (rest.trim()) feed(rest); finish(undefined); });
      });
    },
    /** `ssh -N -L`: this laptop's `localPort` reaches `remotePort` on the TV itself. Stopped by its own process id. */
    forward(localPort, remotePort) {
      const child = spawn(exe, [...pre, ...base.slice(0, -1), '-N', '-o', 'ExitOnForwardFailure=yes',
        '-L', localPort + ':127.0.0.1:' + remotePort, base[base.length - 1]], { windowsHide: true, stdio: 'ignore' });
      child.on('error', () => {});
      return { pid: child.pid, close: () => { try { child.kill(); } catch { /* already gone */ } } };
    }
  };
}

/** Is it root? `id -u` must answer 0. */
export async function isRoot(shell) {
  const r = await shell.run('id -u');
  return r.code === 0 && String(r.stdout).trim() === '0';
}

/**
 * One call on LG's internal bus (Luna) as root: `luna-send -n 1` waits for one answer. Returns the answer as an
 * object, or { returnValue: false, errorText } when the call or its output fails.
 */
export async function luna(shell, uri, payload = {}, waitMs = 10000) {
  const r = await shell.run('luna-send -n 1 -w ' + waitMs + ' ' + sq('luna://' + uri) + ' ' + sq(JSON.stringify(payload)));
  const text = String(r.stdout || '');
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b < a) return { returnValue: false, errorText: (String(r.stderr).trim() || 'no answer') + ' (exit ' + r.code + ')' };
  try {
    return JSON.parse(text.slice(a, b + 1));
  } catch {
    return { returnValue: false, errorText: 'unreadable answer' };
  }
}
