#!/usr/bin/env node
// What HomeTV's page says when its heartbeat call to HomeTV's service fails: a GET of http://127.0.0.1:8767/alive with
// the error, noted in the boot log (call #2, 2026-11-18: the heartbeat never came while HomeTV was mounted over LG's
// Home, though it came when HomeTV was opened from its tile; mounted, the page runs as LG's Home, and the bus may refuse
// that call). It does NOT count as a heartbeat: a page that can't reach its service has no TMDB key and no saved
// settings, so the watchdog and the restart check must still give LG's Home back then; this only says why. lasharor's
// launcher talks to its root service over 127.0.0.1 the same way (MIT, docs/security.md). Started by 10-hometv-home, as
// root, in memory only; undo-home.sh and uninstall.sh end it. Listens on 127.0.0.1 only, writes only a few boot-log
// lines a start (ids and error texts, cut short, addresses masked). Plain ES5 (older webOS ships an old Node).
'use strict';

var fs = require('fs');
var http = require('http');

var LOG = process.env.HOMETV_LOG || '/tmp/hometv-boot.log';
var PORT = Number(process.env.HOMETV_HEARTBEAT_PORT || 8767);
/** Notes per start at most: the log is read after a failed restart, never meant to grow. */
var MAX_NOTES = 12;

var notes = 0;
var lastWhy = null;

function uptime() {
  try {
    return String(fs.readFileSync('/proc/uptime', 'utf8')).split(' ')[0];
  } catch (e) {
    return String(Math.round(process.uptime()));
  }
}

/** One boot-log line, as lib.sh say writes it. */
function say(text) {
  if (notes >= MAX_NOTES) return;
  notes++;
  try {
    fs.appendFileSync(LOG, uptime() + ' heartbeat: ' + text + '\n');
  } catch (e) {
    // no log: nothing else to do
  }
}

/** What the page sent, kept to ids and plain words: no addresses (digits with dots), at most 80 characters. */
function clean(s) {
  return String(s || '')
    .replace(/\d+\.\d+\.\d+\.\d+/g, 'ADDRESS')
    .replace(/[^A-Za-z0-9 ._:'"()\/-]/g, '')
    .slice(0, 80);
}

/** The query's values, by name (no URL module needed on an old Node). */
function query(url) {
  var out = {};
  var q = String(url).split('?')[1] || '';
  q.split('&').forEach(function (kv) {
    var i = kv.indexOf('=');
    if (i <= 0) return;
    try {
      out[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '));
    } catch (e) {
      // a broken value is left out
    }
  });
  return out;
}

function handle(req, res) {
  var head = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', 'Content-Length': '0' };
  if (req.method !== 'GET' || String(req.url).split('?')[0] !== '/alive') {
    res.writeHead(404, head);
    return res.end();
  }
  var q = query(req.url);
  var why = clean(q.why);
  var as = clean(q.as);
  if (lastWhy === null) say('first beat from the page' + (as ? ' (running as ' + as + ')' : '') + (q.hidden === '1' ? ', page hidden' : ''));
  if (why !== lastWhy && why) say('the page\'s call to HomeTV\'s service failed: ' + why);
  lastWhy = why;
  res.writeHead(204, head);
  res.end();
}

function start(port, cb) {
  var server = http.createServer(handle);
  server.on('error', function (e) {
    say('can\'t listen on 127.0.0.1:' + port + ' (' + clean(e && e.code) + ')');
    if (cb) cb(e);
  });
  server.listen(port, '127.0.0.1', function () {
    if (cb) cb(null, server);
  });
  return server;
}

module.exports = { start: start, clean: clean, query: query };

if (require.main === module) start(PORT);
