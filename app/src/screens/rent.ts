// The rent/buy dialog (07-prices A), from hometv-launcher's design_preview/src/screens/rent.ts at 2bf3c2d: the store's
// name, an HD/4K switch when it prices both, a big button per price, Cancel, and a line that says payment finishes
// in the store's app, naming a cheaper store when there is one. A price button opens the store's app.

import { appName, SERVICES } from '@hometv/core/services.ts';
import type { Offer, OfferType, Quality, Title } from '@hometv/core/types.ts';
import { cheapest, kr, qualitiesOf, type ServiceOffers } from '../data/offers';
import { shell, type Screen } from '../shell/app';
import { h, replace } from '../shell/dom';
import { focusable } from '../shell/focus';
import { samsungApp } from '../titleLinks';
import { button, chip } from '../ui/widgets';
import { openWith } from './opening';
import { cheaperElsewhere, fourKNote } from './rentRules';

export function rentDialog(t: Title, s: ServiceOffers): Screen {
  const name = SERVICES[s.service].name;
  const app = appName(s.service);
  const qualities = qualitiesOf(s);
  const lead = s.rent || s.buy;
  const leadMin = lead ? cheapest(lead) : undefined;
  // The quality the dialog opens on: that of the store's cheapest rental (else purchase), none when nothing is priced.
  let quality: Quality | null = qualities.filter((q) => !!lead && !!lead.prices && lead.prices[q] === leadMin)[0] || qualities[0] || null;

  const qualRow = h('div.qual');
  const prices = h('div.dlg-prices');
  const detail = h('div.dialog-detail');

  const priceButton = (type: OfferType, o: Offer, isDefault: boolean) => {
    const amount = quality && o.prices ? o.prices[quality] : undefined;
    const season = o.seasonal ? ' a season' : '';
    const k = `${type === 'rent' ? 'Rent' : 'Buy'}${season}${quality ? ` · ${quality}` : ''}`;
    const v = amount !== undefined ? kr(amount) : quality ? '–' : 'Price in the app';
    const d = type === 'rent' ? '48 hours to finish once started' : o.seasonal ? `Per season, yours to keep in ${app}` : `Yours to keep in ${app}`;
    return focusable(h('div.pbtn', h('div.k', k), h('div.v', v), h('div.d', d)), {
      group: 'prices',
      key: `p-${type}`,
      isDefault,
      onOk: () => {
        shell.pop();
        openWith({ how: 'app', app: samsungApp(s.service) }, `Opening ${app} to ${type} ${t.name}${quality ? ` in ${quality}` : ''}…`);
      },
    });
  };

  const paint = () => {
    const note = fourKNote(s);
    replace(
      qualRow,
      qualities.length > 1
        ? [
            qualities.map((q) =>
              chip(q, {
                selected: q === quality,
                group: 'qual',
                key: `q-${q}`,
                isDefault: q === quality,
                onOk: () => {
                  quality = q;
                  paint();
                  shell.refocus();
                },
              }),
            ),
            note ? h('span.qual-note', note) : null,
          ]
        : null,
    );
    qualRow.hidden = qualities.length < 2;
    // Only the offers the store has in the chosen quality; both when nothing is priced.
    const shown = ([['rent', s.rent], ['buy', s.buy]] as [OfferType, Offer | undefined][]).filter(
      (x) => !!x[1] && (!quality || (!!x[1].prices && x[1].prices[quality] !== undefined)),
    ) as [OfferType, Offer][];
    replace(prices, shown.map((x, i) => priceButton(x[0], x[1], i === 0)));
    replace(detail, `Payment finishes in the ${app} app.${cheaperElsewhere(t, s)}`);
  };
  paint();

  const cancel = button('Cancel', { key: 'cancel', onOk: () => shell.pop() });
  const el = h(
    'div.screen.layer-dialog',
    h('div.scrim'),
    h('div.dialog.dialog--rent', h('div.dialog-title', `${t.name} on ${name}`), qualRow, prices, h('div.dialog-actions', cancel), detail),
  );
  return {
    label: `${t.name} on ${name}`,
    el,
    layer: 'dialog',
    defaultFocus: () => (prices.querySelector('[data-default]') as HTMLElement | null) || cancel,
  };
}
