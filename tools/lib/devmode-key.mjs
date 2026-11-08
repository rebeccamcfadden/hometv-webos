// The Developer Mode key, the way ares-setup-device does it: the TV's Developer Mode app, with Key Server on, serves
// an encrypted RSA private key at http://<tv>:9991/webos_rsa, and its 6-character passphrase (shown in that app, case
// sensitive) opens it. Node's crypto opens it; the plain key is kept in the HomeTV folder for Windows' own ssh, which
// logs in to the TV's Developer Mode account (`prisoner`, port 9922) with it.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { lockFile } from './sshkey.mjs';

export const KEY_SERVER_DOWN = 'The TV\'s key server didn\'t answer. In the Developer Mode app on the TV, switch "Key Server" on ' +
  '(the app then shows a passphrase), and check the laptop and the TV are on the same Wi-Fi.';

export function keyFile(dir) {
  return path.join(dir, 'devmode_rsa');
}

/** The encrypted key's text, or { error } in plain words. */
export function fetchKey(host, { port = 9991, timeoutMs = 6000 } = {}) {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: '/webos_rsa', timeout: timeoutMs }, (res) => {
      const parts = [];
      res.on('data', (d) => parts.push(d));
      res.on('end', () => {
        const text = Buffer.concat(parts).toString('utf8');
        if (res.statusCode !== 200 || !/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) resolve({ error: KEY_SERVER_DOWN });
        else resolve({ pem: text });
      });
      res.on('error', () => resolve({ error: KEY_SERVER_DOWN }));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve({ error: KEY_SERVER_DOWN }));
  });
}

/** The key in OpenSSH-readable PKCS#1 text, or null when the passphrase is wrong. */
export function openKey(pem, passphrase) {
  try {
    const key = crypto.createPrivateKey({ key: pem, passphrase });
    return key.export({ type: 'pkcs1', format: 'pem' });
  } catch {
    return null;
  }
}

export function saveKey(dir, plain) {
  fs.mkdirSync(dir, { recursive: true });
  const file = keyFile(dir);
  fs.writeFileSync(file, plain, { mode: 0o600 });
  lockFile(file);
  return file;
}

/**
 * Gets the key with the passphrase the person types (three tries), saves it, and returns its file; or { error }.
 * `ask(question)` is the person's typed answer.
 */
export async function getKey(host, dir, ask, say, opts = {}) {
  const got = await fetchKey(host, opts);
  if (got.error) return { error: got.error };
  for (let tries = 0; tries < 3; tries++) {
    const pass = (await ask('  Type the passphrase the Developer Mode app shows (6 characters, capitals matter) and press Enter: ')).trim();
    const plain = pass ? openKey(got.pem, pass) : null;
    if (plain) return { file: saveKey(dir, plain) };
    say('  That passphrase didn\'t open the key. Look at the Developer Mode app again: capital and small letters count.');
  }
  return { error: 'The passphrase didn\'t work three times. Open the Developer Mode app, read the passphrase again, and run this again.' };
}
