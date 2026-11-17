/*
 * Swaps a downloaded HomeTV update in, as root, and swaps it back if the new version doesn't answer. Started detached
 * by HomeTV's service (service.js, updateInstall) once update.js has downloaded and checked every file: installing the
 * new .ipk replaces and restarts that service, so this runs on its own (`node update-apply.js <stage folder>`).
 *
 * Steps: check the stage again against the signed manifest (update.js verifyStage, with the keys of the app installed
 * now); keep the running version (the root scripts and, when kept, its .ipk) in updates/prev; install the new .ipk with
 * LG's installer, as Homebrew Channel and `hometv-lg root` do; copy the new root scripts in; refresh HomeTV as LG's Home
 * in place (root/10-hometv-home) when it is mounted; then wait up to 40 s for the new service to answer with the new
 * version. If it doesn't: the previous scripts and .ipk go back, and the version is written to updates/failed, so it is
 * never offered again. The result is in updates/last.json for Settings › Updates.
 *
 * Adapted from lasharor/cleanyourtv-WebOS (MIT; read at 2debe62): helper/updates.js updateFrontend (swap in, wait 40 s,
 * swap back) and updateService, scripts/bootstrap.sh restart_for_update (keep the previous files, restore them and write
 * last-error.txt when the new service doesn't come up).
 * Copyright (c) 2026 cleanyourtv-WebOS contributors (MIT License; full notice in THIRD_PARTY_NOTICES.md)
 */
'use strict';

var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');
var U = require('./update.js');

var ANSWER_MS = 40000;
var INSTALL_MS = 120000;
var STEP_MS = 2000;

function q(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

function copy(from, to, mode) {
  fs.writeFileSync(to, fs.readFileSync(from));
  if (mode) fs.chmodSync(to, mode);
}

function exists(p) {
  try {
    fs.statSync(p);
    return true;
  } catch (e) {
    return false;
  }
}

/** As root/install.sh: the scripts and the start-up hooks run, the rest is read. */
function modeOf(name) {
  return /\.sh$|^\d\d-/.test(name) ? 493 : 420;
}

/**
 * o: { stage, dir (root/lib.sh D), app (the app folder), home (LG Home's folder), mounts (/proc/mounts), keys,
 * run(command, cb(code, output)) (sh -c), sleep(ms, cb), answerMs, installMs, stepMs }. cb(result): last.json's record.
 */
function apply(o, cb) {
  var dir = o.dir;
  var upd = path.join(dir, U.SUB);
  var prev = path.join(upd, 'prev');
  var answerMs = o.answerMs || ANSWER_MS;
  var installMs = o.installMs || INSTALL_MS;
  var stepMs = o.stepMs || STEP_MS;
  var busy = path.join(upd, 'busy');

  function finish(r) {
    U.writeResult(dir, r);
    U.rmrf(o.stage);
    try {
      fs.unlinkSync(busy);
    } catch (e) {
      // gone
    }
    cb(r);
  }

  var checked = U.verifyStage(o.stage, o.keys);
  if (checked.refused) return finish({ version: '', state: 'refused', note: checked.refused });
  var m = checked.manifest;
  var v = m.version;
  var ipkName = 'com.hometv.app_' + v + '_all.ipk';
  var scripts = m.files.map(function (f) {
    return f.name;
  }).filter(function (n) {
    return n !== ipkName;
  });
  var from = U.installedVersion(o.app);
  U.writeResult(dir, { version: v, state: 'installing', note: '' });

  // The running version, kept until the next update: its root scripts and, when one was kept, its .ipk.
  U.rmrf(prev);
  fs.mkdirSync(prev);
  U.ROOT_FILES.forEach(function (n) {
    if (exists(path.join(dir, n))) copy(path.join(dir, n), path.join(prev, n));
  });
  var prevIpk = exists(path.join(upd, 'current.ipk'));
  if (prevIpk) copy(path.join(upd, 'current.ipk'), path.join(prev, 'app.ipk'));
  fs.writeFileSync(path.join(prev, 'version'), from + '\n');

  function mounted() {
    try {
      return fs.readFileSync(o.mounts, 'utf8').indexOf(' ' + o.home + ' ') >= 0;
    } catch (e) {
      return false;
    }
  }

  /** LG's installer, as root (as tools/lib/install-steps.mjs root-install); then waits for the app to say `want`. */
  function installIpk(file, want, done) {
    var payload = JSON.stringify({ id: 'com.ares.defaultName', ipkUrl: file, subscribe: true });
    o.run('luna-send -w 90000 -i luna://com.webos.appInstallService/dev/install ' + q(payload) + ' 2>&1 | grep -m 1 -e installed -e failed', function () {
      var waited = 0;
      (function poll() {
        if (U.installedVersion(o.app) === want) return done(true);
        if (waited >= installMs) return done(false);
        waited += stepMs;
        o.sleep(stepMs, poll);
      })();
    });
  }

  /** HomeTV as LG's Home: refreshed in place, its service elevated again (root/10-hometv-home, "already HomeTV"). */
  function refreshHome(done) {
    if (!mounted() || exists(path.join(dir, 'DISABLE'))) return done();
    o.run('sh ' + q(path.join(dir, '10-hometv-home')), function () {
      done();
    });
  }

  /** The service answers with version `want` within answerMs. */
  function answers(want, done) {
    var waited = 0;
    var re = new RegExp('"version"\\s*:\\s*"' + want.replace(/\./g, '\\.') + '"');
    (function poll() {
      o.run("luna-send -n 1 -w 3000 luna://com.hometv.app.service/version '{}'", function (code, out) {
        if (re.test(out || '')) return done(true);
        if (waited >= answerMs) return done(false);
        waited += stepMs;
        o.sleep(stepMs, poll);
      });
    })();
  }

  function rollBack(why) {
    U.ROOT_FILES.forEach(function (n) {
      if (exists(path.join(prev, n))) copy(path.join(prev, n), path.join(dir, n), modeOf(n));
      else if (scripts.indexOf(n) >= 0) U.rmrf(path.join(dir, n));
    });
    var failed = U.failedVersions(dir);
    if (failed.indexOf(v) < 0) fs.writeFileSync(path.join(upd, 'failed'), failed.concat(v).join('\n') + '\n');
    function done(appBack) {
      refreshHome(function () {
        finish({
          version: v, state: 'rolled back', from: from,
          note: why + (appBack ? '; ' + (from || 'the previous version') + ' is back'
            : '; the previous root scripts are back, but no copy of the previous app was kept: reinstall it from Homebrew Channel if HomeTV doesn\'t open')
        });
      });
    }
    if (!prevIpk || U.installedVersion(o.app) === from) return done(U.installedVersion(o.app) === from);
    installIpk(path.join(prev, 'app.ipk'), from, done);
  }

  installIpk(path.join(o.stage, ipkName), v, function (ok) {
    if (!ok) return rollBack('the new app didn\'t install');
    scripts.forEach(function (n) {
      copy(path.join(o.stage, n), path.join(dir, n), modeOf(n));
    });
    refreshHome(function () {
      answers(v, function (up) {
        if (!up) return rollBack('the new version didn\'t answer within ' + Math.round(answerMs / 1000) + ' s');
        copy(path.join(o.stage, ipkName), path.join(upd, 'current.ipk'));
        finish({ version: v, state: 'done', from: from, note: '' });
      });
    });
  });
}

module.exports = { apply: apply, ANSWER_MS: ANSWER_MS };

if (require.main === module) {
  var stage = process.argv[2];
  var D = process.env.HOMETV_DIR || '/media/developer/hometv';
  var appId = U.APP_ID;
  apply({
    stage: stage,
    dir: D,
    app: process.env.HOMETV_APP || '/media/developer/apps/usr/palm/applications/' + appId,
    home: process.env.HOMETV_HOME_APP || '/usr/palm/applications/com.webos.app.home',
    mounts: process.env.HOMETV_MOUNTS || '/proc/mounts',
    // The keys of the app installed now, read before its new version replaces this folder.
    keys: U.loadConfig(__dirname).keys,
    run: function (cmd, done) {
      childProcess.execFile('sh', ['-c', cmd], { timeout: 150000 }, function (err, out) {
        done(err ? (err.code || 1) : 0, String(out || ''));
      });
    },
    sleep: function (ms, done) {
      setTimeout(done, ms);
    }
  }, function (r) {
    process.exitCode = r.state === 'done' ? 0 : 1;
  });
}
