// A small GET over XMLHttpRequest with a timeout (Chromium 56 has fetch but no AbortController to stop one). Resolves
// to the answer's text, or null when offline, refused, too slow or too large; never rejects, so no caller waits on
// the network or has to catch.

export function getText(url: string, timeoutMs = 10000, maxChars = 256 * 1024, headers?: Record<string, string>): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const end = (v: string | null) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url);
      xhr.timeout = timeoutMs;
      xhr.setRequestHeader('Accept', 'application/json');
      if (headers) for (const k of Object.keys(headers)) xhr.setRequestHeader(k, headers[k]);
      xhr.onload = () => end(xhr.status === 200 && xhr.responseText.length <= maxChars ? xhr.responseText : null);
      xhr.onerror = xhr.ontimeout = xhr.onabort = () => end(null);
      xhr.send();
      // Some engines skip ontimeout on a dead network: give up a little after it anyway.
      window.setTimeout(() => end(null), timeoutMs + 2000);
    } catch (e) {
      end(null);
    }
  });
}
