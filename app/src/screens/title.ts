// The title page, from hometv-launcher's design_preview/src/screens/preview.ts at 2bf3c2d (Title preview, Option C):
// a popup over the page that opened it, with the essentials and actions on top and tabs for the rest (Overview,
// Episodes, Where to watch, Cast & crew, More like this). Watch and the services open the title in its app through
// the bridge (screens/opening.ts); rent and buy go through the store's dialog (rent.ts).
// The page opens at once on the title as the list or search showed it, and asks TMDB for the rest (runtime or seasons,
// rating, cast, where to watch, trailer, More like this); when that arrives the page draws again, on the same tab and
// focus. A show's episodes load a season at a time. The art is the poster (data/posters.ts). Not ported: a tab's Retry.

import { SERVICES } from '@hometv/core/services.ts';
import { bridge } from '../bridge';
import type { ServiceId, Title } from '@hometv/core/types.ts';
import { live } from '../live/live';
import type { LiveSeason, LivePerson, LiveTitle } from '../live/types';
import { imageUrl, PROFILE_SIZE } from '../live/tmdb';
import {
  attribution,
  bestOffer,
  cheapest,
  cheapestStore,
  isIncludedOffer,
  kr,
  offersByService,
  offersOf,
  paidAction,
  priceLines,
  runtimeLabel,
  watchable,
  type ServiceOffers,
} from '../data/offers';
import { posterUrl } from '../data/posters';
import { store } from '../data/store';
import { shell, type Screen } from '../shell/app';
import { h, replace } from '../shell/dom';
import { focusable } from '../shell/focus';
import { icon, type IconName } from '../ui/icons';
import { button, chip, miniCard, personCard } from '../ui/widgets';
import { openTitleIn, openWith } from './opening';
import { rentDialog } from './rent';
import { openPerson } from './routes';
import { openPlan } from '../titleLinks';
import './title.css';

/** The titles TMDB suggests for `t` that are known so far, up to eight. */
export function similar(t: Title): Title[] {
  const out: Title[] = [];
  for (const id of (t as LiveTitle).similar || []) {
    const o = live.title(id);
    if (o && o.id !== t.id && out.length < 8) out.push(o);
  }
  return out;
}

const isOffline = () => !bridge.platform.online();

/** What the page keeps when it draws again for the details: the season and tab the person is on. */
interface PageState {
  season: number;
  want: string;
}

const detailed = (t: Title) => !!(t as LiveTitle).detailed;

/** The title page, on `t` as it is now. */
function buildPage(t: Title, opts: { moreLike?: boolean }, state: PageState, togglePaints: (() => void)[]): { popup: HTMLElement; tick: () => boolean } {
  const isShow = t.kind === 'show';
  const tabs = isShow
    ? ['Overview', 'Episodes', 'Where to watch', 'Cast & crew', 'More like this']
    : ['Overview', 'Where to watch', 'Cast & crew', 'More like this'];
  let active = '';
  let season = state.season;
  const full = detailed(t);
  const offer = bestOffer(t);
  const svcName = offer ? SERVICES[offer.service].name : '';
  const next = t.next ? `S${t.next.season} E${t.next.episode}` : '';

  const openPaid = (service: ServiceId) => {
    const s = offersByService(t).filter((x) => x.service === service)[0];
    if (s) shell.push(rentDialog(t, s));
  };

  // ---- actions ----
  const watchLabel = !offer
    ? 'Not on your services'
    : isIncludedOffer(offer)
      ? isShow
        ? `Watch ${next} on ${svcName}`
        : `Watch on ${svcName}`
      : paidAction(offer);
  const watch = button(watchLabel, {
    icon: 'play',
    primary: true,
    group: 'actions',
    key: 'watch',
    isDefault: true,
    onOk: () => {
      if (!offer) return shell.toast('Not available on your services or stores');
      if (isIncludedOffer(offer)) return void openTitleIn(t, offer.service, isShow ? `${next} of ${t.name}` : t.name);
      openPaid(offer.service);
    },
  });

  const toggle = (
    key: string,
    icOff: IconName,
    icOn: IconName,
    off: string,
    on: string,
    get: (id: string) => boolean,
    flip: (id: string) => boolean,
    msg: (on: boolean) => string,
  ) => {
    const el = focusable(h('div.btn.btn--icon'), {
      group: 'actions',
      key,
      onOk: () => {
        shell.toast(msg(flip(t.id)));
        paint();
      },
    });
    const paint = () => {
      const state = get(t.id);
      el.classList.toggle('is-on', state);
      replace(el, h('span.btn-icon', { html: icon(state ? icOn : icOff, 26, state && icOn === 'heart') }), h('span.btn-label', state ? on : off));
    };
    paint();
    togglePaints.push(paint);
    return el;
  };

  const actions = h(
    'div.pv-actions',
    watch,
    toggle('mylist', 'plus', 'check', 'My list', 'On My list', store.inMyList, store.toggleMyList, (on) => (on ? 'Added to My list' : 'Removed from My list')),
    toggle('seen', 'eye', 'eye', 'Mark seen', 'Seen', store.isSeen, store.toggleSeen, (on) => (on ? 'Marked as seen' : 'Marked as not seen')),
    toggle('fav', 'heart', 'heart', 'Favorite', 'Favorite', store.isFavorite, store.toggleFavorite, (on) => (on ? 'Added to favorites' : 'Removed from favorites')),
    button('Trailer', {
      icon: 'trailer',
      group: 'actions',
      key: 'trailer',
      onOk: () => {
        if (isOffline()) return shell.toast('Offline: the trailer needs the internet');
        // TMDB's trailer is a YouTube video id; without one (or before the details arrive), YouTube opens on its home.
        const video = (t as LiveTitle).trailer;
        openWith(openPlan('youtube', video ? { payload: `v=${video}` } : undefined), `Opening YouTube for the ${t.name} trailer…`);
      },
    }),
  );

  // ---- tabs ----
  const content = h('div.pv-content');

  const overview = () => {
    const rents = offersOf(t)
      .filter((o) => o.type === 'rent')
      .map(cheapest)
      .filter((p): p is number => p !== undefined);
    const included = !!offer && isIncludedOffer(offer);
    const lead = t.crew[0];
    return h(
      'div.pv-overview',
      h('p.pv-synopsis', t.synopsis),
      h(
        'div.pv-facts',
        h(
          'div.pv-fact',
          included ? h('span.badge', offer!.type === 'free' ? 'Free' : 'Included') : null,
          h('span', included ? `on ${svcName}` : offer ? `${offer.type === 'rent' ? 'Rent' : 'Buy'} on ${svcName}` : 'Not on your services'),
          rents.length && included ? h('span.muted', `· Rent from ${kr(Math.min.apply(null, rents))} elsewhere`) : null,
        ),
        t.cast.length ? h('div.pv-fact', h('span.muted', 'Starring'), h('span', t.cast.slice(0, 3).map((c) => c.name).join(', '))) : null,
        lead
          ? h(
              'div.pv-fact',
              h('span.muted', lead.role),
              h(
                'span',
                t.crew
                  .filter((c) => c.role === lead.role)
                  .map((c) => c.name)
                  .join(', '),
              ),
            )
          : null,
      ),
    );
  };

  // Where to watch (07-prices A): one card per service, included ones first, then the stores, cheapest first and
  // tagged; a line per picture quality. A store no source priced reads "Rent · Buy". The sources are credited under it.
  const serviceCard = (s: ServiceOffers, isCheapest: boolean, isDefault: boolean) => {
    const name = SERVICES[s.service].name;
    let body: (HTMLElement | null)[];
    if (watchable(s)) {
      body = [h('div.service-offer', s.included ? 'With your subscription' : 'Free with ads'), h('div.service-detail', s.quality)];
    } else {
      const lines = priceLines(s);
      const seasonal = !!((s.rent && s.rent.seasonal) || (s.buy && s.buy.seasonal));
      // The cheapest store's deciding price, rent before buy, is the green one.
      const rentMin = s.rent ? cheapest(s.rent) : undefined;
      const buyMin = s.buy ? cheapest(s.buy) : undefined;
      const green = isCheapest ? (rentMin !== undefined ? rentMin : buyMin) : undefined;
      const greenType = isCheapest ? (rentMin !== undefined ? 'rent' : 'buy') : null;
      let greened = false;
      const amount = (type: 'rent' | 'buy', n: number) => {
        const isGreen = !greened && type === greenType && n === green;
        if (isGreen) greened = true;
        return h(`b${isGreen ? '.cheap' : ''}`, kr(n));
      };
      body = lines.length
        ? [
            h(
              'div.price-lines',
              lines.map((l) =>
                h(
                  'div.pl',
                  h(
                    'span',
                    l.rent !== undefined ? ['Rent ', amount('rent', l.rent)] : null,
                    l.rent !== undefined && l.buy !== undefined ? ' · ' : null,
                    l.buy !== undefined ? ['Buy ', amount('buy', l.buy)] : null,
                  ),
                  h('span.q', l.quality),
                ),
              ),
            ),
            seasonal ? h('div.service-detail', 'Per season') : null,
          ]
        : [
            h('div.price-lines', h('div.pl', h('span', [s.rent && 'Rent', s.buy && 'Buy'].filter(Boolean).join(' · ')))),
            h('div.service-detail', 'Price shown in the app'),
          ];
    }
    return focusable(
      h(
        `div.service${watchable(s) ? '.service--included' : ''}`,
        h(
          'div.service-head',
          h('span.service-name', name),
          watchable(s) ? h('span.badge', s.free ? 'Free' : 'Included') : isCheapest ? h('span.tag-best', 'Cheapest') : null,
        ),
        body,
      ),
      {
        group: 'wtw',
        key: `svc-${s.service}`,
        isDefault,
        onOk: () => (watchable(s) ? void openTitleIn(t, s.service) : openPaid(s.service)),
      },
    );
  };

  /** A tab whose data hasn't arrived: loading, or why it won't. */
  const waiting = (what: string) => {
    const p = live.need(t.id).phase;
    return h('div.pv-empty', p === 'nokey' ? 'Add a TMDB key on the key page to see this.' : p === 'offline' ? `Offline: ${what} isn’t saved for this title yet.` : p === 'error' ? `TMDB can’t be reached for ${what}.` : `Loading ${what}…`);
  };

  const whereToWatch = () => {
    if (!full) return waiting('where to watch');
    const list = offersByService(t);
    const best = cheapestStore(list);
    return h(
      'div.pv-where',
      list.length
        ? h('div.pv-row', { 'data-scroll': 'x', 'data-scroll-pad': 0 }, list.map((s, i) => serviceCard(s, s.service === best, i === 0)))
        : h('div.pv-empty', 'Not available to stream, rent or buy here.'),
      h('div.pv-credit', `${attribution(t)}${isOffline() ? ' · Offline: prices may be out of date' : ''}`),
    );
  };

  const cast = () => {
    const people = t.cast.concat(t.crew);
    if (!people.length) return full ? h('div.pv-empty', 'No cast information for this title yet.') : waiting('the cast');
    return h(
      'div.pv-row',
      { 'data-scroll': 'x', 'data-scroll-pad': 0 },
      people.map((c, i) =>
        personCard(c.name, c.role, { group: 'cast', key: `cast-${i}`, isDefault: i === 0, onOk: () => openPerson(c.name, (c as LivePerson).id), photo: imageUrl((c as LivePerson).photo, PROFILE_SIZE) }),
      ),
    );
  };

  const more = () => {
    const list = similar(t);
    if (!list.length) return full ? h('div.pv-empty', 'Nothing similar to suggest yet.') : waiting('more like this');
    return h(
      'div.pv-row',
      { 'data-scroll': 'x', 'data-scroll-pad': 0 },
      list.map((o, i) => miniCard(o, { group: 'similar', key: `sim-${o.id}`, isDefault: i === 0, onOk: () => shell.push(titlePage(o)) })),
    );
  };

  const episodesWrap = h('div.pv-episodes');
  const episodes = () => {
    const seasons = t.seasons || [];
    if (!seasons.length) return h('div.pv-episodes', full ? h('div.pv-empty', 'No episodes listed for this show yet.') : waiting('the episodes'));
    const list = h('div.pv-row', { 'data-scroll': 'x', 'data-scroll-pad': 0 });
    const paintEpisodes = () => {
      const view = live.season(t.id, season);
      const s: LiveSeason | undefined = view.value;
      if (!s || !s.episodes.length) {
        const p = view.phase;
        replace(
          list,
          h('div.pv-empty', p === 'nokey' ? 'Add a TMDB key on the key page to see this.' : p === 'offline' ? 'Offline: this season isn’t saved yet.' : p === 'error' ? 'TMDB can’t be reached for this season.' : p === 'loading' ? 'Loading episodes…' : 'No episodes listed for this season.'),
        );
        return;
      }
      replace(
        list,
        s.episodes.map((e) => {
          const watched = !!t.next && (season < t.next.season || (season === t.next.season && e.n < t.next.episode));
          const upNext = !!t.next && season === t.next.season && e.n === t.next.episode;
          return focusable(
            h(
              `div.episode${upNext ? '.episode--next' : ''}`,
              h('div.episode-num', h('span', `E${e.n}`), upNext ? h('span.badge', 'Up next') : watched ? h('span.episode-seen', { html: icon('check', 20) }) : null),
              h('div.episode-name', e.name),
              h('div.episode-meta', `${e.runtime ? runtimeLabel(e.runtime) : ''}${watched ? `${e.runtime ? ' · ' : ''}Watched` : ''}`),
            ),
            {
              group: 'episodes',
              key: `ep-${season}-${e.n}`,
              isDefault: upNext || (!t.next && e.n === 1),
              onOk: () => {
                const what = `S${season} E${e.n} of ${t.name}`;
                if (!offer) return shell.toast('Not available on your services or stores');
                if (isIncludedOffer(offer)) return void openTitleIn(t, offer.service, what);
                openPaid(offer.service);
              },
            },
          );
        }),
      );
      list.scrollLeft = 0;
    };
    paintEpisodes();
    replace(
      episodesWrap,
      h(
        'div.pv-seasons',
        { 'data-scroll': 'y', 'data-scroll-pad': 0 },
        seasons.map((s) =>
          chip(`Season ${s.n}`, {
            selected: s.n === season,
            group: 'seasons',
            key: `season-${s.n}`,
            isDefault: s.n === season,
            onFocus: () => {
              if (season === s.n) return;
              season = s.n;
              state.season = s.n;
              const chips = episodesWrap.querySelectorAll('.pv-seasons .chip');
              for (let i = 0; i < chips.length; i++) chips[i].classList.toggle('is-selected', chips[i] === shell.focused);
              paintEpisodes();
            },
          }),
        ),
      ),
      list,
    );
    return episodesWrap;
  };

  const renderers: Record<string, () => HTMLElement> = {
    Overview: overview,
    Episodes: episodes,
    'Where to watch': whereToWatch,
    'Cast & crew': cast,
    'More like this': more,
  };

  const tabEls = tabs.map((name) =>
    focusable(h('div.tab', name), {
      group: 'tabs',
      key: `tab-${name}`,
      isDefault: name === (opts.moreLike ? 'More like this' : tabs[0]),
      onFocus: () => setTab(name),
    }),
  );

  function setTab(name: string) {
    if (name === active) return;
    active = name;
    state.want = name;
    tabEls.forEach((el, i) => el.classList.toggle('is-active', tabs[i] === name));
    replace(content, renderers[name]());
    // F46: More like this holds C cards, taller than the other tabs: the title, buttons and tabs move up for it.
    content.classList.toggle('pv-content--cards', name === 'More like this');
  }
  setTab(tabs.indexOf(state.want) >= 0 ? state.want : tabs[0]);

  /** What the open tab shows that can still arrive: if it changed, the tab draws again. */
  const signature = () => {
    if (active === 'Episodes') {
      const v = live.season(t.id, season);
      return `${season}:${v.phase}:${v.value ? v.value.episodes.length : 0}`;
    }
    return active === 'More like this' ? similar(t).map((o) => o.id).join(',') : '';
  };
  let shownSignature = signature();
  const tick = () => {
    const now = signature();
    if (now === shownSignature) return false;
    shownSignature = now;
    const name = active;
    active = '';
    setTab(name);
    return true;
  };

  const facts: (HTMLElement | string)[] = [String(t.year)];
  const addFact = (text: string) => text && facts.push(h('span.dot', '·'), h('span', text));
  addFact(t.genres.join(', '));
  addFact(isShow ? (t.seasons && t.seasons.length ? `${t.seasons.length} season${t.seasons.length === 1 ? '' : 's'}` : '') : t.runtime ? runtimeLabel(t.runtime) : '');
  const details = h(
    'div.pv-details',
    h('span', String(t.year)),
    facts.slice(1),
    t.rating ? h('span.rating', t.rating) : null,
    t.score ? h('span.score', h('span.star', { html: icon('star', 22, true) }), t.score.toFixed(1)) : null,
  );

  const backBtn = button('Back', { icon: 'back', small: true, key: 'back', onOk: () => shell.back() });

  const art = h('div.pv-poster');
  const url = posterUrl(t);
  if (url) {
    const img = h('img', { src: url, alt: '' }) as HTMLImageElement;
    img.onerror = () => art.classList.add('is-missing');
    art.appendChild(img);
  } else art.classList.add('is-missing');

  const popup = h(
    'div.popup',
    h('div.pv-art'),
    art,
    h('div.pv-fade'),
    h('div.pv-back', backBtn),
    h(
      'div.pv-body',
      h('div.pv-head', h('div.pv-titleblock', h('h1.pv-title', t.name), details), actions),
      h('div.pv-tabs', tabEls),
      h('div.pv-divider'),
      content,
    ),
  );
  return { popup, tick };
}

/** The title page. `moreLike` opens it on More like this, with focus on that tab. */
export function titlePage(from: Title, opts: { moreLike?: boolean } = {}): Screen {
  // The freshest copy there is: details that arrived since the card was drawn.
  let t: Title = live.title(from.id) || from;
  store.pushViewed(t.id);
  if (!detailed(t)) live.need(t.id);
  else live.wantPrices(t);
  const state: PageState = { season: t.next ? t.next.season : 1, want: opts.moreLike ? 'More like this' : 'Overview' };
  const togglePaints: (() => void)[] = [];
  const el = h('div.screen.layer-popup');
  let page: ReturnType<typeof buildPage>;
  const draw = () => {
    togglePaints.length = 0;
    page = buildPage(t, opts, state, togglePaints);
    replace(el, h('div.scrim'), page.popup);
  };
  draw();
  const first = opts.moreLike ? '[data-key="tab-More like this"]' : '[data-key="watch"]';
  const screen: Screen = { label: t.name, el, layer: 'popup', defaultFocus: () => el.querySelector(first) as HTMLElement | null };

  /** Draws again keeping the focus on the same button, card or tab. */
  const keepFocus = (draw: () => void) => {
    const f = shell.focused;
    const key = f && el.contains(f) ? f.getAttribute('data-key') : null;
    draw();
    if (key) {
      const again = el.querySelector(`[data-key="${key.replace(/"/g, '\\"')}"]`) as HTMLElement | null;
      if (again) shell.focus(again);
    }
  };
  // The details, a season or the similar titles arrive after the page opens.
  const stopLive = live.on(() => {
    if (!shell.has(screen)) return;
    const now = live.title(t.id);
    if (now && now !== t && detailed(now)) {
      // Details arriving, or prices laid over the offers: draw the page again.
      if (!detailed(t)) live.wantPrices(now);
      t = now;
      keepFocus(draw);
    } else keepFocus(() => void page.tick());
  });
  // My list, Seen and Favorite changed elsewhere (another title page, later a phone): the buttons follow. Both
  // listeners go when the page leaves the stack, so a closed page can be freed.
  const stopStore = store.on(() => togglePaints.forEach((p) => p()));
  let wasShown = false;
  const stopStack = shell.onChange(() => {
    if (shell.has(screen)) wasShown = true;
    else if (wasShown) {
      stopStore();
      stopLive();
      stopStack();
    }
  });
  return screen;
}
