// The laptop check (install step 1), over LG's remote-control connection; the settings backup (step 3) is in
// backup.mjs. Read-only except launching apps the person agrees to, and one message on the screen. Every value kept
// is on an allowlist: no serial number, device id, MAC or IP address ever goes into the report.

export const STREAMING = {
  netflix: 'Netflix', 'youtube.leanback.v4': 'YouTube', amazon: 'Prime Video',
  'com.disney.disneyplus-prod': 'Disney+', 'com.wbd.stream': 'HBO Max', 'com.hbo.hbomax': 'HBO Max (old id)',
  hulu: 'Hulu', 'com.apple.appletv': 'Apple TV', 'com.cbs-all-access.webapp.prod': 'Paramount+', 'cdp-30': 'Plex',
  'com.peacocktv.peacock': 'Peacock', 'com.tubitv.tubitv': 'Tubi', 'com.pluto.plutotv': 'Pluto TV', spotify: 'Spotify'
};

const SW_KEYS = ['product_name', 'model_name', 'major_ver', 'minor_ver', 'country', 'country_group', 'language_code'];
const YT_VIDEO = 'jNQXAC9IVRw';

export const LAUNCHES = [
  { id: 'open-netflix', label: 'Open Netflix', app: 'netflix' },
  { id: 'open-youtube', label: 'Open YouTube', app: 'youtube.leanback.v4' },
  { id: 'youtube-title', label: 'Open a YouTube video ("Me at the zoo")', app: 'youtube.leanback.v4', params: { contentId: 'v=' + YT_VIDEO } }
];

// webOS 10.3.2 (seen 2026-11-17) answers some reads with "401 insufficient permissions" or "500 Application error": the
// TV doesn't let a paired app read them. That's unknown, not a failed check.
const UNREADABLE = /^\s*(401|403|500)\b|insufficient permissions|application error/i;
export const UNKNOWN_NOTE = 'unknown: this TV doesn\'t let the laptop read it';

/** A read that didn't work: { ok: false, error }, plus unknown and a plain note when the TV just won't tell. */
export function notRead(errorText) {
  const error = String(errorText || 'no answer');
  return UNREADABLE.test(error) ? { ok: false, unknown: true, error, note: UNKNOWN_NOTE } : { ok: false, error };
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
}

export async function readOnlyChecks(tv) {
  const report = { at: new Date().toISOString(), checks: {} };
  const c = report.checks;

  const sw = await tv.request('com.webos.service.update/getCurrentSWInformation');
  c.software = sw.returnValue === false ? notRead(sw.errorText) : { ok: true, ...pick(sw, SW_KEYS) };

  const sys = await tv.request('system/getSystemInfo');
  c.system = sys.returnValue === false ? notRead(sys.errorText) : { ok: true, ...pick(sys, ['modelName', 'receiverType']) };

  const lp = await tv.request('com.webos.applicationManager/listLaunchPoints');
  if (lp.returnValue === false || !Array.isArray(lp.launchPoints)) c.apps = notRead(lp.errorText || 'no list');
  else {
    const apps = lp.launchPoints.map((a) => ({ id: String(a.id), title: String(a.title || '') }));
    c.apps = {
      ok: true, count: apps.length,
      streaming: apps.filter((a) => STREAMING[a.id]).map((a) => ({ id: a.id, name: STREAMING[a.id] })),
      all: apps
    };
  }

  const fg = await tv.request('com.webos.applicationManager/getForegroundAppInfo');
  c.foreground = fg.returnValue === false ? notRead(fg.errorText) : { ok: true, appId: fg.appId || '' };

  const inputs = await tv.request('tv/getExternalInputList');
  c.inputs = inputs.returnValue === false || !Array.isArray(inputs.devices)
    ? notRead(inputs.errorText || 'no list')
    : { ok: true, devices: inputs.devices.map((d) => pick(d, ['id', 'label', 'connected', 'appId'])) };

  const sound = await tv.request('com.webos.service.apiadapter/audio/getSoundOutput');
  c.soundOutput = sound.returnValue === false ? notRead(sound.errorText) : { ok: true, soundOutput: sound.soundOutput };

  return report;
}

export async function launch(tv, l) {
  const r = await tv.request('com.webos.applicationManager/launch', { id: l.app, ...(l.params ? { params: l.params } : {}) });
  return r.returnValue === false ? { ok: false, error: r.errorText } : { ok: true };
}

export async function toast(tv, message) {
  return tv.request('system.notifications/createToast', { message });
}

// What v0 will need, from what the laptop check read (v-1). Root status is dated: re-check
// CanI.RootMy.TV before root (docs/jailbreak.md). `slopbro` is the options the root step gives SlopBro (pinned v0.1.0)
// for that version: on 33.31.75 only com.webos.app.voiceweb worked, which SlopBro tries alone with --webos-version 11
// (its TARGET_APPS lists voiceweb for 11 only; the option only picks the app). docs/root-plan.md, "33.31.75".
export const ROOTABLE = {
  '33.31.61': { note: 'SlopBro: the newest version known to work (CanI.RootMy.TV, read 2026-11-04)', slopbro: [] },
  '33.31.75': {
    note: 'SlopBro through com.webos.app.voiceweb (--webos-version 11): reported working in Oct 2026 on 55UT80006LA, ' +
      '55QNED80SRA and others, where the default app failed (github.com/throwaway96/slopbro issues 28 and 29, read ' +
      '2026-11-17). LG fixed the bug in firmware released after about 10 Oct 2026: keep updates off',
    slopbro: ['--webos-version', '11']
  }
};

// webOS 10.3.2 answers the software read with "401 insufficient permissions" (seen on the 2026-11-17 call)
export const SW_UNREAD = 'unknown: the TV didn\'t say its software version; read it on the TV (Settings > All Settings > ' +
  'Support > TV Information, Software Version) and compare it with the known list before any root';

export function readiness(report) {
  const c = report.checks;
  const sw = c.software && c.software.ok && c.software.major_ver ? c.software.major_ver + '.' + c.software.minor_ver : '';
  const ids = c.apps && c.apps.ok ? c.apps.all.map((a) => a.id) : [];
  return {
    software: sw || 'unknown',
    root: ROOTABLE[sw] ? ROOTABLE[sw].note : (sw ? 'not in the known list: check CanI.RootMy.TV before any root' : SW_UNREAD),
    developerModeApp: ids.includes('com.palmdts.devmode'),
    homebrewChannel: ids.includes('org.webosbrew.hbchannel'),
    appList: !!(c.apps && c.apps.ok),
    launchesWork: report.launches ? Object.values(report.launches).some((l) => l.ok) : null
  };
}
