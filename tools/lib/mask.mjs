// The masking rules for anything HomeTV's tools show, log or keep about a TV: the reports, install-log.txt, the TV's
// start-up notes, and the error report to come. From lasharor/cleanyourtv-WebOS's helper/sharelog.js redact() (MIT,
// read at 2debe62; its LAN page isn't taken): addresses, MAC addresses, URL paths, and the values of token, key,
// password and secret fields. Ours on top: the TV's own host name, IPv6 addresses and the Windows home folder.

const IPV4 = /\b(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g;
const MAC = /\b([0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi;
// a full IPv6 address, or a shortened one (with ::); times like 12:30:45 aren't matched
const IPV6 = /\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}\b|\b(?:[0-9a-f]{1,4}:)+:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?(?![0-9a-z:])|(?<![0-9a-z:])::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)\b/gi;
// a URL keeps its scheme, host and port; its path and query go (they can carry names, ids and tokens)
const URL_PATH = /\b((?:https?|wss?):\/\/[^\s/"'<>)]+)\/[^\s"'<>)]+/gi;
const SECRET_NAMES = 'token|key|password|passwd|pass|secret|apikey|api_key|access_token|refresh_token';
// "token": "…" in JSON, and token=… in a query or a command line; also with a prefix (LG's "client-key", client_key=)
const SECRET_JSON = new RegExp('("[\\w-]*?(?:' + SECRET_NAMES + ')"\\s*:\\s*")[^"]*"', 'gi');
const SECRET_ARG = new RegExp('(?<![0-9a-z])([\\w-]*?(?:' + SECRET_NAMES + ')=)[^\\s&"\']+', 'gi');

/** Masks `text`. `host`: the TV's address or name as the person typed it; `home`: a folder shown as %USERPROFILE%. */
export function mask(text, { host, home } = {}) {
  // URLs and secrets first: once the host is <tv ip>, a URL to the TV would no longer look like one
  let s = String(text)
    .replace(URL_PATH, '$1/…')
    .replace(SECRET_JSON, '$1…"')
    .replace(SECRET_ARG, '$1…');
  if (host) s = s.split(host).join('<tv ip>');
  if (home) s = s.split(home).join('%USERPROFILE%');
  return s
    .replace(MAC, '<mac>')
    // IPv4 first, so an IPv4-mapped IPv6 address (::ffff:192.168.1.50) loses its IPv4 part too
    .replace(IPV4, '<ip>')
    .replace(IPV6, '<ip6>');
}
