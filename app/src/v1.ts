// v1's tabs (features.ts): in the build only with HOMETV_V1=1, which points the `@v1` import here; otherwise
// v1-off.ts, so none of these screens or the sample catalogue are in the page.
import type { Screen, TabId } from './shell/app';
import { libraryScreen } from './screens/library';
// Fills routes.person, so Cast & crew and Search's People results open the person page.
import './screens/person';
import { searchScreen } from './screens/search';
import { routes } from './screens/routes';
import { showAccount } from './screens/account';
import { accounts } from './account/tv';
import { showKeys } from './screens/keys';
import { bridge } from './bridge';

// The TMDB account: its button on the API keys page, and its lists' changes recorded from the start.
routes.account = showAccount;
const account = accounts();

// First run's TMDB key and Sign in to TMDB steps, as on Android (design_preview's screens/setup.ts).
routes.tmdbSetup = {
  keySaved: () => bridge.platform.keyPages.tmdbKey().then((k) => !!k, () => false),
  signedInAs: () => {
    const s = account.state();
    return s.phase === 'signedIn' ? s.username || 'your account' : '';
  },
  openKeys: showKeys,
  openAccount: showAccount,
  on: (fn) => account.on(fn),
};

export const v1Tabs: Partial<Record<TabId, () => Screen>> = {
  movies: () => libraryScreen('movie'),
  tv: () => libraryScreen('show'),
  search: searchScreen,
};
