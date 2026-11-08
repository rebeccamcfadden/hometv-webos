// hometv-lg devmode <tv address>: HomeTV v0, then v1 over it, on a TV in Developer Mode, with every check the laptop can
// make itself (no Dev Manager, no root). It does what ares-install does: the Developer Mode key (devmode-key.mjs),
// SSH as `prisoner` on port 9922, the .ipk copied to /media/developer/temp and installed through luna-send-pub; then
// the Web Inspector (devmode-cdp.mjs) drives the app like the remote would, and the TV's own remote-control connection
// (SSAP) says what is on screen. The person is asked yes or no only for what a script can't see.
// Nothing it prints or writes holds the TV's address, serial number, device id or MAC address.
import fs from 'node:fs';
import path from 'node:path';
import { sshShell, sq } from './root-shell.mjs';
import { PINNED, download, sha256 } from './fetch.mjs';
import { getKey } from './devmode-key.mjs';
import { openInspector, findPage, openPage, ask as q, KEYS } from './devmode-cdp.mjs';
import { withTv, appIds, foreground, scrub } from './install-steps.mjs';

const APP = 'com.hometv.app';
const YOUTUBE = /^youtube\./;
const TEMP_DIR = '/media/developer/temp';
const LUNA_PUB = 'luna-send-pub';
const REMOVE = 'To remove HomeTV: delete it from the TV\'s app list, or delete the Developer Mode app.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UPDATES_BACK = 'To let the TV update itself again: Settings › Support › Software Update › Allow Automatic Updates on';
const VERSIONS = { v0: '0.0.1', v1: '0.1.0' };

/** Waits until `fn` gives something other than false, undefined or '' (up to `ms`); returns it, or null. */
async function until(fn, ms, step = 500) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() >= end) return null;
    await sleep(step);
  }
}

const parseLine = (line) => {
  const a = line.indexOf('{');
  if (a < 0) return null;
  try { return JSON.parse(line.slice(a)); } catch { return null; }
};

/** The .ipk for `which` ('v0' or 'v1'): the pinned download, or --v0/--v1's file (held to the pin unless --any-ipk). */
export async function getIpk(which, ctx) {
  const pin = PINNED['hometv-' + which];
  const own = ctx[which];
  if (own) {
    if (!fs.existsSync(own)) throw new Error('the file for ' + which + ' isn\'t there: ' + path.basename(own));
    if (!ctx.anyIpk && (await sha256(own)) !== pin.sha256) throw new Error(path.basename(own) + ' isn\'t the published ' + which + ' (its SHA-256 differs), so it was not used');
    return own;
  }
  return download(pin, ctx.dir, { fetchImpl: ctx.fetchImpl || fetch, log: (s) => ctx.say('  ' + s) });
}

/**
 * Copies the .ipk into the Developer Mode folder and installs it, as ares-install does; the copy is removed after.
 * Returns { ok, note }.
 */
export async function installIpk(shell, ipk, { installMs = 120000 } = {}) {
  const remote = TEMP_DIR + '/' + path.basename(ipk).replace(/[^A-Za-z0-9._-]/g, '_');
  try {
    const put = await shell.run('mkdir -p ' + TEMP_DIR + ' && cat > ' + sq(remote), { input: fs.readFileSync(ipk) });
    if (put.code !== 0) return { ok: false, note: 'the file didn\'t reach the TV (' + (String(put.stderr).trim() || 'exit ' + put.code) + ')' };
    const payload = JSON.stringify({ id: 'com.ares.defaultName', ipkUrl: remote, subscribe: true });
    const r = await shell.stream(LUNA_PUB + ' -i ' + sq('luna://com.webos.appInstallService/dev/install') + ' ' + sq(payload), (line) => {
      const j = parseLine(line);
      if (!j) return undefined;
      const d = j.details || {};
      if (d.state === 'installed' || /^installed$/i.test(String(j.status || ''))) return { ok: true, note: 'the TV says installed' };
      if (j.returnValue === false || d.state === 'failed' || d.errorCode) {
        return { ok: false, note: 'the TV refused it: ' + String(d.reason || d.errorText || j.errorText || j.errorCode || d.errorCode || 'no reason given') };
      }
      return undefined;
    }, installMs);
    if (r.verdict) return r.verdict;
    const why = String(r.stderr || '').trim().split('\n').pop();
    return { ok: false, note: why ? 'no "installed" answer from the TV (' + why + ')' : 'no "installed" answer from the TV in ' + installMs / 1000 + ' s' };
  } finally {
    await shell.run('rm -f ' + sq(remote));
  }
}

async function launchApp(shell, ctx) {
  const r = await shell.run(LUNA_PUB + ' -n 1 ' + sq('luna://com.webos.applicationManager/launch') + ' ' + sq(JSON.stringify({ id: APP })));
  const j = parseLine(String(r.stdout));
  if (j && j.returnValue === true) return true;
  try {
    return await withTv(ctx, async (tv) => (await tv.request('com.webos.applicationManager/launch', { id: APP })).returnValue !== false);
  } catch { return false; }
}

const yn = (a) => (/^\s*y/i.test(a || '') ? true : /^\s*n/i.test(a || '') ? false : null);

export async function runDevmode(ctx) {
  const say = ctx.say;
  const started = Date.now();
  const report = {
    tool: 'hometv-lg devmode', date: new Date(ctx.now || Date.now()).toISOString().slice(0, 10), stopped: '', tv: {}, versions: [], reminder: ''
  };
  const answers = [];
  let stopped = '';
  let shell = null;
  const finish = () => writeReport(ctx, report);

  const yes = async (question, who) => {
    for (let i = 0; i < 3; i++) {
      const v = yn(await ctx.ask('  ' + question + ' [y/n] '));
      if (v !== null) { answers.push({ version: who, question, answer: v ? 'yes' : 'no' }); return v; }
      say('  Please type y or n.');
    }
    return null;
  };

  try {
    fs.mkdirSync(ctx.dir, { recursive: true });
    const wanted = ctx.only ? [ctx.only] : ['v0', 'v1'];
    const ipks = {};
    for (const v of wanted) ipks[v] = await getIpk(v, ctx);

    say('\n  Getting the Developer Mode key from the TV …');
    const key = await getKey(ctx.host, ctx.dir, ctx.ask, say, { port: ctx.keyPort });
    if (key.error) throw Object.assign(new Error(key.error), { plain: true });
    shell = sshShell({
      host: ctx.host, key: key.file, knownHosts: path.join(ctx.dir, 'devmode-known-hosts'), port: ctx.sshPort || 9922, user: 'prisoner',
      timeoutMs: 60000, options: ['-o', 'HostKeyAlgorithms=+ssh-rsa', '-o', 'PubkeyAcceptedKeyTypes=+ssh-rsa']
    });
    const who = await shell.run('id -un');
    if (who.code !== 0 || String(who.stdout).trim() !== 'prisoner') {
      throw Object.assign(new Error('The TV didn\'t let the laptop in. Check Developer Mode is on and its Key Server is on, then run this again (' + scrub(String(who.stderr).trim().split('\n').pop(), ctx.host) + ').'), { plain: true });
    }
    say('  Logged in to the TV\'s Developer Mode account.');
    report.tv = await tvInfo(ctx);

    report.setup = [await autoUpdates(ctx, shell, yes, report)];
    let before = null;
    for (const v of wanted) {
      if (v === 'v1' && before) {
        await ctx.ask('\n  HomeTV v0 is installed and checked. Do any other v0 checks the person helping you asks for (HomeTV\'s\n' +
          '  Checks screen), then press Enter here to install v1 over it. ');
      }
      const R = await runVersion({ ...ctx, report }, shell, v, ipks[v], VERSIONS[v], before, yes);
      report.versions.push(R);
      if (R.snapshot) before = R.snapshot;
      delete R.snapshot;
    }
  } catch (e) {
    stopped = scrub(e && e.message ? e.message : String(e), ctx.host);
    say('\n  Stopped: ' + stopped);
  }
  report.stopped = stopped;
  report.answers = answers;
  report.totalSeconds = Math.round((Date.now() - started) / 1000);
  report.reminder = 'Switch Key Server off in the Developer Mode app.';
  return finish();
}

const UPDATE_CATEGORIES = ['option', 'general', 'network'];
const UPDATE_KEYS = ['autoUpdate', 'automaticUpdate', 'allowAutoUpdate'];
const UPDATES_WHERE = 'Settings › Support › Software Update › Allow Automatic Updates';

/**
 * Reads "Allow Automatic Updates" if the TV says (a few likely settings names, over the Developer Mode shell and over
 * SSAP; read only, never set): { value: 'on' | 'off' }, or null.
 */
async function readAutoUpdate(ctx, shell) {
  const norm = (v) => (/^(on|true|1|yes)$/i.test(String(v)) ? 'on' : /^(off|false|0|no)$/i.test(String(v)) ? 'off' : null);
  const find = (j) => {
    if (!j || j.returnValue === false || !j.settings) return null;
    for (const [k, v] of Object.entries(j.settings)) if (/auto.*update/i.test(k) && norm(v)) return norm(v);
    return null;
  };
  for (const category of UPDATE_CATEGORIES) {
    const payload = { category, keys: UPDATE_KEYS };
    const r = await shell.run(LUNA_PUB + ' -n 1 -w 5000 ' + sq('luna://com.webos.settingsservice/getSystemSettings') + ' ' + sq(JSON.stringify(payload)));
    const a = find(parseLine(String(r.stdout)));
    if (a) return { value: a };
    try {
      const b = find(await withTv(ctx, (tv) => tv.request('settings/getSystemSettings', payload)));
      if (b) return { value: b };
    } catch { /* the TV did not answer this one */ }
  }
  return null;
}

/** Before v0: the person switches Allow Automatic Updates off (this never sets it); what it was and now is goes in the report. */
async function autoUpdates(ctx, shell, yes, report) {
  const say = ctx.say;
  say('\n  --- First: switch off automatic updates, so the TV does not update itself during the checks ---');
  say('  On the TV: ' + UPDATES_WHERE + ' (Settings button on the remote, All Settings, Support).');
  const was = await readAutoUpdate(ctx, shell);
  let wasOn = null;
  let nowOff = null;
  let source = 'told by person';
  if (was) {
    source = 'read by script';
    wasOn = was.value === 'on';
    say('  The TV says it is ' + (wasOn ? 'on' : 'off') + '.');
  }
  if (wasOn === false) nowOff = true;
  else if (wasOn === true) {
    await ctx.ask('  Switch it off, then press Enter here. ');
    const again = await readAutoUpdate(ctx, shell);
    if (again) nowOff = again.value === 'off';
    else {
      nowOff = await yes('Is Allow Automatic Updates now off?', 'setup');
      source = 'read by script, then told by person';
    }
    if (again && !nowOff) nowOff = await yes('The TV still says it is on. Is Allow Automatic Updates now off?', 'setup');
  } else {
    say('  Switch it off (if it is already off, leave it off), then answer two questions.');
    wasOn = await yes('Was Allow Automatic Updates on before you switched it?', 'setup');
    nowOff = await yes('Is Allow Automatic Updates now off?', 'setup');
  }
  const word = (b, t, f) => (b === null ? 'unknown' : b ? t : f);
  const note = 'were ' + word(wasOn, 'on', 'off') + ', now ' + word(nowOff, 'off', 'not off') + '; ' + source;
  report.autoUpdates = { wasOn, nowOff, source };
  const c = { id: 'autoupdates', label: 'automatic updates off before installing', status: nowOff === true ? 'ok' : 'failed', note: scrub(note, ctx.host) };
  say('  [' + (c.status === 'ok' ? 'ok' : 'FAILED') + '] ' + c.label + ': ' + c.note);
  if (nowOff !== true) say('  Carrying on, but the TV may update itself during the checks.');
  return c;
}

async function tvInfo(ctx) {
  try {
    return await withTv(ctx, async (tv) => {
      const sw = await tv.request('com.webos.service.update/getCurrentSWInformation');
      const sys = await tv.request('system/getSystemInfo');
      // only these fields are read: never device_id, serial or the address
      return {
        model: sys.returnValue === false ? '' : String(sys.modelName || ''),
        firmware: sw.returnValue === false || !sw.major_ver ? '' : String(sw.major_ver) + '.' + String(sw.minor_ver)
      };
    });
  } catch { return {}; }
}

async function runVersion(ctx, shell, v, ipk, expected, before, yes) {
  const say = ctx.say;
  const R = { version: v, expectedVersion: expected, ipk: path.basename(ipk), seconds: {}, checks: [] };
  const t0 = Date.now();
  const lap = (k) => { R.seconds[k] = Math.round((Date.now() - t0) / 100) / 10; };
  const rec = (id, label, status, note = '') => {
    note = scrub(note, ctx.host);
    R.checks.push({ id, label, status, note });
    say('  ' + (status === 'ok' ? '[ok]     ' : status === 'failed' ? '[FAILED] ' : '[skipped]') + ' ' + v + ' · ' + label + (note ? ': ' + note : ''));
  };
  const skip = (ids, why) => ids.forEach(([id, label]) => rec(id, label, 'skipped', why));
  say('\n  --- HomeTV ' + v + ' (' + expected + ') ---');

  const inst = await installIpk(shell, ipk, { installMs: ctx.installMs });
  lap('install');
  rec('installed', 'installed on the TV', inst.ok ? 'ok' : 'failed', inst.note);
  if (!inst.ok) {
    skip(CHECK_IDS.slice(1), 'not installed');
    return R;
  }
  const listed = await until(async () => { try { return await withTv(ctx, async (tv) => (await appIds(tv)).has(APP)); } catch { return false; } }, ctx.listWaitMs || 30000, 2000);
  rec('listed', 'the TV lists HomeTV', listed ? 'ok' : 'failed', listed ? '' : 'com.hometv.app isn\'t in the TV\'s app list');
  const info = await shell.run(LUNA_PUB + ' -n 1 ' + sq('luna://com.webos.applicationManager/getAppInfo') + ' ' + sq(JSON.stringify({ id: APP })));
  const seen = (parseLine(String(info.stdout)) || {}).appInfo;
  if (seen && seen.version) rec('version', 'installed version is ' + expected, seen.version === expected ? 'ok' : 'failed', 'the TV reports ' + seen.version);

  // Opens
  const launchedAt = Date.now();
  const launched = await launchApp(shell, ctx);
  const open = launched && (await waitForeground(ctx, (id) => id === APP, ctx.openWaitMs || 20000));
  lap('open');
  rec('opens', 'launches and comes to the front', open ? 'ok' : 'failed', open ? '' : launched ? 'the TV\'s foreground app isn\'t HomeTV' : 'the launch call failed');
  if (open) {
    const on = await yes('Is HomeTV on the TV screen now?', v);
    rec('screen', 'the person sees HomeTV on screen', on ? 'ok' : 'failed', on === null ? 'no answer' : '');
  }

  // the Web Inspector
  let page = null;
  let inspector = null;
  let inspectorError = '';
  if (open) {
    inspector = await openInspector(shell, { remotePort: ctx.inspectorPort || 9998, waitMs: ctx.inspectorWaitMs });
    if (inspector.error) inspectorError = inspector.error;
    else {
      const found = await findPage(inspector.port, { waitMs: ctx.pageWaitMs || 20000 });
      if (found) page = await openPage(inspector.port, found.ws).catch(() => null);
      if (!page) inspectorError = 'inspector: page not found';
    }
  }
  R.inspector = page ? 'reached' : inspectorError || 'not tried';
  try {
    if (page) {
      const ready = await until(async () => page.eval(q('ready')), 30000);
      if (!ready) { rec('screens', 'HomeTV\'s screens drew', 'failed', 'no screen appeared in 30 s'); }
      R.snapshot = await snapshot(page);
      if (v === 'v1') {
        if (before && R.snapshot) {
          const same = JSON.stringify(before) === JSON.stringify(R.snapshot);
          rec('settings', 'settings kept through the update', same ? 'ok' : 'failed', same ? 'the same region, weather city and first-run state' : 'they differ: ' + diffKeys(before, R.snapshot).join(', '));
        } else rec('settings', 'settings kept through the update', 'skipped', before ? 'could not read the page' : 'v0 was not read');
      }
      R.firstRun = await firstRun(page, v);
      if (R.firstRun.shown) rec('firstrun', v === 'v0' ? 'first run done with defaults' : 'first run shown after the update', R.firstRun.ok ? 'ok' : 'failed', R.firstRun.note);
      else if (v === 'v1') rec('firstrun', 'first run shown after the update', 'ok', 'no (not shown)');
      if (v === 'v0') R.snapshot = await snapshot(page);
      R.firstRunShownAfterUpdate = v === 'v1' ? !!R.firstRun.shown : undefined;
      R.settings = describeSettings(R.snapshot);

      await launchPoints(page, ctx, rec);
      await about(page, ctx, R, rec);
      await stayOpen(page, ctx, launchedAt, rec, v);
      await youtube(page, shell, ctx, rec, yes, v);
      if (v === 'v1') await keyPage(page, ctx, rec);
    } else {
      await withoutInspector(shell, ctx, R, rec, yes, v, open, launchedAt, before);
    }
  } finally {
    if (page) page.close();
    if (inspector && inspector.close) inspector.close();
  }
  lap('done');
  return R;
}

const CHECK_IDS = [['installed', 'installed on the TV'], ['listed', 'the TV lists HomeTV'], ['opens', 'launches and comes to the front'], ['launchpoints', 'launch points listed or denied'],
  ['stays', 'still open after 30 s'], ['applaunch', 'an app launch (YouTube by contentId)']];

const diffKeys = (a, b) => Object.keys({ ...a, ...b }).filter((k) => a[k] !== b[k]).map((k) => k.replace(/^hometv-/, ''));

async function snapshot(page) {
  try { return JSON.parse(await page.eval(q('snapshot'))); } catch { return null; }
}

function describeSettings(s) {
  if (!s) return null;
  let p = {};
  try { p = JSON.parse(s['hometv-settings-v1'] || '{}'); } catch { /* none */ }
  return { region: p.region || null, weatherCity: (p.place && p.place.name) || null, setupDone: s['hometv-setup-done'] === '1' };
}

async function waitForeground(ctx, test, ms) {
  try {
    return await withTv(ctx, async (tv) => until(async () => { const id = await foreground(tv); return test(id) ? id : ''; }, ms, 1000));
  } catch { return null; }
}

const top = async (page) => String((await page.eval(q('top'))) || '');
const click = (page, key) => page.eval(q('click', key));

/** First run on top: v0 gets the defaults (Sweden, a Stockholm weather place); either way Start leaves it. */
async function firstRun(page, v) {
  const out = { shown: false, ok: true, note: '' };
  if (!/screen--setup/.test(await top(page))) return out;
  out.shown = true;
  const notes = [];
  if (v === 'v0') {
    await click(page, 'step-region');
    await sleep(500);
    notes.push((await click(page, 'seg-region-se')) ? 'region Sweden' : 'region: could not choose');
    await click(page, 'step-weather');
    await sleep(500);
    await click(page, 'w-change');
    await sleep(500);
    for (const c of 'stockholm') await click(page, 'wk-' + c);
    const hit = await until(() => page.eval(q('has', 'wr-0')), 15000);
    notes.push(hit && (await click(page, 'wr-0')) ? 'weather city Stockholm' : 'weather city: not chosen (the search didn\'t answer)');
    await sleep(500);
  } else notes.push('Start using Home');
  await click(page, 'start');
  let gone = await until(async () => !/screen--setup/.test(await top(page)), 4000);
  // Back on the remote ends first run too
  for (let i = 0; !gone && i < 4; i++) {
    await page.key(KEYS.back);
    gone = await until(async () => !/screen--setup/.test(await top(page)), 1500);
  }
  out.ok = !!gone;
  out.note = notes.join('; ') + (gone ? '' : '; first run did not close');
  return out;
}

async function openChecks(page) {
  await page.key(KEYS.blue);
  if (await until(async () => /checks/.test(await top(page)), 2500)) return true;
  await click(page, 'checks');
  return !!(await until(async () => /checks/.test(await top(page)), 2500));
}

async function runCheck(page, index, name, ms = 20000) {
  const read = async () => { try { return JSON.parse(await page.eval(q('result'))); } catch { return { n: 0, check: '', text: '' }; } };
  const was = await read();
  await sleep(1100);
  await click(page, 'check-' + index);
  return until(async () => {
    const r = await read();
    return (r.n !== was.n || r.check !== was.check || r.text !== was.text) && new RegExp(name + '$').test(r.check) ? r : null;
  }, ms, 700);
}

async function launchPoints(page, ctx, rec) {
  const label = 'launch points listed or denied';
  await sleep(ctx.settleMs ?? 3000);
  const home = async () => { try { return JSON.parse(await page.eval(q('problem'))); } catch { return null; } };
  const h = await home();
  if (!(await openChecks(page))) return rec('launchpoints', label, 'failed', 'the Checks screen did not open');
  const r = await runCheck(page, 1, 'apps');
  const after = await home();
  const problem = (after && after.problem) || (h && h.problem) || '';
  if (!r) return rec('launchpoints', label, 'failed', 'the "Which apps the TV lists" check gave no answer');
  if (r.ok && !problem) rec('launchpoints', label, 'ok', 'listed: ' + r.text);
  else rec('launchpoints', label, 'failed', 'denied: ' + (problem || r.text));
}

async function about(page, ctx, R, rec) {
  const r = await runCheck(page, 0, 'info');
  if (!r) return rec('about', 'About this TV', 'failed', 'no answer');
  // the model and firmware only: a serial, device id or MAC in the line is cut out
  R.about = scrub(r.text.replace(/\b(serial(\s*number)?|device[\s_-]?id|udid|mac(\s*address)?)\b[:= ]*\S+/gi, '<removed>'), ctx.host).slice(0, 120);
  rec('about', 'About this TV', r.ok ? 'ok' : 'failed', R.about);
}

async function stayOpen(page, ctx, launchedAt, rec, v) {
  const stay = ctx.stayMs ?? 30000;
  let closedAt = null;
  try {
    await withTv(ctx, async (tv) => {
      for (;;) {
        const id = await foreground(tv);
        if (id !== APP) { closedAt = (Date.now() - launchedAt) / 1000; return; }
        if (Date.now() - launchedAt >= stay) return;
        await sleep(Math.min(2000, Math.max(50, stay - (Date.now() - launchedAt))));
      }
    });
  } catch { return rec('stays', 'still open after 30 s', 'failed', 'the TV stopped answering'); }
  if (closedAt !== null) return rec('stays', 'still open after 30 s', 'failed', 'HomeTV left the front after ' + closedAt.toFixed(0) + ' s');
  const vis = await page.eval(q('visible'));
  rec('stays', 'still open after 30 s', vis === 'visible' ? 'ok' : 'failed', 'the page is ' + vis);
}

async function youtube(page, shell, ctx, rec, yes, v) {
  const label = 'an app launch (YouTube by contentId)';
  if (!(await openChecks(page))) return rec('applaunch', label, 'failed', 'the Checks screen did not open');
  await sleep(1100);
  await click(page, 'check-6');
  const fg = await waitForeground(ctx, (id) => YOUTUBE.test(id), ctx.openWaitMs || 20000);
  if (!fg) rec('applaunch', label, 'failed', 'YouTube did not come to the front');
  else {
    rec('applaunch', label, 'ok', 'YouTube came to the front');
    const playing = await yes('Is a YouTube video playing (not YouTube\'s start page)?', v);
    rec('contentid', 'YouTube opened the video (contentId)', playing ? 'ok' : 'failed', playing === null ? 'no answer' : '');
  }
  const back = await launchApp(shell, ctx);
  if (!back || !(await waitForeground(ctx, (id) => id === APP, 20000))) rec('back', 'HomeTV comes back to the front', 'failed', 'launching HomeTV again did not bring it up');
}

async function keyPage(page, ctx, rec) {
  const label = 'key page reachable';
  // Home first (Back out of the Checks screen), then Home › API keys
  for (let i = 0; i < 4 && /checks|keys|setup/.test(await top(page)); i++) { await page.key(KEYS.back); await sleep(500); }
  if (!(await click(page, 'keys'))) return rec('keypage', label, 'failed', 'no API keys button on Home');
  const k = await until(async () => {
    try { const j = JSON.parse(await page.eval(q('keypage'))); return /^http:\/\/[^\s/]+:\d+\/keys/.test(j.address) ? j : null; } catch { return null; }
  }, 20000, 700);
  if (!k) return rec('keypage', label, 'failed', 'the API keys screen showed no address');
  if (!k.qr) rec('keyqr', 'the key page shows a QR code', 'failed', 'no QR code in the screen');
  else rec('keyqr', 'the key page shows a QR code', 'ok');
  const got = await httpGet(k.address.trim());
  rec('keypage', label, got.status === 200 && /<html/i.test(got.body) ? 'ok' : 'failed',
    got.status ? 'the laptop got HTTP ' + got.status + (/<html/i.test(got.body) ? ' with the key page' : ' without the key page') : 'the laptop could not reach the page (' + got.error + ')');
  await page.key(KEYS.back);
}

async function httpGet(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return { status: res.status, body: (await res.text()).slice(0, 20000) };
  } catch (e) { return { status: 0, body: '', error: e && e.cause && e.cause.code ? e.cause.code : 'no answer' }; }
}

/** The inspector didn't answer: the checks that needed it go back to the person as yes or no. */
async function withoutInspector(shell, ctx, R, rec, yes, v, open, launchedAt, before) {
  const why = R.inspector;
  if (!open) return skip2(rec, 'HomeTV did not open');
  const home = await yes('If HomeTV shows its first-run page, press Back on the remote until Home shows. Is HomeTV\'s Home screen showing?', v);
  rec('screens', 'HomeTV\'s Home screen shows', home ? 'ok' : 'failed', why);
  const apps = await yes('Does Home show a row of apps, with no red "TV:" message under the date?', v);
  rec('launchpoints', 'launch points listed or denied', apps ? 'ok' : 'failed', 'asked, not read (' + why + ')');
  // stays open: the TV's foreground app alone
  const stay = ctx.stayMs ?? 30000;
  await sleep(Math.max(0, stay - (Date.now() - launchedAt)));
  const still = await waitForeground(ctx, (id) => id === APP, 3000);
  rec('stays', 'still open after 30 s', still ? 'ok' : 'failed', 'by the TV\'s foreground app only');
  const yt = await yes('On the remote press the Blue button, move to "7. YouTube video: app control" and press OK. Did YouTube open?', v);
  if (yt) {
    const playing = await yes('Is a YouTube video playing (not YouTube\'s start page)?', v);
    rec('applaunch', 'an app launch (YouTube by contentId)', playing ? 'ok' : 'failed', 'asked, not read (' + why + ')');
    await launchApp(shell, ctx);
  } else rec('applaunch', 'an app launch (YouTube by contentId)', yt === false ? 'failed' : 'skipped', 'asked, not read (' + why + ')');
  if (v === 'v1') {
    const kept = await yes('Are the region and weather city you set in the first version still set (Settings on Home, then Region and Weather)?', v);
    rec('settings', 'settings kept through the update', kept ? 'ok' : 'failed', 'asked, not read (' + why + ')');
    rec('keypage', 'key page reachable', 'skipped', 'needs the inspector to read the address');
  }
}
const skip2 = (rec, why) => CHECK_IDS.slice(3).forEach(([id, label]) => rec(id, label, 'skipped', why));

function writeReport(ctx, report) {
  const all = [...(report.setup || []), ...report.versions.flatMap((v) => v.checks)];
  const failed = all.filter((c) => c.status === 'failed').length;
  report.summary = { ok: all.filter((c) => c.status === 'ok').length, failed, skipped: all.filter((c) => c.status === 'skipped').length };
  const base = path.join(ctx.dir, 'lg-devmode-' + report.date);
  const json = JSON.stringify(report, null, 2);
  const lines = ['HomeTV on LG: Developer Mode install and checks, ' + report.date, '',
    'TV: ' + (report.tv.model || 'model unknown') + ', firmware ' + (report.tv.firmware || 'unknown')];
  if (report.stopped) lines.push('', 'STOPPED: ' + report.stopped);
  if (report.setup && report.setup.length) {
    lines.push('', 'Before installing:');
    for (const c of report.setup) lines.push('  ' + c.status.toUpperCase().padEnd(8) + ' ' + c.label + (c.note ? ': ' + c.note : ''));
    if (report.autoUpdates) lines.push('  automatic updates: ' + report.setup[0].note);
  }
  for (const v of report.versions) {
    lines.push('', 'HomeTV ' + v.version + ' (' + v.expectedVersion + ')  inspector: ' + v.inspector);
    for (const c of v.checks) lines.push('  ' + c.status.toUpperCase().padEnd(8) + ' ' + c.label + (c.note ? ': ' + c.note : ''));
    if (v.about) lines.push('  About this TV: ' + v.about);
  }
  if (report.answers && report.answers.length) {
    lines.push('', 'Answers from the person:');
    for (const a of report.answers) lines.push('  ' + a.version + ' · ' + a.question + ' ' + a.answer);
  }
  lines.push('', report.summary.ok + ' ok, ' + failed + ' failed, ' + report.summary.skipped + ' skipped, ' + report.totalSeconds + ' s', '', report.reminder, REMOVE, UPDATES_BACK);
  const text = lines.join('\n') + '\n';
  const clean = (s) => scrub(s, ctx.host);
  fs.writeFileSync(base + '.json', clean(json));
  fs.writeFileSync(base + '.txt', clean(text));
  const shown = clean(base);
  ctx.say('\n' + clean(text));
  ctx.say('  Reports: ' + shown + '.json and ' + shown + '.txt');
  ctx.say(failed || report.stopped
    ? '  Send the .txt file (and the .json) back to the person who sent you the link: it lists what failed.'
    : '  All checks passed. Send the .txt file back to the person who sent you the link, with a thumbs up.');
  return { report, failed, files: [base + '.json', base + '.txt'], stopped: !!report.stopped };
}
