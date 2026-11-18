// hometv-lg-root prepare: the steps before the call (docs/root.md, "Before the call"), as one guided command. Each step
// says what it does and how it's undone, and stops at the first thing that isn't ready; run again, it carries on where
// it stopped (prepare-state.json in the HomeTV folder). It never changes the TV and never roots: it reads the TV, and on
// this laptop it fetches the checked tools, may add Windows' OpenSSH client and set the firewall for the call (each
// asked first, one Windows prompt; the firewall is put back by `prepare --undo`), takes the backup and writes a sign-in
// list. At the end it writes prepare-report-<date>.txt, with no TV address, serial, device id or Wi-Fi name in it.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import sea from 'node:sea';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PINNED, download, sha256, getRootKit } from './fetch.mjs';
import { withTv, appIds, readAutoUpdate, latestBackup, rootKit, scrub } from './install-steps.mjs';
import { reach } from './reach.mjs';
import { backup, describe, WARNING } from './backup.mjs';
import { ROOTABLE } from './checks.mjs';
import { checkStick, describeStick, modelFamily } from './recovery.mjs';
import { keyFile as devmodeKeyFile, fetchKeyPatiently, getKey } from './devmode-key.mjs';
import { portOpen } from './telnet.mjs';

const APP = 'com.hometv.app';
const DEVMODE = 'com.palmdts.devmode';
const HBC = 'org.webosbrew.hbchannel';
const SW_WHERE = 'Settings > All Settings > Support > TV Information, Software Version';
const MODEL_WHERE = 'Settings > All Settings > Support > TV Information, Model';
const UPDATES_WHERE = 'Settings > All Settings > Support > Software Update';
const yes = (a) => /^\s*y/i.test(a || '');
const no = (a) => /^\s*n/i.test(a || '');

/** The firewall rule's name, as Windows' firewall settings show it. */
export const RULE = 'HomeTV root (remove after the call)';
/** A backup younger than this, of this TV's model, is used as it is. */
export const FRESH_DAYS = 7;
/** The page LG's US support gives the test TV's model on (no published checksum for its files: read 2026-11-18). */
export const LG_PAGES = { '43UT8000AUA': 'https://www.lg.com/us/support/product/lg-43UT8000AUA.AUS' };
export const LG_FIRMWARE_PAGE = 'https://www.lg.com/us/support/software-firmware';

// The settings screens to photograph (docs/root-plan.md, Backup, part 2), with where they are on webOS 23-25
// (docs/privacy.md); where a path is unsure, All Settings' search finds the name.
export const PHOTOS = [
  'Picture: Settings > All Settings > Picture (the mode, then each page under it)',
  'Sound: Settings > All Settings > Sound (the output and the mode)',
  'The privacy switches: General > System > Additional Settings (Live Plus, Home Settings), and Support > Privacy & Terms',
  'The order of the apps on Home (the Home screen, scrolled along the app row)',
  'Quick Start+ and Power On Screen: General > System > Additional Settings',
  'HDMI device links: search All Settings (the magnifier) for SIMPLINK, and photograph that page',
  'The channel list, only if an aerial or cable is used with the TV\'s own tuner: Live TV > the channel list',
  'Accessibility: General > Accessibility'
];

const stop = (why, next) => ({ stop: why, next });

// --- Windows, on this laptop. Tests pass ctx.windows with the same shape; nothing here touches the TV.

function powershell(script, timeoutMs = 60000) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { encoding: 'utf8', timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
        resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
      });
  });
}

/** A PowerShell single-quoted string. */
const psq = (s) => "'" + String(s).replace(/'/g, "''") + "'";

/** The script as it runs elevated: stops at the first error, which goes to `errFile`. */
export const adminWrap = (script, errFile) => '$ErrorActionPreference = \'Stop\'\ntry {\n' + script + '\n} catch { $_ | Out-String | Set-Content -LiteralPath ' + psq(errFile) + '; exit 1 }';

/**
 * The command that starts \`inner\` as administrator and waits for it: exits with its code, or 1223 (Windows' "the
 * operation was canceled by the user") when No is chosen at the prompt, or 1 when it couldn't start.
 */
export const elevateCommand = (inner) => 'try { $p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ErrorAction Stop -ArgumentList ' +
  '\'-NoProfile\',\'-NonInteractive\',\'-ExecutionPolicy\',\'Bypass\',\'-EncodedCommand\',' + psq(Buffer.from(inner, 'utf16le').toString('base64')) +
  ' } catch { [Console]::Error.WriteLine($_.Exception.Message); if ($_.Exception.Message -match \'cancel\') { exit 1223 }; exit 1 }; ' +
  'if (-not $p) { exit 1 }; exit $p.ExitCode';

/**
 * Runs \`script\` as administrator: one Windows prompt ("Do you want to allow this app to make changes"). Its errors go
 * to a file in \`dir\` (the window it runs in is hidden). Returns { ok } or { error } in plain words.
 */
async function elevated(script, dir) {
  const errFile = path.join(dir, 'prepare-admin-error.txt');
  try { fs.rmSync(errFile, { force: true }); } catch { /* not there */ }
  const r = await powershell(elevateCommand(adminWrap(script, errFile)), 15 * 60000);
  if (r.code === 0) return { ok: true };
  if (r.code === 1223 || /cancel/i.test(r.stderr)) return { error: 'No was chosen at Windows\' prompt' };
  let why = '';
  try { why = fs.readFileSync(errFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0] || ''; } catch { /* none written */ }
  return { error: why ? 'Windows said: ' + why.replace(/\.$/, '') : 'it didn\'t finish (code ' + r.code + ')' };
}

/** What runs as administrator (the tests parse these with PowerShell's own parser, running nothing). */
export const ADMIN = {
  addSsh: () => 'Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0 | Out-Null',
  allow: ({ index, programs, rule, setPrivate }) => [
    ...(setPrivate ? ['Set-NetConnectionProfile -InterfaceIndex ' + Number(index) + ' -NetworkCategory Private'] : []),
    'Remove-NetFirewallRule -DisplayName ' + psq(rule) + ' -ErrorAction SilentlyContinue',
    ...programs.map((p) => 'New-NetFirewallRule -DisplayName ' + psq(rule) + ' -Direction Inbound -Action Allow -Profile Private -Program ' + psq(p) + ' | Out-Null')
  ].join('\n'),
  /** Takes the rule out (when \`rule\`), and puts each network in \`restore\` (on its adapter, \`alias\`) back to \`was\`. */
  undo: ({ rule, restore = [] }) => [
    ...(rule ? ['Remove-NetFirewallRule -DisplayName ' + psq(rule) + ' -ErrorAction SilentlyContinue'] : []),
    ...restore.map((n) => 'Set-NetConnectionProfile -InterfaceAlias ' + psq(n.alias) + ' -NetworkCategory ' + (n.was === 'Public' ? 'Public' : 'Private'))
  ].join('\n')
};

/** A network's name, as a salted hash (it tells the same network again; the name itself is never kept or shown). */
const netId = (name, salt) => (name ? crypto.createHash('sha256').update(String(salt) + '\n' + name).digest('hex').slice(0, 16) : '');

/** The real Windows side. \`salt\`: the undo list's, for the networks' ids. */
export function windowsOps() {
  return {
    /** ssh.exe's path, or ''. */
    async sshPath() {
      const own = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe');
      if (fs.existsSync(own)) return own;
      const r = await powershell('(Get-Command ssh.exe -ErrorAction SilentlyContinue).Source');
      return r.stdout.trim();
    },
    addSsh: (dir) => elevated(ADMIN.addSsh(), dir),
    /**
     * The network this laptop reaches the TV through: { index, alias, category, id } (category Public, Private or
     * DomainAuthenticated; id the network's name hashed with \`salt\`), or { error }.
     */
    async network(host, salt) {
      const r = await powershell('$ErrorActionPreference = \'Stop\'; $r = Find-NetRoute -RemoteIPAddress ' + psq(host) +
        ' | Where-Object InterfaceIndex | Select-Object -First 1; $p = Get-NetConnectionProfile -InterfaceIndex $r.InterfaceIndex; ' +
        '[pscustomobject]@{ index = $p.InterfaceIndex; alias = $p.InterfaceAlias; category = $p.NetworkCategory.ToString(); name = $p.Name } | ConvertTo-Json -Compress');
      try {
        const n = JSON.parse(r.stdout);
        if (n && n.index && n.category) return { index: Number(n.index), alias: String(n.alias || ''), category: String(n.category), id: netId(n.name, salt) };
      } catch { /* below */ }
      return { error: 'Windows didn\'t say which network reaches the TV' };
    },
    /** The network on the adapter \`alias\` now: { category, id }, or { error } when it isn't connected. */
    async profile(alias, salt) {
      const r = await powershell('$p = Get-NetConnectionProfile -InterfaceAlias ' + psq(alias) + ' -ErrorAction SilentlyContinue | Select-Object -First 1; ' +
        'if ($p) { [pscustomobject]@{ category = $p.NetworkCategory.ToString(); name = $p.Name } | ConvertTo-Json -Compress }');
      try {
        const p = JSON.parse(r.stdout);
        if (p && p.category) return { category: String(p.category), id: netId(p.name, salt) };
      } catch { /* below */ }
      return { error: 'not connected' };
    },
    /** The programs our rule lets in (enabled, inbound, allow, on Private networks). */
    async rulePrograms(rule) {
      const r = await powershell('$r = Get-NetFirewallRule -DisplayName ' + psq(rule) + ' -ErrorAction SilentlyContinue | Where-Object { ' +
        '$_.Enabled -eq \'True\' -and $_.Direction -eq \'Inbound\' -and $_.Action -eq \'Allow\' -and $_.Profile.ToString() -match \'Private\' }; ' +
        'ConvertTo-Json -Compress @(@($r | Get-NetFirewallApplicationFilter | ForEach-Object { $_.Program }))');
      try { return JSON.parse(r.stdout || '[]').map(String); } catch { return []; }
    },
    /** Whether any firewall rule of that name is there at all (enabled or not). */
    async ruleThere(rule) {
      const r = await powershell('if (Get-NetFirewallRule -DisplayName ' + psq(rule) + ' -ErrorAction SilentlyContinue) { \'yes\' }');
      return r.stdout.trim() === 'yes';
    },
    allow: (o, dir) => elevated(ADMIN.allow(o), dir),
    undo: (o, dir) => elevated(ADMIN.undo(o), dir),
    /** A web page or file, opened the usual way. */
    open(target) {
      if (process.platform !== 'win32' || process.env.HOMETV_NO_EXPLORER) return;
      spawn('explorer.exe', [target], { detached: true, stdio: 'ignore' }).unref();
    }
  };
}

// --- The undo list: what prepare changed on this laptop that the call is over with (prepare-undo.json):
// { salt, openssh: { added }, firewall: { rule (null once it's gone), programs, networks: [{ alias, index, id, was }] } }.

const undoFile = (dir) => path.join(dir, 'prepare-undo.json');
export function loadUndo(dir) {
  try { return JSON.parse(fs.readFileSync(undoFile(dir), 'utf8')); } catch { return {}; }
}
function saveUndo(dir, u) {
  if (Object.keys(u).some((k) => k !== 'salt')) fs.writeFileSync(undoFile(dir), JSON.stringify(u, null, 2));
  else fs.rmSync(undoFile(dir), { force: true });
}
/** The undo list with its salt (made once, kept with it). */
function undoWithSalt(dir) {
  const u = loadUndo(dir);
  if (!u.salt) u.salt = crypto.randomBytes(16).toString('hex');
  return u;
}

/**
 * hometv-lg-root prepare --undo: the firewall rule out and each network prepare set to Private back as it was, in one
 * Windows prompt, then read back. A network is put back only while the laptop is on that same network (else another
 * network on the same adapter would change): otherwise it says to connect to it, and keeps it in the undo list.
 * Afterwards the firewall step isn't "done" any more, so prepare checks it again. Returns { done } or { stopped }.
 */
export async function undoPrepare(ctx) {
  const w = ctx.windows || windowsOps();
  const u = loadUndo(ctx.dir);
  const fw = u.firewall;
  if (!fw) {
    ctx.say('  Nothing to undo: prepare changed nothing on this laptop\'s firewall' + (u.openssh ? ' (Windows\' OpenSSH client stays: it\'s Windows\' own)' : '') + '.');
    return { done: true };
  }
  const hadRule = !!fw.rule;
  const nets = (fw.networks || []).filter((n) => n.was !== 'Private');
  const here = [];
  const away = [];
  for (const n of nets) {
    const p = await w.profile(n.alias, u.salt);
    (!p.error && p.id === n.id ? here : away).push(n);
  }
  if (fw.rule || here.length) {
    ctx.say('  This ' + [fw.rule && 'takes out the firewall rule "' + fw.rule + '"', here.length && 'puts the network the call used (' +
      here.map((n) => n.alias).join(', ') + ') back to ' + here.map((n) => n.was).join(', ')].filter(Boolean).join(' and ') + '.\n' +
      '  Windows asks once whether to allow it ("Do you want to allow this app to make changes"): choose Yes.');
    const r = await w.undo({ rule: fw.rule, restore: here.map((n) => ({ alias: n.alias, was: n.was })) }, ctx.dir);
    if (r.error) {
      ctx.say('  STOPPED: Windows didn\'t do it (' + r.error + ').\n  Next: run this again and choose Yes at Windows\' prompt.');
      return { stopped: true };
    }
  }
  const ruleLeft = fw.rule ? await w.ruleThere(fw.rule) : false;
  const notBack = [];
  for (const n of here) {
    const p = await w.profile(n.alias, u.salt);
    if (p.error || p.id !== n.id || p.category !== n.was) notBack.push(n);
  }
  // what's done comes off the list; the firewall step is checked again next time
  fw.rule = ruleLeft ? fw.rule : null;
  fw.networks = [...away, ...notBack];
  if (!fw.rule && !fw.networks.length) delete u.firewall;
  saveUndo(ctx.dir, u);
  if (!ruleLeft) {
    const st = loadState(ctx.dir);
    if (st.steps && st.steps.firewall) { delete st.steps.firewall; saveState(ctx.dir, st); }
  }
  const done = [hadRule && !ruleLeft && 'the rule is gone', here.length > notBack.length && 'the network the call used is ' + here.filter((n) => !notBack.includes(n)).map((n) => n.was).join(', ') + ' again'].filter(Boolean);
  if (done.length) ctx.say('  ✓ ' + done.join('; ') + '.');
  if (ruleLeft || notBack.length || away.length) {
    ctx.say('  STOPPED: ' + [ruleLeft && 'the rule "' + RULE + '" is still there',
      notBack.length && 'the network the call used isn\'t back to ' + notBack.map((n) => n.was).join(', '),
      away.length && 'the laptop isn\'t on the network the call used now (' + away.map((n) => n.alias).join(', ') + '), so it wasn\'t changed back'].filter(Boolean).join('; ') + '.\n' +
      '  Next: ' + (away.length ? 'connect the laptop to the Wi-Fi it used for the call, then ' : '') + 'run this again. Or by hand: ' +
      'Windows Security > Firewall & network protection > Advanced settings > Inbound Rules > "' + RULE + '" > Delete; ' +
      'Settings > Network & internet > Wi-Fi > that network > Network profile type: Public.');
    return { stopped: true };
  }
  return { done: true };
}

// --- What the TV says, read only.

async function softwareVersion(tv) {
  const sw = await tv.request('com.webos.service.update/getCurrentSWInformation');
  // only these two fields are read: never device_id or serial
  return sw.returnValue === false || !sw.major_ver ? '' : String(sw.major_ver) + '.' + String(sw.minor_ver);
}

async function modelName(tv) {
  const r = await tv.request('system/getSystemInfo');
  // only the model name is read: never the serial number
  return r.returnValue === false ? '' : String(r.modelName || '');
}

/** root/compat.json: from the exe's own copy, or the repo. null when it can't be read. */
export function compatList() {
  try {
    if (sea.isSea()) return JSON.parse(sea.getAsset('root/compat.json', 'utf8'));
    return JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'root', 'compat.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** The compat.json entry for this firmware and model (root/decide.js compat: a trailing * matches a prefix), or null. */
export function compatEntry(list, model, firmware) {
  const fw = String(firmware || '');
  const fam = modelFamily(model) || '';
  if (!list || !Array.isArray(list.entries) || !fw) return null;
  for (const e of list.entries) {
    const f = String((e && e.firmware) || '');
    if (!(f.endsWith('*') ? fw.startsWith(f.slice(0, -1)) : f === fw)) continue;
    if (Array.isArray(e.families) && !e.families.includes(fam)) continue;
    return e;
  }
  return null;
}

// LG's own apps and the tools' apps: not on the sign-in list
const SYSTEM_APP = /^(com\.webos\.|com\.palm\.|com\.lge\.|com\.palmdts\.|com\.hometv\.|org\.webosbrew\.|lge\.|com\.lgsvl\.|com\.lgsi\.)/;

/** The sign-in list's text: the apps (names only), the LG account and the Wi-Fi name to write in by hand. */
export function signInList(apps) {
  const names = [...new Set(apps.filter((a) => !SYSTEM_APP.test(a.id)).map((a) => String(a.title || a.id).trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  return [
    'HomeTV: the sign-in list',
    '',
    'After a factory reset (the full way back from root) these ask to be signed in to again. Tick each one you',
    'know how to sign in to. Don\'t write passwords here: just make sure you know them, or where they are.',
    '',
    'The TV\'s apps:',
    ...names.map((n) => '  [ ] ' + n + '   account: ______________________'),
    '',
    '  [ ] LG account (if there is one)   account: ______________________',
    '  [ ] Wi-Fi name: write it here ______________________   (and know its password)',
    ''
  ].join('\r\n');
}

// --- The steps. `run` returns {note}, {note, ready: false} (done, with what isn't ready in the note), {stop, next}, or {pause}.

export const PREPARE_STEPS = [
  {
    id: 'tools',
    title: 'The tools on this laptop',
    what: 'Puts what the call needs on this laptop, each checked against its published SHA-256: hometv-lg.exe (release ' +
      'hometv-lg-v3) beside this program; HomeTV 0.2.0\'s .ipk, Python and SlopBro (the root kit; nothing is run) in the ' +
      'HomeTV folder. Then the call doesn\'t need the internet for them.',
    undo: 'Delete them: hometv-lg.exe beside this program; com.hometv.app_0.2.0_all.ipk and the tools folder in the HomeTV folder.',
    async run(ctx) {
      const pins = { ...PINNED, ...ctx.pins };
      const opts = { fetchImpl: ctx.fetchImpl || fetch, log: (s) => ctx.say('  ' + s) };
      const lg = pins['hometv-lg-v3'];
      const exeDir = ctx.exeDir || (sea.isSea() ? path.dirname(process.execPath) : process.cwd());
      const there = path.join(exeDir, lg.file);
      if (fs.existsSync(there) && (await sha256(there)) !== lg.sha256) {
        if (no(await ctx.ask('  The hometv-lg.exe beside this program isn\'t the one from hometv-lg-v3 (an older one?). Replace it with hometv-lg-v3? [Y/n] '))) {
          return stop('hometv-lg.exe beside this program isn\'t hometv-lg-v3.', 'Move it away (or let this replace it), then run this again.');
        }
      }
      const fetched = async (what, fn) => {
        try { await fn(); return null; } catch (e) {
          return stop(what + ' couldn\'t be downloaded and checked (' + String((e && e.message) || e).replace(/\.$/, '') + ').',
            'Check the laptop is online, then run this again. Nothing was kept that didn\'t match.');
        }
      };
      return (await fetched('hometv-lg.exe (hometv-lg-v3)', () => download(lg, exeDir, opts))) ||
        (await fetched('HomeTV 0.2.0', () => download(pins['hometv-v2'], ctx.dir, opts))) ||
        (await fetched('The root kit', () => (ctx.getRootKit || getRootKit)(path.join(ctx.dir, 'tools'), opts))) ||
        { note: 'hometv-lg.exe (hometv-lg-v3), HomeTV 0.2.0 and the root kit are here and checked' };
    }
  },
  {
    id: 'openssh',
    title: 'Windows\' OpenSSH client',
    what: 'Checks Windows\' own OpenSSH client (ssh.exe) is on this laptop: on the call the laptop logs in to the TV with ' +
      'it. If it isn\'t, it offers to add it (Windows\' optional feature; one Windows prompt).',
    undo: 'Nothing to undo if it was there. If it was added: Settings > Apps > Optional features > OpenSSH Client > Remove (after the call).',
    async run(ctx) {
      const w = ctx.windows || windowsOps();
      if (await w.sshPath()) return { note: 'Windows\' OpenSSH client is on this laptop' };
      ctx.say('  Windows\' OpenSSH client isn\'t on this laptop. Adding it is one of Windows\' own optional features; it\n' +
        '  takes a minute or two, and Windows asks once whether to allow it ("Do you want to allow this app to make\n' +
        '  changes"): choose Yes. Undo after the call: Settings > Apps > Optional features > OpenSSH Client > Remove.');
      const byHand = 'Add it by hand: Settings > Apps > Optional features > View features (Add a feature) > OpenSSH Client > Add. Then run this again.';
      if (!yes(await ctx.ask('  Add it now? [y/N] '))) return stop('Windows\' OpenSSH client isn\'t on this laptop.', byHand);
      const r = await w.addSsh(ctx.dir);
      if (r.error) return stop('Windows\' OpenSSH client couldn\'t be added (' + r.error + ').', byHand);
      if (!(await w.sshPath())) return stop('Windows says it added the OpenSSH client, but ssh.exe isn\'t there yet.', 'Restart the laptop, then run this again.');
      const u = loadUndo(ctx.dir);
      u.openssh = { added: new Date().toISOString() };
      saveUndo(ctx.dir, u);
      return { note: 'Windows\' OpenSSH client added (it can stay; Settings > Apps > Optional features removes it)' };
    }
  },
  {
    id: 'firewall',
    title: 'The firewall: the TV can reach this laptop',
    what: 'On the call the TV fetches files from this laptop (SlopBro and the checks). On the 2026-11-17 call Windows\' ' +
      'firewall stopped it. This shows how Windows sees the Wi-Fi network, and offers to set it to Private and let this ' +
      'program and the root kit\'s Python in, on Private networks only (one Windows prompt). Then the TV\'s browser opens ' +
      'for a moment to prove the TV reaches the laptop.',
    undo: 'After the call: hometv-lg-root.exe prepare --undo (the rule out, the network back as it was).',
    async run(ctx) {
      const w = ctx.windows || windowsOps();
      const u = undoWithSalt(ctx.dir);
      const salt = u.salt;
      let net = await w.network(ctx.host, salt);
      if (net.error) return stop('This laptop can\'t tell which network reaches the TV (' + net.error + ').', 'Check the laptop is on the same Wi-Fi as the TV, then run this again.');
      ctx.say('  The laptop reaches the TV through ' + (net.alias || 'its network') + '; Windows treats that network as ' + net.category + '.');
      if (net.category === 'DomainAuthenticated') {
        return stop('This laptop is on a work network (Windows says "Domain"), whose firewall its owner sets.',
          'Use a home Wi-Fi with the TV on it, or ask whoever runs the laptop to let this program in; then run this again.');
      }
      const kit = rootKit(ctx.dir);
      const programs = [ctx.exePath || process.execPath, ...(fs.existsSync(kit.python) ? [kit.python] : [])];
      const have = (await w.rulePrograms(RULE)).map((p) => p.toLowerCase());
      if (net.category !== 'Private' || programs.some((p) => !have.includes(p.toLowerCase()))) {
        ctx.say('  To let the TV in, this would:\n' +
          (net.category !== 'Private' ? '  - set that network to Private (Windows\' setting for a home network you trust; Public hides the laptop)\n' : '') +
          '  - add a firewall rule "' + RULE + '" letting this program' + (programs.length > 1 ? ' and the root kit\'s Python' : '') + ' in, on Private networks only.\n' +
          '  Windows asks once whether to allow it ("Do you want to allow this app to make changes"): choose Yes.\n' +
          '  After the call, hometv-lg-root.exe prepare --undo takes the rule out and puts the network back.');
        if (!yes(await ctx.ask('  Do it now? [y/N] '))) {
          return stop('Windows\' firewall isn\'t set for the call.',
            'By hand: Settings > Network & internet > Wi-Fi > your network > Network profile type: Private; and when Windows asks about this program on private networks, choose Allow. Then run this again.');
        }
        // kept before the change, so an undo can follow even a change cut short; each network keeps its first state
        const fw = u.firewall || { networks: [] };
        fw.rule = RULE;
        fw.programs = programs;
        if (!fw.networks.some((n) => n.id === net.id)) fw.networks.push({ alias: net.alias, index: net.index, id: net.id, was: net.category });
        u.firewall = fw;
        saveUndo(ctx.dir, u);
        const r = await w.allow({ index: net.index, programs, rule: RULE, setPrivate: net.category !== 'Private' }, ctx.dir);
        if (r.error) return stop('Windows didn\'t change the firewall (' + r.error + ').', 'Run this again and choose Yes at Windows\' prompt, or set it by hand (Settings > Network & internet > Wi-Fi > your network > Private).');
        net = await w.network(ctx.host, salt);
        const now = (await w.rulePrograms(RULE)).map((p) => p.toLowerCase());
        if (net.error || net.category !== 'Private' || programs.some((p) => !now.includes(p.toLowerCase()))) {
          return stop('Windows said yes, but the network or the rule isn\'t as set when read back.', 'Run this again; if it stops here again, tell the person helping you.');
        }
        ctx.say('  ✓ the network is Private and the rule is in');
      } else {
        ctx.say('  ✓ the network is Private and the rule is in already');
      }
      const r = await withTv(ctx, (tv) => reach(tv, ctx.host, { address: ctx.reachAddress, waitMs: ctx.reachWaitMs }));
      if (!r.ok) {
        return stop('The TV can\'t reach this laptop (' + r.error + ').',
          'Check the laptop and the TV are on the same Wi-Fi (not a guest network), choose Allow if Windows asks about this program, then run this again. If it stops here again, tell the person helping you.');
      }
      ctx.say('  ✓ the TV reaches this laptop (the TV\'s browser showed "HomeTV: the TV reached the laptop"; press Back on the remote)');
      return { note: 'the network is Private, the rule "' + RULE + '" is in, and the TV reaches this laptop' };
    }
  },
  {
    id: 'tv',
    title: 'The TV: Developer Mode, Key Server, automatic updates',
    what: 'Checks the TV answers this laptop, that Developer Mode and its Key Server are on (on the call they let the laptop ' +
      'keep HomeTV\'s saved TMDB token through root), and that Allow Automatic Updates is off. It reads; it changes nothing on the TV.',
    undo: 'Nothing to undo.',
    async run(ctx) {
      ctx.say('  If the TV asks to "Allow" this laptop, press OK on the remote.');
      const tv = await withTv(ctx, async (t) => ({ apps: await appIds(t), updates: await readAutoUpdate(t) }));
      ctx.say('  ✓ the TV answers and knows this laptop');
      const notes = [];
      if (tv.apps.has(HBC)) {
        notes.push('the TV is rooted already (Homebrew Channel is on it)');
      } else if (!tv.apps.has(DEVMODE)) {
        ctx.say('  The Developer Mode app isn\'t on the TV, so HomeTV\'s saved TMDB token can\'t be kept through root: it\'s typed again from the phone after root.');
        notes.push('no Developer Mode app (the TMDB token is typed again after root)');
      } else {
        if (!(await portOpen(ctx.host, ctx.devSshPort || 9922, 4000))) {
          return stop('The Developer Mode app is on the TV, but Developer Mode isn\'t on (or its time ran out).',
            'On the TV, open the Developer Mode app: Dev Mode Status ON, and if it shows Remaining time, press Extend. Then run this again.');
        }
        ctx.say('  ✓ Developer Mode is on');
        if (fs.existsSync(devmodeKeyFile(ctx.dir))) {
          ctx.say('  ✓ this laptop has Developer Mode\'s key already (Key Server isn\'t needed on the call)');
          notes.push('Developer Mode on; its key is on this laptop');
        } else {
          const got = await (ctx.fetchKey || fetchKeyPatiently)(ctx.host, { port: ctx.keyServerPort });
          if (got.error) {
            return stop('Developer Mode\'s Key Server isn\'t answering.',
              'On the TV, in the Developer Mode app, switch Key Server on (if it says On already, switch it off and on again), then run this again.');
          }
          ctx.say('  ✓ Key Server is on');
          if (!no(await ctx.ask('  Save Developer Mode\'s key on this laptop now, so the call doesn\'t need Key Server? It asks for the passphrase the\n' +
            '  Developer Mode app shows. Nothing changes on the TV. [Y/n] '))) {
            const k = await (ctx.getDevmodeKey || getKey)(ctx.host, ctx.dir, ctx.ask, ctx.say, { port: ctx.keyServerPort });
            if (k.error) return stop('Developer Mode\'s key wasn\'t saved: ' + k.error.replace(/\.$/, '') + '.', 'Run this again (it carries on here).');
            ctx.say('  ✓ Developer Mode\'s key is on this laptop');
            notes.push('Developer Mode and Key Server on; its key saved on this laptop');
          } else {
            notes.push('Developer Mode and Key Server on (leave Key Server on for the call)');
          }
        }
        if (!tv.apps.has(APP)) notes.push('HomeTV isn\'t on the TV (no saved token to keep)');
      }
      if (tv.updates === 'on') return stop('The TV says Allow Automatic Updates is on.', 'Switch it off (' + UPDATES_WHERE + '), then run this again. An LG update can end root before the call.');
      if (tv.updates === 'off') {
        ctx.say('  ✓ Allow Automatic Updates is off (the TV says)');
      } else if (!yes(await ctx.ask('  The TV doesn\'t say whether its automatic updates are on. Look: ' + UPDATES_WHERE + ', Allow Automatic Updates.\n  Is it off? [y/N] '))) {
        return stop('Allow Automatic Updates may still be on.', 'Switch it off (' + UPDATES_WHERE + '), then run this again.');
      }
      notes.push('automatic updates off');
      return { note: notes.join('; ') };
    }
  },
  {
    id: 'software',
    title: 'The TV\'s software version',
    what: 'Reads the TV\'s software version and model (or asks you to read them off the TV when it won\'t say), and ' +
      'checks root is known to work on it (root/compat.json). If it isn\'t, root is off for this call.',
    undo: 'Nothing to undo.',
    async run(ctx) {
      let { sw, model } = await withTv(ctx, async (t) => ({ sw: await softwareVersion(t), model: await modelName(t) }));
      let by = 'the TV says';
      if (!sw) {
        ctx.say('  The TV didn\'t say its software version (webOS 10.3.2 refuses that read). Read it on the TV: ' + SW_WHERE + '.');
        sw = (await ctx.ask('  Type the Software Version exactly as the TV shows it (for example 33.31.75), or just Enter to stop here: ')).trim();
        if (!/^\d+\.\d+\.\d+$/.test(sw)) return stop('The TV\'s software version is unknown.', 'Read it on the TV (' + SW_WHERE + '), then run this again.');
        by = 'read off the TV by you';
      }
      if (!model) {
        ctx.say('  The TV didn\'t say its model. Read it on the TV: ' + MODEL_WHERE + '.');
        model = (await ctx.ask('  Type the Model exactly as the TV shows it (for example 43UT8000AUA), or just Enter to stop here: ')).trim().toUpperCase();
        if (!/^[0-9A-Z][0-9A-Z.\-]{4,}$/.test(model)) return stop('The TV\'s model is unknown.', 'Read it on the TV (' + MODEL_WHERE + '), then run this again.');
      }
      ctx.state.software = sw;
      ctx.state.model = model;
      const listed = ROOTABLE[sw] && compatEntry(ctx.compat === undefined ? compatList() : ctx.compat, model, sw);
      // the stick is needed only with root: decided again when root's on/off changes
      if (ctx.state.rootOff !== undefined && ctx.state.rootOff !== !listed) delete ctx.state.steps['usb-stick'];
      ctx.state.rootOff = !listed;
      ctx.say('  ✓ software ' + sw + ' (' + by + '), model ' + model);
      if (!listed) {
        ctx.say('  Root is OFF for this call: software ' + sw + ' on a ' + model + ' isn\'t in the list root is known to work on\n' +
          '  (LG closed the hole root uses in software newer than 33.31.75). The call does stage 2 only: setting HomeTV up\n' +
          '  without root. Nothing is lost: HomeTV works as an app.');
        return { note: 'software ' + sw + ' (' + by + ') on ' + model + ': not in the list root is known for, so root is OFF for this call (stage 2 only)', ready: false };
      }
      return { note: 'software ' + sw + ' (' + by + ') on ' + model + ': root is known to work on it' };
    }
  },
  {
    id: 'backup',
    title: 'The backup',
    what: 'Uses this TV\'s backup on this laptop if one is less than ' + FRESH_DAYS + ' days old, else takes one now (the TV\'s ' +
      'model, software, apps, inputs and the settings it lets the laptop read), in the HomeTV folder. Nothing on the TV changes.',
    undo: 'Nothing to undo (the backup file can be deleted from the HomeTV folder).',
    async run(ctx) {
      const model = ctx.state.model || (await withTv(ctx, modelName));
      const b = latestBackup(ctx.dir);
      const age = b ? Date.now() - Date.parse(b.data.at || 0) : Infinity;
      if (b && age < FRESH_DAYS * 86400000 && (!model || !b.data.tv || b.data.tv.model === model)) {
        ctx.say('  ✓ this TV\'s backup from ' + String(b.data.at).slice(0, 10) + ' is on this laptop: ' + b.file);
        return { note: 'backup ' + b.file + ' (from ' + String(b.data.at).slice(0, 10) + ')' };
      }
      const made = await withTv(ctx, (tv) => backup(tv, ctx.dir));
      for (const line of describe(made.summary)) ctx.say('  ' + line);
      ctx.say('  ' + WARNING);
      return { note: 'backup ' + path.basename(made.file) + ' taken now' };
    }
  },
  {
    id: 'sign-in-list',
    title: 'The sign-in list',
    what: 'Writes sign-in-list.txt in the HomeTV folder: the TV\'s apps (names only), the LG account and a line for the ' +
      'Wi-Fi name, to tick and fill in by hand. Print it, or keep it open. No passwords on it.',
    undo: 'Delete sign-in-list.txt.',
    async run(ctx) {
      const apps = await withTv(ctx, async (tv) => {
        const r = await tv.request('com.webos.applicationManager/listLaunchPoints');
        if (r.returnValue === false || !Array.isArray(r.launchPoints)) throw new Error('the TV didn\'t list its apps');
        return r.launchPoints.map((a) => ({ id: String(a.id), title: String(a.title || '') }));
      });
      const file = path.join(ctx.dir, 'sign-in-list.txt');
      const text = signInList(apps);
      fs.writeFileSync(file, text);
      ctx.say('  ✓ written: sign-in-list.txt in the HomeTV folder (it opens now). Print it or keep it; fill it in by hand.');
      (ctx.windows || windowsOps()).open(file);
      const n = text.split('\r\n').filter((l) => /^ {2}\[ \] /.test(l)).length - 2;
      return { note: 'sign-in-list.txt written (' + n + ' apps, the LG account, the Wi-Fi name)' };
    }
  },
  {
    id: 'photos',
    title: 'Photos of the TV\'s settings',
    what: 'A list of the settings screens to photograph with your phone. After a factory reset, they\'re how the settings go ' +
      'back by hand.',
    undo: 'Nothing to undo.',
    async run(ctx) {
      ctx.say('  With your phone, photograph each of these screens on the TV (all the lines on a page):');
      for (const [i, p] of PHOTOS.entries()) ctx.say('   ' + (i + 1) + '. ' + p);
      ctx.say('  (Settings is the remote\'s gear button. If a path differs on the TV, All Settings\' search, the magnifier, finds the name.)');
      const a = (await ctx.ask('  Type  done  when you have them (or press Enter to stop here and do them later): ')).trim().toLowerCase();
      if (a !== 'done') return { pause: 'The photos aren\'t done yet. Run this again when they are: it carries on here.' };
      return { note: 'photos taken (' + PHOTOS.length + ' screens)' };
    }
  },
  {
    id: 'usb-stick',
    title: 'The USB stick with LG\'s software',
    what: 'The very last way back if the TV ever won\'t start (LG\'s USB recovery): a FAT32 stick, 32 GB or smaller, with ' +
      'LG\'s software for this TV in a folder LG_DTV. LG publishes no checksum for its files, so this doesn\'t download it: ' +
      'it opens LG\'s page and walks you through, then reads the stick to check it. It never formats or writes to the stick.',
    undo: 'Nothing to undo (the stick can be used for other things after the call; format it then).',
    async run(ctx) {
      if (ctx.state.rootOff) return { note: 'not needed: root is off for this call' };
      const model = ctx.state.model || '';
      const software = ctx.state.software || '';
      let drive = (await ctx.ask('  Is the stick ready already? Type its drive letter (for example E), or press Enter for the steps to make it: ')).trim();
      if (!drive) {
        const page = LG_PAGES[model] || LG_FIRMWARE_PAGE;
        ctx.say([
          '  1. On LG\'s page (it opens now' + (LG_PAGES[model] ? '' : ': search for ' + (model || 'the TV\'s model')) + '), under Download Software, download',
          '     "Software_File(Version_' + (software || '<the TV\'s version>') + ').zip", the same as the TV\'s software or newer (about 1.6 GB).',
          '  2. Unzip it (right-click > Extract All). Inside is one file ending in .epk.',
          '  3. A USB stick of 32 GB or smaller, in the laptop. In File Explorer, right-click it > Properties: File system',
          '     should say FAT32. If it doesn\'t: right-click > Format > FAT32 > Start. Formatting erases everything on it.',
          '  4. On the stick, make a folder named LG_DTV (capitals). Copy the .epk file into it. Nothing else in LG_DTV.'
        ].join('\n'));
        (ctx.windows || windowsOps()).open(page);
        drive = (await ctx.ask('  When it\'s done, type the stick\'s drive letter (or press Enter to stop here and do it later): ')).trim();
        if (!drive) return { pause: 'The USB stick isn\'t ready yet. Run this again when it is: it carries on here.' };
      }
      // the same check as hometv-lg get recovery <drive> (tools/lib/recovery.mjs): reads the stick only
      const r = (ctx.checkStick || checkStick)(drive, { model, software });
      for (const l of describeStick(r)) ctx.say('  ' + l);
      if (r.problems.length) return stop('The USB stick isn\'t ready: ' + r.problems.join('; ') + '.', 'Fix that (the steps: run this again and press Enter at the first question), then run this again.');
      for (const u of r.unsure) {
        if (!yes(await ctx.ask('  Check by hand: ' + u + '. Is it so? [y/N] '))) return stop('The USB stick isn\'t confirmed: ' + u + '.', 'Check it, then run this again.');
      }
      return { note: 'USB stick checked: ' + (r.file || 'LG_DTV') };
    }
  }
];

// --- The runner

const stateFile = (dir) => path.join(dir, 'prepare-state.json');
export function loadState(dir) {
  try { return JSON.parse(fs.readFileSync(stateFile(dir), 'utf8')); } catch { return { steps: {} }; }
}
function saveState(dir, state) {
  fs.writeFileSync(stateFile(dir), JSON.stringify(state, null, 2));
}

/** The report: ready or not per item, and on its last line "Ready for the call" or what's missing. */
export function reportText(state, undo) {
  const word = (rec) => (!rec ? 'not checked' : rec.status === 'done' && rec.ready !== false ? 'ready' : 'not ready');
  const lines = [
    'HomeTV for LG: getting ready for the call (hometv-lg-root prepare)',
    'Written ' + new Date().toISOString().slice(0, 19).replace('T', ' ') + ' (UTC).',
    'No TV address, serial number, device id or Wi-Fi name is in this report.',
    ''
  ];
  for (const [i, s] of PREPARE_STEPS.entries()) {
    const rec = state.steps[s.id];
    lines.push((i + 1) + '. [' + word(rec) + '] ' + s.title + (rec && rec.at ? ' (' + rec.at.slice(0, 16).replace('T', ' ') + ')' : ''));
    if (rec && (rec.why || rec.note)) lines.push('   ' + (rec.why || rec.note));
    if (rec && rec.next) lines.push('   Next: ' + rec.next);
  }
  if (undo.firewall) lines.push('', 'After the call: hometv-lg-root.exe prepare --undo (takes the firewall rule out and puts the network back).');
  const missing = PREPARE_STEPS.filter((s) => { const r = state.steps[s.id]; return !r || r.status !== 'done'; }).map((s) => s.title);
  lines.push('');
  if (missing.length) lines.push('Not ready yet. Missing: ' + missing.join('; ') + '.');
  else if (state.rootOff) lines.push('Ready for the call: stage 2 only. Root is OFF for this call (software ' + state.software + ' isn\'t in the list root is known to work on).');
  else lines.push('Ready for the call.');
  return lines.join('\r\n') + '\r\n';
}

/**
 * Runs the steps not done yet (or from `from` on); writes prepare-report-<date>.txt in the HomeTV folder at the end,
 * whatever happened. Returns { done }, { paused: id } or { stopped: id }, and the report's file.
 */
export async function runPrepare(ctx, { from } = {}) {
  fs.mkdirSync(ctx.dir, { recursive: true });
  const logFile = path.join(ctx.dir, 'prepare-log.txt');
  const say = (s) => {
    const clean = scrub(s, ctx.host);
    ctx.say(clean);
    fs.appendFileSync(logFile, clean + '\n');
  };
  const state = loadState(ctx.dir);
  if (from) {
    const i = PREPARE_STEPS.findIndex((s) => s.id === from);
    if (i < 0) throw new Error('no step named ' + from + ' (steps: ' + PREPARE_STEPS.map((s) => s.id).join(', ') + ')');
    for (const s of PREPARE_STEPS.slice(i)) delete state.steps[s.id];
  }
  const c = { ...ctx, say, state };
  say('\n[' + new Date().toISOString().slice(0, 19) + '] hometv-lg-root prepare: getting ready for the call. Nothing here changes the TV.');
  const result = await (async () => {
    for (const [i, step] of PREPARE_STEPS.entries()) {
      const head = '\nStep ' + (i + 1) + ' of ' + PREPARE_STEPS.length + ': ' + step.title;
      const prev = state.steps[step.id];
      if (prev && prev.status === 'done') { say(head + ' (done ' + prev.at.slice(0, 10) + ')'); continue; }
      say(head + '\n  ' + step.what + '\n  Undo: ' + step.undo);
      let r;
      try {
        r = await step.run(c);
      } catch (e) {
        r = stop('Something went wrong: ' + (e && e.message ? e.message : e) + '.', 'Run this again: finished steps are skipped.');
      }
      const at = new Date().toISOString();
      if (r.pause) {
        state.steps[step.id] = { status: 'paused', at, why: scrub(r.pause, ctx.host) };
        saveState(ctx.dir, state);
        say('  ' + r.pause);
        return { paused: step.id };
      }
      if (r.stop) {
        state.steps[step.id] = { status: 'stopped', at, why: scrub(r.stop, ctx.host), next: scrub(r.next, ctx.host) };
        saveState(ctx.dir, state);
        say('  STOPPED: ' + r.stop + '\n  Next: ' + r.next);
        return { stopped: step.id };
      }
      state.steps[step.id] = { status: 'done', at, note: scrub(r.note || '', ctx.host), ...(r.ready === false ? { ready: false } : {}) };
      saveState(ctx.dir, state);
      say('  ' + (r.ready === false ? '! ' : '✓ ') + (r.note || 'done'));
    }
    return { done: true };
  })();
  const file = path.join(ctx.dir, 'prepare-report-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.txt');
  const text = scrub(reportText(state, loadUndo(ctx.dir)), ctx.host);
  fs.writeFileSync(file, text);
  say('\n' + text.replace(/\r\n/g, '\n') + '\nThis report is saved as ' + path.basename(file) + ' in the HomeTV folder: send it to the person helping you.');
  return { ...result, report: file };
}

export function listSteps(dir) {
  const state = loadState(dir);
  return PREPARE_STEPS.map((s, i) => {
    const rec = state.steps[s.id];
    const w = !rec ? 'not run' : rec.status === 'done' && rec.ready === false ? 'not ready' : rec.status;
    return (i + 1) + '. ' + s.id.padEnd(13) + w.padEnd(10) + s.title;
  });
}
