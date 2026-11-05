// Settings › About, from design_preview's screens/panes/misc.ts aboutPane at 2bf3c2d, as far as it applies on Samsung:
// the version, where updates stand (updates.ts: signed page updates, shown at the next start, so no Install button),
// and Report a problem (not in design_preview: HomeTV's own problem report, screens/report.ts), and in a v1 build TMDB's
// notice. Not here: the catalogue cache, licences and Clear cache.
import { bridge } from '../../bridge';
import { ago } from '../../clockText';
import { V1 } from '../../features';
import { h } from '../../shell/dom';
import { button } from '../../ui/widgets';
import { showReport } from '../report';
import { updateLine } from '../../updates';
import { PAGE_VERSION } from '../../version';
import type { Pane } from './pane';

const RUNS_AS = {
  app: `Its own ${bridge.platform.brand} app`,
  tv: 'A TizenBrew module',
  'fake-tv': 'Fake TV on this PC',
  preview: 'Preview, with no TV',
};

export const aboutPane = (): Pane => ({
  render: () => {
    const u = bridge.platform.pageUpdates();
    const now = Date.now();
    return [
      h('div.eyebrow', 'About'),
      h('div.pane-title', 'HomeTV'),
      h(
        'div.kvs',
        h('div.kv', h('span', 'Version'), h('b', (u && u.page) || PAGE_VERSION || '–')),
        u && u.app ? h('div.kv', h('span', 'App'), h('b', u.app)) : null,
        h('div.kv', h('span', 'Runs as'), h('b', RUNS_AS[bridge.mode()])),
      ),
      h(
        'div.about-updates',
        h('div.perf-title', 'Updates'),
        h('div.about-update-line', updateLine(u, (ms) => ago(ms, now))),
      ),
      // Report a problem: the problems HomeTV noted on this TV, to read out or scan (screens/report.ts).
      h('div.pane-actions', button('Report a problem', { icon: 'alert', key: 'about-report', onOk: showReport })),
      // TMDB's terms ask for this line wherever its data shows, which is v1's screens only.
      V1 ? h('div.pane-credits', 'This product uses the TMDB API but is not endorsed or certified by TMDB.') : null,
      h('div.pane-credits', 'Weather data by Open-Meteo.com (CC BY 4.0). ' + bridge.platform.credits),
    ];
  },
});
