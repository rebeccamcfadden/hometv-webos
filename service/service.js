/*
 * HomeTV's background service on LG (webOS JS service, com.hometv.app.service). Plain ES5 (older TVs run old Node).
 * Methods (Luna, from HomeTV's page only):
 *   alive      HomeTV's page calls it every 10 s while it shows (app/src/platform.ts started()); it touches
 *              /tmp/hometv-alive, which the rooted edition's watchdog reads (root/watchdog.sh).
 * The key page (v1; pages.js holds its rules, its security design is in that file's header):
 *   start      opens the key page's HTTP server on port 8766 (the phone's page and the screen's loopback routes) and
 *              keeps this process alive while it listens; lets go once the TV's screen hasn't held it for a while
 *   token      the screen's token for the loopback routes; "" until the server holds its port. Never written to disk
 *   tmdbKey    the TMDB key the household sent, or ""; priceKeys the Watchmode and Movie of the Night keys
 *   stop       closes the server now
 * The root edition's way back (docs/root-plan.md, levels 0 and 1; root/undo-home.sh does the work, as root: the start-up
 * hook elevates this service at each start):
 *   rootState  { edition, hooked, chosen }: root/ is on the TV; its start-up hook is linked; "Use LG's Home" is chosen
 *   useLgHome  { mode: 'temp' }: LG's Home now, until the next restart (Home pressed three times), run detached, since
 *              the app manager's restart ends HomeTV's page. { mode: 'at-restart' }: LG's Home for good from the next
 *              restart (Settings › Use LG's Home); answers once the hooks are gone
 * Every method but `alive` wants a caller that is HomeTV's page, or LG's Home with HomeTV mounted over it: a TV that
 * doesn't say who called is refused, because these hand out keys or change Home. Nothing is sent anywhere but the key
 * checks that pages.js makes (one free request per key, to its own service); nothing is logged.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');

var ID = 'com.hometv.app.service';
/** As root/lib.sh ALIVE. */
var ALIVE = process.env.HOMETV_ALIVE || '/tmp/hometv-alive';
/** As root/lib.sh D and INITD (the tests point them elsewhere). */
var ROOT_DIR = process.env.HOMETV_DIR || '/media/developer/hometv';
var INITD = process.env.HOMETV_INITD || '/var/lib/webosbrew/init.d';
/** A second "LG's Home now" within this long is the same press (the first is still restarting the app manager). */
var TEMP_GAP_MS = 60000;
/** Who may call: HomeTV's page, also when it is mounted over LG's Home (root/10-hometv-home). */
var CALLERS = ['com.hometv.app', 'com.webos.app.home'];
/** How long the key page's server may sit unused before the process is let go (the screen holds it every 3 s). */
var IDLE_MS = 2 * 60000;
var SWEEP_MS = 30000;

/**
 * The caller's app id, as LG's service library gives it ("" when this TV doesn't say). It may carry the caller's
 * instance after a space or dash ("com.hometv.app-12", "com.hometv.app 12"); only a number or a UUID is cut off, so
 * another app's id that merely starts with HomeTV's ("com.hometv.app-evil") is not taken for it.
 */
function callerOf(message) {
  var s = message && (message.sender || message.applicationID);
  if (typeof s !== 'string') return '';
  return s.replace(/[ -](\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i, '');
}

/** `alive` only touches one empty file: a TV that doesn't say who called is let through. */
function allowed(message) {
  var who = callerOf(message);
  return !who || CALLERS.indexOf(who) >= 0;
}

/** The key page's methods: the caller must be known, and be HomeTV. */
function strict(message) {
  return CALLERS.indexOf(callerOf(message)) >= 0;
}

/**
 * The methods that change Home: the caller's id exactly, or with an instance after a space. No dash suffix is cut, so
 * another app named "com.hometv.app-1" is never taken for HomeTV (a TV that says "com.hometv.app-1" is refused: safe).
 */
function exact(message) {
  var s = message && (message.sender || message.applicationID);
  return typeof s === 'string' && CALLERS.indexOf(s.split(' ')[0]) >= 0;
}

function touch(path) {
  var now = new Date();
  try {
    fs.utimesSync(path, now, now);
  } catch (e) {
    fs.writeFileSync(path, '');
  }
}

/** Whether a file or a link (even one whose target is gone) is there. */
function there(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch (e) {
    return false;
  }
}

/** The root edition on this TV, as far as this service can see (a jailed service may see none of it). */
function rootStateOf(dir, initd) {
  return {
    edition: there(path.join(dir, 'undo-home.sh')),
    hooked: there(path.join(initd, '10-hometv-home')),
    chosen: there(path.join(dir, 'DISABLE'))
  };
}

/**
 * The service's methods. `deps`: pages (the module), activities ({ create(name, cb(activity)), complete(activity, cb) },
 * LG's activityManager), options (pages.create's), setTimer/clearTimer. The TV passes none; the tests pass fakes.
 */
function createMethods(deps) {
  deps = deps || {};
  var pages = deps.pages;
  var setTimer = deps.setTimer || setInterval;
  var clearTimer = deps.clearTimer || clearInterval;
  var instance = null;
  var activity = null;
  var creating = false;
  var epoch = 0;
  var sweeper = null;
  var rootDir = deps.rootDir || ROOT_DIR;
  var initd = deps.initd || INITD;
  var spawn = deps.spawn || childProcess.spawn;
  var execFile = deps.execFile || childProcess.execFile;
  var uid = deps.uid || function () {
    return process.getuid ? process.getuid() : -1;
  };
  var now = deps.now || Date.now;
  var tempAt = -Infinity;

  function refuse(message) {
    message.respond({ returnValue: false, errorText: 'not HomeTV' });
  }

  /** The key page, made on first use: a build without pages.js (v0) answers these methods with an error. */
  function one(message) {
    if (!instance) {
      try {
        instance = (pages || require('./pages.js')).create(deps.options || {});
      } catch (e) {
        message.respond({ returnValue: false, errorText: 'no key page in this build' });
        return null;
      }
    }
    return instance;
  }

  function release() {
    epoch++;
    creating = false;
    if (sweeper) clearTimer(sweeper);
    sweeper = null;
    if (activity && deps.activities) deps.activities.complete(activity, function () {});
    activity = null;
  }

  /** Lets the process go when the screen hasn't held the key page open for IDLE_MS. */
  function sweep() {
    if (instance && instance.listening() && instance.idleMs() >= IDLE_MS) {
      instance.stop();
      instance = null;
      release();
    }
  }

  return {
    alive: function (message) {
      if (!allowed(message)) return refuse(message);
      try {
        touch(ALIVE);
        message.respond({ returnValue: true });
      } catch (e) {
        message.respond({ returnValue: false, errorText: String(e && e.message) });
      }
    },
    start: function (message) {
      if (!strict(message)) return refuse(message);
      var mine = one(message);
      if (!mine) return;
      // Without an open activity a webOS service is stopped a few seconds after its last call.
      if (!activity && !creating && deps.activities) {
        creating = true;
        var born = epoch;
        deps.activities.create('hometv-keys-keepalive', function (a) {
          // Released while it was being made: let it go at once, or it would keep the service alive for good.
          if (epoch !== born) return deps.activities.complete(a, function () {});
          creating = false;
          activity = a;
        });
      }
      if (!sweeper) {
        sweeper = setTimer(sweep, SWEEP_MS);
        if (sweeper && sweeper.unref) sweeper.unref();
      }
      mine.start(function (e) {
        if (!e) return message.respond({ returnValue: true, port: mine.port() });
        if (instance === mine) instance = null;
        release();
        message.respond({ returnValue: false, errorText: 'listen failed: ' + ((e && e.code) || 'error') });
      });
    },
    stop: function (message) {
      if (!strict(message)) return refuse(message);
      if (instance) instance.stop();
      instance = null;
      release();
      message.respond({ returnValue: true });
    },
    token: function (message) {
      if (!strict(message)) return refuse(message);
      var t = instance ? instance.tvToken() : '';
      if (!t) return message.respond({ returnValue: false, errorText: 'the key page is not listening' });
      message.respond({ returnValue: true, token: t });
    },
    tmdbKey: function (message) {
      if (!strict(message)) return refuse(message);
      var p = one(message);
      if (!p) return;
      message.respond({ returnValue: true, key: p.keyOf('tmdb') });
    },
    priceKeys: function (message) {
      if (!strict(message)) return refuse(message);
      var p = one(message);
      if (!p) return;
      message.respond({ returnValue: true, watchmode: p.keyOf('watchmode'), motn: p.keyOf('motn') });
    },
    rootState: function (message) {
      if (!exact(message)) return refuse(message);
      var s = rootStateOf(rootDir, initd);
      message.respond({ returnValue: true, edition: s.edition, hooked: s.hooked, chosen: s.chosen });
    },
    useLgHome: function (message) {
      if (!exact(message)) return refuse(message);
      var mode = message.payload && message.payload.mode;
      if (mode !== 'temp' && mode !== 'at-restart') {
        return message.respond({ returnValue: false, errorText: 'mode must be temp or at-restart' });
      }
      var script = path.join(rootDir, 'undo-home.sh');
      if (!there(script)) return message.respond({ returnValue: false, errorText: 'HomeTV\'s root edition isn\'t on this TV' });
      if (uid() !== 0) {
        return message.respond({ returnValue: false, errorText: 'HomeTV\'s service isn\'t running as root (restart the TV)' });
      }
      if (mode === 'temp') {
        if (now() - tempAt < TEMP_GAP_MS) return message.respond({ returnValue: true, already: true });
        try {
          var child = spawn('sh', [script, 'temp'], { detached: true, stdio: 'ignore' });
          if (child && child.on) child.on('error', function () {});
          if (child && child.unref) child.unref();
        } catch (e) {
          return message.respond({ returnValue: false, errorText: 'couldn\'t start undo-home.sh' });
        }
        tempAt = now();
        return message.respond({ returnValue: true });
      }
      execFile('sh', [script, 'at-restart'], { timeout: 15000 }, function (err) {
        var s = rootStateOf(rootDir, initd);
        if (err || !s.chosen || s.hooked) {
          return message.respond({ returnValue: false, errorText: 'undo-home.sh didn\'t finish', chosen: s.chosen, hooked: s.hooked });
        }
        message.respond({ returnValue: true, chosen: true, hooked: false });
      });
    },
    sweep: sweep,
    instance: function () {
      return instance;
    }
  };
}

var methods = createMethods();

var Service = null;
try {
  Service = require('webos-service');
} catch (e) {
  // Not on a TV (the tests).
}
if (Service) {
  var service = new Service(ID);
  methods = createMethods({ activities: service.activityManager });
  ['alive', 'start', 'stop', 'token', 'tmdbKey', 'priceKeys', 'rootState', 'useLgHome'].forEach(function (name) {
    service.register(name, methods[name]);
  });
}

module.exports = { methods: methods, createMethods: createMethods, ALIVE: ALIVE, allowed: allowed, strict: strict, IDLE_MS: IDLE_MS };
