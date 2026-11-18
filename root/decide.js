#!/usr/bin/env node
// The decisions HomeTV's root scripts follow, and the JSON they need, so the shell needs no python. Plain ES5 (older
// webOS ships an old Node). Adapted from lasharor/cleanyourtv-WebOS's helper/tvprofile.js and scripts/jtool.js (MIT).
//   decide.js kind <appinfo.json>                 -> "<id> <type>"
//   decide.js takeover <home kind>                -> mount | unsupported
//   decide.js aftersam <sdk version> <home kind>  -> the services to restart after sam (may be empty)
//   decide.js stage <stock home appinfo.json> <out>  writes the appinfo.json for HomeTV over LG's Home
//   decide.js family <model name>                 -> the model family (43UT8000AUA -> UT80), or nothing
//   decide.js compat <compat.json> <model> <firmware>  -> "listed <status>: <note>", "unlisted", or "nolist" (no list)
//   decide.js acg <home id> <service id> <luna-service2 root>...  -> the bus groups each holds, and the shared ones
var fs = require('fs');

function rj(f, d) {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    return d;
  }
}

function kind(file) {
  var o = rj(file, null);
  return o ? (o.id || '') + ' ' + (o.type || '') : '';
}

// Only LG's flutter or web Home (webOS 24 and newer) is supported: the launcher's folder is mounted over it and the app
// manager restarted. The native Home of webOS 5-23 needs lasharor's stand-in, which HomeTV doesn't carry (v0).
function takeover(homeKind) {
  return /^com\.webos\.app\.home (flutter|web)$/.test(homeKind) ? 'mount' : 'unsupported';
}

// lasharor's findings (helper/tvprofile.js afterSam, compared again at 2debe62), for the flutter or web Home only:
// webOS 25 (SDK 10): on an OLED65B2RLA (SDK 10.3.2, 33.31.75, the test TV's firmware) video apps now and then played
// with a black picture after the sam restart until videooutputd and then umediaserver were restarted, in that order
// (its issue 122); eARC is kept there, so arccontroller is left alone. Other webOS 25 TVs were fine without it, which is
// what after-sam-services is for. webOS 26 (SDK 11) lost HDMI ARC sound until arccontroller was restarted (issue 21)
// and video until umediaserver (pull request 73). The native Home's list (webOS 5-23) isn't carried.
function afterSam(sdk, homeKind) {
  var major = parseInt(String(sdk || '').split('.')[0], 10) || 0;
  if (!/\s(flutter|web)$/.test(homeKind)) return '';
  if (major === 10) return 'videooutputd umediaserver';
  if (major === 11) return 'arccontroller umediaserver';
  return '';
}

function stage(stockFile, out) {
  var h = rj(stockFile, null);
  if (!h || h.id !== 'com.webos.app.home') {
    console.error('not LG Home\'s appinfo: ' + stockFile);
    process.exit(1);
  }
  h.type = 'web';
  h.main = 'index.html';
  delete h.splashBackground;
  delete h.noSplashOnLaunch;
  h.bgColor = '#000000';
  h.transparent = false;
  fs.writeFileSync(out, JSON.stringify(h, null, 1));
}

// An LG model name's family: the panel type and series, without the size and region letters (tools/lib/recovery.mjs
// modelFamily; "OLED65C46LA" -> "OLEDC4", "43UT8000AUA" -> "UT80", "65QNED86T6A" -> "QNED86"). '' when it isn't one.
function family(model) {
  var s = String(model || '').toUpperCase().replace(/[\s-]/g, '');
  var m = /^OLED\d{2}([A-Z]{1,2}\d)/.exec(s);
  if (m) return 'OLED' + m[1];
  var o = /^\d{2}(QNED\d{2}|NANO\d{2}|[A-Z]{2,3}\d{2})/.exec(s);
  return o ? o[1] : '';
}

// The firmware list (root/compat.json; the idea from lasharor's compat.json, MIT, read at 2debe62): the first entry
// whose firmware matches (a trailing * matches a prefix) and, when it names families, the TV's family. An unread
// firmware, or a family the entry doesn't name, is unlisted.
function compat(file, model, firmware) {
  var list = rj(file, null);
  var fw = String(firmware || '');
  var fam = family(model);
  if (!list || !Array.isArray(list.entries) || !fw) return null;
  for (var i = 0; i < list.entries.length; i++) {
    var e = list.entries[i] || {};
    var f = String(e.firmware || '');
    var hit = f.slice(-1) === '*' ? fw.indexOf(f.slice(0, -1)) === 0 : f === fw;
    if (!hit) continue;
    if (Array.isArray(e.families) && e.families.indexOf(fam) < 0) continue;
    return e;
  }
  return null;
}

// Which bus permission groups LG's Home holds, and which groups HomeTV's service's methods are in, from luna-service2's
// files under each root (client-permissions.d, api-permissions.d): the bus lets a client call a method only when they
// share a group. Read only, for the boot log (call #2: did the bus refuse the mounted page's heartbeat?). A pattern
// ending in * matches a prefix, as luna-service2's do. Groups are LG's names, never anything of the household's.
function acg(home, svc, roots) {
  var homeGroups = {};
  var svcGroups = {};
  var read = 0;
  roots.forEach(function (r) {
    ['client-permissions.d', 'api-permissions.d'].forEach(function (sub) {
      var dir = r + '/' + sub;
      var names = [];
      try {
        names = fs.readdirSync(dir);
      } catch (e) {
        return;
      }
      names.forEach(function (n) {
        var o = /\.json$/.test(n) ? rj(dir + '/' + n, null) : null;
        if (!o || typeof o !== 'object') return;
        read++;
        Object.keys(o).forEach(function (k) {
          var v = Array.isArray(o[k]) ? o[k] : [];
          if (sub === 'client-permissions.d') {
            var hit = k === home || (k.slice(-1) === '*' && home.indexOf(k.slice(0, -1)) === 0);
            if (hit) v.forEach(function (g) { homeGroups[String(g)] = 1; });
          } else if (v.some(function (m) { return String(m).indexOf(svc + '/') === 0; })) {
            svcGroups[k] = 1;
          }
        });
      });
    });
  });
  var hg = Object.keys(homeGroups).sort();
  var sg = Object.keys(svcGroups).sort();
  // a client holding "all" may call anything
  var shared = homeGroups.all ? sg.slice() : sg.filter(function (g) { return homeGroups[g]; });
  return {
    read: read, home: hg, service: sg, shared: shared,
    line: 'files read ' + read + '; ' + home + ': ' + (hg.join(' ') || 'none found') + '; ' + svc + ': ' + (sg.join(' ') || 'none found') +
      '; shared: ' + (shared.join(' ') || 'none')
  };
}

module.exports = { kind: kind, takeover: takeover, afterSam: afterSam, stage: stage, family: family, compat: compat, acg: acg };

if (require.main === module) {
  var a = process.argv.slice(2);
  if (a[0] === 'kind') console.log(kind(a[1]));
  else if (a[0] === 'takeover') console.log(takeover(a[1] || ''));
  else if (a[0] === 'aftersam') console.log(afterSam(a[1], a[2] || ''));
  else if (a[0] === 'stage') stage(a[1], a[2]);
  else if (a[0] === 'family') console.log(family(a[1]));
  else if (a[0] === 'compat') {
    var l = rj(a[1], null);
    var e = compat(a[1], a[2], a[3]);
    console.log(!l || !Array.isArray(l.entries) ? 'nolist' : e ? 'listed ' + (e.status || '') + ': ' + (e.note || '') : 'unlisted');
  } else if (a[0] === 'acg') console.log(acg(a[1] || '', a[2] || '', a.slice(3)).line);
  else {
    console.error('usage: decide.js kind|takeover|aftersam|stage|family|compat|acg');
    process.exit(2);
  }
}
