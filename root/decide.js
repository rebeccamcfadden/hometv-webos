#!/usr/bin/env node
// The decisions HomeTV's root scripts follow, and the JSON they need, so the shell needs no python. Plain ES5 (older
// webOS ships an old Node). Adapted from lasharor/cleanyourtv-WebOS's helper/tvprofile.js and scripts/jtool.js (MIT).
//   decide.js kind <appinfo.json>                 -> "<id> <type>"
//   decide.js takeover <home kind>                -> mount | unsupported
//   decide.js aftersam <sdk version> <home kind>  -> the services to restart after sam (may be empty)
//   decide.js stage <stock home appinfo.json> <out>  writes the appinfo.json for HomeTV over LG's Home
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

// lasharor's findings: webOS 25 (SDK 10) video apps could play black after the sam restart until videooutputd and
// umediaserver were restarted (its issue 122); webOS 26 (SDK 11) lost HDMI ARC sound until arccontroller (issue 21)
// and video until umediaserver (pull request 73).
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

module.exports = { kind: kind, takeover: takeover, afterSam: afterSam, stage: stage };

if (require.main === module) {
  var a = process.argv.slice(2);
  if (a[0] === 'kind') console.log(kind(a[1]));
  else if (a[0] === 'takeover') console.log(takeover(a[1] || ''));
  else if (a[0] === 'aftersam') console.log(afterSam(a[1], a[2] || ''));
  else if (a[0] === 'stage') stage(a[1], a[2]);
  else {
    console.error('usage: decide.js kind|takeover|aftersam|stage');
    process.exit(2);
  }
}
