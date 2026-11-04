// The title page, from hometv-launcher's design_preview/src/screens/preview.ts at 2bf3c2d (Title preview, Option C):
// a popup over the page that opened it, with the essentials and actions on top and tabs for the rest (Overview,
// Episodes, Where to watch, Cast & crew, More like this). Watch and the services open the title in its app through
// the bridge (screens/opening.ts); rent and buy go through the store's dialog (rent.ts).
// Not ported: the loading skeletons and a tab's Retry, which come with data that loads (the TMDB client); the mock
// catalogue is on the TV. The art is the poster: the mock catalogue has no landscape art on Samsung (data/posters.ts).

import { SERVICES } from '@hometv/core/services.ts';
import { bridge } from '../bridge';
import type { ServiceId, Title } from '@hometv/core/types.ts';
import { TITLES } from '../data/catalog';
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

/** Up to eight titles that share genres with `t`, best first. */
export function similar(t: Title): Title[] {
  return TITLES.filter((o) => o.id !== t.id)
    .map((o) => ({ o, s: o.genres.filter((g) => t.genres.indexOf(g) >= 0).length * 2 + (o.kind === t.kind ? 1 : 0) + o.score / 10 }))
    .filter((x) => x.s >= 2)
    .sort((a, b) => b.s - a.s)
    .slice(0, 8)
    .map((x) => x.o);
}

const isOffline = () => !bridge.platform.online();

/** The title page. `moreLike` opens it on More like this, with focus on that tab. */
export function titlePage(t: Title, opts: { moreLike?: boolean } = {}): Screen {
  store.pushViewed(t.id);
  const isShow = t.kind === 'show';
  const tabs = isShow
    ? ['Overview', 'Episodes', 'Where to watch', 'Cast & crew', 'More like this']
    : ['Overview', 'Where to watch', 'Cast & crew', 'More like this'];
  let active = '';
  let season = t.next ? t.next.season : 1;
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

  const togglePaints: (() => void)[] = [];
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
        // The mock catalogue has no trailer's video id (TMDB's videos): YouTube opens on its home.
        openWith(openPlan('youtube'), `Opening YouTube for the ${t.name} trailer…`);
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

  const whereToWatch = () => {
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
    if (!people.length) return h('div.pv-empty', 'No cast information for this title yet.');
    return h(
      'div.pv-row',
      { 'data-scroll': 'x', 'data-scroll-pad': 0 },
      people.map((c, i) => personCard(c.name, c.role, { group: 'cast', key: `cast-${i}`, isDefault: i === 0, onOk: () => openPerson(c.name) })),
    );
  };

  const more = () =>
    h(
      'div.pv-row',
      { 'data-scroll': 'x', 'data-scroll-pad': 0 },
      similar(t).map((o, i) => miniCard(o, { group: 'similar', key: `sim-${o.id}`, isDefault: i === 0, onOk: () => shell.push(titlePage(o)) })),
    );

  const episodesWrap = h('div.pv-episodes');
  const episodes = () => {
    const seasons = t.seasons || [];
    const list = h('div.pv-row', { 'data-scroll': 'x', 'data-scroll-pad': 0 });
    const paintEpisodes = () => {
      const s = seasons.filter((x) => x.n === season)[0];
      replace(
        list,
        (s ? s.episodes : []).map((e) => {
          const watched = !!t.next && (season < t.next.season || (season === t.next.season && e.n < t.next.episode));
          const upNext = !!t.next && season === t.next.season && e.n === t.next.episode;
          return focusable(
            h(
              `div.episode${upNext ? '.episode--next' : ''}`,
              h('div.episode-num', h('span', `E${e.n}`), upNext ? h('span.badge', 'Up next') : watched ? h('span.episode-seen', { html: icon('check', 20) }) : null),
              h('div.episode-name', e.name),
              h('div.episode-meta', `${runtimeLabel(e.runtime)}${watched ? ' · Watched' : ''}`),
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
    tabEls.forEach((el, i) => el.classList.toggle('is-active', tabs[i] === name));
    replace(content, renderers[name]());
    // F46: More like this holds C cards, taller than the other tabs: the title, buttons and tabs move up for it.
    content.classList.toggle('pv-content--cards', name === 'More like this');
  }
  setTab(opts.moreLike ? 'More like this' : tabs[0]);

  const details = h(
    'div.pv-details',
    h('span', String(t.year)),
    h('span.dot', '·'),
    h('span', t.genres.join(', ')),
    h('span.dot', '·'),
    h('span', isShow ? `${(t.seasons || []).length} seasons` : runtimeLabel(t.runtime || 0)),
    h('span.rating', t.rating),
    h('span.score', h('span.star', { html: icon('star', 22, true) }), t.score.toFixed(1)),
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
  const el = h('div.screen.layer-popup', h('div.scrim'), popup);
  const first = opts.moreLike ? '[data-key="tab-More like this"]' : '[data-key="watch"]';
  const screen: Screen = { label: t.name, el, layer: 'popup', defaultFocus: () => popup.querySelector(first) as HTMLElement | null };
  // My list, Seen and Favorite changed elsewhere (another title page, later a phone): the buttons follow. Both
  // listeners go when the page leaves the stack, so a closed page can be freed.
  const stopStore = store.on(() => togglePaints.forEach((p) => p()));
  let wasShown = false;
  const stopStack = shell.onChange(() => {
    if (shell.has(screen)) wasShown = true;
    else if (wasShown) {
      stopStore();
      stopStack();
    }
  });
  return screen;
}
