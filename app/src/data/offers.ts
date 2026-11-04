// TEMPORARY copy of hometv-launcher's design_preview/src/data/offers.ts at 2bf3c2d, until the offers move into
// @hometv/core (docs/shared-package.md). Changes: the imports; the household's choices come from ./settings.ts, a
// Samsung stand-in with one region (decided 2026-11-04), so pickServices() is that region's list only. The
// card functions (cardLine, cardOffer, availability) are what Movies and TV Shows' cards use too.
import type { Offer, OfferType, Quality, ServiceId, Title } from '@hometv/core/types.ts';
import { featureOn, settings, pickServices, pickStores } from './settings';
import { DEFAULT_PRICE_SOURCE, HOME_APPS, PRICE_SOURCE, SERVICES } from '@hometv/core/services.ts';

// Offer rules. Prices are Swedish kronor, as the launcher's real catalogue has them (V2 Phase 2): a rent or buy
// offer keeps a price per picture quality, and a store no price source priced has none at all.

/** "39 kr". */
export const kr = (n: number) => `${n} kr`;

const QUALITIES: Quality[] = ['SD', 'HD', '4K'];

const amounts = (o: Offer) => QUALITIES.map((q) => o.prices?.[q]).filter((p): p is number => p !== undefined);

/** The cheapest price of a rent or buy offer in any quality; undefined when no source priced it. */
export function cheapest(o: Offer): number | undefined {
  const all = amounts(o);
  return all.length ? Math.min(...all) : undefined;
}

/** Several prices (qualities that cost different amounts, or one per season): the cheapest then reads "from". */
export const isFrom = (o: Offer) => !!o.seasonal || new Set(amounts(o)).size > 1;

/** "39 kr", "from 49 kr", or undefined without a price. */
export function priceLabel(o: Offer): string | undefined {
  const min = cheapest(o);
  if (min === undefined) return undefined;
  return isFrom(o) ? `from ${kr(min)}` : kr(min);
}

const verb = (type: OfferType) => (type === 'rent' ? 'Rent' : 'Buy');

/** "Rent 39 kr", "Buy from 99 kr", or just "Rent" when the store's price isn't known (its app shows it). */
export function paid(o: Offer): string {
  const p = priceLabel(o);
  return p ? `${verb(o.type)} ${p}` : verb(o.type);
}

/** A button that rents or buys: "Rent on SF Anytime · 39 kr", "Buy on Amazon Video · from 139 kr", "Rent on Rakuten TV". */
export function paidAction(o: Offer): string {
  const p = priceLabel(o);
  return `${verb(o.type)} on ${SERVICES[o.service].name}${p ? ` · ${p}` : ''}`;
}

/** The household has the service: ticked in Launcher settings (free YouTube always counts). */
export const isSubscribed = (id: ServiceId) =>
  !!SERVICES[id].free || pickServices().some((p) => p.catalog === id && settings.get().services.includes(p.id));

/** How many services are ticked, for "All 8 services". */
export const subscribedCount = () => settings.get().services.length;

/**
 * The title's offers the household can use: every one except those of stores unticked in Launcher settings, whose
 * prices are left out everywhere. With Prices off (F14) every offer comes without its prices: Rent and Buy still say
 * where.
 */
export const offersOf = (t: Title) =>
  t.offers
    .filter((o) => !SERVICES[o.service].store || SERVICES[o.service].free || settings.get().stores.includes(o.service))
    .map((o) => (featureOn('prices') || !o.prices ? o : unpriced(o)));

/** One price-less copy per offer, so an offer stays the same object between calls. */
const unpricedCopies = new WeakMap<Offer, Offer>();
function unpriced(o: Offer): Offer {
  let c = unpricedCopies.get(o);
  if (!c) unpricedCopies.set(o, (c = { ...o, prices: undefined }));
  return c;
}

export const isIncludedOffer = (o: Offer) => o.type === 'free' || (o.type === 'sub' && isSubscribed(o.service));

/** A catalogue service the household ticked in the Streaming services pane. */
const isTicked = (id: ServiceId) =>
  pickServices().some((p) => p.catalog === id && settings.get().services.includes(p.id));

/** Whether the service's app is on the mock TV: as the Streaming services pane has it, else on the Home row. */
const isInstalled = (id: ServiceId) =>
  pickServices().find((p) => p.catalog === id)?.installed ?? HOME_APPS.some((a) => a.id === id);

/**
 * The offers a card counts (F1, 2026-11-01): a subscription the household ticked, a free service whose app is
 * installed or that is ticked, and rent and buy only from a store ticked in the Stores pane (one the pane doesn't
 * list never names a card). The title preview still shows every offer.
 */
export const cardOffersOf = (t: Title) =>
  offersOf(t).filter((o) =>
    o.type === 'sub'
      ? isTicked(o.service)
      : o.type === 'free'
        ? isInstalled(o.service) || isTicked(o.service)
        : settings.get().stores.includes(o.service),
  );

/** "Included only" in Movies and TV Shows, Pick for me and Search: the cards' rule ({@link cardOffersOf}). */
export const isOwnIncluded = (t: Title) => cardOffersOf(t).some(isIncludedOffer);

/** The cheapest offer of a type: a priced one beats an unpriced one, which is only picked when none is priced. */
function cheapestOf(offers: Offer[], type: OfferType): Offer | undefined {
  let best: Offer | undefined;
  for (const o of offers) {
    if (o.type !== type) continue;
    const p = cheapest(o);
    const b = best && cheapest(best);
    if (!best || (p !== undefined && (b === undefined || p < b))) best = o;
  }
  return best;
}

/** The offer the Watch button uses: included first, then the cheapest rental, then the cheapest purchase. */
export function bestOffer(t: Title): Offer | undefined {
  return bestOf(offersOf(t));
}

/** The offer a card names: the best of the household's own offers ({@link cardOffersOf}), or none. */
export function cardOffer(t: Title): Offer | undefined {
  return bestOf(cardOffersOf(t));
}

function bestOf(offers: Offer[]): Offer | undefined {
  return offers.find(isIncludedOffer) ?? cheapestOf(offers, 'rent') ?? cheapestOf(offers, 'buy');
}

/** The library card's second provider line: "Included", "Free", "Rent 39 kr", "Buy from 99 kr" or just "Rent". */
export function availability(o: Offer | undefined): string {
  if (!o) return '';
  if (o.type === 'free') return 'Free';
  if (o.type === 'sub') return isIncludedOffer(o) ? 'Included' : 'Subscription';
  return paid(o);
}

/** "Prime Video · Included", "YouTube · Free", "SF Anytime · Rent 39 kr", "Not available". */
export function offerLabel(o: Offer | undefined): string {
  return o ? `${SERVICES[o.service].name} · ${availability(o)}` : 'Not available';
}

/**
 * The line on search and row cards: "Prime Video · Included" when a service the household has includes it; else
 * the cheapest rental across the stores, "Rent from 39 kr · 3 stores", else "Buy from 99 kr · 2 stores" (one store:
 * "SF Anytime · Rent 39 kr"); a show's season "Buy a season from 199 kr". Quality is left to Where to watch. Only the
 * household's offers count ({@link cardOffersOf}): blank when none of its services or stores has the title.
 */
export function cardLine(t: Title): string {
  const offers = cardOffersOf(t);
  const o = bestOf(offers);
  if (!o) return '';
  if (isIncludedOffer(o)) return offerLabel(o);
  const stores = new Set(offers.filter((x) => x.type === o.type).map((x) => x.service)).size;
  const min = cheapest(o);
  const count = stores > 1 ? ` · ${stores} stores` : '';
  if (o.seasonal) return `${verb(o.type)} a season${min === undefined ? '' : ` from ${kr(min)}`}${count}`;
  if (stores === 1) return offerLabel(o);
  return `${verb(o.type)}${min === undefined ? '' : ` from ${kr(min)}`}${count}`;
}

/** One entry per service, with its rent and buy offers merged: the title preview's Where to watch cards. */
export interface ServiceOffers {
  service: ServiceId;
  included: boolean;
  free: boolean;
  rent?: Offer;
  buy?: Offer;
  /** Subscription and free offers: the picture quality ("4K · HDR"). */
  quality: string;
}

export const watchable = (s: ServiceOffers) => s.included || s.free;

/** Rentals with a price first, by price; then purchases with a price, by price; then stores with no price. */
function storeRank(s: ServiceOffers): [number, number] {
  const r = s.rent && cheapest(s.rent);
  if (r !== undefined) return [0, r];
  const b = s.buy && cheapest(s.buy);
  if (b !== undefined) return [1, b];
  return [2, 0];
}

/** Included and free services first, in the offers' order; then the stores, cheapest first. */
export function offersByService(t: Title): ServiceOffers[] {
  const map = new Map<ServiceId, ServiceOffers>();
  for (const o of offersOf(t)) {
    const e = map.get(o.service) ?? { service: o.service, included: false, free: false, quality: o.quality ?? '' };
    if (o.type === 'sub' && isSubscribed(o.service)) e.included = true;
    if (o.type === 'free') e.free = true;
    if (o.type === 'rent') e.rent = o;
    if (o.type === 'buy') e.buy = o;
    map.set(o.service, e);
  }
  const all = [...map.values()];
  const inc = all.filter(watchable);
  const stores = all.filter((s) => !watchable(s)).map((s, i) => ({ s, i, r: storeRank(s) }));
  stores.sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1] || a.i - b.i);
  const sorted = stores.map((x) => x.s);
  // A tie on the deciding price goes to a store whose app is on the TV (decided 2026-10-31).
  const lead = sorted[0];
  if (lead && storeRank(lead)[0] < 2 && !hasApp(lead.service)) {
    const [r, p] = storeRank(lead);
    const tied = sorted.findIndex((s) => storeRank(s)[0] === r && storeRank(s)[1] === p && hasApp(s.service));
    if (tied > 0) sorted.unshift(...sorted.splice(tied, 1));
  }
  return [...inc, ...sorted];
}

/** Whether the store's (or service's) app is installed on the mock TV. */
function hasApp(id: ServiceId): boolean {
  return (pickStores().find((s) => s.id === id) ?? pickServices().find((s) => s.id === id))?.installed ?? false;
}

/**
 * The store Where to watch tags "Cheapest": the cheapest rental, else the cheapest purchase, once two or more
 * stores have a price. Undefined otherwise.
 */
export function cheapestStore(list: ServiceOffers[]): ServiceId | undefined {
  // offersByService's order: the first priced store is the cheapest (an installed one of equals).
  const priced = list.filter((s) => !watchable(s) && storeRank(s)[0] < 2);
  return priced.length < 2 ? undefined : priced[0].service;
}

/** A store card's line for one quality, or for several that cost the same ("HD · 4K"). */
export interface PriceLine {
  quality: string;
  rent?: number;
  buy?: number;
}

/** A store's prices, one line per quality, SD first; a quality whose prices match the line above joins it. */
export function priceLines(s: ServiceOffers): PriceLine[] {
  const lines: PriceLine[] = [];
  for (const q of QUALITIES) {
    const rent = s.rent?.prices?.[q];
    const buy = s.buy?.prices?.[q];
    if (rent === undefined && buy === undefined) continue;
    const last = lines[lines.length - 1];
    if (last && last.rent === rent && last.buy === buy) last.quality += ` · ${q}`;
    else lines.push({ quality: q, rent, buy });
  }
  return lines;
}

/** The qualities a store prices, SD first. */
export const qualitiesOf = (s: ServiceOffers): Quality[] =>
  QUALITIES.filter((q) => s.rent?.prices?.[q] !== undefined || s.buy?.prices?.[q] !== undefined);

/** The caption under Where to watch: "Availability: JustWatch · Prices: Apple", naming the sources that priced it. */
export function attribution(t: Title): string {
  const sources = new Set<string>();
  for (const o of offersOf(t)) if (cheapest(o) !== undefined) sources.add(PRICE_SOURCE[o.service] ?? DEFAULT_PRICE_SOURCE);
  return `Availability: JustWatch${sources.size ? ` · Prices: ${[...sources].join(' / ')}` : ''}`;
}

export function runtimeLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}
