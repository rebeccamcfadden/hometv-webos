// hometv-lg devmode <tv address>: HomeTV v2 (0.2.0) on a TV in Developer Mode, over the HomeTV already there or as a
// first install (--from-v0: v0 first, then v2 over it), with every check the laptop can make itself (no Dev Manager,
// no root). It does what ares-install does: the Developer Mode key (devmode-key.mjs),
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
// The versions each pinned .ipk installs, from its file name (com.hometv.app_<version>_all.ipk)
const pinnedVersion = (k) => (PINNED[k].file.match(/_(\d+\.\d+\.\d+)_all\.ipk$/) || [])[1];
const VERSIONS = { v0: pinnedVersion('hometv-v0'), v2: pinnedVersion('hometv-v2') };

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

/** The .ipk for `which` ('v0' or 'v2'): the pinned download, or --v0/--v2's file (held to the pin unless --any-ipk). */
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
    const wanted = ctx.only ? [ctx.only] : ctx.fromV0 ? ['v0', 'v2'] : ['v2'];
    const ipks = {};
    for (const v of wanted) ipks[v] = await getIpk(v, ctx);

    // On a rooted TV LG's Developer Mode app must not come back: deleting it again later takes the "Developer Mode on"
    // flag with it, and LG then wipes /media/developer, Homebrew Channel included (webosbrew issue 256, 33.31.75)
    // A list that can't be read never counts as "not rooted": the person confirms, or it stops
    let rooted = null;
    try { rooted = (await withTv(ctx, appIds)).has('org.webosbrew.hbchannel'); } catch { /* asked below */ }
    if (rooted === null) {
      say('  The laptop couldn\'t read the TV\'s list of apps, so it can\'t tell whether this TV is rooted.');
      const none = await yes('Look at the TV\'s apps: is it true there is NO Homebrew Channel on it?', 'setup');
      if (none !== true) {
        throw Object.assign(new Error('Stopped: the laptop couldn\'t tell whether this TV is rooted (its list of apps couldn\'t be ' +
          'read), and Developer Mode must never go on a rooted TV. Check the TV is on and the laptop can reach it, then run this ' +
          'again; if Homebrew Channel is on the TV, don\'t use Developer Mode on it: ask the HomeTV team.'), { plain: true });
      }
      rooted = false;
    }
    if (rooted) {
      throw Object.assign(new Error('This TV is rooted (Homebrew Channel is installed): HomeTV goes on it through Homebrew ' +
        'Channel, not Developer Mode. Don\'t install, switch on or delete LG\'s Developer Mode app on it; ask the HomeTV team.'), { plain: true });
    }

    say('\n  Getting the Developer Mode key from the TV …');
    const key = await getKey(ctx.host, ctx.dir, ctx.ask, say, { port: ctx.keyPort, waitMs: ctx.keyWaitMs, stepMs: ctx.keyStepMs });
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
    // v2 first in this run: the HomeTV already on the TV (v1 0.1.1 on the first call's TV) has its settings read, so the
    // update is checked against them; on a TV without HomeTV, v2 is a first install
    let prior = wanted[0] === 'v2' ? await readEarlier(ctx, shell, report) : null;
    for (const v of wanted) {
      if (v === 'v2' && prior && prior.from === 'v0') {
        await ctx.ask('\n  HomeTV v0 is installed and checked. Do any other v0 checks the person helping you asks for (HomeTV\'s\n' +
          '  Checks screen), then press Enter here to install v2 over it. ');
      }
      const R = await runVersion({ ...ctx, report }, shell, v, ipks[v], VERSIONS[v], prior, yes);
      report.versions.push(R);
      prior = { from: v, snapshot: R.snapshot || null };
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
      const opt = await tv.request('settings/getSystemSettings', { category: 'option', keys: ['country'] });
      const country = opt.returnValue === false || !opt.settings ? '' : String(opt.settings.country || '');
      // only these fields are read: never device_id, serial or the address
      return {
        model: sys.returnValue === false ? '' : String(sys.modelName || ''),
        firmware: sw.returnValue === false || !sw.major_ver ? '' : String(sw.major_ver) + '.' + String(sw.minor_ver),
        ...(/^[A-Z]{2,3}$/.test(country) ? { country } : {})
      };
    });
  } catch { return {}; }
}

/**
 * The HomeTV already on the TV, before v2 goes over it: its version, and its settings read through the Web Inspector
 * (it is opened for that). Returns null when HomeTV isn't on the TV (a first install), else { from, version, snapshot }
 * (snapshot null when the settings couldn't be read; the settings check is then skipped, not failed).
 */
async function readEarlier(ctx, shell, report) {
  let listed = null;
  try { listed = (await withTv(ctx, appIds)).has(APP); } catch { /* read below from the TV's own answer */ }
  const info = await shell.run(LUNA_PUB + ' -n 1 ' + sq('luna://com.webos.applicationManager/getAppInfo') + ' ' + sq(JSON.stringify({ id: APP })));
  const seen = (parseLine(String(info.stdout)) || {}).appInfo;
  const version = seen && seen.version ? String(seen.version) : '';
  if (!version && listed !== true) { report.earlier = { version: '' }; return null; }
  report.earlier = { version: version || 'unknown' };
  ctx.say('\n  HomeTV ' + (version || '') + ' is on the TV: reading its settings first, so the update can be checked against them.');
  if (!(await launchApp(shell, ctx)) || !(await waitForeground(ctx, (id) => id === APP, ctx.openWaitMs || 30000))) {
    ctx.say('  It didn\'t come to the front, so its settings weren\'t read.');
    return { from: 'earlier', version, snapshot: null };
  }
  const inspector = await openInspector(shell, { remotePort: ctx.inspectorPort || 9998, waitMs: ctx.inspectorWaitMs });
  let page = null;
  try {
    if (!inspector.error) {
      const found = await findPage(inspector.port, { waitMs: ctx.pageWaitMs || 20000 });
      if (found) page = await openPage(inspector.port, found.ws).catch(() => null);
    }
    if (!page) { ctx.say('  The Web Inspector didn\'t answer, so its settings weren\'t read.'); return { from: 'earlier', version, snapshot: null }; }
    await until(async () => page.eval(q('ready')), 30000);
    return { from: 'earlier', version, snapshot: await snapshot(page) };
  } finally {
    if (page) page.close();
    if (inspector && inspector.close) inspector.close();
  }
}

async function runVersion(ctx, shell, v, ipk, expected, prior, yes) {
  // An update (over v0 in this run, or over the HomeTV that was on the TV), or a first install
  const update = !!prior;
  const before = prior && prior.snapshot;
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
  let launched = await launchApp(shell, ctx);
  const fg = {};
  const openWait = ctx.openWaitMs || 30000;
  let open = launched && !!(await waitForeground(ctx, (id) => id === APP, openWait, fg));
  if (!open) {
    // On the real TV v1 opened by hand but the foreground read missed it once: launch again and wait once more.
    launched = (await launchApp(shell, ctx)) || launched;
    open = launched && !!(await waitForeground(ctx, (id) => id === APP, openWait, fg));
  }
  let toldOpen = false;
  if (!open && launched) {
    toldOpen = (await yes('The script can\'t see HomeTV in front (the TV says: ' + scrub(String(fg.last || 'nothing'), ctx.host) + '). Is HomeTV on the TV screen now?', v)) === true;
    open = toldOpen;
  }
  lap('open');
  rec('opens', 'launches and comes to the front', open ? 'ok' : 'failed',
    toldOpen ? 'told by person; the TV\'s foreground read: ' + (fg.last || 'nothing')
      : open ? '' : launched ? 'the TV\'s foreground app isn\'t HomeTV (' + (fg.last || 'nothing read') + ')' : 'the launch call failed');
  if (open && !toldOpen) {
    const on = await yes('Is HomeTV on the TV screen now?', v);
    rec('screen', 'the person sees HomeTV on screen', on ? 'ok' : 'failed', on === null ? 'no answer' : '');
  } else if (toldOpen) rec('screen', 'the person sees HomeTV on screen', 'ok', '');

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
      if (update) {
        if (before && R.snapshot) {
          const same = JSON.stringify(before) === JSON.stringify(R.snapshot);
          rec('settings', 'settings kept through the update', same ? 'ok' : 'failed', same ? 'the same region, weather city and first-run state' : 'they differ: ' + diffKeys(before, R.snapshot).join(', '));
        } else rec('settings', 'settings kept through the update', 'skipped', before ? 'could not read the page' : 'the earlier HomeTV\'s settings were not read');
      }
      R.firstRun = await firstRun(page, { fresh: !update, tmdb: v !== 'v0', country: ctx.report && ctx.report.tv && ctx.report.tv.country });
      if (R.firstRun.shown) rec('firstrun', update ? 'first run shown after the update' : 'first run done with defaults', R.firstRun.ok ? 'ok' : 'failed', R.firstRun.note);
      else if (update) rec('firstrun', 'first run shown after the update', 'ok', 'no (not shown)');
      if (!update) R.snapshot = await snapshot(page);
      R.firstRunShownAfterUpdate = update ? !!R.firstRun.shown : undefined;
      R.settings = describeSettings(R.snapshot);

      await launchPoints(page, ctx, rec);
      await about(page, ctx, R, rec);
      await stayOpen(page, ctx, launchedAt, rec, v);
      await youtube(page, shell, ctx, rec, yes, v);
      if (v !== 'v0') await keyPage(page, ctx, rec);
    } else {
      await withoutInspector(shell, ctx, R, rec, yes, v, open, launchedAt, update);
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

/**
 * Polls the TV's foreground app until `test` passes or `ms` has gone by. A failed read (the remote-control connection
 * dropping, say while the TV starts the app) is retried with a new connection instead of ending the wait. `seen.last`
 * gets the last app id read, or the last error.
 */
async function waitForeground(ctx, test, ms, seen = {}) {
  return until(async () => {
    try {
      const id = await withTv(ctx, foreground);
      seen.last = id || '(none)';
      return test(id) ? id : '';
    } catch (e) {
      seen.last = 'no answer (' + String((e && e.message) || e).slice(0, 80) + ')';
      return '';
    }
  }, ms, 1000);
}

const top = async (page) => String((await page.eval(q('top'))) || '');
const click = (page, key) => page.eval(q('click', key));

/** HomeTV's region for the TV's country setting ("USA", "SWE"), or null for one HomeTV doesn't have. */
export function regionFor(country) {
  const c = String(country || '').toUpperCase();
  return c === 'USA' || c === 'US' ? 'us' : c === 'SWE' || c === 'SE' ? 'se' : null;
}

/**
 * First run on top. A first install gets the TV's own region (from its country setting); the weather city is left for
 * the person to choose (the 2026-11-17 call: a US TV got Sweden and Stockholm, °C). From v1 on it lists the TMDB
 * steps. Either way Start leaves it.
 */
async function firstRun(page, { fresh, tmdb, country } = {}) {
  const out = { shown: false, ok: true, note: '' };
  if (!/screen--setup/.test(await top(page))) return out;
  out.shown = true;
  const notes = [];
  if (fresh) {
    const region = regionFor(country);
    if (region) {
      await click(page, 'step-region');
      await sleep(500);
      const name = region === 'us' ? 'United States' : 'Sweden';
      notes.push((await click(page, 'seg-region-' + region)) ? 'region ' + name + ' (the TV\'s country)' : 'region: could not choose');
    } else notes.push('region left for the person (the TV\'s country ' + (country ? country + ' isn\'t one HomeTV has' : 'wasn\'t read') + ')');
    notes.push('weather city left for the person');
  }
  if (tmdb) {
    // v1's and v2's First run lists the TMDB key (only while no key is saved) and Sign in to TMDB; the person walks
    // through them after the checks, from Settings › Open first run
    const key = await page.eval(q('has', 'step-tmdbKey'));
    const account = await page.eval(q('has', 'step-account'));
    notes.push(`TMDB steps: key ${key ? 'listed' : 'not listed'}, sign-in ${account ? 'listed' : 'not listed'}`);
    if (!account) out.ok = false;
  }
  if (tmdb || !fresh) notes.push('Start using Home');
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
async function withoutInspector(shell, ctx, R, rec, yes, v, open, launchedAt, update) {
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
  if (update) {
    const kept = await yes('Are the region and weather city set before this update still set (Settings on Home, then Region and Weather)?', v);
    rec('settings', 'settings kept through the update', kept ? 'ok' : 'failed', 'asked, not read (' + why + ')');
  }
  if (v !== 'v0') rec('keypage', 'key page reachable', 'skipped', 'needs the inspector to read the address');
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
  if (report.earlier) lines.push('HomeTV on the TV before: ' + (report.earlier.version || 'none'));
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
