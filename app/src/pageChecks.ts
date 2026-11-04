// The TV-call checks HomeTV's page runs itself on LG (bridge mode 'app'). Same checks and names as hometv-tizen's
// pageChecks.ts, done LG's way: "app control" is the app manager's launch with the title's params (webos/apps.ts),
// "remote socket" is LG's own remote socket (SSAP, which phones and our laptop tool use), DIAL is LG's DIAL server.
// Results are kept in this app's own storage so the Checks screen lists them after an app opened and HomeTV came back.

import type { Result } from './bridge';
import { luna, lunaError } from './webos/luna';
import { titleParams } from './webos/apps';

/** One well-known title per service, the Android launcher's link shapes (as hometv-tizen's SAMPLE_TITLES). */
export const SAMPLE_TITLES: Record<string, { label: string; url: string; meta: string }> = {
  netflix: { label: 'Stranger Things', url: 'https://www.netflix.com/title/80057281', meta: 'm=80057281' },
  youtube: { label: 'a YouTube video', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', meta: 'v=aqz-KE-bpKQ' },
  prime: {
    label: 'The Boys',
    url: 'https://app.primevideo.com/detail?gti=amzn1.dv.gti.0eb1d3b1-28b0-ebdb-6c2d-2a1e3e9e1e1c',
    meta: 'gti=amzn1.dv.gti.0eb1d3b1-28b0-ebdb-6c2d-2a1e3e9e1e1c',
  },
};

const STORE = 'hometv-checks-v1';
/** The remote socket's key once the TV allowed HomeTV, so it asks only once. */
const SSAP_KEY = 'hometv-ssap-key';
/** LG's DIAL server (where a phone casting YouTube goes). */
const DIAL = 'http://127.0.0.1:36866/apps/YouTube';

function load(): Result[] {
  try {
    return JSON.parse(localStorage.getItem(STORE) || '[]') as Result[];
  } catch (e) {
    return [];
  }
}

function record(check: string, ok: boolean, detail: Record<string, unknown>): Result {
  const r = { at: new Date().toISOString(), check, ok, detail };
  const all = load();
  all.push(r);
  try {
    localStorage.setItem(STORE, JSON.stringify(all.slice(-100)));
  } catch (e) {
    // The screen still shows this one.
  }
  return r;
}

/** LG's remote socket on the TV: asks the TV to allow HomeTV once, then launches the app with the title. */
function remoteLaunch(appId: string, params: Record<string, string>): Promise<{ ok: boolean; events: string[]; error?: string }> {
  return new Promise((resolve) => {
    const events: string[] = [];
    let ws: WebSocket;
    let finished = false;
    const done = (ok: boolean, error?: string) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      try {
        ws.close();
      } catch (e) {
        // Already closed.
      }
      resolve({ ok, events, error });
    };
    // Long enough for a person to press Allow on the TV's prompt.
    const timer = window.setTimeout(() => done(false, 'no answer after 40 s (was Allow pressed?)'), 40000);
    try {
      ws = new WebSocket('ws://127.0.0.1:3000');
    } catch (e) {
      done(false, (e as Error).message);
      return;
    }
    let key = '';
    try {
      key = localStorage.getItem(SSAP_KEY) || '';
    } catch (e) {
      // Asks again.
    }
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          id: 'reg',
          type: 'register',
          payload: {
            pairingType: 'PROMPT',
            'client-key': key || undefined,
            manifest: { manifestVersion: 1, appVersion: '1.0', permissions: ['LAUNCH'], signed: { appId: 'com.hometv.app', vendorId: 'com.hometv' } },
          },
        }),
      );
    };
    ws.onmessage = (m) => {
      let msg: { id?: string; type?: string; payload?: Record<string, unknown>; error?: string } = {};
      try {
        msg = JSON.parse(String(m.data));
      } catch (e) {
        return;
      }
      events.push(msg.type || '?');
      if (msg.id === 'reg' && msg.type === 'registered') {
        const k = msg.payload && msg.payload['client-key'];
        if (typeof k === 'string') {
          try {
            localStorage.setItem(SSAP_KEY, k);
          } catch (e) {
            // Asks again next time.
          }
        }
        const payload: Record<string, unknown> = { id: appId, params };
        if (params.contentId) payload.contentId = params.contentId;
        ws.send(JSON.stringify({ id: 'launch', type: 'request', uri: 'ssap://system.launcher/launch', payload }));
      } else if (msg.id === 'reg' && msg.type === 'error') {
        done(false, msg.error || 'the TV refused HomeTV');
      } else if (msg.id === 'launch') {
        done(msg.type === 'response', msg.type === 'response' ? undefined : msg.error || 'the TV refused the launch');
      }
    };
    ws.onerror = () => done(false, 'the TV refused the socket');
  });
}

/** DIAL, as a phone casting YouTube does. */
function dialYouTube(meta: string): Promise<{ status: number; error?: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', DIAL);
    xhr.timeout = 8000;
    xhr.setRequestHeader('Content-Type', 'text/plain; charset=utf-8');
    xhr.onload = () => resolve({ status: xhr.status });
    // A refused cross-origin answer still means the request went out.
    xhr.onerror = () => resolve({ status: 0, error: 'no readable answer (it may still have been sent)' });
    xhr.ontimeout = () => resolve({ status: 0, error: 'timed out' });
    xhr.send(meta);
  });
}

/** The TV's model and software: LG's system properties, else the page's own device info. */
async function about(): Promise<Record<string, unknown>> {
  const r = await luna('luna://com.webos.service.tv.systemproperty/getSystemInfo', { keys: ['modelName', 'firmwareVersion', 'sdkVersion'] }, 5000);
  let device: { modelName?: string; platformVersion?: string } = {};
  try {
    const ps = (window as unknown as { PalmSystem?: { deviceInfo?: string } }).PalmSystem;
    device = ps && ps.deviceInfo ? JSON.parse(ps.deviceInfo) : {};
  } catch (e) {
    // Only the system properties then.
  }
  const chrome = /Chrome\/(\d+)/.exec(navigator.userAgent);
  return {
    model: (r.modelName as string) || device.modelName || null,
    osVersion: (r.sdkVersion as string) || device.platformVersion || null,
    firmware: (r.firmwareVersion as string) || null,
    chromium: chrome ? Number(chrome[1]) : null,
    mode: 'own app',
    error: r.returnValue ? undefined : lunaError(r),
  };
}

export const pageChecks = {
  results: load,

  /** `appIdFor` gives the installed app's id for a Home key, or null. */
  async run(name: string, params: Record<string, unknown>, appIdFor: (key: string) => string | null): Promise<Result> {
    const key = String(params.app || '');
    const label = name + (key ? ':' + key : '');
    if (name === 'info') {
      const d = await about();
      return record(label, !!(d.model || d.osVersion), d);
    }
    if (name === 'apps') {
      const r = await luna('luna://com.webos.applicationManager/listLaunchPoints', {});
      const list = r.launchPoints as { id: string }[] | undefined;
      if (!r.returnValue || !Array.isArray(list)) return record(label, false, { error: lunaError(r) });
      const known: Record<string, string> = {};
      for (const k of Object.keys(SAMPLE_TITLES).concat(['disney', 'max', 'appletv', 'hulu'])) {
        const id = appIdFor(k);
        if (id) known[k] = id;
      }
      return record(label, true, { count: list.length, known });
    }
    const title = SAMPLE_TITLES[key];
    const appId = appIdFor(key);
    if (!title) return record(label, false, { error: 'no sample title for ' + key });
    if (!appId && name !== 'linkDial') return record(label, false, { error: `${key} isn’t on this TV` });
    const launchParams = titleParams(key, key === 'youtube' ? null : title.url, title.meta);
    if (name === 'linkAppControl') {
      if (!launchParams) return record(label, false, { error: 'no launch params for ' + key });
      const r = await luna('luna://com.webos.applicationManager/launch', { id: appId, params: launchParams }, 15000);
      return record(
        label,
        !!r.returnValue,
        r.returnValue ? { sentTo: appId, params: launchParams, note: 'Did the title open, or only the app?' } : { error: lunaError(r) },
      );
    }
    if (name === 'linkRemote') {
      if (!launchParams) return record(label, false, { error: 'no launch params for ' + key });
      const r = await remoteLaunch(appId!, launchParams);
      return record(label, r.ok, {
        events: r.events,
        error: r.error,
        note: r.ok ? 'Did the title open, or only the app? Did the TV ask to allow “HomeTV”?' : undefined,
      });
    }
    if (name === 'linkDial') {
      const r = await dialYouTube(title.meta);
      return record(label, r.status >= 200 && r.status < 300, { ...r, note: 'Did the video play, or a “connect” pane?' });
    }
    return record(label, false, { error: 'not a check in this mode: ' + name });
  },
};
