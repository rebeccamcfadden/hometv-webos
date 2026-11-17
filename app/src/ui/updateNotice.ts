// Home's update notice (design_preview's ui/updateNotice.ts at 2bf3c2d, the install plan, step 5): once per new
// version on offer, when Home shows, a pill for 8 s, "HomeTV 0.0.3 is available · Settings › Updates" (updates.ts).
// Never focusable, gone for that version after once, and taken away by any screen over Home. Nothing shows outside the
// installed app (no loader). On the rooted edition the service's look (a new app) runs at most once a day too.
import './updateNotice.css';
import { bridge } from '../bridge';
import { pageStorage } from '../launcherSettings';
import { shell } from '../shell/app';
import { h, replace } from '../shell/dom';
import { DAY_MS, offerOf, rootLookDue, takeNotice, type RootUpdates } from '../updates';
import { rootEdition } from '../webos/rootEdition';
import { rootUpdateCheck } from '../webos/rootUpdates';
import { icon } from './icons';

export function startUpdateNotice(stage: HTMLElement): void {
  const el = h('div.update-notice', { 'aria-live': 'polite', 'aria-hidden': 'true' });
  stage.appendChild(el);
  let hideTimer = 0;
  /** This start's notice, so blocked storage still shows it only once a start. */
  let shown = '';
  let root: RootUpdates | null = null;
  /** The service's look this start: at most one a start even when storage can't keep the time. */
  let rootLooked = 0;
  const hide = () => {
    window.clearTimeout(hideTimer);
    el.classList.remove('is-shown');
    el.setAttribute('aria-hidden', 'true');
  };
  const show = (version: string) => {
    replace(el, h('span', { html: icon('sync', 22) }), `HomeTV ${version} is available · Settings › Updates`);
    el.classList.add('is-shown');
    el.setAttribute('aria-hidden', 'false');
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hide, 8000);
  };
  const check = () => {
    // The shell keeps only its screens and toast on the stage: put the pill back after each change.
    if (el.parentNode !== stage) stage.appendChild(el);
    const top = shell.top();
    if (!top || top.label !== 'Home') return hide();
    if (document.hidden) return;
    const s = bridge.platform.pageUpdates();
    const now = Date.now();
    if (rootEdition.shows() && (!rootLooked || now - rootLooked >= DAY_MS) && rootLookDue(pageStorage(), !s || s.checkOn, now)) {
      rootLooked = now;
      void rootUpdateCheck().then((r) => {
        root = r;
        check();
      });
    }
    const o = offerOf(s, root);
    if (!o || o.version === shown) return;
    const v = takeNotice(pageStorage(), o.version);
    shown = o.version;
    if (v) show(v);
  };
  shell.onChange(check);
  // Back from an app, or a check that finished while Home stayed: look again.
  document.addEventListener('visibilitychange', check);
  window.setInterval(check, 60000);
  window.setTimeout(check, 0);
}
