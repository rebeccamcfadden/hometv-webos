// Makes the Ed25519 key pair that signs HomeTV's LG page releases. Node's own crypto, no packages.
// Usage: node tools/page-key.mjs [--out <path>]   (default: ~/.hometv/webos-page-key.pem)
//
// The private key is written outside this repo only, never over an existing file; the public key is printed, to
// paste into app/loader/page-keys.txt. docs/updates.md says how to keep the private key. From hometv-tizen's
// tools/page-key.mjs (5ac0b52); the LG key has its own default file, so a leak of one doesn't reach the other TV.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_KEY = path.join(os.homedir(), '.hometv', 'webos-page-key.pem');

/** True when p is this repo or inside it. */
export function insideRepo(p) {
  const rel = path.relative(root, path.resolve(p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** The raw 32-byte public key, base64: the form app/loader/page-keys.txt and TweetNaCl use. */
export function rawPublicKey(key) {
  const pub = key.type === 'private' ? crypto.createPublicKey(key) : key;
  return Buffer.from(pub.export({ format: 'jwk' }).x, 'base64url').toString('base64');
}

export function makeKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }), publicKey: rawPublicKey(publicKey), privateKey };
}

function main() {
  const i = process.argv.indexOf('--out');
  const out = path.resolve(i > 0 ? process.argv[i + 1] : DEFAULT_KEY);
  if (insideRepo(out)) {
    console.error(`Refused: ${out} is inside the repo. The private key must live outside it (default ${DEFAULT_KEY}).`);
    process.exit(1);
  }
  if (fs.existsSync(out)) {
    console.error(`Refused: ${out} already exists. Pick another --out, or keep using that key.`);
    process.exit(1);
  }
  const { privatePem, publicKey } = makeKeyPair();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, privatePem, { flag: 'wx', mode: 0o600 });
  console.log(`Private key saved: ${out}
  Keep it on this PC only, plus one copy somewhere safe offline (a USB stick in a drawer, or a password manager).
  Never put it in git, a chat or a cloud folder. Whoever has it can send pages to the TV.

Public key (paste this line into app/loader/page-keys.txt, then rebuild and reinstall the app):
${publicKey}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
