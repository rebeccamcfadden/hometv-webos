/*
 * HomeTV checks' background service (webOS JS service). Plain ES5; Node built-ins plus LG's webos-service.
 * Methods: start (the phone page on port 8766), status, stop, report (results for the phone page),
 * devmode (Developer Mode's time left, if this service may read the session; the token itself never leaves it).
 */
'use strict';

var Service = require('webos-service');
var os = require('os');
var fs = require('fs');
var https = require('https');
var phoneServer = require('./phone.js');

var PORT = 8766;
var TOKEN_FILE = '/var/luna/preferences/devmode_enabled';
var CHECK_URL = 'https://developer.lge.com/secure/CheckDevModeSession.dev?sessionToken=';

var service = new Service('com.hometv.checks.service');
var phone = null;
var startedAt = 0;
var keepAlive = null;

function addresses() {
  var out = [];
  var ifaces = os.networkInterfaces();
  Object.keys(ifaces).forEach(function (name) {
    (ifaces[name] || []).forEach(function (a) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push(a.address);
    });
  });
  return out;
}

function info() {
  return {
    returnValue: true,
    running: !!(phone && startedAt),
    port: PORT,
    addresses: addresses(),
    code: phone ? phone.state.code : null,
    uptimeS: startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0,
    lastPhone: phone ? phone.state.lastPhone : null,
    notes: phone ? phone.state.notes.slice() : [],
    node: process.version
  };
}

service.register('start', function (message) {
  if (!keepAlive) {
    // Without an open activity a webOS service is stopped a few seconds after its last call.
    service.activityManager.create('hometv-checks-keepalive', function (activity) { keepAlive = activity; });
  }
  if (phone && startedAt) {
    message.respond(info());
    return;
  }
  phone = phoneServer.createPhoneServer();
  phone.server.on('error', function (e) {
    startedAt = 0;
    message.respond({ returnValue: false, errorText: 'listen failed: ' + (e && e.code || e) });
  });
  phone.server.listen(PORT, '0.0.0.0', function () {
    startedAt = Date.now();
    message.respond(info());
  });
});

service.register('status', function (message) {
  message.respond(info());
});

service.register('stop', function (message) {
  if (phone) phone.server.close();
  phone = null;
  startedAt = 0;
  if (keepAlive) {
    service.activityManager.complete(keepAlive, function () {});
    keepAlive = null;
  }
  message.respond({ returnValue: true });
});

service.register('report', function (message) {
  if (!phone) {
    message.respond({ returnValue: false, errorText: 'start the phone page first' });
    return;
  }
  phone.state.report = message.payload && message.payload.results || {};
  message.respond({ returnValue: true });
});

service.register('inputs', function (message) {
  // Read-only: the input devices' names, and whether this service may open each event node. Nothing is read from
  // them and nothing is grabbed; this is what an on-TV Home helper would need (key 773 is Home on LG's remote).
  var names = [];
  try {
    String(fs.readFileSync('/proc/bus/input/devices', 'utf8')).split('\n').forEach(function (line) {
      var m = /^N: Name="(.*)"$/.exec(line);
      if (m) names.push(m[1]);
    });
  } catch (e) {
    names = null;
  }
  var nodes = [];
  var list = [];
  try { list = fs.readdirSync('/dev/input'); } catch (e) { list = []; }
  list.filter(function (n) { return /^event\d+$/.test(n); }).forEach(function (n) {
    var ok = false;
    var code = '';
    try {
      var fd = fs.openSync('/dev/input/' + n, 'r');
      fs.closeSync(fd);
      ok = true;
    } catch (e) {
      code = e && e.code || 'error';
    }
    nodes.push(n + (ok ? ':open' : ':' + code));
  });
  message.respond({ returnValue: true, names: names, nodes: nodes });
});

service.register('home', function (message) {
  // For v0's root install: what kind of app LG's Home is (the takeover supports flutter and web) and the free space
  // where apps go. Read-only: LG Home's appinfo.json (id and type only) and `df`.
  var kind = null;
  try {
    var info = JSON.parse(String(fs.readFileSync('/usr/palm/applications/com.webos.app.home/appinfo.json', 'utf8')));
    kind = { id: info.id || '', type: info.type || '' };
  } catch (e) {
    kind = { error: e && e.code || 'unreadable' };
  }
  require('child_process').execFile('df', ['-k', '/media/developer'], { timeout: 5000 }, function (err, out) {
    var freeMb = null;
    if (!err) {
      var row = String(out).trim().split('\n').pop().split(/\s+/);
      var avail = parseInt(row[3], 10);
      if (!isNaN(avail)) freeMb = Math.round(avail / 1024);
    }
    message.respond({ returnValue: true, home: kind, freeMb: freeMb, dfError: err ? String(err.code || err.message) : null });
  });
});

service.register('devmode', function (message) {
  var token;
  try {
    token = String(fs.readFileSync(TOKEN_FILE, 'utf8')).trim();
  } catch (e) {
    message.respond({ returnValue: true, readable: false, reason: e && e.code || 'unreadable' });
    return;
  }
  if (!/^[0-9a-zA-Z]+$/.test(token)) {
    message.respond({ returnValue: true, readable: false, reason: 'unexpected token format' });
    return;
  }
  var req = https.get(CHECK_URL + encodeURIComponent(token), function (res) {
    var body = '';
    res.setEncoding('utf8');
    res.on('data', function (d) { if (body.length < 4096) body += d; });
    res.on('end', function () {
      var parsed = null;
      try { parsed = JSON.parse(body); } catch (e) { parsed = null; }
      var ok = parsed && parsed.result === 'success';
      message.respond({
        returnValue: true,
        readable: true,
        remaining: ok ? String(parsed.errorMsg || '') : null,
        answer: ok ? 'success' : ('HTTP ' + res.statusCode + ' ' + body.split(token).join('<token>').slice(0, 200))
      });
    });
  });
  req.on('error', function (e) {
    message.respond({ returnValue: true, readable: true, remaining: null, answer: 'request failed: ' + (e && e.code || e) });
  });
  req.setTimeout(10000, function () { req.abort(); });
});
