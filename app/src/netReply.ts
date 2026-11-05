// One GET that tells its status and headers, over XMLHttpRequest, for the price sources: the keyed ones say how much of
// their quota is spent in the reply's headers (net.ts getText returns only the body). Never rejects: null means no
// answer (offline, refused, too slow). The page can read only headers the server exposes (Access-Control-Expose-Headers);
// the others are missing from `headers`, and the quota then runs on the local count alone (policy.ts).

export interface Reply {
  code: number;
  body: string;
  headers: Record<string, string>;
}

function parseHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return out;
}

export function getReply(url: string, headers: Record<string, string> = {}, timeoutMs = 10000, maxChars = 512 * 1024): Promise<Reply | null> {
  return new Promise((resolve) => {
    let done = false;
    const end = (v: Reply | null) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url);
      xhr.timeout = timeoutMs;
      xhr.setRequestHeader('Accept', 'application/json');
      for (const k of Object.keys(headers)) xhr.setRequestHeader(k, headers[k]);
      xhr.onload = () => end(xhr.responseText.length <= maxChars ? { code: xhr.status, body: xhr.responseText, headers: parseHeaders(xhr.getAllResponseHeaders() || '') } : null);
      xhr.onerror = xhr.ontimeout = xhr.onabort = () => end(null);
      xhr.send();
      window.setTimeout(() => end(null), timeoutMs + 2000);
    } catch (e) {
      end(null);
    }
  });
}
