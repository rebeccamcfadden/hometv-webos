// Settings › Region and first run's Region step, from design_preview's screens/panes/region.ts at 2bf3c2d. On Samsung
// HomeTV keeps one region at a time, chosen by the person (decided 2026-11-04: one region, no two-region offers):
// Sweden or the United States. It decides whose streaming services, stores and prices show, and, until °C or °F is
// chosen, the temperature unit. Not set until the person chooses.
import { h } from '../../shell/dom';
import { prefs, REGION_LABELS, REGIONS, type Region } from '../../launcherSettings';
import { segmented } from '../../ui/segmented';
import type { Pane } from './pane';

export const regionPane = (): Pane => ({
  render: () => {
    const r = prefs.get().region;
    return [
      h('div.eyebrow', 'Region'),
      h('div.pane-title', 'Where is this TV?'),
      h('div.pane-sub', 'HomeTV shows one country’s streaming services, stores and prices: this TV’s.'),
      h(
        'div.pane-seg',
        segmented<Region>({
          options: REGIONS.map((x): [Region, string] => [x, REGION_LABELS[x]]),
          get: () => prefs.get().region,
          set: (x) => prefs.set({ region: x }),
          group: 'seg-region',
          entry: true,
        }),
      ),
      h(
        'div.pane-note',
        r === 'us'
          ? 'US streaming services and stores, prices in dollars, temperatures in °F unless you choose °C.'
          : r === 'se'
            ? 'Swedish streaming services and stores, prices in kronor, temperatures in °C unless you choose °F.'
            : 'Not chosen yet. OK on a country chooses it.',
      ),
      h('div.pane-note', 'One country at a time. Changing it starts that country’s choices afresh.'),
    ];
  },
});
