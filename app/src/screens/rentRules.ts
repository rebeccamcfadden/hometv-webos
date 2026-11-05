// The rent dialog's notes (rent.ts, from design_preview's screens/rent.ts), kept apart so the tests run them in Node.
import { SERVICES } from '@hometv/core/services.ts';
import type { Quality, Title } from '@hometv/core/types.ts';
import { cheapest, cheapestStore, kr, offersByService, type ServiceOffers } from '../data/offers';
import { markFirst } from '../data/settings';

/** "4K costs 10–30 kr more here" ("$1.00–$3.00" in the US), from the store's HD and 4K prices; null when it has no 4K or no difference. */
export function fourKNote(s: ServiceOffers): string | null {
  const diffs: number[] = [];
  for (const o of [s.rent, s.buy]) {
    const hd = o && o.prices ? o.prices.HD : undefined;
    const uhd = o && o.prices ? o.prices['4K'] : undefined;
    if (hd !== undefined && uhd !== undefined && uhd > hd) diffs.push(uhd - hd);
  }
  if (!diffs.length) return null;
  const cents = (n: number) => Math.round(n * 100) / 100;
  const lo = cents(Math.min.apply(null, diffs));
  const hi = cents(Math.max.apply(null, diffs));
  const range = lo === hi ? kr(lo) : markFirst() ? `${kr(lo)}–${kr(hi)}` : `${lo}–${kr(hi)}`;
  return `4K costs ${range} more here`;
}

/**
 * The cheaper offer elsewhere, of the type that decided Cheapest (rent against rent, buy against buy):
 * " SF Anytime has it for 39 kr (HD)." or " … for 129 kr to buy (HD).", else ''.
 */
export function cheaperElsewhere(t: Title, s: ServiceOffers): string {
  const all = offersByService(t);
  const best = cheapestStore(all);
  const bestOffers = all.filter((x) => x.service === best)[0];
  if (!best || !bestOffers || best === s.service) return '';
  const byRent = !!bestOffers.rent && cheapest(bestOffers.rent) !== undefined;
  const theirs = byRent ? bestOffers.rent : bestOffers.buy;
  const ours = byRent ? s.rent : s.buy;
  const here = ours ? cheapest(ours) : undefined;
  const there = theirs ? cheapest(theirs) : undefined;
  if (there === undefined || (here !== undefined && there >= here)) return '';
  const prices = theirs!.prices || {};
  const q = (Object.keys(prices) as Quality[]).filter((x) => prices[x] === there)[0];
  return ` ${SERVICES[best].name} has it for ${kr(there)}${byRent ? '' : ' to buy'}${q ? ` (${q})` : ''}.`;
}
