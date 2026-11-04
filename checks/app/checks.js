/*
 * HomeTV checks for LG webOS: one button per check, for the first call on a family TV. Runs as a Developer Mode app.
 * Calls LG's Luna services through PalmServiceBridge (what LG's webOSTV.js wraps). Results are kept in localStorage,
 * so they survive opening Netflix and coming back, and can be sent to the phone page.
 */
(function () {
  'use strict';

  var SERVICE = 'luna://com.hometv.checks.service/';
  var STORE = 'hometv-checks-results';
  var pending = [];

  var results = {};
  try { results = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) { results = {}; }

  function save() { try { localStorage.setItem(STORE, JSON.stringify(results)); } catch (e) { /* full */ } }

  function luna(uri, params) {
    return new Promise(function (resolve) {
      if (typeof window.PalmServiceBridge === 'undefined') {
        resolve({ returnValue: false, errorText: 'not on a webOS TV (no PalmServiceBridge)' });
        return;
      }
      var bridge = new window.PalmServiceBridge();
      pending.push(bridge);
      var done = false;
      function finish(v) {
        if (done) return;
        done = true;
        var i = pending.indexOf(bridge);
        if (i >= 0) pending.splice(i, 1);
        resolve(v);
      }
      var timer = setTimeout(function () { finish({ returnValue: false, errorText: 'no answer in 10 s' }); }, 10000);
      bridge.onservicecallback = function (msg) {
        clearTimeout(timer);
        try { finish(JSON.parse(msg)); } catch (e) { finish({ returnValue: false, errorText: String(msg) }); }
      };
      bridge.call(uri, JSON.stringify(params || {}));
    });
  }

  function errText(r) {
    return (r && (r.errorText || r.errorMessage || (r.errorCode !== undefined ? 'error ' + r.errorCode : ''))) || 'failed';
  }

  function launch(id, params) {
    var p = { id: id };
    if (params) p.params = params;
    return luna('luna://com.webos.applicationManager/launch', p);
  }

  async function launchFirst(ids, params) {
    var errors = [];
    for (var i = 0; i < ids.length; i++) {
      var r = await launch(ids[i], params);
      if (r.returnValue) return { ok: true, text: 'asked ' + ids[i] + ' to open. Did it open? (and the title?)', state: 'ask' };
      errors.push(ids[i] + ': ' + errText(r));
    }
    return { ok: false, text: errors.join('; '), state: 'fail' };
  }

  var STREAMING = {
    netflix: 'Netflix', 'youtube.leanback.v4': 'YouTube', amazon: 'Prime Video',
    'com.disney.disneyplus-prod': 'Disney+', 'com.wbd.stream': 'HBO Max', 'com.hbo.hbomax': 'HBO Max (old id)',
    hulu: 'Hulu', 'com.apple.appletv': 'Apple TV', 'com.cbs-all-access.webapp.prod': 'Paramount+', 'cdp-30': 'Plex'
  };

  var YT_VIDEO = 'jNQXAC9IVRw';
  var NETFLIX_TITLE = '80057281';

  var phone = { timer: 0 };

  var CHECKS = [
    { id: 'info', label: 'About this TV', run: async function () {
      var r = await luna('luna://com.webos.service.tv.systemproperty/getSystemInfo',
        { keys: ['modelName', 'firmwareVersion', 'sdkVersion'] });
      var ua = (navigator.userAgent.match(/Chrome\/[\d.]+/) || ['Chrome ?'])[0];
      if (!r.returnValue) return { state: 'fail', text: errText(r) + '; ' + ua };
      return { state: 'ok', text: [r.modelName, 'firmware ' + r.firmwareVersion, 'SDK ' + r.sdkVersion, ua].join(' · ') };
    } },
    { id: 'apps', label: 'List the installed apps', run: async function () {
      var r = await luna('luna://com.webos.applicationManager/listApps', {});
      if (!r.returnValue || !r.apps) return { state: 'fail', text: errText(r) };
      var found = r.apps.filter(function (a) { return STREAMING[a.id]; }).map(function (a) { return STREAMING[a.id]; });
      return { state: 'ok', text: r.apps.length + ' apps; streaming: ' + (found.join(', ') || 'none of the known ids') };
    } },
    { id: 'open-netflix', label: 'Open Netflix', run: function () { return launchFirst(['netflix']); } },
    { id: 'open-youtube', label: 'Open YouTube', run: function () { return launchFirst(['youtube.leanback.v4']); } },
    { id: 'open-prime', label: 'Open Prime Video', run: function () { return launchFirst(['amazon']); } },
    { id: 'open-disney', label: 'Open Disney+', run: function () { return launchFirst(['com.disney.disneyplus-prod']); } },
    { id: 'open-max', label: 'Open HBO Max', run: function () { return launchFirst(['com.wbd.stream', 'com.hbo.hbomax']); } },
    { id: 'open-hulu', label: 'Open Hulu', run: function () { return launchFirst(['hulu']); } },
    { id: 'link-yt-id', label: 'YouTube video (contentId)', run: function () {
      return launchFirst(['youtube.leanback.v4'], { contentId: 'v=' + YT_VIDEO });
    } },
    { id: 'link-yt-target', label: 'YouTube video (contentTarget)', run: function () {
      return launchFirst(['youtube.leanback.v4'], { contentTarget: 'https://www.youtube.com/tv?v=' + YT_VIDEO });
    } },
    { id: 'link-netflix', label: 'Netflix title (old form)', run: function () {
      return launchFirst(['netflix'], {
        contentId: 'm=http://api.netflix.com/catalog/titles/movies/' + NETFLIX_TITLE + '&source_type=4'
      });
    } },
    { id: 'phone', label: 'Start the phone page', run: async function () {
      var r = await luna(SERVICE + 'start', {});
      if (!r.returnValue) return { state: 'fail', text: 'service: ' + errText(r) };
      showPhone(r);
      return { state: 'ask', text: 'listening on port ' + r.port + ' (' + (r.addresses || []).join(', ') +
        '), Node ' + r.node + '. Open it on the phone.' };
    } },
    { id: 'phone-status', label: 'Phone page: did the phone reach it?', run: async function () {
      var r = await luna(SERVICE + 'status', {});
      if (!r.returnValue) return { state: 'fail', text: 'service: ' + errText(r) };
      showPhone(r);
      if (!r.running) return { state: 'fail', text: 'not running (start it first)' };
      var up = 'up ' + Math.round(r.uptimeS / 60) + ' min';
      if (!r.lastPhone) return { state: 'ask', text: up + '; no phone yet' };
      return { state: 'ok', text: up + '; phone reached it at ' + r.lastPhone.at + '; notes: ' + r.notes.join(' | ') };
    } },
    { id: 'devmode', label: 'Developer Mode: time left', run: async function () {
      var r = await luna(SERVICE + 'devmode', {});
      if (!r.returnValue) return { state: 'fail', text: errText(r) };
      if (!r.readable) return { state: 'fail', text: 'the app can\'t read the session (' + r.reason + ')' };
      return { state: r.remaining ? 'ok' : 'fail', text: r.remaining ? 'time left: ' + r.remaining : 'LG said: ' + r.answer };
    } },
    { id: 'report', label: 'Send these results to the phone page', run: async function () {
      var r = await luna(SERVICE + 'report', { results: results });
      if (!r.returnValue) return { state: 'fail', text: errText(r) };
      return { state: 'ok', text: 'on the phone at /report (same code)' };
    } }
  ];

  function showPhone(r) {
    var help = document.getElementById('phone-help');
    var url = document.getElementById('phone-url');
    var code = document.getElementById('phone-code');
    var seen = document.getElementById('phone-seen');
    var canvas = document.getElementById('qr');
    if (!r.running) { help.textContent = 'Not running.'; return; }
    var addr = (r.addresses || [])[0];
    if (!addr) { help.textContent = 'The service found no network address.'; return; }
    var link = 'http://' + addr + ':' + r.port + '/#' + r.code;
    help.textContent = 'Scan with the phone camera (same Wi-Fi), or type:';
    url.textContent = 'http://' + addr + ':' + r.port + '/';
    code.textContent = 'Code: ' + r.code;
    seen.textContent = r.lastPhone ? 'Phone reached the TV at ' + r.lastPhone.at : 'Waiting for the phone…';
    if (window.HomeTvQr && !canvas.dataset.link) {
      drawQr(canvas, link);
      canvas.dataset.link = link;
    }
    canvas.hidden = false;
    if (!phone.timer) {
      phone.timer = setInterval(function () {
        if (document.hidden) return;
        luna(SERVICE + 'status', {}).then(function (s) {
          if (s.returnValue) seen.textContent = s.lastPhone ? 'Phone reached the TV at ' + s.lastPhone.at +
            (s.notes.length ? '; last note: ' + s.notes[s.notes.length - 1] : '') : 'Waiting for the phone…';
        });
      }, 2000);
    }
  }

  function drawQr(canvas, text) {
    var qr = window.HomeTvQr.encodeQr(text, 'M');
    var ctx = canvas.getContext('2d');
    var quiet = 4;
    var scale = Math.floor(canvas.width / (qr.size + quiet * 2));
    var offset = Math.floor((canvas.width - scale * qr.size) / 2);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    for (var y = 0; y < qr.size; y++) {
      for (var x = 0; x < qr.size; x++) {
        if (window.HomeTvQr.dark(qr, x, y)) ctx.fillRect(offset + x * scale, offset + y * scale, scale, scale);
      }
    }
  }

  var buttons = [];

  function render() {
    var list = document.getElementById('list');
    CHECKS.forEach(function (c) {
      var row = document.createElement('div');
      row.className = 'row';
      var b = document.createElement('button');
      b.textContent = c.label;
      var res = document.createElement('div');
      res.className = 'result';
      paint(res, results[c.id]);
      b.addEventListener('click', function () {
        res.className = 'result';
        res.textContent = '…';
        Promise.resolve().then(c.run).then(function (out) {
          return out;
        }, function (e) {
          return { state: 'fail', text: String(e && e.message || e) };
        }).then(function (out) {
          out.at = new Date().toLocaleTimeString();
          results[c.id] = out;
          save();
          paint(res, out);
        });
      });
      row.appendChild(b);
      row.appendChild(res);
      list.appendChild(row);
      buttons.push(b);
    });
    buttons[0].focus();
  }

  function paint(el, out) {
    if (!out) { el.className = 'result'; el.textContent = ''; return; }
    el.className = 'result ' + (out.state || '');
    el.textContent = out.text + (out.at ? ' (' + out.at + ')' : '');
  }

  function move(delta) {
    var i = buttons.indexOf(document.activeElement);
    var next = buttons[Math.max(0, Math.min(buttons.length - 1, (i < 0 ? 0 : i + delta)))];
    next.focus();
    next.scrollIntoView({ block: 'nearest' });
  }

  document.addEventListener('keydown', function (e) {
    if (e.keyCode === 38) { move(-1); e.preventDefault(); }
    else if (e.keyCode === 40) { move(1); e.preventDefault(); }
    else if (e.keyCode === 461 || e.keyCode === 27) {
      e.preventDefault();
      if (window.PalmSystem && window.PalmSystem.platformBack) window.PalmSystem.platformBack();
    }
  });

  document.addEventListener('webOSRelaunch', function () { if (buttons.length) buttons[0].focus(); });

  function fit() {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    document.body.style.transform = s < 1 ? 'scale(' + s + ')' : '';
  }
  window.addEventListener('resize', fit);
  fit();

  window.HomeTvChecks = { CHECKS: CHECKS, luna: luna };
  render();
})();
