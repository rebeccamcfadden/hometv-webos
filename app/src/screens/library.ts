// Movies and TV Shows (V1), ported from design_preview's screens/library.ts and reading the live catalogue
// (live/live.ts): the list chips (My list, then TMDB's Trending, Popular, Top rated and Now playing or On the air), Sort
// (TMDB's order, A–Z, recently added, newest, oldest, highest rated), Filters (score, genre, watch state) and the poster
// grid, eight across. OK on a card opens the title page.
//
// For a weak TV: the grid is drawn only when what it shows changes (a list, a filter, the sort, an answer arriving),
// never on a focus move; D-pad moves inside it go by index (shell/grid.ts); posters load only near the screen
// (ui/widgets.ts posterArt). Home never waits on this page: it reads what has arrived, and the cache behind it shows the
// last catalogue at once, offline too. Without a TMDB key the page says so and points to the key page; there is no
// sample catalogue.
//
// The Availability and Length filters read each title's details (a list entry has neither), loaded a few at a time
// while one is on (live.prefetch); until a title's details arrive it doesn't pass. TMDB account lists wait for the
// sign-in (M3); the card styles of design_preview's dev bar are left out
// (F46's poster card was chosen); Pick for me (screens/pick.ts) isn't in this port.

import './library.css';
import type { Kind, Title } from '@hometv/core/types.ts';
import { FAVORITES_LIST, FIRST_LIST, HOUSEHOLD_LISTS, lists, SEEN_LIST } from '../data/lists';
import { isOwnIncluded, offersOf } from '../data/offers';
import { store } from '../data/store';
import { live } from '../live/live';
import { parseId } from '../live/tmdb';
import { shell, type Key, type Screen } from '../shell/app';
import { h, replace } from '../shell/dom';
import { columnsOf, gridMove } from '../shell/grid';
import { icon } from '../ui/icons';
import { button, chip, guide, miniCard, navBar } from '../ui/widgets';
import { bridge } from '../bridge';
import { dropdown } from './dropdown';
import { activeCount, applyFilters, defaultFilters, filterDefs, summary } from './filterDefs';
import { filtersDrawer } from './filters';
import { defaultSort, recentRanks, SORTS, sortsFor, sortTitles, type SortId } from './librarySort';
import { showKeys } from './keys';
import { titlePage } from './title';
import type { Phase } from '../live/source';
import { accounts } from '../account/tv';

/** 'my', or a TMDB list id from data/lists.ts. */
type ListChoice = string;

/** The titles on one of the household's lists (data/store.ts). */
const householdIds = (l: ListChoice) => (l === FAVORITES_LIST ? store.favoriteIds() : l === SEEN_LIST ? store.seenIds() : store.myListIds());
const emptyHint = (l: ListChoice) =>
  l === FAVORITES_LIST ? 'Add titles with Favorite on a title page.' : l === SEEN_LIST ? 'Mark titles seen on a title page.' : 'Add titles with + My list on a title page.';

/** F2: an hour away, the page starts again with no filters, the first list and its order. */
const AWAY_MS = 60 * 60 * 1000;

/** Filters that need a title's details (where to watch, runtime), which a list entry doesn't carry. */
const NEEDS_DETAILS = ['availability', 'runtime'];

const isOffline = () => !bridge.platform.online();
const isDir = (k: Key): k is 'up' | 'down' | 'left' | 'right' => k === 'up' || k === 'down' || k === 'left' || k === 'right';

interface Pool {
  phase: Phase;
  titles: Title[];
  stale: boolean;
}

export function libraryScreen(kind: Kind): Screen {
  const noun = kind === 'movie' ? 'movies' : 'shows';
  const heading = kind === 'movie' ? 'Movies' : 'TV Shows';
  const defs = filterDefs(kind, {
    isSeen: store.isSeen,
    included: isOwnIncluded,
    rentable: (t) => offersOf(t).some((o) => o.type === 'rent'),
  });
  // F2: the page starts with no filters each time HomeTV starts.
  const filters = defaultFilters();
  let list: ListChoice = FIRST_LIST;
  // F4: the Sort button's order; TMDB's own on its lists, recently added on My list.
  let sort: SortId = defaultSort(false);
  /** When the page was left, or null while it shows. */
  let leftAt: number | null = null;

  const listName = (l: ListChoice) => {
    const shown = lists.byId(kind, l);
    return shown ? shown.name : 'Trending';
  };

  /** The titles on the chosen list so far, and where the answer stands. */
  const pool = (): Pool => {
    if (HOUSEHOLD_LISTS.indexOf(list) >= 0) {
      const ids = householdIds(list).filter((id) => {
        const p = parseId(id);
        return !!p && p.kind === kind;
      });
      const titles: Title[] = [];
      let phase: Phase = 'ready';
      for (const id of ids) {
        const t = live.title(id);
        if (t) titles.push(t);
        else if (phase === 'ready') phase = live.need(id).phase;
        else live.need(id);
      }
      return { phase: titles.length ? 'ready' : phase, titles, stale: false };
    }
    const v = live.list(kind, list);
    return { phase: v.phase, titles: v.value, stale: v.stale };
  };

  const chipsEl = h('div.chips', { 'data-scroll': 'x', 'data-scroll-pad': 48 });
  const scopeEl = h('span.lib-scope-slot');
  const filterSummary = h('span.lib-filter-summary');
  const sortBtnSlot = h('span.lib-btn-slot');
  const filterBtnSlot = h('span.lib-btn-slot');
  const listTitle = h('div.lib-list-title');
  const contextEl = h('div.page-context');
  const listStatus = h('div.lib-list-status');
  const grid = h('div.lib-grid');

  /** Pick for me shows: there is something on the list to pick from. */
  let pickable = false;
  /** True while onShow renders: the shell focuses the page next. */
  let showing = false;
  /** The titles the grid shows, as drawn, so a render that changes nothing leaves the grid alone. */
  let drawn: string | null = null;
  /** Cards to a row, read off the layout after each draw. */
  let cols = 0;
  const refocus = () => {
    if (!showing) shell.refocus();
  };

  const pickBtn = button('Pick for me', {
    icon: 'shuffle',
    primary: true,
    key: 'pick',
    // Pick for me (design_preview's screens/pick.ts) isn't part of this port.
    onOk: () => shell.toast('Pick for me isn’t on Samsung yet.'),
  });

  const drawGrid = (key: string, build: () => HTMLElement[]) => {
    if (key === drawn) return;
    drawn = key;
    cols = 0;
    replace(grid, build());
  };

  const notice = (title: string, note: string, action?: HTMLElement) => h('div.empty', h('div.empty-title', title), h('div.empty-note', note), action || '');

  const render = () => {
    const mine = HOUSEHOLD_LISTS.indexOf(list) >= 0;
    const view = pool();
    // Before the key has been read, "no key" is only "not yet".
    const phase: Phase = view.phase === 'nokey' && live.hasKey() ? 'loading' : view.phase;
    const all = view.titles;
    pickable = all.length > 0;
    pickBtn.style.display = pickable ? '' : 'none';
    // The order a list doesn't offer falls back to the list's own.
    if (!sortsFor(mine).some((s) => s.id === sort)) sort = defaultSort(mine);
    replace(
      chipsEl,
      h('span.chips-label', 'Lists'),
      lists.all(kind).map((c) =>
        chip(c.name, {
          selected: c.id === list,
          group: 'lists',
          key: `list-${c.id}`,
          isDefault: c.id === list,
          onOk: () => {
            list = c.id;
            render();
            shell.refocus();
          },
        }),
      ),
    );

    const n = activeCount(defs, filters);
    replace(filterSummary, summary(defs, filters) || 'No filters');
    // F4: Sort, a small button beside Filters; OK opens its menu under it.
    const sortBtn: HTMLElement = button(`Sort · ${SORTS.filter((s) => s.id === sort)[0].short}`, {
      icon: 'sort',
      small: true,
      key: 'sort',
      onOk: () =>
        shell.push(
          dropdown(
            'Sort',
            sortBtn,
            sortsFor(mine).map((s) => ({
              label: s.label,
              checked: s.id === sort,
              onOk: () => {
                if (s.id === sort) return;
                sort = s.id;
                render();
              },
            })),
          ),
        ),
    });
    replace(sortBtnSlot, sortBtn);
    replace(
      filterBtnSlot,
      button(n ? `Filters · ${n}` : 'Filters', {
        icon: 'filter',
        small: true,
        key: 'filters',
        onOk: () => shell.push(filtersDrawer(kind, defs, filters, render)),
      }),
    );

    const recent = sort === 'recent' ? recentRanks([householdIds(list)]) : undefined;
    // Availability and Length read details, which a list entry hasn't: while one is on, the list's titles load a few at
    // a time and are judged as they arrive (the ones still loading don't pass).
    const needing = defs.some((d) => NEEDS_DETAILS.indexOf(d.id) >= 0 && (filters[d.id] || 0) !== 0);
    const judged = needing ? all.map((t) => live.title(t.id) || t) : all;
    if (needing) live.prefetch(all.map((t) => t.id));
    const waiting = needing ? live.prefetching(all.map((t) => t.id)) : 0;
    const shown = sortTitles(applyFilters(defs, filters, judged), sort, recent);
    replace(listTitle, listName(list));
    const count = shown.length === all.length ? `${shown.length} ${noun}` : `${shown.length} of ${all.length} ${noun}`;
    const offline = isOffline();
    const old = view.stale || (offline && all.length > 0);
    replace(listStatus, phase !== 'ready' ? '' : waiting ? `Checking ${waiting} titles… · ${count}` : old ? `${count} · as last loaded` : shown.length === all.length ? `${count} · From TMDB` : `${count} · Filtered`);
    replace(
      scopeEl,
      offline
        ? h('span.offline-pill', h('span', { html: icon('wifiOff', 24) }), all.length ? 'Offline · showing the last catalogue' : 'Offline')
        : h('span.lib-scope-text', live.hasKey() ? 'Movies and shows from TMDB' : 'Add a TMDB key to see movies and shows'),
    );
    replace(contextEl, mine ? `Your collection · ${listName(list)}` : 'Browse TMDB');

    if (phase === 'nokey') {
      drawGrid('nokey', () => [
        notice(
          'Add a TMDB key',
          `${heading} come from TMDB. Add your free TMDB key on the key page, and they appear here.`,
          button('Add TMDB key', { small: true, key: 'add-key', primary: true, onOk: () => showKeys() }),
        ),
      ]);
    } else if (phase === 'loading' && !all.length) {
      drawGrid(`loading:${list}`, () => [notice(`Loading ${noun}…`, mine ? 'Looking up your list.' : 'Asking TMDB.')]);
    } else if (phase === 'offline' && !all.length) {
      drawGrid(`offline:${list}`, () => [notice('Offline, and nothing saved yet', `${heading} show here once the TV is online.`)]);
    } else if (phase === 'error' && !all.length) {
      drawGrid(`error:${list}`, () => [
        notice('TMDB can’t be reached', 'Check the TV’s network.', button('Try again', { small: true, key: 'retry', onOk: () => live.retry() })),
      ]);
    } else if (!all.length) {
      drawGrid(`empty:${list}`, () => [
        notice(mine ? `Nothing on ${listName(list)} yet` : `No ${noun} on ${listName(list)}`, mine ? emptyHint(list) : 'Try another list.'),
      ]);
    } else if (!shown.length) {
      drawGrid(`hidden:${list}:${all.length}:${summary(defs, filters)}`, () => [
        h(
          'div.empty',
          h('div.empty-title', `Your filters hide all ${all.length} ${noun}`),
          h('div.empty-note', summary(defs, filters)),
          button('Clear filters', {
            small: true,
            key: 'clear-filters',
            onOk: () => {
              for (const d of defs) filters[d.id] = 0;
              render();
              shell.refocus();
            },
          }),
        ),
      ]);
    } else {
      drawGrid(shown.map((t) => t.id).join(','), () =>
        shown.map((t, i) => miniCard(t, { group: 'grid', key: `t-${t.id}`, isDefault: i === 0, onOk: () => shell.push(titlePage(t)) })),
      );
    }
    refocus();
  };

  const page = h(
    'div.page-scroll',
    { 'data-scroll': 'y', 'data-scroll-pad': 70, 'data-scroll-pad-bottom': 200 },
    h('div.lib-intro', h('div.lib-heading', h('h1.page-title', heading), contextEl), pickBtn),
    h('div.lib-scope', scopeEl, h('span.lib-filters', filterSummary, sortBtnSlot, filterBtnSlot)),
    chipsEl,
    h('div.lib-list-head', listTitle, listStatus),
    grid,
    h('div.page-end'),
  );

  const el = h(
    'div.screen.screen--full.library',
    navBar(kind === 'movie' ? 'movies' : 'tv'),
    page,
    h('div.bottom-fade'),
    guide('Movie and TV data from TMDB; scores are TMDB’s', 'OK for title details'),
  );

  render();
  const redraw = () => {
    if (shell.top() !== screen) return;
    render();
    shell.refocus();
  };
  // A title page changes My list or Seen while this page shows under it (onShow redraws on the way back); the
  // catalogue answering, or the key changing, draws again too.
  store.on(redraw);
  live.on(redraw);
  window.addEventListener('online', redraw);
  window.addEventListener('offline', redraw);

  const screen: Screen = {
    label: heading,
    el,
    defaultFocus: () =>
      (grid.querySelector('[data-default]') as HTMLElement | null) ||
      (grid.querySelector('[data-focus]') as HTMLElement | null) ||
      // Nothing in the grid: Pick for me when there is something to pick, else the selected list chip.
      (pickable ? pickBtn : (chipsEl.querySelector('.chip.is-selected') as HTMLElement | null)),
    onShow: () => {
      // The key page may have just closed: read the key again.
      live.checkKey();
      // F2: back on the page after more than an hour away, what was set on it starts again, from the top.
      if (leftAt !== null && Date.now() - leftAt > AWAY_MS) {
        for (const d of defs) filters[d.id] = 0;
        list = FIRST_LIST;
        sort = defaultSort(false);
        screen.memory = {};
        screen.lastFocus = null;
        screen.lastFocusKey = undefined;
        page.scrollTop = 0;
      }
      leftAt = null;
      showing = true;
      // Signed in to TMDB: My list, Favorites and Seen sync while a list page shows (account/account.ts).
      accounts().shown();
      try {
        render();
      } finally {
        showing = false;
      }
    },
    onLeave: () => {
      if (leftAt === null) leftAt = Date.now();
    },
    // Back on the first chip, the row returns to its start so its label shows again.
    onFocus(f) {
      if (f.getAttribute('data-key') === `list-${FIRST_LIST}`) chipsEl.scrollLeft = 0;
    },
    onKey(key, f) {
      if (!f || !isDir(key)) return false;
      if (grid.contains(f) && f.classList.contains('card')) {
        const cards = grid.querySelectorAll('.card') as NodeListOf<HTMLElement>;
        if (!cols) cols = columnsOf(cards);
        const next = gridMove(Array.prototype.indexOf.call(cards, f), cards.length, cols, key);
        if (next !== null) {
          shell.focus(cards[next]);
          return true;
        }
        // Up from the first row goes on to the chips; the grid's other edges keep focus where it is.
        return key !== 'up';
      }
      // F4: nothing is left of Sort, so ← stays on it.
      if (f.getAttribute('data-key') === 'sort' && key === 'left') return true;
      // The list chips lead to Pick for me: Up from any chip, and Right from the last one.
      if (!chipsEl.contains(f) || !pickable) return false;
      const all = chipsEl.querySelectorAll('[data-focus]');
      if (key === 'up' || (key === 'right' && all[all.length - 1] === f)) {
        shell.focus(pickBtn);
        return true;
      }
      return false;
    },
  };
  // A page pushed over this one (a title page, a person) leaves it too, though onLeave is only for tabs.
  shell.onChange(() => {
    if (!el.isConnected && leftAt === null) leftAt = Date.now();
  });
  return screen;
}
