// TEMPORARY Samsung stand-in for hometv-launcher's design_preview/src/core/settings.ts at 2bf3c2d, only the parts
// data/offers.ts reads, until the offers take the household's choices as arguments in @hometv/core. Changes: one
// region at a time (decided 2026-11-04: one region, no region switch), the one chosen in Settings › Region
// (launcherSettings.ts), else Sweden, design_preview's default, until the person chooses; a new region starts with its
// own first ticks. Prices stay in kronor: the sample catalogue's offers are Swedish (design_preview says the same of its
// own region switch). The ticks aren't saved: Samsung's Settings has no services or stores panes yet (v1), so they are
// design_preview's first-run ticks. `set` exists for the tests and changes this visit only.
import { SE_PICK_SERVICES, SE_PICK_STORES, US_PICK_SERVICES, US_PICK_STORES, type PickService } from '@hometv/core/services.ts';
import type { ServiceId } from '@hometv/core/types.ts';
import { prefs, type Region } from '../launcherSettings';

const PICKS: Record<Region, { services: PickService[]; stores: { id: ServiceId; installed: boolean }[] }> = {
  se: { services: SE_PICK_SERVICES, stores: SE_PICK_STORES },
  us: { services: US_PICK_SERVICES, stores: US_PICK_STORES },
};
/** The region chosen in Settings, or Sweden until one is. */
const region = (): Region => prefs.get().region || 'se';

/** Launcher settings › Features (F14), the ones the offers and Search read. */
export type FeatureId = 'tmdb' | 'prices';

interface Household {
  /** Ticked streaming services (pickServices() ids): their titles count as Included. */
  services: string[];
  /** Ticked stores: prices come only from these. */
  stores: ServiceId[];
  features: Record<FeatureId, boolean>;
}

/** The card pill's currency mark: kronor in Sweden, dollars in the US (prices are in the region's own money). */
export const currency = (): string => (region() === 'us' ? '$' : 'kr');

/** Whether the region's price is written with the mark before it. */
export const markFirst = (): boolean => region() === 'us';

/** design_preview's first ticks: the services whose app is on the TV, and every store, so prices show from the start. */
const defaults = (): Household => ({
  services: PICKS[region()].services.filter((s) => s.installed && !s.more).map((s) => s.id),
  stores: PICKS[region()].stores.map((s) => s.id),
  features: { tmdb: true, prices: true },
});

let data = defaults();
let ticksFor = region();
// A new region: its own first ticks (one region at a time; nothing kept from the other).
prefs.on(() => {
  if (region() === ticksFor) return;
  ticksFor = region();
  data = defaults();
});

export const settings = {
  get: (): Readonly<Household> => data,
  set(patch: Partial<Household>) {
    data = { ...data, ...patch };
  },
  reset() {
    data = defaults();
  },
};

/** The region's streaming services, in the Streaming services pane's order. */
export const pickServices = (): PickService[] => PICKS[region()].services;
/** The region's stores for rent and buy. */
export const pickStores = () => PICKS[region()].stores;

export const featureOn = (id: FeatureId) => data.features[id];
