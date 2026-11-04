// The nav's Wi-Fi and Inputs menus, from hometv-launcher's design_preview/src/screens/dropdown.ts at 2bf3c2d
// (wifiMenu, inputsMenu, topBarButton), on what a Samsung can tell a page (bridge.platform, docs/platform.md):
// - Wi-Fi: how the TV is connected (Wi-Fi with its network's name and signal, a cable, or not at all) and whether the
//   TV says it's online. A Samsung page can't list or switch saved networks, so design_preview's saved-network rows
//   aren't here; "Other networks" and "Wi-Fi settings" open the TV's network settings, or say where they are.
// - Inputs: the TV's HDMI ports with the device's name when the TV knows it, the other ports, then Live TV. OK shows
//   an HDMI input full screen inside HomeTV (Back returns), or hands Live TV to Samsung's own viewer.

import { bridge } from '../bridge';
import type { NetState, TvInput, TvPage } from '../platform';
import { recordError } from '../errors';
import { shell, type Screen } from '../shell/app';
import { h } from '../shell/dom';
import { icon, type IconName } from '../ui/icons';
import { dropdown, type MenuRow } from './dropdown';

/** The top-bar button a menu hangs from, on whichever page is showing. */
export function topBarButton(key: string): HTMLElement | null {
  const top = shell.top();
  return top ? (top.el.querySelector(`[data-key="${key}"]`) as HTMLElement | null) : null;
}

/** Opens the TV's own settings page, or says where it is. */
export function openTvPage(page: TvPage, what: string): void {
  bridge.platform.openTvSettings(page).then((opened) => {
    if (opened) shell.toast(`Opening the TV’s settings… ${bridge.platform.settingsWhere(page)}`, false, 6000);
    else shell.toast(`${what}: ${bridge.platform.settingsWhere(page)}`, false, 8000);
  });
}

// ---- Wi-Fi ----

let net: NetState = { kind: 'unknown', signal: null, name: '', online: true };
let netAsked = false;

/**
 * Paints every nav's Wi-Fi icon on the stage. A page's nav is off the stage while another page covers it, so this runs
 * again whenever the stack changes, rather than each icon keeping a listener of its own.
 */
function paintNetIcons() {
  if (!shell.stage) return;
  const icons = shell.stage.querySelectorAll('[data-key="dev-wifi"]');
  const name = netIcon();
  for (let i = 0; i < icons.length; i++) {
    const el = icons[i] as HTMLElement;
    if (el.getAttribute('data-icon') === name) continue;
    el.setAttribute('data-icon', name);
    el.innerHTML = icon(name, 28);
  }
}

function refreshNet(): Promise<NetState> {
  return bridge.platform.network().then((s) => {
    net = s;
    paintNetIcons();
    return s;
  });
}

/** Starts following the connection (once): the TV's change events and HomeTV coming back to the front. No polling. */
function followNet() {
  if (netAsked) return;
  netAsked = true;
  refreshNet();
  bridge.platform.onNetworkChange(() => {
    refreshNet();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshNet();
  });
  shell.onChange(paintNetIcons);
}

/** The nav's icon for the connection: crossed out when offline, a cable for Ethernet. */
export function netIcon(s: NetState = net): IconName {
  if (!s.online || s.kind === 'none') return 'wifiOff';
  return s.kind === 'ethernet' ? 'ethernet' : 'wifi';
}

/** Puts the connection's icon on a nav's Wi-Fi button, which then follows it (paintNetIcons). */
export function paintNetIcon(el: HTMLElement): void {
  const name = netIcon();
  el.setAttribute('data-icon', name);
  el.innerHTML = icon(name, 28);
  followNet();
}

const signalWords = (s: number | null) => (s === null ? '' : s >= 0.66 ? 'Strong signal' : s >= 0.33 ? 'Fair signal' : 'Weak signal');

/** The menu's header: what the TV is connected to, and how. */
export function netHeader(s: NetState): { title: string; sub: string; warn: boolean } {
  if (s.kind === 'none') return { title: 'Not connected', sub: 'No Wi-Fi or cable', warn: true };
  const title = s.kind === 'ethernet' ? 'Ethernet' : s.kind === 'wifi' ? s.name || 'Wi-Fi' : 'Network';
  if (!s.online) return { title, sub: 'Connected · No internet', warn: true };
  if (s.kind === 'unknown') return { title, sub: 'This TV doesn’t say how it’s connected', warn: false };
  const parts = ['Connected'];
  if (s.kind === 'ethernet') parts.push('Cable');
  const signal = signalWords(s.signal);
  if (signal) parts.push(signal);
  return { title, sub: parts.join(' · '), warn: false };
}

export function wifiMenu(anchor: HTMLElement | null): Screen {
  followNet();
  const headIcon = h('span.menu-header-icon');
  const title = h('div.menu-header-title');
  const sub = h('div.menu-header-sub');
  const header = h('div.menu-header', headIcon, h('div', title, sub));
  const paint = (s: NetState) => {
    const head = netHeader(s);
    headIcon.innerHTML = icon(netIcon(s), 34);
    headIcon.classList.toggle('is-warn', head.warn);
    title.textContent = head.title;
    while (sub.firstChild) sub.removeChild(sub.firstChild);
    sub.appendChild(h('span.menu-dot' + (head.warn ? '.is-warn' : '')));
    sub.appendChild(document.createTextNode(head.sub));
  };
  paint(net);
  refreshNet().then(paint);
  const wired = net.kind === 'ethernet';
  return dropdown(
    'Wi-Fi',
    anchor,
    [
      { label: 'Other networks', icon: 'wifi', onOk: () => openTvPage('network', 'To join another network') },
      { label: wired ? 'Network settings' : 'Wi-Fi settings', icon: 'settings', onOk: () => openTvPage('network', 'The TV’s network settings') },
    ],
    { header },
  );
}

// ---- Inputs ----

/** The label a person reads: the device's name when the TV knows it, else the port. */
export const inputLabel = (i: TvInput) => i.device || i.port;

/** What shows while an input is up: nothing of HomeTV's but a line that fades, so the input fills the screen. */
function watchScreen(input: TvInput): Screen {
  const note = h('div.input-watch-note', `${inputLabel(input)} · Back returns to HomeTV`);
  const el = h('div.screen.input-watch', note);
  document.documentElement.classList.add('is-watching');
  // Gone after a few seconds whatever Motion says (its fade is only how it goes), so nothing stays on the picture.
  const noteTimer = window.setTimeout(() => note.classList.add('is-gone'), 5000);
  let left = false;
  const leave = () => {
    if (left) return;
    left = true;
    clearTimeout(noteTimer);
    document.removeEventListener('visibilitychange', onVisible);
    bridge.platform.inputs.leave();
    document.documentElement.classList.remove('is-watching');
    if (shell.has(screen)) shell.pop();
  };
  // Back from another app (the remote's Home, then HomeTV again) finds Home, not the input: as AeroTizen does.
  let wasHidden = false;
  const onVisible = () => {
    if (document.hidden) wasHidden = true;
    else if (wasHidden) leave();
  };
  document.addEventListener('visibilitychange', onVisible);
  const screen: Screen = {
    label: inputLabel(input),
    el,
    defaultFocus: () => null,
    onKey(key) {
      if (key === 'back' || key === 'ok') leave();
      return true;
    },
  };
  return screen;
}

async function showInput(input: TvInput) {
  const label = inputLabel(input);
  shell.toast(`Switching to ${label}…`);
  const r = await bridge.platform.inputs.show(input);
  if (r === '') shell.push(watchScreen(input));
  else if (r === 'left') return;
  else if (r === 'preview') shell.toast(`Preview: on the TV this switches to ${label}.`);
  else {
    recordError('input_failed', { input: input.kind, reason: r });
    shell.toast(`${label} didn’t show: ${r}`, true);
  }
}

/** The Inputs menu's rows for a list: HDMI and the other ports, then Live TV, as design_preview groups them. */
export function inputRows(list: TvInput[] | null): MenuRow[] {
  if (!list || !list.length) {
    return [
      {
        label: list ? 'The TV lists no inputs' : 'The TV’s inputs show here on the TV',
        icon: 'input',
        onOk: () => openTvPage('inputs', 'The TV’s inputs'),
      },
    ];
  }
  let lastKind = '';
  return list.map((i, n) => {
    const row: MenuRow = {
      label: inputLabel(i),
      icon: i.kind === 'hdmi' ? 'hdmi' : i.kind === 'av' ? 'av' : 'liveTv',
      status: i.kind === 'tv' ? undefined : i.device ? `${i.port}${i.connected ? ' · Connected' : ''}` : i.connected ? 'Connected' : undefined,
      good: i.kind !== 'tv' && i.connected,
      divider: n > 0 && i.kind !== lastKind && i.kind !== 'hdmi',
      onOk: () => {
        showInput(i);
      },
    };
    lastKind = i.kind;
    return row;
  });
}

export function inputsMenu(anchor: HTMLElement | null): Promise<Screen> {
  return bridge.platform.inputs.list().then((list) => dropdown('Inputs', anchor, inputRows(list)));
}
