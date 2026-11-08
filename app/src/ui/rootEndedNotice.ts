// After an LG update that ended root (docs/root-plan.md, When an LG update ends root): HomeTV, opened from its tile on
// a TV where it was the root edition, says once per TV software version that LG's Home is back, HomeTV works as an app
// and nothing is broken, with where to read more. "Don't show again" ends it for good. The decision is
// webos/rootEdition.ts's (rootEnded, takeRootEndedNotice); nothing goes over the network.
import '../screens/title.css';
import { pageStorage } from '../launcherSettings';
import { shell, type Screen } from '../shell/app';
import { h } from '../shell/dom';
import {
  AFTER_UPDATE_URL,
  isLgHome,
  neverRootEndedNotice,
  rootEdition,
  rootEnded,
  takeRootEndedNotice,
  tvFirmware,
} from '../webos/rootEdition';
import { button } from './widgets';

export const ROOT_ENDED_LABEL = 'Root ended';

/** The guide's address as it reads on a TV (no scheme). */
const shortUrl = (u: string) => u.replace(/^https:\/\//, '');

export const ROOT_ENDED_LINES = [
  'HomeTV’s start-up step didn’t run this time, as happens after an LG software update ends root. So the TV opens LG’s own Home again.',
  'HomeTV still works: open it from its tile, like any app.',
  'Nothing is broken: your apps, inputs and settings are as they were.',
  'Choices: leave it as it is; or a reset, then HomeTV as a Developer Mode app; or root again, if a tool exists for the new software.',
];

function dialog(): Screen {
  const storage = pageStorage();
  const ok = button('OK', { primary: true, key: 'rootended-ok', onOk: () => shell.pop() });
  const never = button('Don’t show again', {
    key: 'rootended-never',
    onOk: () => {
      neverRootEndedNotice(storage);
      shell.pop();
    },
  });
  const el = h(
    'div.screen.layer-dialog',
    h('div.scrim'),
    h(
      'div.dialog',
      h('div.dialog-title', 'LG’s Home is back'),
      ...ROOT_ENDED_LINES.map((line) => h('div.dialog-detail', line)),
      h('div.dialog-detail', `Help: ${shortUrl(AFTER_UPDATE_URL)}`),
      h('div.dialog-actions', ok, never),
    ),
  );
  return { label: ROOT_ENDED_LABEL, el, layer: 'dialog', defaultFocus: () => ok };
}

/** Call once the root state is read (rootEdition.refresh()). Shows over Home, now or the next time Home is on top. */
export async function startRootEndedNotice(): Promise<void> {
  if (!rootEnded(rootEdition.get(), isLgHome())) return;
  const firmware = await tvFirmware();
  const show = () => {
    if (takeRootEndedNotice(pageStorage(), firmware)) shell.push(dialog());
  };
  const onHome = () => {
    const top = shell.top();
    return !!top && top.label === 'Home';
  };
  if (onHome()) return show();
  const off = shell.onChange(() => {
    if (!onHome()) return;
    off();
    show();
  });
}
