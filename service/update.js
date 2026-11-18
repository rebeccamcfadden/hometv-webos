/*
 * HomeTV's own updates on a rooted TV (Settings › Updates, root edition): the app (.ipk) and the root scripts (root/),
 * from a signed manifest published with a release. Plain ES5 for old Node. Used by service.js (updateCheck,
 * updateInstall, updateStatus) and by update-apply.js, which swaps them in as root.
 *
 * Adapted from lasharor/cleanyourtv-WebOS (MIT; read at 2debe62, helper/updates.js and helper/selfupdate.js): the
 * release check, the download that refuses an unchecked file, the "this version failed" note. Changed: a signature, not
 * a .sha256 beside the file: the manifest (hometv-root.json) is signed with Ed25519 by the same LG key as the page
 * updates (app/loader/page-keys.txt; the private key stays on the project lead's PC), and lists each file's size and
 * SHA-512. A file the manifest doesn't list, or whose size or hash differs, is refused; so is a manifest without a good
 * signature. No dev channel, no LAN page, no token: the TV only makes outbound HTTPS requests.
 *
 * Copyright (c) 2026 cleanyourtv-WebOS contributors (MIT License; full notice in THIRD_PARTY_NOTICES.md)
 */
'use strict';

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var FORMAT = 1;
var APP = 'hometv-webos-root';
var APP_ID = 'com.hometv.app';
var MANIFEST = 'hometv-root.json';
/** The root scripts an update may replace: the files of root/ that install.sh copies (README.md and package.json aside). */
var ROOT_FILES = ['10-hometv-home', '15-hometv-debloat', 'after-sam.sh', 'compat.json', 'debloat-stop.sh', 'debloat-undo.sh',
  'decide.js', 'install.sh', 'lib.sh', 'stage-home.sh', 'undo-home.sh', 'uninstall.sh', 'watchdog.sh'];
var MAX_MANIFEST = 64 * 1024;
var MAX_IPK = 64 * 1024 * 1024;
var MAX_SCRIPT = 512 * 1024;
var VERSION_RE = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/;
/** Where the updates keep their state, inside the root edition's folder (root/lib.sh D). */
var SUB = 'updates';

function cmp(a, b) {
  var x = VERSION_RE.exec(String(a));
  var y = VERSION_RE.exec(String(b));
  if (!x || !y) return null;
  for (var i = 1; i <= 3; i++) {
    if (+x[i] !== +y[i]) return +x[i] < +y[i] ? -1 : 1;
  }
  return 0;
}

var nacl = null;
/** TweetNaCl (vendor/tweetnacl): beside this file in the .ipk (tools/package-webos.mjs), in vendor/ in the repo. */
function getNacl() {
  if (nacl) return nacl;
  try {
    nacl = require('./nacl-fast.min.js');
  } catch (e) {
    nacl = require(path.join(__dirname, '..', 'vendor', 'tweetnacl', 'nacl-fast.min.js'));
  }
  return nacl;
}

function readJson(f) {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    return null;
  }
}

/** update-config.json, written into the service by tools/package-webos.mjs: { url, keys }. Off without both. */
function loadConfig(dir) {
  var c = readJson(path.join(dir || __dirname, 'update-config.json')) || {};
  var keys = Object.prototype.toString.call(c.keys) === '[object Array]' ? c.keys.filter(function (k) {
    return typeof k === 'string' && k.length > 40;
  }) : [];
  var url = typeof c.url === 'string' && /^https:\/\/[^\s]+$/.test(c.url) ? c.url : '';
  return { url: url, keys: keys, on: !!(url && keys.length) };
}

/** The base64 key (of `keys`) that signed these exact bytes, or null. */
function signedBy(bytes, sigText, keys) {
  var n = getNacl();
  var sig;
  try {
    sig = new Uint8Array(Buffer.from(String(sigText || '').replace(/\s+/g, ''), 'base64'));
  } catch (e) {
    return null;
  }
  if (sig.length !== 64) return null;
  for (var i = 0; i < keys.length; i++) {
    var pk = new Uint8Array(Buffer.from(keys[i], 'base64'));
    if (pk.length === 32 && n.sign.detached.verify(new Uint8Array(bytes), sig, pk)) return keys[i];
  }
  return null;
}

function isCount(x) {
  return typeof x === 'number' && x >= 0 && x % 1 === 0;
}

/** null when the manifest is acceptable for this TV, else the reason. */
function validate(m) {
  if (!m || typeof m !== 'object' || Object.prototype.toString.call(m) === '[object Array]') return 'not a manifest';
  if (m.format !== FORMAT) return 'unknown manifest format ' + m.format;
  if (m.app !== APP) return 'for another app (' + m.app + ')';
  if (cmp(m.version, '0.0.0') === null) return 'bad version ' + m.version;
  if (m.tag !== undefined && !(typeof m.tag === 'string' && /^[A-Za-z0-9._-]{1,60}$/.test(m.tag))) return 'bad tag';
  if (Object.prototype.toString.call(m.files) !== '[object Array]' || !m.files.length) return 'bad file list';
  var ipk = 'com.hometv.app_' + m.version + '_all.ipk';
  var seen = {};
  var ipks = 0;
  for (var i = 0; i < m.files.length; i++) {
    var f = m.files[i];
    var name = f && f.name;
    if (typeof name !== 'string' || seen[name]) return 'bad or repeated file ' + name;
    seen[name] = true;
    if (name === ipk) ipks++;
    else if (ROOT_FILES.indexOf(name) < 0) return 'a file this TV never installs: ' + name;
    if (!isCount(f.size) || f.size > (name === ipk ? MAX_IPK : MAX_SCRIPT)) return 'bad size for ' + name;
    if (typeof f.sha512 !== 'string' || !/^[0-9a-f]{128}$/.test(f.sha512)) return 'bad SHA-512 for ' + name;
  }
  if (ipks !== 1) return 'no ' + ipk + ' in the manifest';
  return null;
}

/** The manifest's bytes and signature, checked: { manifest } or { refused }. */
function checkManifest(bytes, sigText, keys) {
  if (!bytes || bytes.length > MAX_MANIFEST) return { refused: 'manifest missing or too large' };
  if (!signedBy(bytes, sigText, keys)) return { refused: 'bad signature' };
  var m;
  try {
    m = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch (e) {
    return { refused: 'manifest is not JSON' };
  }
  var why = validate(m);
  return why ? { refused: why } : { manifest: m };
}

/** A file's address: beside the manifest, or in the manifest's own release when it came from releases/latest. */
function fileUrl(manifestUrl, m, name) {
  var base = manifestUrl.replace(/[?#].*$/, '');
  var latest = /\/releases\/latest\/download\/[^\/]*$/;
  if (m.tag && latest.test(base)) return base.replace(latest, '/releases/download/' + encodeURIComponent(m.tag) + '/' + encodeURIComponent(name));
  return base.replace(/[^\/]*$/, '') + encodeURIComponent(name);
}

/**
 * HTTPS GET into a Buffer, following up to 5 redirects (GitHub's release downloads redirect), never to plain http,
 * refusing more than `max` bytes. cb(err, buffer).
 */
function httpsGet(url, max, cb, hops) {
  var https = require('https');
  var done = false;
  function end(err, body) {
    if (!done) {
      done = true;
      cb(err, body);
    }
  }
  if (!/^https:\/\//.test(url)) return end(new Error('not an https address'));
  var req;
  try {
    req = https.get(url, { headers: { 'User-Agent': 'HomeTV-webOS' } }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if ((hops || 0) >= 5) return end(new Error('too many redirects'));
        var next = require('url').resolve(url, res.headers.location);
        return httpsGet(next, max, end, (hops || 0) + 1);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return end(new Error('HTTP ' + res.statusCode));
      }
      var parts = [];
      var size = 0;
      res.on('data', function (d) {
        size += d.length;
        if (size > max) {
          req.abort();
          return end(new Error('larger than expected'));
        }
        parts.push(d);
      });
      res.on('end', function () {
        end(null, Buffer.concat(parts));
      });
      res.on('error', function (e) {
        end(e);
      });
    });
  } catch (e) {
    return end(e);
  }
  req.setTimeout(60000, function () {
    req.abort();
    end(new Error('timed out'));
  });
  req.on('error', function () {
    end(new Error('no connection'));
  });
}

function sha512(buf) {
  return crypto.createHash('sha512').update(buf).digest('hex');
}

/** The installed HomeTV app's version (its appinfo.json), or ''. */
function installedVersion(appDir) {
  var a = readJson(path.join(appDir, 'appinfo.json'));
  return a && typeof a.version === 'string' ? a.version : '';
}

/** Versions that failed to start after an update (update-apply.js writes them): never offered again. */
function failedVersions(dir) {
  try {
    return fs.readFileSync(path.join(dir, SUB, 'failed'), 'utf8').split('\n').filter(function (v) {
      return VERSION_RE.test(v);
    });
  } catch (e) {
    return [];
  }
}

/** The last update's record ({ version, state, note, at }), or null. */
function lastResult(dir) {
  return readJson(path.join(dir, SUB, 'last.json'));
}

function writeResult(dir, r) {
  try {
    fs.mkdirSync(path.join(dir, SUB));
  } catch (e) {
    // there already
  }
  r.at = Date.now();
  fs.writeFileSync(path.join(dir, SUB, 'last.json'), JSON.stringify(r));
}

/**
 * Looks: downloads only the manifest and its signature. opts: { config, dir (root/lib.sh D), app (the app folder),
 * get (httpsGet's shape) }. cb(null, { on, installed, available, failedBefore, refused, error, manifest, bytes, sig }).
 */
function check(opts, cb) {
  var c = opts.config;
  var get = opts.get || httpsGet;
  var installed = installedVersion(opts.app);
  var out = { on: c.on, installed: installed, available: null, failedBefore: null, refused: '', error: '' };
  if (!c.on) return cb(null, out);
  get(c.url, MAX_MANIFEST, function (err, bytes) {
    if (err) {
      out.error = err.message;
      return cb(null, out);
    }
    get(c.url.replace(/([?#]|$)/, '.sig$1'), 1024, function (err2, sig) {
      if (err2) {
        out.error = err2.message;
        return cb(null, out);
      }
      var r = checkManifest(bytes, sig && sig.toString('utf8'), c.keys);
      if (r.refused) {
        out.refused = r.refused;
        return cb(null, out);
      }
      var v = r.manifest.version;
      if (cmp(v, installed || '0.0.0') !== 1) return cb(null, out);
      if (failedVersions(opts.dir).indexOf(v) >= 0) {
        out.failedBefore = v;
        return cb(null, out);
      }
      out.available = v;
      out.manifest = r.manifest;
      out.bytes = bytes;
      out.sig = sig.toString('utf8');
      cb(null, out);
    });
  });
}

function rmrf(p) {
  try {
    var st = fs.lstatSync(p);
    if (st.isDirectory()) {
      fs.readdirSync(p).forEach(function (f) {
        rmrf(path.join(p, f));
      });
      fs.rmdirSync(p);
    } else {
      fs.unlinkSync(p);
    }
  } catch (e) {
    // gone
  }
}

/**
 * Downloads each file the checked manifest lists into `stage`, refusing any whose size or SHA-512 differs (the whole
 * stage is then deleted). Keeps the manifest and its signature there, so update-apply.js checks it all again before use.
 * cb(err).
 */
function download(opts, found, stage, cb) {
  var get = opts.get || httpsGet;
  var m = found.manifest;
  // a write that fails (a full disk) ends the download with the stage deleted, never a crashed service
  function fail(e) {
    rmrf(stage);
    cb(e);
  }
  try {
    rmrf(stage);
    fs.mkdirSync(stage);
    fs.writeFileSync(path.join(stage, MANIFEST), found.bytes);
    fs.writeFileSync(path.join(stage, MANIFEST + '.sig'), found.sig);
  } catch (e) {
    return fail(e);
  }
  var i = 0;
  (function next() {
    if (i === m.files.length) return cb(null);
    var f = m.files[i++];
    get(fileUrl(opts.config.url, m, f.name), f.size, function (err, body) {
      var why = err ? f.name + ': ' + err.message
        : body.length !== f.size ? f.name + ': ' + body.length + ' bytes, the manifest says ' + f.size
        : sha512(body) !== f.sha512 ? f.name + ': SHA-512 doesn\'t match' : '';
      if (why) return fail(new Error(why));
      try {
        fs.writeFileSync(path.join(stage, f.name), body);
      } catch (e) {
        return fail(e);
      }
      next();
    });
  })();
}

/**
 * Checks a stage again, right before use: the signature over the kept manifest with the installed app's keys, and each
 * file's size and SHA-512; nothing else in the folder is used. Returns { manifest } or { refused }.
 */
function verifyStage(stage, keys) {
  var bytes;
  var sig;
  try {
    bytes = fs.readFileSync(path.join(stage, MANIFEST));
    sig = fs.readFileSync(path.join(stage, MANIFEST + '.sig'), 'utf8');
  } catch (e) {
    return { refused: 'no manifest in the download' };
  }
  var r = checkManifest(bytes, sig, keys);
  if (r.refused) return r;
  for (var i = 0; i < r.manifest.files.length; i++) {
    var f = r.manifest.files[i];
    var body;
    try {
      body = fs.readFileSync(path.join(stage, f.name));
    } catch (e) {
      return { refused: f.name + ' is missing' };
    }
    if (body.length !== f.size || sha512(body) !== f.sha512) return { refused: f.name + ' doesn\'t match the signed manifest' };
  }
  return r;
}

module.exports = {
  FORMAT: FORMAT, APP: APP, APP_ID: APP_ID, MANIFEST: MANIFEST, ROOT_FILES: ROOT_FILES, SUB: SUB,
  cmp: cmp, loadConfig: loadConfig, validate: validate, checkManifest: checkManifest, fileUrl: fileUrl, httpsGet: httpsGet,
  sha512: sha512, installedVersion: installedVersion, failedVersions: failedVersions, lastResult: lastResult,
  writeResult: writeResult, check: check, download: download, verifyStage: verifyStage, rmrf: rmrf
};
