// Settings › Updates (Android's launcher has it: design_preview's core/updates.ts at 2bf3c2d): where updates stand,
// Check for updates (on by default: a look at most once a day while Home shows), Check now, and Install update only when
// one is on offer; nothing is downloaded before Install update is pressed. A page update is downloaded and checked by
// the loader, then HomeTV starts again with it (a page that doesn't start twice gives way to the previous one, and its
// version is never offered again). On the rooted edition a new app and its root scripts come through HomeTV's service,
// as root (webos/rootUpdates.ts); in Developer Mode only pages, and plain words that a new app needs the laptop.
import { bridge } from '../../bridge';
import { ago } from '../../clockText';
import { h } from '../../shell/dom';
import { button } from '../../ui/widgets';
import { appLine, offerOf, rootStatusLine, updateLine, type RootUpdateRecord, type RootUpdates } from '../../updates';
import { rootEdition } from '../../webos/rootEdition';
import { rootUpdateCheck, rootUpdateInstall, rootUpdateStatus } from '../../webos/rootUpdates';
import type { Pane, PaneHost } from './pane';

const POLL_MS = 3000;

export function updatesPane(host: PaneHost): Pane {
  let root: RootUpdates | null = null;
  let record: RootUpdateRecord | null = null;
  let looked = false;
  let busy: '' | 'check' | 'install' = '';
  let note = '';
  let poll = 0;

  async function lookRoot() {
    if (!rootEdition.shows()) return;
    root = await rootUpdateCheck();
    const st = await rootUpdateStatus();
    record = st ? st.last : null;
    if (st && st.busy) follow();
  }

  async function checkNow() {
    if (busy) return;
    busy = 'check';
    note = '';
    host.rerender();
    const r = await bridge.platform.pageUpdate.check();
    await lookRoot();
    busy = '';
    if (/^failed/.test(r) && !(root && root.available)) note = 'Couldn’t reach the update server. Check the TV is online, then try again.';
    host.rerender();
    host.focusKey();
  }

  /** Follows the service's update until it's over; a new app reloads this page once it is in. */
  function follow() {
    window.clearTimeout(poll);
    poll = window.setTimeout(async () => {
      const st = await rootUpdateStatus();
      record = st ? st.last : record;
      host.rerender();
      if (st && st.busy) return follow();
      busy = '';
      if (record && record.state === 'done') {
        window.setTimeout(() => bridge.platform.pageUpdate.restart(), 3000);
        return;
      }
      root = await rootUpdateCheck();
      host.rerender();
      host.focusKey();
    }, POLL_MS);
  }

  async function install() {
    const o = offerOf(bridge.platform.pageUpdates(), root);
    if (!o || busy) return;
    busy = 'install';
    note = '';
    host.rerender();
    if (o.kind === 'app') {
      const why = await rootUpdateInstall(o.version);
      if (why) {
        busy = '';
        note = `The update didn’t start (${why}). Nothing changed.`;
        host.rerender();
        return;
      }
      record = { version: o.version, state: 'downloading', note: '' };
      host.rerender();
      return follow();
    }
    const r = await bridge.platform.pageUpdate.install();
    busy = '';
    if (/^downloaded/.test(r)) {
      note = `HomeTV ${o.version} is downloaded and checked. HomeTV starts again with it…`;
      host.rerender();
      window.setTimeout(() => bridge.platform.pageUpdate.restart(), 3000);
      return;
    }
    note = r === 'up to date' ? 'Already up to date.' : `Not installed (${r.replace(/^(refused|failed): /, '')}). Nothing changed.`;
    host.rerender();
    host.focusKey();
  }

  return {
    render() {
      if (!looked) {
        looked = true;
        void lookRoot().then(() => host.rerender());
      }
      const page = bridge.platform.pageUpdates();
      const now = Date.now();
      const o = offerOf(page, root);
      const app = appLine(page, root);
      const status = rootStatusLine(record);
      const checkOn = !page || page.checkOn;
      const installBtn = o && busy !== 'install'
        ? button(`Install update ${o.version}`, { icon: 'sync', primary: true, key: 'upd-install', onOk: () => void install() })
        : null;
      const restartBtn = page && page.next && !o
        ? button('Start HomeTV again now', { icon: 'sync', primary: true, key: 'upd-restart', onOk: () => bridge.platform.pageUpdate.restart() })
        : null;
      const check = button(busy === 'check' ? 'Checking…' : 'Check now', { icon: 'sync', key: 'upd-check', onOk: () => void checkNow() });
      const toggle = button(`Check for updates: ${checkOn ? 'On' : 'Off'}`, {
        key: 'upd-auto',
        onOk: () => {
          bridge.platform.pageUpdate.setCheck(!checkOn);
          host.rerender();
          host.focusKey('upd-auto');
        },
      });
      (installBtn || restartBtn || check).setAttribute('data-entry', '');
      return [
        h('div.eyebrow', 'This TV'),
        h('div.pane-title', 'Updates'),
        h('div.pane-sub', updateLine(page, root, (ms) => ago(ms, now))),
        status ? h('div.pane-note', status) : null,
        app ? h('div.pane-note', app) : null,
        note ? h('div.pane-note', note) : null,
        h('div.pane-actions', installBtn, restartBtn, check),
        h('div.pane-actions', toggle),
        h('div.pane-note', checkOn
          ? 'Check for updates looks once a day while Home shows. Nothing is downloaded until you press Install update.'
          : 'HomeTV doesn’t look for updates by itself. Check now still looks.'),
        page && page.app ? h('div.pane-note', `App ${page.app} · page ${page.page}`) : null,
      ];
    },
  };
}
