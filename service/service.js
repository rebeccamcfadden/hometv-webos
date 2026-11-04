/*
 * HomeTV's background service on LG (webOS JS service, com.hometv.app.service). Plain ES5 (older TVs run old Node).
 * Methods:
 *   alive  HomeTV's page calls it every 10 s while it shows (app/src/platform.ts started()); it touches
 *          /tmp/hometv-alive, which the rooted edition's watchdog reads (root/watchdog.sh). Answers only HomeTV's page.
 * The key page (v1) adds its methods here later. Nothing is sent anywhere; nothing is kept but that one empty file.
 */
'use strict';

var fs = require('fs');

var ID = 'com.hometv.app.service';
/** As root/lib.sh ALIVE. */
var ALIVE = process.env.HOMETV_ALIVE || '/tmp/hometv-alive';
/** Who may call: HomeTV's page, also when it is mounted over LG's Home (root/10-hometv-home). */
var CALLERS = ['com.hometv.app', 'com.webos.app.home'];

/** The caller's app id, as LG's service library gives it ("" when this TV doesn't say). */
function callerOf(message) {
  var s = message && message.sender;
  return typeof s === 'string' ? s.split(/[ -]/)[0] : '';
}

function allowed(message) {
  var who = callerOf(message);
  // A TV that doesn't say who called: allowed (the method only touches one empty file).
  return !who || CALLERS.indexOf(who) >= 0;
}

function touch(path) {
  var now = new Date();
  try {
    fs.utimesSync(path, now, now);
  } catch (e) {
    fs.writeFileSync(path, '');
  }
}

var methods = {
  alive: function (message) {
    if (!allowed(message)) return message.respond({ returnValue: false, errorText: 'not HomeTV' });
    try {
      touch(ALIVE);
      message.respond({ returnValue: true });
    } catch (e) {
      message.respond({ returnValue: false, errorText: String(e && e.message) });
    }
  },
};

var Service = null;
try {
  Service = require('webos-service');
} catch (e) {
  // Not on a TV (the tests).
}
if (Service) {
  var service = new Service(ID);
  Object.keys(methods).forEach(function (name) {
    service.register(name, methods[name]);
  });
}

module.exports = { methods: methods, ALIVE: ALIVE, allowed: allowed };
