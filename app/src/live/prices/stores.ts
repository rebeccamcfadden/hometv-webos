// The stores a price source names, by the names it uses for them (the Android launcher's WatchProviders.storeForName,
// for the stores @hometv/core's ServiceId has). A store not here is dropped, as in the launcher. Only rent and buy: "Prime
// Video" here is Amazon's store, not the subscription.
import type { ServiceId } from '@hometv/core/types.ts';
import { norm } from './types';

const NAMES: [ServiceId, string[]][] = [
  ['appletv', ['Apple TV', 'Apple TV Store', 'iTunes', 'Apple iTunes', 'AppleTV', 'apple']],
  ['googletv', ['Google Play', 'Google Play Movies', 'Google Play Movies & TV', 'Google TV']],
  ['youtube', ['YouTube', 'YouTube Movies']],
  ['amazonvideo', ['Amazon Video', 'Amazon', 'Prime Video', 'Amazon Prime Video', 'prime', 'Prime Video Store']],
  ['viaplaystore', ['Viaplay', 'Viaplay Store', 'Viaplay Rent & Buy']],
  ['sfanytime', ['SF Anytime', 'SFAnytime']],
  ['rakuten', ['Rakuten TV', 'Rakuten']],
  ['fandango', ['Fandango at Home', 'Fandango', 'Vudu', 'VUDU']],
];

const BY_NAME: Record<string, ServiceId> = {};
for (const [id, names] of NAMES) for (const n of names) BY_NAME[norm(n)] = id;

/** The store a price source means by `name`, or null. */
export const storeForName = (name: unknown): ServiceId | null => (typeof name === 'string' && BY_NAME[norm(name)]) || null;

export const isStore = (id: ServiceId): boolean => NAMES.some((n) => n[0] === id);
