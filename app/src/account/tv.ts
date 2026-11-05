// The account on a TV: createAccounts (account.ts) with the page's storage, XMLHttpRequest, the household's lists
// (data/store.ts) and the TMDB key from the API keys page. Started by v1.ts; v0 builds never import it.

import { bridge } from '../bridge';
import { store } from '../data/store';
import { pageStorage } from '../launcherSettings';
import { type Accounts, createAccounts } from './account';
import { sendXhr } from './http';

let one: Accounts | null = null;

export function accounts(): Accounts {
  if (one) return one;
  const a = createAccounts({
    now: () => Date.now(),
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (id) => window.clearTimeout(id),
    send: sendXhr,
    appKey: () => bridge.platform.keyPages.tmdbKey(),
    kv: pageStorage(),
    lists: store,
    visible: () => document.visibilityState !== 'hidden',
  });
  one = a;
  window.addEventListener('online', () => a.resume());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') a.resume();
  });
  return a;
}
