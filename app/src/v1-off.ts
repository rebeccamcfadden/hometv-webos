// The `@v1` import in a v0 build (features.ts): no v1 tabs.
import type { Screen, TabId } from './shell/app';

export const v1Tabs: Partial<Record<TabId, () => Screen>> = {};
