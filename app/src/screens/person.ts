// The person page, from design_preview's screens/person.ts (a stub there too: "Person · not designed yet"): opened from
// a title page's Cast & crew and from Search's People results (through routes.ts, which this module fills). The person's
// photo and best-known titles from TMDB, eight across; OK opens a title page. It opens at once with the name and fills
// in when TMDB answers; offline it shows what was saved, and says so when nothing was.

import './person.css';
import { live } from '../live/live';
import { imageUrl, PROFILE_SIZE } from '../live/tmdb';
import { shell, type Screen } from '../shell/app';
import { h, replace } from '../shell/dom';
import { columnsOf, gridMove } from '../shell/grid';
import { button, initials, miniCard } from '../ui/widgets';
import { routes } from './routes';
import { titlePage } from './title';

export function personScreen(name: string, id: number): Screen {
  const back = button('Back', { icon: 'back', small: true, key: 'back', onOk: () => shell.back() });
  const portrait = h('div.person-portrait', initials(name));
  const known = h('div.row-label.person-known');
  const grid = h('div.person-grid');
  let photo = '';
  let drawn = '';

  const draw = () => {
    const view = id ? live.person(id) : null;
    const list = view && view.value ? view.value.titles : [];
    const url = view && view.value ? imageUrl(view.value.person.photo, PROFILE_SIZE) : null;
    if (url && url !== photo) {
      photo = url;
      const img = h('img', { src: url, alt: '' }) as HTMLImageElement;
      img.onerror = () => img.remove();
      portrait.appendChild(img);
    }
    const phase = view ? (view.phase === 'nokey' && live.hasKey() ? 'loading' : view.phase) : 'error';
    const note =
      phase === 'nokey'
        ? 'Add a TMDB key on the key page to see this person’s titles.'
        : phase === 'loading'
          ? 'Loading…'
          : phase === 'offline'
            ? 'Offline: this person isn’t saved yet.'
            : phase === 'error'
              ? 'TMDB can’t be reached for this person.'
              : 'No titles found.';
    replace(known, list.length ? `Known for · ${list.length} title${list.length === 1 ? '' : 's'}` : note);
    const key = list.map((t) => t.id).join(',');
    if (key === drawn) return;
    drawn = key;
    replace(
      grid,
      list.map((t, i) => miniCard(t, { group: 'known', key: `p-${t.id}`, isDefault: i === 0, onOk: () => shell.push(titlePage(t)) })),
    );
  };

  const el = h(
    'div.screen.screen--full.person-page',
    back,
    h('div.person-hero', portrait, h('div', h('div.eyebrow', 'Person'), h('h1.page-title', name))),
    known,
    h('div.person-scroll', { 'data-scroll': 'y', 'data-scroll-pad': 40 }, grid),
  );
  draw();

  const stopLive = live.on(() => {
    if (!shell.has(screen)) return;
    draw();
    shell.refocus();
  });
  let wasShown = false;
  const stopStack = shell.onChange(() => {
    if (shell.has(screen)) wasShown = true;
    else if (wasShown) {
      stopLive();
      stopStack();
    }
  });

  let cols = 0;
  const screen: Screen = {
    label: name,
    el,
    defaultFocus: () => (grid.querySelector('[data-focus]') as HTMLElement | null) || back,
    onKey(key, f) {
      if (!f || !grid.contains(f) || (key !== 'up' && key !== 'down' && key !== 'left' && key !== 'right')) return false;
      const cards = grid.querySelectorAll('.card') as NodeListOf<HTMLElement>;
      if (!cols) cols = columnsOf(cards);
      const next = gridMove(Array.prototype.indexOf.call(cards, f), cards.length, cols, key);
      if (next !== null) {
        shell.focus(cards[next]);
        return true;
      }
      return key !== 'up';
    },
  };
  return screen;
}

export function showPerson(name: string, id: number): void {
  shell.push(personScreen(name, id));
}

routes.person = showPerson;
