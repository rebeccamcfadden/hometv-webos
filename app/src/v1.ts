// v1's tabs (features.ts): in the build only with HOMETV_V1=1, which points the `@v1` import here; otherwise
// v1-off.ts, so none of these screens or the sample catalogue are in the page.
import type { Screen, TabId } from './shell/app';
import { libraryScreen } from './screens/library';
// Fills routes.person, so Cast & crew and Search's People results open the person page.
import './screens/person';
import { searchScreen } from './screens/search';

export const v1Tabs: Partial<Record<TabId, () => Screen>> = {
  movies: () => libraryScreen('movie'),
  tv: () => libraryScreen('show'),
  search: searchScreen,
};
