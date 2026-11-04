import './styles.css';
import { bridge } from './bridge';
import { shell } from './shell/app';
import { homeScreen } from './screens/home';
import { showChecks } from './screens/checks';
import { v1Tabs } from '@v1';

// HomeTV for Samsung: the shell (screen stack, focus, keys) and its screens. Home first; Movies, TV Shows and Search are
// its tabs, ported from design_preview.

const t0 = Date.now();
const stage = document.getElementById('stage') as HTMLElement;

const home = homeScreen();

const { keys, buttons } = bridge.platform;
shell.keys = keys;
shell.extraKeys = {
  [buttons.blue]: showChecks,
  [buttons.info]: showChecks,
  67: showChecks, // C on a PC keyboard
};
bridge.platform.registerButtons(['blue', 'info']);

async function start() {
  bridge.setToast((text) => shell.toast(text, /didn’t|refused|failed/i.test(text)));
  await bridge.connect();
  const serviceFoundMs = Date.now() - t0;
  home.setApps(null);
  shell.init(stage, {
    home: () => home,
    ...v1Tabs,
  });
  const homeShownMs = Date.now() - t0;
  bridge.platform.started();
  if (bridge.mode() === 'app') shell.toast(`Home in ${homeShownMs} ms · ${(/Chrome\/(\d+)/.exec(navigator.userAgent) || ['', '?'])[1]}`);
  if (bridge.mode() === 'tv' || bridge.mode() === 'fake-tv') {
    bridge.check('timing', {
      homeShownMs,
      serviceFoundMs,
      userAgent: navigator.userAgent,
      screen: `${window.innerWidth}x${window.innerHeight}`,
    });
  }
  home.setApps(await bridge.apps());
  if (bridge.mode() === 'app') shell.toast(`${bridge.appCount()} apps on this TV`);
}

start();
