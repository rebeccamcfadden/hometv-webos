// LG webOS's system services (Luna) from the page, through PalmServiceBridge (what LG's webOSTV.js wraps). A small
// promise wrapper with a timeout, written for HomeTV after zzeppieri/webos-custom-home's src/service/luna.ts (MIT)
// and our checks app. Outside a webOS TV it answers "not on a webOS TV", so the page still runs in a browser.

export interface LunaReply {
  returnValue?: boolean;
  errorCode?: number | string;
  errorText?: string;
  [key: string]: unknown;
}

interface Bridge {
  onservicecallback: (msg: string) => void;
  call(uri: string, params: string): void;
  cancel?(): void;
}

type BridgeCtor = new () => Bridge;

// A bare global, not globalThis: webOS 4's Chromium 53 has no globalThis (check-legacy).
declare const PalmServiceBridge: unknown;

const pending: Bridge[] = [];

const ctor = (): BridgeCtor | undefined =>
  typeof PalmServiceBridge !== 'undefined' ? (PalmServiceBridge as unknown as BridgeCtor) : undefined;

export const onWebOS = (): boolean => typeof ctor() === 'function';

export function luna(uri: string, params: Record<string, unknown> = {}, timeoutMs = 10000): Promise<LunaReply> {
  return new Promise((resolve) => {
    const Ctor = ctor();
    if (!Ctor) {
      resolve({ returnValue: false, errorText: 'not on a webOS TV' });
      return;
    }
    // Kept referenced until it answers: an unreferenced bridge can be collected before its callback.
    const bridge = new Ctor();
    pending.push(bridge);
    let done = false;
    const finish = (r: LunaReply) => {
      if (done) return;
      done = true;
      const i = pending.indexOf(bridge);
      if (i >= 0) pending.splice(i, 1);
      resolve(r);
    };
    const timer = setTimeout(() => finish({ returnValue: false, errorText: `no answer in ${timeoutMs / 1000} s` }), timeoutMs);
    bridge.onservicecallback = (msg: string) => {
      clearTimeout(timer);
      try {
        finish(JSON.parse(msg) as LunaReply);
      } catch (e) {
        finish({ returnValue: false, errorText: String(msg) });
      }
    };
    bridge.call(uri, JSON.stringify(params));
  });
}

/**
 * A call with `subscribe: true`: `onReply` gets the answer now and again whenever the service has news. Returns a
 * function that stops it. Does nothing outside a webOS TV. Unchecked on a real TV (written after webOSTV.js's subscribe).
 */
export function lunaSubscribe(uri: string, params: Record<string, unknown>, onReply: (r: LunaReply) => void): () => void {
  const Ctor = ctor();
  if (!Ctor) return () => {};
  const bridge = new Ctor();
  pending.push(bridge);
  let stopped = false;
  bridge.onservicecallback = (msg: string) => {
    if (stopped) return;
    try {
      onReply(JSON.parse(msg) as LunaReply);
    } catch (e) {
      onReply({ returnValue: false, errorText: String(msg) });
    }
  };
  try {
    bridge.call(uri, JSON.stringify({ ...params, subscribe: true }));
  } catch (e) {
    // Not subscribed; the stop function below still cleans up.
  }
  return () => {
    stopped = true;
    const i = pending.indexOf(bridge);
    if (i >= 0) pending.splice(i, 1);
    try {
      if (bridge.cancel) bridge.cancel();
    } catch (e) {
      // Already gone.
    }
  };
}

export const lunaError = (r: LunaReply): string =>
  r.errorText || (r.errorCode !== undefined ? `error ${r.errorCode}` : 'failed');
