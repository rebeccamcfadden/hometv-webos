// TEMPORARY Samsung stand-in for hometv-launcher's design_preview/src/core/settings.ts at 2bf3c2d, only the parts
// data/offers.ts reads, until the offers take the household's choices as arguments in @hometv/core. Changes: one
// region (decided 2026-11-04: one region, no region switch; which one isn't decided, so this uses Sweden,
// design_preview's default, as a stand-in),
// and nothing saved: Samsung has no Launcher settings yet, so the defaults are design_preview's first-run ticks.
// `set` exists for the tests and changes this visit only.
import { SE_PICK_SERVICES, SE_PICK_STORES, type PickService } from '@hometv/core/services.ts';
import type { ServiceId } from '@hometv/core/types.ts';

/** Launcher settings › Features (F14), the ones the offers and Search read. */
export type FeatureId = 'tmdb' | 'prices';

interface Household {
  /** Ticked streaming services (pickServices() ids): their titles count as Included. */
  services: string[];
  /** Ticked stores: prices come only from these. */
  stores: ServiceId[];
  features: Record<FeatureId, boolean>;
}

/** The one region's currency, for the card pill (design_preview: kr in Sweden, $ in the US). */
export const CURRENCY = 'kr';

/** design_preview's first ticks: the services whose app is on the TV, and every store, so prices show from the start. */
const defaults = (): Household => ({
  services: SE_PICK_SERVICES.filter((s) => s.installed && !s.more).map((s) => s.id),
  stores: SE_PICK_STORES.map((s) => s.id),
  features: { tmdb: true, prices: true },
});

let data = defaults();

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
export const pickServices = (): PickService[] => SE_PICK_SERVICES;
/** The region's stores for rent and buy. */
export const pickStores = () => SE_PICK_STORES;

export const featureOn = (id: FeatureId) => data.features[id];
