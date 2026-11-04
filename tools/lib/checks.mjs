// The laptop check (install step 1) and the settings backup (step 3), over LG's remote-control connection. Read-only
// except launching apps the person agrees to, and one message on the screen. Every value kept is on an allowlist: no
// serial number, device id, MAC or IP address ever goes into the report.

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

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
}

export async function readOnlyChecks(tv) {
  const report = { at: new Date().toISOString(), checks: {} };
  const c = report.checks;

  const sw = await tv.request('com.webos.service.update/getCurrentSWInformation');
  c.software = sw.returnValue === false ? { ok: false, error: sw.errorText } : { ok: true, ...pick(sw, SW_KEYS) };

  const sys = await tv.request('system/getSystemInfo');
  c.system = sys.returnValue === false ? { ok: false, error: sys.errorText } : { ok: true, ...pick(sys, ['modelName', 'receiverType']) };

  const lp = await tv.request('com.webos.applicationManager/listLaunchPoints');
  if (lp.returnValue === false || !Array.isArray(lp.launchPoints)) c.apps = { ok: false, error: lp.errorText || 'no list' };
  else {
    const apps = lp.launchPoints.map((a) => ({ id: String(a.id), title: String(a.title || '') }));
    c.apps = {
      ok: true, count: apps.length,
      streaming: apps.filter((a) => STREAMING[a.id]).map((a) => ({ id: a.id, name: STREAMING[a.id] })),
      all: apps
    };
  }

  const fg = await tv.request('com.webos.applicationManager/getForegroundAppInfo');
  c.foreground = fg.returnValue === false ? { ok: false, error: fg.errorText } : { ok: true, appId: fg.appId || '' };

  const inputs = await tv.request('tv/getExternalInputList');
  c.inputs = inputs.returnValue === false || !Array.isArray(inputs.devices)
    ? { ok: false, error: inputs.errorText || 'no list' }
    : { ok: true, devices: inputs.devices.map((d) => pick(d, ['id', 'label', 'connected', 'appId'])) };

  const sound = await tv.request('com.webos.service.apiadapter/audio/getSoundOutput');
  c.soundOutput = sound.returnValue === false ? { ok: false, error: sound.errorText } : { ok: true, soundOutput: sound.soundOutput };

  return report;
}

// Settings the TV lets a paired app read, for the backup. Each key is asked for alone, so one the TV doesn't know
// doesn't hide the others; what fails is recorded as such. The list is a start, to be confirmed on his TV.
export const BACKUP_SETTINGS = [
  { category: 'picture', keys: ['pictureMode', 'backlight', 'brightness', 'contrast', 'color', 'sharpness', 'colorTemperature', 'energySaving'] },
  { category: 'sound', keys: ['soundMode', 'soundOutput'] },
  { category: 'option', keys: ['country', 'localeInfo', 'audioGuidance', 'quickStartMode'] },
  { category: 'general', keys: ['homeAutoLaunch', 'powerOnScreen', 'alwaysReady'] },
  { category: 'aiPicture', keys: ['ai_Picture'] }
];

export async function readSettings(tv, list = BACKUP_SETTINGS) {
  const out = {};
  for (const { category, keys } of list) {
    out[category] = {};
    for (const key of keys) {
      const r = await tv.request('settings/getSystemSettings', { category, keys: [key] });
      out[category][key] = r.returnValue === false || !r.settings || !(key in r.settings)
        ? { ok: false, error: r.errorText || 'not returned' }
        : { ok: true, value: r.settings[key] };
    }
  }
  return out;
}

export async function launch(tv, l) {
  const r = await tv.request('com.webos.applicationManager/launch', { id: l.app, ...(l.params ? { params: l.params } : {}) });
  return r.returnValue === false ? { ok: false, error: r.errorText } : { ok: true };
}

export async function toast(tv, message) {
  return tv.request('system.notifications/createToast', { message });
}
