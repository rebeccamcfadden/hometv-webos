import './styles.css';
import './ui/motion.css';
import './ui/uiSize.css';
import { noteUpdateCheck, watchErrors } from './errors';
import { bridge } from './bridge';
import { shell } from './shell/app';
import { homeScreen } from './screens/home';
import { showChecks } from './screens/checks';
import { v1Tabs } from '@v1';
import { initScreensaver } from './ui/screensaver';
import { markSetupDone, pageStorage, prefs, setupDone, SETUP_V1_KEY, UI_SIZE_SCALE } from './launcherSettings';
import { restoreIfEmpty, startKeeping } from './settingsKeep';
import { showSetup } from './screens/setup';
import { routes } from './screens/routes';
import { startUpdateNotice } from './ui/updateNotice';
import { theme } from './theme/theme';
import './ui/themeHome.css';
// After every screen's styles: the themes' variables override the shared tokens of the same specificity.
import './ui/themes.css';
import { rootEdition, startWayOut } from './webos/rootEdition';
import { startRootEndedNotice } from './ui/rootEndedNotice';

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
// Text and UI size (Settings › Text and UI size): one scale for the whole screen, set before the first screen shows.
const applyUiSize = () => {
  stage.setAttribute('data-ui-size', prefs.get().uiSize);
  shell.setUiScale(UI_SIZE_SCALE[prefs.get().uiSize]);
};
applyUiSize();
prefs.on(applyUiSize);
// Theme (Settings › Theme): the colours, type and backdrop on <html>; App logos is the stage's.
theme.init();
const applyLogos = () => stage.setAttribute('data-logos', prefs.get().appLogos);
applyLogos();
prefs.on(applyLogos);

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
  // HomeTV's settings from its service's copy when this page's store is empty (mounted over LG's Home, or after a
  // reinstall): put back, then the page starts again once (settingsKeep.ts); and the copy kept up to date from here on.
  const copy = bridge.platform.settingsCopy();
  if (copy) {
    let once: Storage | null = null;
    try {
      once = window.sessionStorage;
    } catch (e) {
      once = null;
    }
    const start = await restoreIfEmpty(pageStorage(), copy, once);
    if (start.state === 'restored') {
      window.location.reload();
      return;
    }
    // unknown: the service couldn't be asked; nothing is sent this session (an empty store must never replace the copy)
    if (start.state === 'none') startKeeping(pageStorage(), copy, true);
    else if (start.state === 'kept') startKeeping(pageStorage(), copy, !start.copied);
  }
  const serviceFoundMs = Date.now() - t0;
  home.setApps(null);
  // Home's own shade over a theme's backdrop is lighter than every other screen's.
  const markScreen = () => {
    const top = shell.top();
    stage.setAttribute('data-on', top && top.label === 'Home' ? 'home' : 'other');
  };
  shell.onChange(markScreen);
  shell.init(stage, {
    home: () => home,
    ...v1Tabs,
  });
  // F36: the clock screensaver watches Home for idle time and wakes on any key (Settings › Screensaver: off until a time is picked).
  markScreen();
  initScreensaver();
  const homeShownMs = Date.now() - t0;
  bridge.platform.started();
  // The root edition: Home pressed three times puts LG's Home back until the next restart; Settings shows "Use LG's
  // Home" once the service says root/ is here (webos/rootEdition.ts).
  startWayOut((text, bad) => shell.toast(text, !!bad));
  // After an LG update that ended root, HomeTV opened from its tile says so, once per TV software version.
  void rootEdition.refresh().then(() => startRootEndedNotice());
  startUpdateNotice(stage);
  // A failed page-update check goes to the problem log, once per check (the loader checks 10 s after Home, then every 12 h).
  const updateCheck = () => noteUpdateCheck(bridge.platform.pageUpdates());
  window.setInterval(updateCheck, 60000);
  document.addEventListener('visibilitychange', updateCheck);
  // First run, once: where the TV is and the weather place (screens/setup.ts). Home is already there underneath. v1 adds
  // the TMDB key and sign-in; after an update from v0 it shows once more for them, unless the key is already saved.
  const storage = pageStorage();
  const tmdb = routes.tmdbSetup;
  if (!setupDone(storage)) showSetup();
  else if (tmdb && !setupDone(storage, SETUP_V1_KEY))
    void tmdb.keySaved().then((saved) => {
      if (saved) markSetupDone(storage, SETUP_V1_KEY);
      else showSetup();
    });
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
  const src = bridge.appSource();
  const n = bridge.appCount();
  if (bridge.mode() === 'app') shell.toast(src === 'listed' ? `${n} apps on this TV` : src === 'checked' ? `${n} known apps found on this TV` : `${n} known apps (this TV doesn’t say which it has)`);
}

start();
