// The Checks screen for the TV calls (docs/research.md, Open questions for the TV): one button per check, each result written on screen
// (and, under TizenBrew, on the page a phone opens). Pushed over Home; Back returns.

import { bridge, type Result } from '../bridge';
import { h } from '../shell/dom';
import { focusable } from '../shell/focus';
import { shell, type Screen } from '../shell/app';
import { topBar } from './home';
import { showReport } from './report';

interface CheckDef {
  label: string;
  name: string;
  params?: Record<string, unknown>;
  /** Leaves HomeTV (an app opens): say so before running. */
  leaves?: boolean;
}

const CHECKS: CheckDef[] = [
  { label: '1. About this TV', name: 'info' },
  { label: '2. Which apps the TV lists', name: 'apps' },
  { label: '3. Phone reached the TV?', name: 'phone' },
  { label: '4. Netflix title: app control', name: 'linkAppControl', params: { app: 'netflix' }, leaves: true },
  { label: '5. Netflix title: remote socket', name: 'linkRemote', params: { app: 'netflix' }, leaves: true },
  { label: '6. YouTube video: DIAL', name: 'linkDial', params: { app: 'youtube' }, leaves: true },
  { label: '7. YouTube video: app control', name: 'linkAppControl', params: { app: 'youtube' }, leaves: true },
  { label: '8. Prime Video title: app control', name: 'linkAppControl', params: { app: 'prime' }, leaves: true },
  { label: '9. Prime Video title: remote socket', name: 'linkRemote', params: { app: 'prime' }, leaves: true },
];

export function summary(r: Result): string {
  const d = r.detail as Record<string, unknown>;
  if (r.check === 'info' && d && d.mode === 'own app') return `${d.model || '?'} · ${bridge.platform.os} ${d.osVersion || '?'} · Chromium ${d.chromium || '?'}`;
  if (r.check === 'info' && d) return `${d.model || '?'} · ${bridge.platform.os} ${d.osVersion || '?'} · Node ${d.node} · up ${d.serviceUpMinutes} min`;
  if (r.check === 'apps' && d) return r.ok ? `${d.count} apps listed; known: ${Object.keys((d.known as object) || {}).join(', ') || 'none'}` : `not listed: ${d.error}`;
  if (r.check === 'phone' && d) return r.ok ? `yes, ${d.visits} visit(s)` : 'not yet: open the link on the phone first';
  if (r.check === 'timing' && d) return `Home in ${d.homeShownMs} ms · Chromium ${d.chromium || '?'} · ${d.screen}`;
  if (d && d.error) return String(d.error);
  if (d && d.note) return String(d.note);
  return r.ok ? 'done' : 'failed';
}

let open: Screen | null = null;

export function showChecks() {
  if (open && shell.has(open)) return;
  const el = h('div.screen.checks');
  el.appendChild(topBar('Checks for the TV call'));
  const addr = bridge.addresses();
  const link = addr.length ? `http://${addr[0]}:8766/report` : 'http://<the TV’s address>:8766/report';
  el.appendChild(
    h('p.phonelink' + (bridge.problem() ? '.after-problem' : ''), bridge.mode() === 'app' ? 'Results stay on this TV; read them out or take a photo.' : `On a phone on the same Wi-Fi, open ${link}`),
  );
  const list = h('div.checklist');
  const log = h('div.log');
  el.appendChild(h('div.cols', list, log));

  const renderLog = async () => {
    const results = await bridge.results();
    while (log.firstChild) log.removeChild(log.firstChild);
    log.appendChild(h('h3', 'Results (newest first)'));
    results
      .slice(-12)
      .reverse()
      .forEach((r) => {
        log.appendChild(
          h('div.result.' + (r.ok ? 'ok' : 'bad'), h('span.rcheck', `${new Date(r.at).toTimeString().slice(0, 8)} ${r.check}`), h('span.rtext', summary(r))),
        );
      });
  };

  CHECKS.forEach((c, i) => {
    list.appendChild(
      focusable(h('button.button.wide', c.label + (c.leaves ? '  ↗' : '')), {
        key: 'check-' + i,
        group: 'checks',
        onOk: async () => {
          if (c.leaves) {
            shell.toast(
              bridge.mode() === 'app'
                ? 'This opens another app. HomeTV comes back when it closes (or open HomeTV from Apps).'
                : 'This may open another app. Come back to HomeTV afterwards (open TizenBrew again).',
            );
          } else shell.toast('Checking…');
          const r = await bridge.check(c.name, c.params);
          shell.toast(`${r.ok ? 'Done' : 'Didn’t work'}: ${summary(r)}`, !r.ok);
          renderLog();
        },
      }),
    );
  });
  list.appendChild(focusable(h('button.button.wide', 'Report a problem'), { key: 'report', group: 'checks', onOk: showReport }));
  el.appendChild(h('p.hint', '↗ opens another app. Back: Home.'));

  open = { label: 'Checks', el };
  shell.push(open);
  renderLog();
}
