// The laptop's SSH key for the rooted TV: an Ed25519 pair made with Node's crypto, written in OpenSSH's own formats
// (the public line Homebrew Channel's SSH server reads from /home/root/.ssh/authorized_keys, and an unencrypted
// "openssh-key-v1" private key, as `ssh-keygen -t ed25519 -N ""` writes, for Windows' own ssh). Only the public key
// ever leaves the laptop. The comment is fixed ("hometv-lg"): no user or computer name.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';

export const COMMENT = 'hometv-lg';
const str = (b) => { const s = Buffer.isBuffer(b) ? b : Buffer.from(b); const l = Buffer.alloc(4); l.writeUInt32BE(s.length); return Buffer.concat([l, s]); };
const u32 = (n) => { const l = Buffer.alloc(4); l.writeUInt32BE(n); return l; };

export function makeKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  const seed = Buffer.from(privateKey.export({ format: 'jwk' }).d, 'base64url');
  const blob = Buffer.concat([str('ssh-ed25519'), str(pub)]);
  const check = crypto.randomBytes(4);
  let priv = Buffer.concat([check, check, str('ssh-ed25519'), str(pub), str(Buffer.concat([seed, pub])), str(COMMENT)]);
  const pad = [];
  for (let i = 1; (priv.length + pad.length) % 8; i++) pad.push(i);
  priv = Buffer.concat([priv, Buffer.from(pad)]);
  const body = Buffer.concat([Buffer.from('openssh-key-v1\0'), str('none'), str('none'), str(''), u32(1), str(blob), str(priv)]);
  const b64 = body.toString('base64').match(/.{1,70}/g).join('\n');
  return {
    publicLine: 'ssh-ed25519 ' + blob.toString('base64') + ' ' + COMMENT,
    privatePem: '-----BEGIN OPENSSH PRIVATE KEY-----\n' + b64 + '\n-----END OPENSSH PRIVATE KEY-----\n'
  };
}

/** The key pair in <dir>/ssh, made once and kept. Returns the paths and the public line. */
export function laptopKey(dir) {
  const d = path.join(dir, 'ssh');
  const file = path.join(d, 'hometv-lg_ed25519');
  if (!fs.existsSync(file) || !fs.existsSync(file + '.pub')) {
    fs.mkdirSync(d, { recursive: true });
    const k = makeKey();
    fs.writeFileSync(file, k.privatePem, { mode: 0o600 });
    fs.writeFileSync(file + '.pub', k.publicLine + '\n');
    // Windows' ssh ignores a private key other accounts can read: this account only (icacls is part of Windows)
    if (process.platform === 'win32') {
      try {
        execFileSync('icacls', [file, '/inheritance:r', '/grant:r', os.userInfo().username + ':F'], { stdio: 'ignore' });
      } catch { /* the key still works for this tool; ssh may warn */ }
    }
  }
  return { file, publicLine: fs.readFileSync(file + '.pub', 'utf8').trim() };
}
