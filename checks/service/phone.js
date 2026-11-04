/*
 * The phone page for HomeTV checks: a small HTTP server a phone on the home Wi-Fi opens (QR on the TV). Plain ES5 and
 * Node's built-in modules only, so it runs on webOS's oldest Node (0.12 on 2016-2019 TVs). No webOS calls here: the
 * service wraps it, and tests run it on a PC.
 *
 * Routes: GET / (the page), POST /hello (code + a short note: proves a phone reached the TV),
 * GET /report?code=... (the results the TV sent). Everything else 404. The code is 6 characters, shown on the TV
 * and carried in the QR link's fragment; 10 wrong codes make a new one.
 */
'use strict';

var http = require('http');
var crypto = require('crypto');

var ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
var MAX_BODY = 4096;
var MAX_NOTES = 10;
var MAX_NOTE = 200;
var MAX_WRONG = 10;

function newCode() {
  var bytes = crypto.randomBytes(6);
  var out = '';
  for (var i = 0; i < 6; i++) out += ALPHABET.charAt(bytes[i] % ALPHABET.length);
  return out;
}

function sameCode(a, b) {
  a = String(a || '').toUpperCase();
  b = String(b || '');
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function pad(n) { return (n < 10 ? '0' : '') + n; }
function clock(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }

var PAGE = [
  '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<title>HomeTV check</title>',
  '<style>body{font-family:system-ui,sans-serif;margin:24px;max-width:32em}input,button{font-size:18px;padding:8px;',
  'margin:6px 0;width:100%;box-sizing:border-box}#out{font-weight:bold}pre{white-space:pre-wrap;font-size:13px}</style>',
  '</head><body><h1>HomeTV check</h1>',
  '<p>This page comes from the TV. If you can read it, the phone reached the TV.</p>',
  '<label>Code shown on the TV<input id="code" autocomplete="off" autocapitalize="characters"></label>',
  '<label>A note (any words, to see them arrive on the TV)<input id="note" maxlength="200"></label>',
  '<button id="send">Send to the TV</button><p id="out"></p>',
  '<button id="report">Show the TV\'s results</button><pre id="rep"></pre>',
  '<script>',
  'var c=document.getElementById("code");if(location.hash.length>1)c.value=location.hash.slice(1);',
  'document.getElementById("send").onclick=function(){var x=new XMLHttpRequest();x.open("POST","/hello");',
  'x.setRequestHeader("Content-Type","application/json");x.onload=function(){document.getElementById("out")',
  '.textContent=x.status===200?"Sent. Look at the TV.":"Not accepted ("+x.status+"): check the code."};',
  'x.onerror=function(){document.getElementById("out").textContent="Couldn\'t reach the TV."};',
  'x.send(JSON.stringify({code:c.value,note:document.getElementById("note").value}))};',
  'document.getElementById("report").onclick=function(){var x=new XMLHttpRequest();',
  'x.open("GET","/report?code="+encodeURIComponent(c.value));x.onload=function(){',
  'document.getElementById("rep").textContent=x.status===200?x.responseText:"Not available ("+x.status+")"};x.send()};',
  '</script></body></html>'
].join('');

function createPhoneServer(options) {
  options = options || {};
  var now = options.now || function () { return new Date(); };
  var state = {
    code: options.code || newCode(),
    wrong: 0,
    lastPhone: null,
    notes: [],
    report: null
  };

  function send(res, status, type, body) {
    res.writeHead(status, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    });
    res.end(body);
  }

  function wrongCode(res) {
    state.wrong++;
    if (state.wrong >= MAX_WRONG) {
      state.code = newCode();
      state.wrong = 0;
    }
    send(res, 403, 'text/plain; charset=utf-8', 'wrong code');
  }

  function handle(req, res) {
    var path = String(req.url || '/').split('?')[0];
    if (req.method === 'GET' && path === '/') {
      send(res, 200, 'text/html; charset=utf-8', PAGE);
      return;
    }
    if (req.method === 'GET' && path === '/report') {
      var q = String(req.url).split('?')[1] || '';
      var m = /(?:^|&)code=([^&]*)/.exec(q);
      if (!m || !sameCode(decodeURIComponent(m[1]), state.code)) { wrongCode(res); return; }
      send(res, 200, 'application/json; charset=utf-8', JSON.stringify(state.report || {}, null, 2));
      return;
    }
    if (req.method === 'POST' && path === '/hello') {
      var size = 0;
      var chunks = [];
      var aborted = false;
      req.on('data', function (d) {
        size += d.length;
        if (size > MAX_BODY) {
          aborted = true;
          send(res, 413, 'text/plain; charset=utf-8', 'too large');
          req.destroy();
          return;
        }
        chunks.push(d);
      });
      req.on('end', function () {
        if (aborted) return;
        var body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { body = null; }
        if (!body || typeof body !== 'object') { send(res, 400, 'text/plain; charset=utf-8', 'bad request'); return; }
        if (!sameCode(body.code, state.code)) { wrongCode(res); return; }
        state.wrong = 0;
        state.lastPhone = { at: clock(now()) };
        var note = String(body.note || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_NOTE);
        if (note) {
          state.notes.push(note);
          if (state.notes.length > MAX_NOTES) state.notes.shift();
        }
        send(res, 200, 'application/json; charset=utf-8', '{"ok":true}');
      });
      return;
    }
    send(res, 404, 'text/plain; charset=utf-8', 'not found');
  }

  var server = http.createServer(handle);
  return { server: server, state: state };
}

module.exports = { createPhoneServer: createPhoneServer, newCode: newCode, sameCode: sameCode, ALPHABET: ALPHABET };
