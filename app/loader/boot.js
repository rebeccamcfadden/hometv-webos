// HomeTV's loader on LG: the first script of the installed app's index.html (after shell-config.js). Plain ES5, no
// network, no crypto, so it runs as is on 2016 TVs (Chromium 38). It shows the newest complete, trusted page the TV has:
// - a page the updater downloaded and checked, kept in the page's own IndexedDB (database "hometv-pages"), read back
//   and put into the installed index.html as inline styles and scripts (its other files as blob: addresses); the app
//   never navigates anywhere; or
// - the page that came inside the app (the .ipk), when there is none, it fails, or the TV can't run it.
// The page calls HomeTVBoot.started() once Home shows (app/src/platform.ts started()). A downloaded page that doesn't,
// in two starts in a row (each ended by the TV going off, a crash, or a reload after START_TIMEOUT_MS), is dropped:
// the next start goes back to the previous good page. Ported from hometv-tizen's app/loader/boot.js (5ac0b52), which
// keeps its pages in Samsung's app storage instead. docs/updates.md explains it.
(function (win) {
  "use strict";

  var doc = win.document;
  var SHELL = win.HOMETV_SHELL || {};
  var STATE_KEY = "hometv.pages";
  // 20 s, so a page that never starts is dropped (two tries) well before the rooted edition's watchdog gives LG's Home
  // back after about a minute without a heartbeat (root/watchdog.sh).
  var START_TIMEOUT_MS = SHELL.startTimeoutMs || 20000;
  // Reading a page back never holds Home longer than this: the app's own page shows instead, this time.
  var READ_TIMEOUT_MS = SHELL.readTimeoutMs || 5000;
  var UPDATE_DELAY_MS = SHELL.updateDelayMs == null ? 10000 : SHELL.updateDelayMs;
  var CHECK_EVERY_MS = (SHELL.checkHours || 12) * 3600000;
  var SKIP_KEEP = 20;
  var STRIKES = 2;
  var BUNDLED = SHELL.page || { version: "0.0.0", entry: { css: [], js: [], body: "" } };

  // Where the installed page lives (absolute).
  var shellBase = String(win.location.href).replace(/[?#].*$/, "").replace(/[^\/]*$/, "");

  // The keys and the update address belong to the installed app: copied here once, before any page code runs.
  var shell = {
    version: String(SHELL.shellVersion || "0.0.0"),
    pageVersion: String(BUNDLED.version),
    updateUrl: String(SHELL.updateUrl || ""),
    keys: (SHELL.keys || []).slice(0),
    maxPages: 2,
  };
  if (Object.freeze) {
    Object.freeze(shell.keys);
    Object.freeze(shell);
  }

  // ---- versions: x.y.z, numbers only ----

  function parseVersion(v) {
    var m = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(String(v));
    return m ? [+m[1], +m[2], +m[3]] : null;
  }

  /** -1, 0 or 1; null when either isn't a version. */
  function compareVersions(a, b) {
    var x = parseVersion(a);
    var y = parseVersion(b);
    if (!x || !y) {
      return null;
    }
    for (var i = 0; i < 3; i++) {
      if (x[i] !== y[i]) {
        return x[i] < y[i] ? -1 : 1;
      }
    }
    return 0;
  }

  // ---- state, in localStorage (small and synchronous: read before anything shows) ----

  var storage = null;
  try {
    storage = win.localStorage;
    storage.setItem("hometv.probe", "1");
    storage.removeItem("hometv.probe");
  } catch (e) {
    storage = null;
  }

  function isObject(x) {
    return !!x && typeof x === "object" && Object.prototype.toString.call(x) !== "[object Array]";
  }

  function loadState() {
    var s = null;
    try {
      s = JSON.parse((storage && storage.getItem(STATE_KEY)) || "null");
    } catch (e) {
      s = null;
    }
    if (!isObject(s)) {
      s = {};
    }
    if (!isObject(s.pages)) {
      s.pages = {};
    }
    if (!isObject(s.fails)) {
      s.fails = {};
    }
    if (Object.prototype.toString.call(s.skip) !== "[object Array]") {
      s.skip = [];
    }
    var names = ["next", "good", "prev", "trying", "partial", "inlineBlocked"];
    for (var i = 0; i < names.length; i++) {
      if (typeof s[names[i]] !== "string") {
        s[names[i]] = null;
      }
    }
    return s;
  }

  function saveState(s) {
    try {
      if (storage) {
        storage.setItem(STATE_KEY, JSON.stringify(s));
      }
    } catch (e) {
      // A full or missing store: the bundled page still works.
    }
  }

  function skipVersion(s, v) {
    if (s.skip.indexOf(v) < 0) {
      s.skip.push(v);
    }
    while (s.skip.length > SKIP_KEEP) {
      s.skip.shift();
    }
    if (s.next === v) {
      s.next = null;
    }
    if (s.good === v) {
      s.good = s.prev;
      s.prev = null;
    }
    if (s.prev === v) {
      s.prev = null;
    }
  }

  /**
   * A start of page v didn't reach started(). Any page, new or once good, is skipped after two such starts in a row
   * (a good start clears the count): people switch a TV off in the first seconds, and one would skip a good page.
   */
  function failedStart(s, v) {
    s.fails[v] = (s.fails[v] || 0) + 1;
    if (s.fails[v] >= STRIKES) {
      skipVersion(s, v);
    }
    s.trying = null;
  }

  function usable(s, v) {
    var p = v && s.pages[v];
    return !!(
      p &&
      p.entry &&
      p.files &&
      shell.keys.indexOf(p.key) >= 0 &&
      s.skip.indexOf(v) < 0 &&
      compareVersions(v, shell.pageVersion) === 1 &&
      compareVersions(p.minShell, shell.version) !== null &&
      compareVersions(p.minShell, shell.version) <= 0
    );
  }

  function pick(s) {
    if (s.inlineBlocked === shell.version) {
      return null;
    }
    var order = [s.next, s.good, s.prev];
    for (var i = 0; i < order.length; i++) {
      if (usable(s, order[i])) {
        return order[i];
      }
    }
    return null;
  }

  // ---- bytes and text ----

  /** A Uint8Array of this window's own kind (TweetNaCl checks instanceof). */
  function toBytes(data) {
    return data instanceof Uint8Array ? data : new Uint8Array(data);
  }

  function binaryString(bytes) {
    var parts = [];
    for (var i = 0; i < bytes.length; i += 0x8000) {
      parts.push(String.fromCharCode.apply(null, Array.prototype.slice.call(bytes.subarray(i, i + 0x8000))));
    }
    return parts.join("");
  }

  function utf8(bytes) {
    if (win.TextDecoder) {
      return new win.TextDecoder("utf-8").decode(bytes);
    }
    return decodeURIComponent(escape(binaryString(bytes)));
  }

  function dirname(p) {
    var i = p.lastIndexOf("/");
    return i < 0 ? "" : p.slice(0, i);
  }

  function once(cb) {
    var called = false;
    return function (err, result) {
      if (!called) {
        called = true;
        cb(err, result);
      }
    };
  }

  // ---- the page files, in the page's own IndexedDB ----
  // One object store, "files": key "<version>/<path>", value the file's bytes (an ArrayBuffer). Each call ends in
  // cb(error, result). Only open, transaction, get, put and a cursor are used: all there since Chromium 38.

  var DB_NAME = "hometv-pages";
  var STORE = "files";

  function makeFs() {
    var idb = null;
    try {
      idb = win.indexedDB || null;
    } catch (e) {
      idb = null;
    }
    if (!idb || typeof idb.open !== "function") {
      return null;
    }
    var db = null;
    var broken = null;
    var waiting = null;

    function withDb(cb) {
      if (db || broken) {
        return cb(broken, db);
      }
      if (waiting) {
        return waiting.push(cb);
      }
      waiting = [cb];
      var settle = once(function (err, d) {
        db = d || null;
        broken = err || (d ? null : new Error("indexedDB.open gave nothing"));
        var w = waiting;
        waiting = null;
        for (var i = 0; i < w.length; i++) {
          w[i](broken, db);
        }
      });
      var req;
      try {
        req = idb.open(DB_NAME, 1);
      } catch (e) {
        return settle(e);
      }
      req.onupgradeneeded = function () {
        try {
          req.result.createObjectStore(STORE);
        } catch (e) {
          // already there
        }
      };
      req.onsuccess = function () {
        settle(null, req.result);
      };
      req.onerror = function () {
        settle(req.error || new Error("indexedDB.open failed"));
      };
    }

    /** Runs work(store) in one transaction; cb(error, box.value) once it has committed. */
    function run(mode, work, cb) {
      cb = once(cb);
      withDb(function (err, d) {
        if (err) {
          return cb(err);
        }
        var t;
        var box;
        try {
          t = d.transaction(STORE, mode);
          box = work(t.objectStore(STORE)) || {};
        } catch (e) {
          return cb(e);
        }
        t.oncomplete = function () {
          cb(null, box.value);
        };
        t.onerror = t.onabort = function () {
          cb(t.error || new Error("IndexedDB " + mode + " failed"));
        };
      });
    }

    /** Deletes every key for which drop(key) is true. */
    function deleteWhere(drop, cb) {
      run("readwrite", function (store) {
        var req = store.openCursor();
        req.onsuccess = function () {
          var c = req.result;
          if (!c) {
            return;
          }
          if (drop(String(c.key))) {
            c["delete"]();
          }
          c["continue"]();
        };
      }, cb);
    }

    return {
      api: "indexedDB",
      read: function (key, cb) {
        run("readonly", function (store) {
          var box = {};
          var req = store.get(key);
          req.onsuccess = function () {
            box.value = req.result;
          };
          return box;
        }, function (err, value) {
          if (err) {
            return cb(err);
          }
          if (value == null) {
            return cb(new Error("NotFoundError: " + key));
          }
          cb(null, toBytes(value));
        });
      },
      write: function (key, bytes, cb) {
        var b = toBytes(bytes);
        var buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
        run("readwrite", function (store) {
          store.put(buf, key);
        }, cb);
      },
      /** Deletes one page's files. */
      removePage: function (v, cb) {
        deleteWhere(function (key) {
          return key.indexOf(v + "/") === 0;
        }, cb);
      },
      /** Deletes every file whose page isn't in keep (an object keyed by version). */
      prune: function (keep, cb) {
        deleteWhere(function (key) {
          return !Object.prototype.hasOwnProperty.call(keep, key.split("/")[0]);
        }, cb);
      },
    };
  }

  var fs = makeFs();

  function fileKey(v, path) {
    return v + "/" + path;
  }

  // ---- showing a page ----

  function whenReady(fn) {
    if (doc.readyState === "loading") {
      doc.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  function el(tag, props) {
    var e = doc.createElement(tag);
    for (var k in props) {
      e[k] = props[k];
    }
    return e;
  }

  /** "a/b/../c/./d.png" -> "a/c/d.png"; null when it climbs out of the page. */
  function normalize(p) {
    var parts = p.split("/");
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === "..") {
        if (!out.length) {
          return null;
        }
        out.pop();
      } else if (parts[i] !== "." && parts[i] !== "") {
        out.push(parts[i]);
      }
    }
    return out.join("/");
  }

  /** url(...) in a downloaded CSS file that names one of the page's own files: pointed at that file's blob: address. */
  function rewriteCss(css, file, urls) {
    var dir = dirname(file);
    return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, function (all, q, url) {
      if (/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(url)) {
        return all;
      }
      var target = normalize((dir ? dir + "/" : "") + url.replace(/[?#].*$/, ""));
      return target && urls.hasOwnProperty(target) ? "url(" + q + urls[target] + q + ")" : all;
    });
  }

  var TYPES = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    otf: "font/otf",
  };

  function blobUrl(bytes, path) {
    var ext = (/\.([a-z0-9]+)$/i.exec(path) || ["", ""])[1].toLowerCase();
    return win.URL.createObjectURL(new win.Blob([bytes], { type: TYPES[ext] || "application/octet-stream" }));
  }

  function showBundled() {
    var entry = BUNDLED.entry;
    whenReady(function () {
      doc.body.innerHTML = entry.body || "";
      var waiting = entry.css.length;
      var scriptsAdded = false;
      function addScripts() {
        if (scriptsAdded) {
          return;
        }
        scriptsAdded = true;
        for (var j = 0; j < entry.js.length; j++) {
          doc.head.appendChild(el("script", { src: shellBase + entry.js[j], async: false }));
        }
      }
      function oneLoaded() {
        waiting--;
        if (waiting <= 0) {
          addScripts();
        }
      }
      // Styles first, as the page's own <link> tags would block its scripts.
      for (var i = 0; i < entry.css.length; i++) {
        var link = el("link", { rel: "stylesheet", href: shellBase + entry.css[i] });
        link.onload = oneLoaded;
        link.onerror = oneLoaded;
        doc.head.appendChild(link);
      }
      if (!waiting) {
        addScripts();
      } else {
        win.setTimeout(addScripts, 3000);
      }
    });
  }

  /**
   * Reads a downloaded page back: its CSS and JS as text, every other file as a blob: address. Each file is checked
   * against the size recorded when the updater verified it (signature, then SHA-512).
   */
  function readPage(v, page, cb) {
    var entryFiles = {};
    var names = page.entry.css.concat(page.entry.js);
    for (var i = 0; i < names.length; i++) {
      entryFiles[names[i]] = true;
    }
    var texts = {};
    var urls = {};
    var n = 0;
    function nextFile() {
      if (n === page.files.length) {
        return cb(null, texts, urls);
      }
      var f = page.files[n++];
      fs.read(fileKey(v, f.path), function (err, bytes) {
        if (err) {
          return cb(err);
        }
        if (bytes.length !== f.size) {
          return cb(new Error(f.path + " is " + bytes.length + " bytes, expected " + f.size));
        }
        try {
          if (entryFiles[f.path]) {
            texts[f.path] = utf8(bytes);
          } else {
            urls[f.path] = blobUrl(bytes, f.path);
          }
        } catch (e) {
          return cb(e);
        }
        nextFile();
      });
    }
    nextFile();
  }

  /** True when the TV runs inline scripts (a strict content security policy would stop them). */
  function inlineRuns() {
    win.__hometvInline = false;
    doc.head.appendChild(el("script", { text: "window.__hometvInline = true;" }));
    var ok = win.__hometvInline === true;
    win.__hometvInline = undefined;
    return ok;
  }

  /** Puts the page in. Returns the script that threw while loading (the page can't start), or null. */
  function injectDownloaded(page, texts, urls) {
    var entry = page.entry;
    var head = doc.head;
    doc.body.innerHTML = entry.body || "";
    var i;
    for (i = 0; i < entry.css.length; i++) {
      head.appendChild(el("style", { textContent: rewriteCss(texts[entry.css[i]], entry.css[i], urls) }));
    }
    for (i = 0; i < entry.js.length; i++) {
      // An inline script runs as it's added; the flag at its end is set only if nothing above it threw.
      win.__hometvRan = false;
      head.appendChild(el("script", { text: texts[entry.js[i]] + "\n;window.__hometvRan = true;\n//# sourceURL=" + entry.js[i] }));
      var ran = win.__hometvRan === true;
      win.__hometvRan = undefined;
      if (!ran) {
        return entry.js[i];
      }
    }
    if (doc.readyState === "complete") {
      // The window's load event has passed: the page's own load handlers still get one.
      var e = doc.createEvent("Event");
      e.initEvent("load", false, false);
      win.dispatchEvent(e);
    }
    return null;
  }

  // ---- the start ----

  var current = null; // the downloaded version shown, or null for the bundled page
  var startedDone = false;
  var startTimer = null;
  var info = { page: shell.pageVersion, source: "bundled", fs: fs ? fs.api : "none", note: "", lastCheck: null };

  function showBundledNow(s) {
    current = null;
    s.trying = null;
    saveState(s);
    showBundled();
  }

  /** A start of v that can't reach Home (now or after the timeout): counted, then the app starts again. */
  function restartAfterFailure(v) {
    var s = loadState();
    if (s.trying === v) {
      failedStart(s, v);
      saveState(s);
    }
    win.location.reload();
  }

  function startWith(s) {
    var v = fs ? pick(s) : null;
    if (!v) {
      return showBundledNow(s);
    }
    s.trying = v;
    saveState(s);
    var page = s.pages[v];
    var settled = false;
    // A store that doesn't answer never holds Home: the app's own page shows this time, and v isn't counted against.
    var readTimer = win.setTimeout(function () {
      if (settled) {
        return;
      }
      settled = true;
      info.note = "page " + v + " took too long to read; the app's own page this time";
      showBundledNow(loadState());
    }, READ_TIMEOUT_MS);
    readPage(v, page, function (err, texts, urls) {
      if (settled) {
        return;
      }
      settled = true;
      win.clearTimeout(readTimer);
      if (err) {
        // Missing or damaged on the TV: skip it and show the next best page now.
        var s2 = loadState();
        skipVersion(s2, v);
        s2.trying = null;
        info.note = "page " + v + " unreadable: " + (err.message || err.name || err);
        return startWith(s2);
      }
      whenReady(function () {
        if (!inlineRuns()) {
          var s3 = loadState();
          s3.inlineBlocked = shell.version;
          s3.trying = null;
          info.note = "this TV doesn't run inline scripts, so downloaded pages are off";
          return startWith(s3);
        }
        current = v;
        info.page = v;
        info.source = "downloaded";
        startTimer = win.setTimeout(function () {
          if (!startedDone) {
            restartAfterFailure(v);
          }
        }, START_TIMEOUT_MS);
        var threw = injectDownloaded(page, texts, urls);
        if (threw && !startedDone) {
          win.clearTimeout(startTimer);
          info.note = "page " + v + ": " + threw + " threw while loading";
          restartAfterFailure(v);
        }
      });
    });
  }

  function boot() {
    var s = loadState();
    if (s.trying) {
      // The last start of this page never reached Home.
      info.note = "page " + s.trying + " didn't start last time";
      failedStart(s, s.trying);
    }
    startWith(s);
  }

  // ---- after Home shows ----

  /**
   * Keeps the page shown and the good, next or previous one (two at most); returns them (by version). Pages this app
   * can't show (skipped, signed with a key it no longer trusts, not newer than its own) go, without being skipped, so
   * a trusted copy of the same version can be downloaded again.
   */
  function tidy(s) {
    var keep = {};
    var order = [current, s.good, s.next, s.prev];
    var kept = 0;
    var v;
    for (var i = 0; i < order.length; i++) {
      v = order[i];
      if (v && s.pages[v] && !keep[v] && kept < shell.maxPages && (v === current || usable(s, v))) {
        keep[v] = true;
        kept++;
      }
    }
    for (v in s.pages) {
      if (!keep[v]) {
        delete s.pages[v];
      }
    }
    if (s.next && !keep[s.next]) {
      s.next = null;
    }
    if (s.prev && !keep[s.prev]) {
      s.prev = null;
    }
    if (s.good && !keep[s.good]) {
      s.good = null;
    }
    for (v in s.fails) {
      if (!keep[v]) {
        delete s.fails[v];
      }
    }
    s.partial = null;
    return keep;
  }

  function removePages(versions, done) {
    if (!fs || !versions.length) {
      return done && done();
    }
    fs.removePage(versions.shift(), function () {
      removePages(versions, done);
    });
  }

  function started() {
    if (startedDone) {
      return;
    }
    startedDone = true;
    if (startTimer) {
      win.clearTimeout(startTimer);
    }
    var s = loadState();
    if (current && s.trying === current) {
      if (s.good !== current) {
        s.prev = s.good;
        s.good = current;
      }
      if (s.next === current) {
        s.next = null;
      }
      s.fails[current] = 0;
    }
    s.trying = null;
    var keep = tidy(s);
    saveState(s);
    if (!fs) {
      return;
    }
    // Every other file goes, including files whose record was lost (localStorage cleared, IndexedDB kept). A store
    // that can't do that can't keep a download either: no update checks this start.
    fs.prune(keep, function (err) {
      if (err) {
        info.note = "page store unusable: " + (err.message || err.name || err);
        return;
      }
      scheduleUpdates();
    });
  }

  // ---- the updater (update.js), loaded only after Home shows ----

  var updating = false;

  function canUpdate() {
    return !!(shell.updateUrl && shell.keys.length && fs && storage && loadState().inlineBlocked !== shell.version);
  }

  function loadScript(name, cb) {
    var e = el("script", { src: shellBase + name, async: true });
    e.onload = function () {
      cb(null);
    };
    e.onerror = function () {
      cb(new Error(name + " didn't load"));
    };
    doc.head.appendChild(e);
  }

  var updaterApi = {
    shell: shell,
    fs: fs,
    fileKey: fileKey,
    loadState: loadState,
    saveState: saveState,
    compareVersions: compareVersions,
    loadScript: loadScript,
    removePages: removePages,
    current: function () {
      return current;
    },
  };

  function checkNow(done) {
    if (updating || !canUpdate()) {
      return done && done(null, "off");
    }
    updating = true;
    function finish(err, result) {
      updating = false;
      info.lastCheck = { at: new Date().toISOString(), result: err ? "failed: " + (err.message || err) : result };
      if (done) {
        done(err, result);
      }
    }
    if (win.HomeTVUpdate && win.HomeTVUpdate.run) {
      return win.HomeTVUpdate.run(updaterApi, finish);
    }
    loadScript("update.js", function (err) {
      if (err || !win.HomeTVUpdate) {
        return finish(err || new Error("update.js didn't load"));
      }
      win.HomeTVUpdate.run(updaterApi, finish);
    });
  }

  function scheduleUpdates() {
    if (!canUpdate()) {
      return;
    }
    win.setTimeout(function again() {
      checkNow(function () {
        win.setTimeout(again, CHECK_EVERY_MS);
      });
    }, UPDATE_DELAY_MS);
  }

  win.HomeTVBoot = {
    started: started,
    checkNow: checkNow,
    status: function () {
      var s = loadState();
      return {
        page: info.page,
        source: info.source,
        shell: shell.version,
        bundled: shell.pageVersion,
        fs: info.fs,
        updates: canUpdate() ? shell.updateUrl : "off",
        good: s.good,
        next: s.next,
        skipped: s.skip.slice(0),
        note: info.note,
        lastCheck: info.lastCheck,
      };
    },
    compareVersions: compareVersions,
    parseVersion: parseVersion,
  };

  boot();
})(window);
