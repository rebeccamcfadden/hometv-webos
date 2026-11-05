// The TMDB account screen, from the API keys page (v1 only; v1.ts fills routes.account): sign in with a phone by
// scanning a QR code of TMDB's approve page, then the account's name and Sign out. What it says comes from
// account/view.ts; this draws it. Back while a code shows drops the code. No token is ever written on screen.

import './account.css';
import { accounts } from '../account/tv';
import { type ActionId, view } from '../account/view';
import { h, replace } from '../shell/dom';
import { focusable } from '../shell/focus';
import { shell, type Screen } from '../shell/app';
import { qrCanvas } from '../ui/qrCanvas';
import { topBar } from './home';

let open: Screen | null = null;

export function showAccount() {
  if (open && shell.has(open)) return;
  const a = accounts();
  const el = h('div.screen.keys.account');
  el.appendChild(topBar('TMDB account'));
  const qrBox = h('div.qrbox');
  const heading = h('div.acct-head');
  const address = h('div.keyaddr');
  const lines = h('div.acct-lines');
  const row = h('div.lowerrow');
  const cols = h('div.keycols', qrBox, h('div.keyside', heading, address, lines, row));
  el.appendChild(cols);
  el.appendChild(h('p.hint', 'Back: the API keys page. Back while a code shows drops the code.'));

  let confirming = false;
  let shownQr: string | null = '';
  let shownButtons = '';
  let tick = 0;

  function act(id: ActionId) {
    if (id === 'start' || id === 'retry') {
      a.cancel();
      void a.start();
    } else if (id === 'signOut') {
      confirming = true;
      paint();
    } else if (id === 'keepSignedIn') {
      confirming = false;
      paint();
    } else if (id === 'confirmSignOut') {
      confirming = false;
      void a.signOut().then(() => shell.toast('Signed out of TMDB'));
    }
  }

  function paint() {
    const s = a.state();
    if (s.phase !== 'signedIn') confirming = false;
    const v = view(s, confirming);
    if (v.qr !== shownQr) {
      shownQr = v.qr;
      if (v.qr) replace(qrBox, qrCanvas(v.qr, 440, 'L'));
      qrBox.style.display = v.qr ? '' : 'none';
      if (v.qr) qrBox.setAttribute('aria-label', 'QR code to approve this TV on TMDB');
    }
    heading.textContent = v.heading;
    address.textContent = v.address;
    address.style.display = v.address ? '' : 'none';
    replace(lines, ...v.lines.filter(Boolean).map((t) => h('p.acct-line', t)));
    const sig = v.buttons.map((b) => b.id).join(',');
    if (sig !== shownButtons) {
      shownButtons = sig;
      replace(row, ...v.buttons.map((b) => focusable(h('button.button', b.label), { key: 'acct-' + b.id, group: 'acct', onOk: () => act(b.id) })));
      const first = row.firstElementChild as HTMLElement | null;
      if (first && shell.top() === screen) shell.focus(first);
    }
    shell.refocus();
    window.clearTimeout(tick);
    if (s.phase === 'waiting') tick = window.setTimeout(paint, 15000);
  }

  const screen: Screen = {
    label: 'TMDB account',
    el,
    defaultFocus: () => row.firstElementChild as HTMLElement | null,
  };
  open = screen;
  const offState = a.on(() => {
    if (shell.has(screen)) paint();
  });
  const stop = shell.onChange(() => {
    if (shell.has(screen)) return;
    stop();
    offState();
    window.clearTimeout(tick);
    a.showing(false);
    a.cancel();
  });
  shell.push(screen);
  a.showing(true);
  paint();
}
