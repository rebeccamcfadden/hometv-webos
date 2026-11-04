// Movies and TV Shows (V1: the household's imported watchlists), ported from design_preview's screens/library.ts. The
// list chips (All lists, My list, each imported list), Sort (A–Z, recently added, newest, oldest, highest rated),
// Filters (availability, score, genre, length, watch state) and the poster grid, eight across. OK on a card opens the
// title page.
//
// For a weak TV: the grid is drawn only when what it shows changes (a list, a filter, the sort), never on a focus move;
// D-pad moves inside it go by index (shell/grid.ts); posters load only near the screen (ui/widgets.ts posterArt).
//
// Not here yet, and why: the loading and "offline, nothing saved" states and "needs a TMDB account" wait for the TMDB
// client and the account (the catalogue is bundled mock data, always there); the card styles of design_preview's dev
// bar are left out (F46's poster card was chosen); Pick for me (screens/pick.ts) isn't in this port.

import './library.css';
import { bridge } from '../bridge';
import type { Kind, Title } from '@hometv/core/types.ts';
import { TITLES } from '../data/catalog';
import { lists } from '../data/lists';
import { isOwnIncluded, offersOf, subscribedCount } from '../data/offers';
import { store } from '../data/store';
import { shell, type Key, type Screen } from '../shell/app';
import { h, replace } from '../shell/dom';
import { columnsOf, gridMove } from '../shell/grid';
import { icon } from '../ui/icons';
import { button, chip, guide, miniCard, navBar } from '../ui/widgets';
import { dropdown } from './dropdown';
import { activeCount, applyFilters, defaultFilters, filterDefs, summary } from './filterDefs';
import { filtersDrawer } from './filters';
import { recentRanks, SORTS, sortTitles, type SortId } from './librarySort';
import { titlePage } from './title';

/** 'all', or a list id from data/lists.ts. */
type ListChoice = string;

const inList = (t: Title, l: ListChoice) => {
  if (l === 'all') return lists.saved(t);
  const shown = lists.byId(l);
  return !!shown && shown.has(t);
};
const listName = (l: ListChoice) => {
  const shown = l === 'all' ? undefined : lists.byId(l);
  return shown ? shown.name : 'All lists';
};

/** F2: an hour away, the page starts again with no filters, All lists and A–Z. */
const AWAY_MS = 60 * 60 * 1000;

const isOffline = () => !bridge.platform.online();
const isDir = (k: Key): k is 'up' | 'down' | 'left' | 'right' => k === 'up' || k === 'down' || k === 'left' || k === 'right';

export function libraryScreen(kind: Kind): Screen {
  const noun = kind === 'movie' ? 'movies' : 'shows';
  const heading = kind === 'movie' ? 'Movies' : 'TV Shows';
  // The availability filter counts the household's own offers, as design_preview's does (data/offers.ts).
  const defs = filterDefs(kind, { isSeen: store.isSeen, included: isOwnIncluded, rentable: (t) => offersOf(t).some((o) => o.type === 'rent') });
  // F2: the page starts with no filters each time HomeTV starts.
  const filters = defaultFilters();
  let list: ListChoice = 'all';
  // F4: the Sort button's order; A–Z by default.
  let sort: SortId = 'az';
  /** When the page was left, or null while it shows. */
  let leftAt: number | null = null;

  const pool = () => TITLES.filter((t) => t.kind === kind && lists.saved(t));

  const chipsEl = h('div.chips', { 'data-scroll': 'x', 'data-scroll-pad': 48 });
  const scopeEl = h('span.lib-scope-slot');
  const filterSummary = h('span.lib-filter-summary');
  const sortBtnSlot = h('span.lib-btn-slot');
  const filterBtnSlot = h('span.lib-btn-slot');
  const listTitle = h('div.lib-list-title');
  const contextEl = h('div.page-context');
  const listStatus = h('div.lib-list-status');
  const grid = h('div.lib-grid');

  /** Pick for me shows: there is something on the lists to pick from. */
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

  const render = () => {
    const all = pool();
    pickable = all.length > 0;
    pickBtn.style.display = pickable ? '' : 'none';
    // A list gone since falls back to All lists.
    if (list !== 'all' && !lists.byId(list)) list = 'all';
    const choices: ListChoice[] = ['all'].concat(lists.all().map((l) => l.id));
    replace(
      chipsEl,
      h('span.chips-label', 'Imported watchlists'),
      choices.map((c) =>
        chip(`${listName(c)} · ${all.filter((t) => inList(t, c)).length}`, {
          selected: c === list,
          group: 'lists',
          key: `list-${c}`,
          isDefault: c === list,
          onOk: () => {
            list = c;
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
            SORTS.map((s) => ({
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

    const inChosen = all.filter((t) => inList(t, list));
    const recent =
      sort === 'recent'
        ? recentRanks((list === 'all' ? ['my'].concat(lists.imported().map((l) => l.id)) : [list]).map((id) => lists.order(id, all)))
        : undefined;
    const shown = sortTitles(applyFilters(defs, filters, inChosen), sort, recent);
    replace(listTitle, listName(list));
    const count = shown.length === inChosen.length ? `${shown.length} ${noun}` : `${shown.length} of ${inChosen.length} ${noun}`;
    const offline = isOffline();
    replace(
      listStatus,
      offline ? `${count} · prices may be out of date` : shown.length === inChosen.length ? `${count} · Across your services` : `${count} · Filtered`,
    );
    const watchlists = lists.watchlists();
    const services = subscribedCount();
    replace(
      scopeEl,
      offline
        ? h('span.offline-pill', h('span', { html: icon('wifiOff', 24) }), 'Offline · showing your lists as saved')
        : h('span.lib-scope-text', `${watchlists} imported watchlist${watchlists === 1 ? '' : 's'} · All ${services} services`),
    );
    replace(contextEl, `Your collection · ${lists.names()}`);

    if (!inChosen.length) {
      drawGrid(`empty:${list}`, () => [
        h(
          'div.empty',
          h('div.empty-title', `Nothing on ${list === 'all' ? 'your lists' : listName(list)} yet`),
          h('div.empty-note', 'Add titles with + My list on a title page.'),
        ),
      ]);
    } else if (!shown.length) {
      drawGrid(`hidden:${list}:${inChosen.length}:${summary(defs, filters)}`, () => [
        h(
          'div.empty',
          h('div.empty-title', `Your filters hide all ${inChosen.length} ${noun}`),
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
    guide('Illustrative services, scores & availability', 'OK for title details'),
  );

  render();
  const redraw = () => {
    if (shell.top() !== screen) return;
    render();
    shell.refocus();
  };
  // A title page changes My list or Seen while this page shows under it (onShow redraws on the way back).
  store.on(redraw);
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
      // F2: back on the page after more than an hour away, what was set on it starts again, from the top.
      if (leftAt !== null && Date.now() - leftAt > AWAY_MS) {
        for (const d of defs) filters[d.id] = 0;
        list = 'all';
        sort = 'az';
        screen.memory = {};
        screen.lastFocus = null;
        screen.lastFocusKey = undefined;
        page.scrollTop = 0;
      }
      leftAt = null;
      showing = true;
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
      if (f.getAttribute('data-key') === 'list-all') chipsEl.scrollLeft = 0;
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
