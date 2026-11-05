// Sending a TMDB account call (the Android launcher's AccountHttp) over XMLHttpRequest, which takes a method, a body and a
// timeout on Chromium 56. The bearer token is put in the Authorization header here, at the last moment, from the
// household's read token (`app`) or the signed-in account's access token (`user`); neither is logged, cached or kept
// in the call. Resolves to the status and body, or null when nothing answered; never rejects.

import { type Call, type Reply } from './api';

export const TIMEOUT = 15000;
const MAX_CHARS = 512 * 1024;

export function sendXhr(c: Call, bearer: string, timeoutMs = TIMEOUT): Promise<Reply | null> {
  return new Promise((resolve) => {
    let done = false;
    let guard = 0;
    const end = (v: Reply | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(guard);
      resolve(v);
    };
    try {
      const xhr = new XMLHttpRequest();
      xhr.open(c.method, c.url);
      xhr.timeout = timeoutMs;
      xhr.setRequestHeader('Accept', 'application/json');
      if (bearer) xhr.setRequestHeader('Authorization', `Bearer ${bearer}`);
      if (c.body != null) xhr.setRequestHeader('Content-Type', 'application/json;charset=utf-8');
      xhr.onload = () => end(xhr.status === 0 || xhr.responseText.length > MAX_CHARS ? null : { status: xhr.status, body: xhr.responseText });
      xhr.onerror = xhr.ontimeout = xhr.onabort = () => end(null);
      xhr.send(c.body);
      // Some engines skip ontimeout on a dead network: give up a little after it anyway, and don't leave the timer behind.
      guard = window.setTimeout(() => {
        end(null);
        try {
          xhr.abort();
        } catch (e) {
          // Already finished.
        }
      }, timeoutMs + 2000);
    } catch (e) {
      end(null);
    }
  });
}
