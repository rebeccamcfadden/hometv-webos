// A root shell on a rooted TV, from the laptop: Homebrew Channel's SSH (root, port 22) with a key, through Windows'
// own OpenSSH client (ssh.exe, in Windows 10 and 11). Node has no SSH of its own and the tool adds no dependencies.
// Password logins are refused (BatchMode): the plan locks SSH to a key and switches Telnet off (docs/root-plan.md,
// step 7). The TV's host key is kept in the HomeTV folder, trusted the first time and checked after that.
//
// A shell is { run(command, { binary }) -> { code, stdout, stderr } }; tests pass a fake one.
import { execFile } from 'node:child_process';

/** One shell word: single quotes, with any single quote inside closed, escaped and reopened. */
export function sq(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

export function sshShell({ host, key, knownHosts, port = 22, user = 'root', timeoutMs = 30000 }) {
  // Tests only: a pretend ssh (a .mjs file run with this Node).
  const bin = process.env.HOMETV_SSH || 'ssh';
  const pre = /\.mjs$/.test(bin) ? [bin] : [];
  const exe = pre.length ? process.execPath : bin;
  const base = [
    '-p', String(port), '-i', key,
    '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=10',
    '-o', 'StrictHostKeyChecking=accept-new', '-o', 'UserKnownHostsFile=' + knownHosts,
    user + '@' + host
  ];
  return {
    run(command, { binary = false } = {}) {
      return new Promise((resolve) => {
        execFile(exe, [...pre, ...base, command],
          { encoding: binary ? 'buffer' : 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
          (err, stdout, stderr) => {
            const code = err ? (typeof err.code === 'number' ? err.code : 255) : 0;
            resolve({ code, stdout, stderr: String(stderr || (err && !stderr ? err.message : '')) });
          });
      });
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
