// Home's update notice (design_preview's ui/updateNotice.ts at 2bf3c2d, the install plan, step 5), as it applies on
// Samsung: once per new version, when Home shows with a newer page downloaded and checked, a pill for 8 s, "HomeTV
// 0.0.3 is ready · it shows the next time HomeTV starts" (updates.ts). Never focusable, gone for that version after
// once, and taken away by any screen over Home. Nothing shows outside the installed app (no loader).
import './updateNotice.css';
import { bridge } from '../bridge';
import { pageStorage } from '../launcherSettings';
import { shell } from '../shell/app';
import { h, replace } from '../shell/dom';
import { takeNotice } from '../updates';
import { icon } from './icons';

export function startUpdateNotice(stage: HTMLElement): void {
  const el = h('div.update-notice', { 'aria-live': 'polite', 'aria-hidden': 'true' });
  stage.appendChild(el);
  let hideTimer = 0;
  /** This start's notice, so blocked storage still shows it only once a start. */
  let shown = '';
  const hide = () => {
    window.clearTimeout(hideTimer);
    el.classList.remove('is-shown');
    el.setAttribute('aria-hidden', 'true');
  };
  const show = (version: string) => {
    replace(el, h('span', { html: icon('sync', 22) }), `HomeTV ${version} is ready · it shows the next time HomeTV starts`);
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
    if (!s || !s.next || s.next === shown) return;
    const v = takeNotice(pageStorage(), s);
    shown = s.next;
    if (v) show(v);
  };
  shell.onChange(check);
  // Back from an app, or a check that finished while Home stayed: look again.
  document.addEventListener('visibilitychange', check);
  window.setInterval(check, 60000);
  window.setTimeout(check, 0);
}
