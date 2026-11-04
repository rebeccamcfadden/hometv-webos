// HomeTV's page updater on LG. Plain ES5, loaded by boot.js only after Home shows, and only when the app was built
// with an update address and at least one public key. It never changes the page shown now: it downloads a newer page
// into the page's IndexedDB, and boot.js uses it at the next start.
//
// What it accepts: a manifest (JSON) whose exact bytes carry an Ed25519 signature from a key built into the app
// (manifest.json and manifest.json.sig, base64), for app "hometv-webos", format 1, a version newer than every page
// the TV has, needing no newer app than this one; then each file, from <manifest folder>/<version>/<path>, with the
// size and SHA-512 the manifest lists. TweetNaCl (vendor/tweetnacl, nacl-fast.min.js) does the checks. Ported from
// hometv-tizen's app/loader/update.js (5ac0b52); the checks are the same, only the app name and the storage differ.
(function (win) {
  "use strict";

  var FORMAT = 1;
  var APP = "hometv-webos";
  var MAX_MANIFEST = 256 * 1024;
  var MAX_FILES = 300;
  var MAX_FILE = 8 * 1024 * 1024;
  var MAX_TOTAL = 32 * 1024 * 1024;
  var MAX_BODY = 20000;
  var MAX_PATH = 200;
  var TIMEOUT_MS = 60000;
  // Letters, digits, "_", "-" and "." in each part, never starting with "." (so no "..", no hidden files).
  var PATH_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;

  function toBytes(data) {
    return data instanceof Uint8Array ? data : new Uint8Array(data);
  }

  function base64ToBytes(b64) {
    var bin = win.atob(String(b64).replace(/\s+/g, ""));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  }

  function hex(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) {
      s += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    }
    return s;
  }

  function utf8(bytes) {
    if (win.TextDecoder) {
      return new win.TextDecoder("utf-8").decode(bytes);
    }
    var bin = "";
    for (var i = 0; i < bytes.length; i++) {
      bin += String.fromCharCode(bytes[i]);
    }
    return decodeURIComponent(escape(bin));
  }

  /** The app key (base64) that signed these exact bytes, or null. */
  function signedBy(nacl, bytes, sigText, keys) {
    var sig;
    try {
      sig = base64ToBytes(sigText);
    } catch (e) {
      return null;
    }
    if (sig.length !== 64) {
      return null;
    }
    for (var i = 0; i < keys.length; i++) {
      var pk;
      try {
        pk = base64ToBytes(keys[i]);
      } catch (e) {
        continue;
      }
      if (pk.length === 32 && nacl.sign.detached.verify(toBytes(bytes), sig, pk)) {
        return keys[i];
      }
    }
    return null;
  }

  function isArray(x) {
    return Object.prototype.toString.call(x) === "[object Array]";
  }

  function isCount(x) {
    return typeof x === "number" && x >= 0 && x % 1 === 0;
  }

  /**
   * Checks a parsed manifest against this app and the pages the TV has. Returns null when it's acceptable, else
   * the reason in plain words.
   */
  function validate(m, ctx) {
    var cmp = ctx.compareVersions;
    if (!m || typeof m !== "object" || isArray(m)) {
      return "not a manifest";
    }
    if (m.format !== FORMAT) {
      return "unknown manifest format " + m.format;
    }
    if (m.app !== APP) {
      return "for another app (" + m.app + ")";
    }
    if (cmp(m.version, "0.0.0") === null) {
      return "bad version " + m.version;
    }
    if (cmp(m.minShell, "0.0.0") === null) {
      return "bad minShell " + m.minShell;
    }
    if (cmp(m.minShell, ctx.shellVersion) > 0) {
      return "needs app " + m.minShell + " or newer (this is " + ctx.shellVersion + ")";
    }
    for (var h = 0; h < ctx.have.length; h++) {
      if (ctx.have[h] && cmp(m.version, ctx.have[h]) <= 0) {
        return "version " + m.version + " is not newer than " + ctx.have[h];
      }
    }
    if (ctx.skip.indexOf(m.version) >= 0) {
      return "version " + m.version + " failed to start before";
    }
    if (!isArray(m.files) || !m.files.length || m.files.length > MAX_FILES) {
      return "bad file list";
    }
    var seen = {};
    var total = 0;
    for (var i = 0; i < m.files.length; i++) {
      var f = m.files[i];
      if (!f || typeof f.path !== "string" || f.path.length > MAX_PATH || !PATH_RE.test(f.path)) {
        return "bad file path " + (f && f.path);
      }
      var key = f.path.toLowerCase();
      if (seen[key]) {
        return "file listed twice: " + f.path;
      }
      seen[key] = f.path;
      if (!isCount(f.size) || f.size > MAX_FILE) {
        return "bad size for " + f.path;
      }
      total += f.size;
      if (typeof f.sha512 !== "string" || !/^[0-9a-f]{128}$/.test(f.sha512)) {
        return "bad SHA-512 for " + f.path;
      }
    }
    if (total > MAX_TOTAL) {
      return "too large (" + total + " bytes)";
    }
    var e = m.entry;
    if (!e || !isArray(e.css) || !isArray(e.js) || !e.js.length || typeof e.body !== "string" || e.body.length > MAX_BODY) {
      return "bad entry";
    }
    var lists = [["css", /\.css$/], ["js", /\.js$/]];
    for (var l = 0; l < lists.length; l++) {
      var names = e[lists[l][0]];
      for (var j = 0; j < names.length; j++) {
        if (typeof names[j] !== "string" || seen[names[j].toLowerCase()] !== names[j] || !lists[l][1].test(names[j])) {
          return "entry file not in the list: " + names[j];
        }
      }
    }
    return null;
  }

  /** Checks the manifest's bytes and signature; returns { manifest, key } or { refused: reason }. */
  function check(nacl, bytes, sigText, ctx) {
    bytes = toBytes(bytes);
    if (bytes.length > MAX_MANIFEST) {
      return { refused: "manifest too large" };
    }
    var key = signedBy(nacl, bytes, sigText, ctx.keys);
    if (!key) {
      return { refused: "bad signature" };
    }
    var m;
    try {
      m = JSON.parse(utf8(bytes));
    } catch (e) {
      return { refused: "manifest is not JSON" };
    }
    var why = validate(m, ctx);
    return why ? { refused: why } : { manifest: m, key: key };
  }

  function get(url, binary, cb) {
    var xhr = new win.XMLHttpRequest();
    var done = false;
    function end(err, data) {
      if (!done) {
        done = true;
        cb(err, data);
      }
    }
    try {
      xhr.open("GET", url);
      xhr.timeout = TIMEOUT_MS;
      if (binary) {
        xhr.responseType = "arraybuffer";
      }
      xhr.onload = function () {
        if (xhr.status !== 200) {
          return end(new Error(url + ": HTTP " + xhr.status));
        }
        end(null, binary ? toBytes(xhr.response) : xhr.responseText);
      };
      xhr.onerror = function () {
        end(new Error(url + ": no connection"));
      };
      xhr.ontimeout = function () {
        end(new Error(url + ": timed out"));
      };
      xhr.send();
    } catch (e) {
      end(e);
    }
  }

  function splitUrl(url) {
    var m = /^([^?#]*)(\?[^#]*)?/.exec(url);
    return { path: m[1], query: m[2] || "" };
  }

  function withNoCache(url, stamp) {
    var u = splitUrl(url);
    return u.path + (u.query ? u.query + "&" : "?") + "t=" + stamp;
  }

  function encodePath(p) {
    var parts = p.split("/");
    for (var i = 0; i < parts.length; i++) {
      parts[i] = encodeURIComponent(parts[i]);
    }
    return parts.join("/");
  }

  function ensureNacl(api, cb) {
    if (win.nacl && win.nacl.sign && win.nacl.hash) {
      return cb(null, win.nacl);
    }
    api.loadScript("nacl-fast.min.js", function (err) {
      if (err || !win.nacl || !win.nacl.sign) {
        return cb(err || new Error("TweetNaCl didn't load"));
      }
      cb(null, win.nacl);
    });
  }

  /** One update check. done(err, result): result is "up to date", "downloaded <v>" or "refused: <reason>". */
  function run(api, done) {
    var shell = api.shell;
    var fs = api.fs;
    var cmp = api.compareVersions;
    var stamp = new Date().getTime();
    var url = splitUrl(shell.updateUrl);
    var sigUrl = url.path + ".sig" + url.query;
    var folder = url.path.replace(/[^\/]*$/, "");
    var signedWith = null;

    ensureNacl(api, function (err, nacl) {
      if (err) {
        return done(err);
      }
      get(withNoCache(shell.updateUrl, stamp), true, function (err, bytes) {
        if (err) {
          return done(err);
        }
        get(withNoCache(sigUrl, stamp), false, function (err, sigText) {
          if (err) {
            return done(err);
          }
          var s = api.loadState();
          var have = [shell.pageVersion, s.good, s.next, api.current()];
          var c = check(nacl, bytes, sigText, {
            keys: shell.keys,
            shellVersion: shell.version,
            have: have,
            skip: s.skip,
            compareVersions: cmp,
          });
          if (c.refused) {
            // Same or older is the everyday answer, not a problem.
            return done(null, /not newer/.test(c.refused) ? "up to date" : "refused: " + c.refused);
          }
          signedWith = c.key;
          download(c.manifest, nacl);
        });
      });
    });

    function download(m, nacl) {
      var v = m.version;
      var s = api.loadState();
      // Room for the new page: keep only the page shown and the good one.
      var keep = {};
      keep[api.current() || ""] = true;
      keep[s.good || ""] = true;
      var drop = [];
      for (var p in s.pages) {
        if (!keep[p]) {
          drop.push(p);
          delete s.pages[p];
        }
      }
      if (s.next && !keep[s.next]) {
        s.next = null;
      }
      if (s.prev && !keep[s.prev]) {
        s.prev = null;
      }
      if (s.partial && drop.indexOf(s.partial) < 0) {
        drop.push(s.partial);
      }
      drop.push(v);
      s.partial = v;
      api.saveState(s);
      api.removePages(drop, function () {
        fetchFiles(m, nacl, 0);
      });
    }

    function fail(m, err) {
      api.removePages([m.version], function () {
        var s = api.loadState();
        if (s.partial === m.version) {
          s.partial = null;
        }
        api.saveState(s);
        done(err);
      });
    }

    function fetchFiles(m, nacl, i) {
      if (i === m.files.length) {
        return finish(m);
      }
      var f = m.files[i];
      get(folder + encodePath(m.version) + "/" + encodePath(f.path), true, function (err, bytes) {
        if (err) {
          return fail(m, err);
        }
        if (bytes.length !== f.size) {
          return fail(m, new Error(f.path + ": " + bytes.length + " bytes, the manifest says " + f.size));
        }
        if (hex(nacl.hash(bytes)) !== f.sha512) {
          return fail(m, new Error(f.path + ": SHA-512 doesn't match"));
        }
        fs.write(api.fileKey(m.version, f.path), bytes, function (err) {
          if (err) {
            return fail(m, new Error(f.path + ": couldn't save (" + (err.message || err.name || err) + ")"));
          }
          fetchFiles(m, nacl, i + 1);
        });
      });
    }

    function finish(m) {
      var s = api.loadState();
      var files = [];
      for (var i = 0; i < m.files.length; i++) {
        files.push({ path: m.files[i].path, size: m.files[i].size });
      }
      s.pages[m.version] = {
        minShell: m.minShell,
        entry: { css: m.entry.css.slice(0), js: m.entry.js.slice(0), body: m.entry.body },
        files: files,
        // boot.js shows a page only while the installed app still trusts the key that signed it.
        key: signedWith,
      };
      s.next = m.version;
      s.partial = null;
      api.saveState(s);
      done(null, "downloaded " + m.version);
    }
  }

  win.HomeTVUpdate = { run: run, check: check, validate: validate };
})(window);
