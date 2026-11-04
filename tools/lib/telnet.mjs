// A small Telnet client for Homebrew Channel's root shell (port 23, no password: `telnetd -l /bin/sh` in its
// services/startup.sh). Node built-ins only. It answers the server's option questions (RFC 854/855), drops them from
// what it reads, and runs one command at a time: each is followed by an end marker carrying its exit status, so the
// laptop knows when a command is done and whether it worked, whatever the shell's prompt looks like.
import net from 'node:net';
import crypto from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';

const IAC = 255, DONT = 254, DO = 253, WONT = 252, WILL = 251, SB = 250, SE = 240;
const ECHO = 1, SGA = 3;

/** Single-quotes a value for the TV's shell. */
export const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";

/** Splits Telnet's option bytes from the data. Keeps state across chunks; `reply` gets the answers to send. */
export function telnetParser(reply) {
  let st = 'data';
  let cmd = 0;
  return (chunk) => {
    const out = [];
    for (const b of chunk) {
      if (st === 'data') { if (b === IAC) st = 'iac'; else out.push(b); }
      else if (st === 'iac') {
        if (b === IAC) { out.push(IAC); st = 'data'; }
        else if (b === SB) st = 'sb';
        else if (b === WILL || b === WONT || b === DO || b === DONT) { cmd = b; st = 'opt'; }
        else st = 'data';
      } else if (st === 'opt') {
        // The server may echo and suppress go-ahead; the laptop itself turns on nothing.
        if (cmd === DO) reply([IAC, WONT, b]);
        else if (cmd === WILL) reply([IAC, b === ECHO || b === SGA ? DO : DONT, b]);
        st = 'data';
      } else if (st === 'sb') { if (b === IAC) st = 'sb-iac'; }
      else if (st === 'sb-iac') st = b === SE ? 'data' : 'sb';
    }
    return Buffer.from(out);
  };
}

export function portOpen(host, port, ms = 3000) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (v) => { clearTimeout(t); s.destroy(); resolve(v); };
    const t = setTimeout(() => done(false), ms);
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

export async function telnetShell(host, { port = 23, connectMs = 5000, timeoutMs = 30000 } = {}) {
  const sock = net.connect({ host, port });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => { sock.destroy(); reject(new Error('no answer on port ' + port)); }, connectMs);
    sock.once('connect', () => { clearTimeout(t); resolve(); });
    sock.once('error', (e) => { clearTimeout(t); reject(e); });
  });
  const parse = telnetParser((bytes) => sock.write(Buffer.from(bytes)));
  const decoder = new StringDecoder('utf8');
  let text = '';
  let closed = false;
  let wake = () => {};
  sock.on('data', (d) => { text += decoder.write(parse(d)).replace(/\r/g, ''); wake(); });
  sock.on('close', () => { closed = true; wake(); });
  sock.on('error', () => {});
  const tag = crypto.randomBytes(4).toString('hex');
  let n = 0;

  async function run(cmd, { ms = timeoutMs } = {}) {
    const id = tag + '_' + ++n;
    // The quotes split the marker in the typed line, so an echo of the command never looks like its end.
    const re = new RegExp('__HTV_END_' + id + '_(\\d+)__');
    const start = text.length;
    sock.write(cmd + '\necho "__HTV_""END_' + id + '_$?__"\n');
    const until = Date.now() + ms;
    for (;;) {
      const m = re.exec(text.slice(start));
      if (m) {
        const out = text.slice(start, start + m.index);
        text = text.slice(start + m.index + m[0].length);
        return { code: Number(m[1]), out };
      }
      if (closed) throw new Error('the TV closed the connection');
      const left = until - Date.now();
      if (left <= 0) throw new Error('the TV did not finish a command in ' + Math.round(ms / 1000) + ' s');
      await new Promise((r) => { const t = setTimeout(r, Math.min(left, 1000)); wake = () => { clearTimeout(t); r(); }; });
    }
  }

  // A shell on a terminal repeats what it's sent and prints prompts; switch both off (the markers cope either way).
  await run("stty -echo 2>/dev/null; PS1=''; PS2=''");
  return { run, close: () => sock.end() };
}

/** Copies a file to the TV through the shell: base64 lines appended to a file, decoded, checked by its SHA-256. Lines
 * stay under 1,024 characters, the shortest limit of a shell's line editing (busybox ash's default). */
export async function pushFile(sh, remote, data, { mode = '644', line = 800, batch = 24 } = {}) {
  const b64 = Buffer.from(data).toString('base64');
  const sum = crypto.createHash('sha256').update(data).digest('hex');
  const tmp = remote + '.b64';
  const must = async (cmd, what) => { const r = await sh.run(cmd); if (r.code !== 0) throw new Error(what); return r; };
  await must('rm -f ' + q(tmp) + ' ' + q(remote + '.part') + ' && : > ' + q(tmp), 'could not write ' + remote);
  const lines = [];
  for (let i = 0; i < b64.length; i += line) lines.push("printf '%s' '" + b64.slice(i, i + line) + "' >> " + q(tmp));
  for (let i = 0; i < lines.length; i += batch) await must(lines.slice(i, i + batch).join('\n'), 'could not write ' + remote);
  await must('base64 -d ' + q(tmp) + ' > ' + q(remote + '.part') + ' && echo ' + q(sum + '  ' + remote + '.part') +
    ' | sha256sum -c >/dev/null 2>&1 && mv -f ' + q(remote + '.part') + ' ' + q(remote) + ' && chmod ' + mode + ' ' +
    q(remote) + ' && rm -f ' + q(tmp), remote + ' arrived damaged (SHA-256 differs)');
  return sum;
}
