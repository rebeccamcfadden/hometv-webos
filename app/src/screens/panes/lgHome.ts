// Settings › Use LG's Home, the root edition's level 1 (docs/root-plan.md, The way back): LG's own Home for good from
// the next restart. HomeTV stays an app on its tile and root stays on the TV, unused. A confirm says what happens and
// how to come back (from the laptop: hometv-lg root <tv address> --home-again) before the service does it
// (webos/rootEdition.ts, root/undo-home.sh at-restart). Shown on the root edition only (settings.ts). Also names level 0.
import { h } from '../../shell/dom';
import { button } from '../../ui/widgets';
import { LEVEL0_TEXT, RESTART_TEXT, rootEdition, useLgHome } from '../../webos/rootEdition';
import type { Pane, PaneHost } from './pane';

export const HOME_AGAIN = 'hometv-lg root <tv address> --home-again';

export const lgHomeValue = (): string => {
  const s = rootEdition.get();
  return s && s.chosen ? 'From the next restart' : '';
};

export function lgHomePane(host: PaneHost): Pane {
  let confirming = false;
  let busy = false;
  let problem = '';

  async function confirm() {
    if (busy) return;
    busy = true;
    problem = '';
    host.rerender();
    const why = await useLgHome('at-restart');
    busy = false;
    confirming = false;
    problem = why;
    await rootEdition.refresh();
    host.rerender();
    host.focusKey();
  }

  const pane: Pane = {
    back() {
      if (!confirming) return false;
      confirming = false;
      host.rerender();
      host.focusKey('lghome-open');
      return true;
    },
    render() {
      const s = rootEdition.get();
      const head = [h('div.eyebrow', 'This TV'), h('div.pane-title', 'Use LG’s Home')];
      const comeBack = h('div.pane-note', `To have HomeTV as Home again: on the laptop, ${HOME_AGAIN}, then restart the TV.`);
      const wayOut = h('div.pane-note', `Just for now: ${LEVEL0_TEXT}`);
      if (s && s.chosen) {
        return [
          ...head,
          h('div.pane-sub', 'Chosen. LG’s own Home opens from the next restart; until then HomeTV stays Home.'),
          h('div.pane-note', RESTART_TEXT),
          comeBack,
        ];
      }
      if (!confirming) {
        const open = button('Use LG’s Home…', { icon: 'home', key: 'lghome-open', onOk: () => {
          confirming = true;
          host.rerender();
          host.focusKey('lghome-cancel');
        } });
        open.setAttribute('data-entry', '');
        return [
          ...head,
          h('div.pane-sub', 'The TV opens LG’s own Home again, from the next restart. HomeTV stays an app on its tile.'),
          problem ? h('div.pane-note', `That didn’t work (${problem}). Nothing changed; the laptop can do it instead (docs/root-plan.md, level 1).`) : null,
          h('div.pane-actions', open),
          wayOut,
        ];
      }
      const yes = button(busy ? 'One moment…' : 'Yes, use LG’s Home', { primary: true, key: 'lghome-yes', onOk: () => void confirm() });
      const no = button('Cancel', { key: 'lghome-cancel', onOk: () => pane.back!() });
      no.setAttribute('data-entry', '');
      return [
        ...head,
        h('div.pane-sub', 'What happens:'),
        h('div.pane-note', '· From the next restart the TV opens LG’s own Home. Nothing changes before then.'),
        h('div.pane-note', '· HomeTV stays installed: open it from its tile like any app.'),
        h('div.pane-note', '· Root stays on the TV, unused. HomeTV’s start-up step is removed; nothing of it runs at the start.'),
        comeBack,
        h('div.pane-actions', no, yes),
      ];
    },
  };
  return pane;
}
