// Search, from hometv-launcher's design_preview/src/screens/search.ts at 2bf3c2d: the search bar, the panel with
// recent searches or suggestions over the on-screen keyboard, and the results beside it; → past the keyboard widens
// the results to the full page, ← or Back brings the keyboard back. Typing is the on-screen keyboard, as in
// design_preview: no text field, so the TV's own keyboard never opens. A keyboard paired with the TV and the
// remote's number keys type too (shell onText).
// Not here: the phone remote's typing (on the back burner on Samsung), and the TMDB sign-in state (Samsung has no
// account yet). The catalogue is TMDB's, read through live/; offline comes from the browser's own online state, and
// then Search finds only the titles saved on the TV.

import type { Hit } from '@hometv/core/fuzzy.ts';
import { bridge } from '../bridge';
import type { Title } from '@hometv/core/types.ts';
import { store } from '../data/store';
import { live } from '../live/live';
import type { LiveTitle } from '../live/types';
import { imageUrl, PROFILE_SIZE } from '../live/tmdb';
import { shell, type Screen } from '../shell/app';
import { h, highlight, replace } from '../shell/dom';
import { focusable } from '../shell/focus';
import { icon } from '../ui/icons';
import { button, chip, flag, initials, miniCard, rowOf } from '../ui/widgets';
import { topBar } from './home';
import { showKeys } from './keys';
import { openPerson } from './routes';
import { BROWSE_GENRES, FILTERS, filterLabel, KEY_ROWS, resultItems, runSearch, tidyQuery, TYPEABLE, type Filter, type LiveHit, type Sources } from './searchModel';
import { titlePage } from './title';
import './search.css';

const isOffline = () => !bridge.platform.online();


export function searchScreen(): Screen {
  let query = '';
  let expanded = false;
  let filter: Filter = 'all';
  let hasMatches = false;

  // ---- search bar ----
  const typed = h('span.sb-typed');
  const ghost = h('span.sb-ghost');
  const hint = h('span.sb-hint');
  // Focusable only on the full results, where OK on it brings the keyboard back to edit the query.
  const bar = focusable(h('div.search-bar', h('span.sb-icon', { html: icon('search', 30) }), typed, ghost, h('span.sb-spacer'), hint), {
    key: 'bar',
    onOk: () => collapse(),
  });

  // ---- keyboard ----
  const key = (label: string, onOk: () => void, cls = '') =>
    focusable(h(`div.key${cls}`, label), { group: 'kb', key: `k-${label}`, isDefault: label === 'a', onOk });
  const keyboard = h(
    'div.keyboard',
    KEY_ROWS.map((row) => h('div.key-row', row.split('').map((c) => key(c, () => setQuery(query + c))))),
    h(
      'div.key-row',
      key('Space', () => setQuery(query + ' '), '.key--space'),
      focusable(h('div.key', { html: icon('backspace', 26) }), { group: 'kb', key: 'k-del', onOk: () => setQuery(query.slice(0, -1)) }),
      key('Clear', () => setQuery(''), '.key--clear'),
    ),
  );

  const listHead = h('div.sp-head');
  const list = h('div.sp-list');
  const panel = h('div.search-panel', listHead, list, keyboard);

  const results = h('div.search-results', { 'data-scroll': 'y', 'data-scroll-pad': 40 });
  const viewport = h('div.search-viewport', results, h('div.bottom-fade-local'));

  const el = h('div.screen.search', topBar('Search'), bar, panel, viewport);

  // TMDB is asked about the query only once typing pauses, not for every letter; the screen shows "Searching…" meanwhile.
  let asked = '';
  let askTimer: number | undefined;
  const ASK_AFTER = 350;

  function setQuery(q: string) {
    query = tidyQuery(q);
    if (!query) expanded = false;
    window.clearTimeout(askTimer);
    if (query && query !== asked) {
      askTimer = window.setTimeout(() => {
        asked = query;
        if (shell.top() === screen) render();
      }, ASK_AFTER);
    }
    render();
  }

  const openTitle = (t: Title) => {
    if (query) store.pushRecent(query);
    shell.push(titlePage(t));
  };
  const toPerson = (name: string, id: number) => {
    if (query) store.pushRecent(query);
    openPerson(name, id);
  };

  const listItem = (label: Node | string, tag: string | null, ic: 'clock' | 'search', k: string, onOk: () => void) =>
    focusable(h('div.sp-item', h('span.sp-icon', { html: icon(ic, 22) }), h('span.sp-text', label), tag ? h('span.sp-tag', tag) : null), {
      group: 'list',
      key: k,
      onOk,
    });

  const suggestionAction = (s: Hit) => () => {
    filter = s.kind === 'person' ? 'person' : 'all';
    setQuery(s.label.toLowerCase());
  };

  // Cards are built once per title or person and reused as the query changes, so a key press only moves them and
  // repaints their highlighted names (a weak TV draws 40 of them).
  const cards: Record<string, HTMLElement> = {};

  const resultCard = (hit: Hit, i: number) => {
    // Titles by id (two titles may share a name), people by their TMDB id.
    const person = hit.kind === 'person' ? (hit as LiveHit) : null;
    const k = person ? `r-person-${person.person || person.label}` : `r-title-${hit.title!.id}`;
    let card = cards[k];
    if (!card) {
      if (person) {
        const portrait = h('div.person-portrait', initials(hit.label));
        if (person.photo) portrait.appendChild(h('img', { src: imageUrl(person.photo, PROFILE_SIZE), alt: '' }));
        card = focusable(
          h('div.card.card--mini.card--person', h('div.card-art', portrait, h('div.person-cap', h('div.card-name'), h('div.card-meta', 'Person')))),
          { group: 'grid', key: k, onOk: () => toPerson(hit.label, person.person || 0) },
        );
      } else {
        const t = hit.title!;
        card = miniCard(t, { group: 'grid', key: k, onOk: () => openTitle(t) });
      }
      cards[k] = card;
    }
    const name = card.querySelector(hit.kind === 'person' ? '.card-name' : '.mini-name') as HTMLElement;
    replace(name, highlight(hit.label, hit.match.indices));
    flag(card, 'data-default', i === 0);
    return card;
  };

  const titleRow = (label: string, titles: Title[], group: string) =>
    rowOf(
      label,
      titles.map((t) => {
        const k = `${group}-${t.id}`;
        return cards[k] || (cards[k] = miniCard(t, { group, key: k, onOk: () => openTitle(t) }));
      }),
      // The row runs off the screen's edge; scrolling stops a safe margin short of it so the focused card stays whole.
      96,
    );

  const titlesOf = (ids: string[]) => ids.map((id) => live.title(id)).filter((t): t is LiveTitle => !!t);
  const offlinePill = (text: string) => h('span.offline-pill', h('span', { html: icon('wifiOff', 24) }), h('span', text));

  // The saved titles: My list and the recently viewed ones, as far as the TV has them.
  const savedTitles = () => {
    const seen: Record<string, boolean> = {};
    return titlesOf(store.myListIds().concat(store.viewed())).filter((t) => !seen[t.id] && (seen[t.id] = true));
  };

  function render() {
    const offline = isOffline();
    // A search waits for TMDB when online with a key; without a key, or when TMDB can't be reached, the saved titles answer.
    const waiting = !!query && !offline && query !== asked;
    const view = query && !offline && !waiting ? live.search(query) : null;
    const phase = waiting ? 'loading' : view ? (view.phase === 'nokey' && live.hasKey() ? 'loading' : view.phase) : 'ready';
    const noKey = phase === 'nokey';
    const asking = phase === 'loading';
    const fallback = offline || phase === 'offline' || phase === 'error' || noKey;
    const saved = fallback ? savedTitles() : [];
    const nothingSaved = fallback && saved.length === 0;
    const src: Sources = {
      found: view && phase === 'ready' ? view.value : null,
      saved: fallback ? saved : [],
      genre: (name) => (offline || waiting ? [] : live.genre(name).value),
    };
    const out = runSearch(query, src);
    const res = out.res;
    hasMatches = out.hasMatches;

    // Bar
    typed.classList.toggle('is-placeholder', !query);
    replace(typed, query || 'Search movies, shows, people and genres');
    const top = res ? res.suggestions[0] : undefined;
    replace(ghost, !expanded && top && top.label.toLowerCase() !== query.toLowerCase() ? `→ ${top.label.toLowerCase()}` : '');
    replace(
      hint,
      offline
        ? offlinePill(nothingSaved ? 'Offline' : 'Offline · saved titles only')
        : !expanded && hasMatches
          ? h('span.sb-pill', h('span', { html: icon('chevRight', 20) }), h('span', 'Results'))
          : asking && !res?.titles.length
            ? h('span.sb-pill', h('span', 'Searching…'))
            : '',
    );

    // The panel's list
    if (!query) {
      replace(listHead, 'Recent searches');
      replace(list, store.recent().map((r) => listItem(r, null, 'clock', `li-${r}`, () => setQuery(r))));
    } else {
      replace(listHead, 'Suggestions');
      const sugg = res ? res.suggestions : [];
      replace(
        list,
        sugg.length
          ? sugg.map((s) => listItem(highlight(s.label.toLowerCase(), s.match.indices), s.tag, 'search', `li-${s.kind}-${s.label}`, suggestionAction(s)))
          : h('div.sp-none', 'No suggestions yet'),
      );
    }

    // Results
    if (!offline && !live.hasKey() && !hasMatches) {
      replace(
        results,
        h(
          'div.state',
          h('div.state-icon', { html: icon('search', 48) }),
          h('div.empty-title', 'Add a TMDB key to search'),
          h('div.empty-note.state-note', 'Search reads movies, shows and people from TMDB, which needs your own free key.'),
          h('div.state-actions', button('Add TMDB key', { key: 'search-add-key', primary: true, onOk: () => showKeys() })),
        ),
      );
    } else if (nothingSaved && offline && (!query || !hasMatches)) {
      replace(
        results,
        h(
          'div.state',
          h('div.state-icon', { html: icon('wifiOff', 48) }),
          h('div.empty-title', query ? `No saved titles match “${query}”` : 'You’re offline, and nothing is saved yet'),
          h('div.empty-note.state-note', 'Search needs the internet once to fetch the catalogue. Recent searches still work.'),
          h(
            'div.state-actions',
            // No known way yet to open the TV's network settings from an app (rule 1, in the report).
            button('Wi-Fi settings', {
              key: 'search-wifi',
              onOk: () => shell.toast('Wi-Fi is in the TV’s Settings, under Connection › Network.'),
            }),
          ),
        ),
      );
    } else if (!query) {
      replace(
        results,
        h(
          'div.browse',
          // F46 (2026-11-04): Browse by genre first, then the title rows as C cards.
          h(
            'div.row',
            h('div.row-label', 'Browse by genre'),
            h(
              'div.chips',
              BROWSE_GENRES.map((g) => chip(g, { group: 'genres', key: `g-${g}`, onOk: () => setQuery(g.toLowerCase()) })),
            ),
          ),
          titleRow('Recently viewed', titlesOf(store.viewed()), 'viewed'),
          titleRow('From My list', titlesOf(store.myListIds()), 'mine'),
        ),
      );
    } else if (query && !hasMatches && asking) {
      replace(results, h('div.no-matches', h('div.nm-title', `Searching for “${query}”…`)));
    } else if (!hasMatches) {
      const down = !offline && (phase === 'offline' || phase === 'error');
      replace(
        results,
        h(
          'div.no-matches',
          h('div.nm-title', offline || down ? `No saved titles match “${query}”` : `No matches for “${query}”`),
          h(
            'div.nm-note',
            offline
              ? 'Offline, Search looks only at the titles saved on this TV. The full catalogue needs the internet.'
              : down
                ? 'TMDB could not be reached, so Search looked only at the titles saved on this TV.'
                : 'Try fewer letters, or search for a person or a genre.',
          ),
          titleRow('Recently viewed', titlesOf(store.viewed()), 'viewed'),
        ),
      );
    } else {
      const items = resultItems(res!, filter, query, src.genre);
      replace(
        results,
        h(
          'div.results-head',
          h('span.results-count', `${items.length} result${items.length === 1 ? '' : 's'}${fallback ? ' from saved titles' : ''}`),
          h(
            'div.chips',
            FILTERS.map((x) =>
              chip(x[1], {
                selected: x[0] === filter,
                group: 'filters',
                key: `rf-${x[0]}`,
                isDefault: x[0] === filter,
                onOk: () => {
                  filter = x[0];
                  render();
                },
              }),
            ),
          ),
        ),
        items.length ? h('div.results-grid', items.map(resultCard)) : h('div.nm-note.results-empty', `Nothing under “${filterLabel(filter)}”. Try All.`),
      );
    }

    // Focus zones: while typing with results, the grid is only reachable by pressing → (which widens it).
    el.classList.toggle('is-expanded', expanded);
    flag(bar, 'data-inert', !expanded);
    flag(panel, 'data-inert', expanded);
    flag(viewport, 'data-inert', !!query && hasMatches && !expanded);
    if (shell.top() === screen) shell.refocus();
  }

  /** The first card of the full results, else the first thing in them (a filter chip), else the search bar. */
  const firstResult = () =>
    (results.querySelector('.results-grid [data-focus]') as HTMLElement | null) || (results.querySelector('[data-focus]') as HTMLElement | null) || bar;

  function expand() {
    expanded = true;
    render();
    results.scrollTop = 0;
    shell.focus(firstResult());
  }

  const keyboardFocus = () =>
    (screen.memory && screen.memory.kb && keyboard.contains(screen.memory.kb) ? screen.memory.kb : null) ||
    (keyboard.querySelector('[data-default]') as HTMLElement | null);

  function collapse() {
    expanded = false;
    render();
    shell.focus(keyboardFocus());
  }

  const onNetwork = () => {
    if (shell.top() === screen) render();
  };
  window.addEventListener('online', onNetwork);
  window.addEventListener('offline', onNetwork);
  live.on(onNetwork);

  // Set when Search is left for another tab: the next render puts the panel back without the slide.
  let snap = false;

  const screen: Screen = {
    label: 'Search',
    el,
    // On the full results the keyboard is hidden, so focus that loses its card lands on a result or the bar.
    defaultFocus: () => (expanded ? firstResult() : (keyboard.querySelector('[data-default]') as HTMLElement | null)),
    onShow() {
      bridge.platform.registerButtons(['digits']);
      live.checkKey();
      if (!snap) return render();
      snap = false;
      el.classList.add('is-snapping');
      results.scrollTop = 0;
      render();
      void el.offsetWidth;
      el.classList.remove('is-snapping');
    },
    // Leaving for another tab, or Back to Home, forgets the search, so coming back shows the empty page with focus as
    // on the first visit. A title pushed over Search keeps it.
    onLeave() {
      window.clearTimeout(askTimer);
      query = '';
      filter = 'all';
      expanded = false;
      snap = true;
      screen.memory = {};
      screen.lastFocus = null;
      screen.lastFocusKey = undefined;
    },
    onText(ch) {
      if (!TYPEABLE.test(ch)) return false;
      if (expanded) {
        expanded = false;
        shell.focus(keyboard.querySelector('[data-default]') as HTMLElement | null);
      }
      setQuery(query + ch.toLowerCase());
      return true;
    },
    onKey(k, f) {
      if (k === 'back' && expanded) {
        collapse();
        return true;
      }
      if (k === 'right' && !expanded && f && panel.contains(f)) {
        if (shell.moveWithin(panel, 'right')) return true;
        if (query && hasMatches) expand();
        else shell.moveWithin(viewport, 'right') || shell.moveWithin(el, 'right');
        return true;
      }
      if (k === 'left' && expanded && f && viewport.contains(f)) {
        if (!shell.moveWithin(viewport, 'left')) collapse();
        return true;
      }
      return false;
    },
  };
  render();
  return screen;
}
