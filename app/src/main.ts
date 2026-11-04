import './styles.css';
import './ui/motion.css';
import { noteUpdateCheck, watchErrors } from './errors';
import { bridge } from './bridge';
import { shell } from './shell/app';
import { homeScreen } from './screens/home';
import { showChecks } from './screens/checks';
import { v1Tabs } from '@v1';
import { initScreensaver } from './ui/screensaver';
import { pageStorage, prefs, setupDone } from './launcherSettings';
import { showSetup } from './screens/setup';
import { startUpdateNotice } from './ui/updateNotice';

// HomeTV for Samsung: the shell (screen stack, focus, keys) and its screens. Home first; Movies, TV Shows and Search are
// its tabs, ported from design_preview.

const t0 = Date.now();
// HomeTV's own errors go to the log on the TV that "Report a problem" shows (nothing is sent).
watchErrors();
const stage = document.getElementById('stage') as HTMLElement;
// Motion (launcherSettings.ts: Settings › Performance and the nav's Settings menu): Reduced drops the scale-ups, Off
// every animation (ui/motion.css).
const applyMotion = () => stage.setAttribute('data-motion', prefs.get().motion);
applyMotion();
prefs.on(applyMotion);

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
  // F36: the clock screensaver watches Home for idle time and wakes on any key (Settings › Screensaver: off until a time is picked).
  initScreensaver();
  const homeShownMs = Date.now() - t0;
  bridge.platform.started();
  startUpdateNotice(stage);
  // A failed page-update check goes to the problem log, once per check (the loader checks 10 s after Home, then every 12 h).
  const updateCheck = () => noteUpdateCheck(bridge.platform.pageUpdates());
  window.setInterval(updateCheck, 60000);
  document.addEventListener('visibilitychange', updateCheck);
  // First run, once: where the TV is and the weather place (screens/setup.ts). Home is already there underneath.
  if (!setupDone(pageStorage())) showSetup();
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
