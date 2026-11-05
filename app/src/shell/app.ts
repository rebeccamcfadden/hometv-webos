// The screen stack, layers, Back, focus and keys, from design_preview's core/app.ts, for a TV remote and
// Chromium 56. The TV's key codes come from the platform (bridge.platform.keys); nothing here is Samsung's. Screens are modules that build an element and say how they handle keys; the shell does the rest.
// Left out from design_preview: the phone remote (on the back burner on Samsung) and the import pill.

import { h } from './dom';
import { type Dir, ensureVisible, findNext, handlerOf, nearest } from './focus';
import { V1 } from '../features';

export type TabId = 'home' | 'movies' | 'tv' | 'search';

/**
 * screen: a full page. popup: drawn over the nearest screen, which stays visible behind a scrim.
 * dialog: drawn over a popup or screen without hiding it.
 */
export type Layer = 'screen' | 'popup' | 'dialog';

export type Key = Dir | 'ok' | 'back';

export interface Screen {
  label: string;
  el: HTMLElement;
  layer?: Layer;
  tab?: TabId;
  defaultFocus?(): HTMLElement | null;
  /** Return true to stop the default handling. */
  onKey?(key: Key, focused: HTMLElement | null): boolean;
  /** OK held down on an item (the hold-OK menus). Return true when used. */
  onLongOk?(focused: HTMLElement | null): boolean;
  /** Printable characters, for screens that take typing (a keyboard paired with the TV). Return true when used. */
  onText?(ch: string): boolean;
  onFocus?(el: HTMLElement): void;
  /** Called each time the screen becomes the top of the stack. */
  onShow?(): void;
  /** Called when a tab's page stops being the current tab, not when something is pushed over it. */
  onLeave?(): void;
  // Managed by the shell.
  memory?: Record<string, HTMLElement>;
  lastFocus?: HTMLElement | null;
  lastFocusKey?: string;
}

export const STAGE_W = 1920;
export const STAGE_H = 1080;
/** How long OK is held before it opens a hold-OK menu, as Android's long press. */
const HOLD_MS = 500;


const onScreen = (el: HTMLElement | null | undefined) => !!el && document.body.contains(el) && el.getClientRects().length > 0;

/**
 * The character a key types, or ''. The remote's number keys (keyCodes 48-57 once registered) may come without a
 * `key` on older TVs, so their keyCode stands in.
 */
const typed = (e: KeyboardEvent): string =>
  e.key && e.key.length === 1 ? e.key : e.keyCode >= 48 && e.keyCode <= 57 ? String.fromCharCode(e.keyCode) : '';

class Shell {
  stage!: HTMLElement;
  scale = 1;
  focused: HTMLElement | null = null;
  private stack: Screen[] = [];
  private tabs: Partial<Record<TabId, Screen>> = {};
  /** The tabs this build has (a v0 build has Home only: features.ts). */
  private factories!: Partial<Record<TabId, () => Screen>> & { home: () => Screen };
  private toastEl!: HTMLElement;
  private toastTimer = 0;
  private lastEl: HTMLElement | null = null;
  /** Layers over every screen that the stack leaves alone (the screensaver). */
  private overlays: HTMLElement[] = [];
  private listeners: (() => void)[] = [];
  private okTimer = 0;
  private okDown = false;
  private okHeld = false;
  private okTarget: HTMLElement | null = null;
  private okScreen: Screen | null = null;
  /** A hold-OK the top screen didn't take, offered on any screen (the title menu on a title card). */
  longOk: ((focused: HTMLElement) => boolean) | null = null;
  /** The remote's arrows, OK and Back by keyCode, from the platform (bridge.platform.keys), set by main.ts. */
  keys: Record<number, Key> = { 37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'ok', 27: 'back' };
  /** Other remote keys by keyCode (colour keys, Info), set by main.ts. */
  extraKeys: Record<number, () => void> = {};

  init(stage: HTMLElement, factories: Partial<Record<TabId, () => Screen>> & { home: () => Screen }, first: TabId = 'home') {
    this.stage = stage;
    this.factories = factories;
    this.toastEl = h('div.toast');
    stage.appendChild(this.toastEl);
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('resize', () => this.fit());
    stage.addEventListener('click', (e) => this.onClick(e));
    this.fit();
    this.goTab(first);
  }

  /** Calls `fn` whenever the stack changes; returns a function that stops it. */
  onChange(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== fn);
    };
  }

  top(): Screen | undefined {
    return this.stack[this.stack.length - 1];
  }

  has(s: Screen): boolean {
    return this.stack.indexOf(s) >= 0;
  }

  tab(id: TabId): Screen {
    // A tab this build doesn't have (v1's in a v0 build) is Home.
    if (!this.factories[id]) id = 'home';
    let s = this.tabs[id];
    if (!s) {
      s = this.factories[id]!();
      s.tab = id;
      this.tabs[id] = s;
    }
    return s;
  }

  goTab(id: TabId, opts: { focusNav?: boolean } = {}) {
    const s = this.tab(id);
    const root = this.stack[0];
    if (root && root !== s && root.onLeave) root.onLeave();
    this.stack = [s];
    this.render();
    if (s.onShow) s.onShow();
    const nav = opts.focusNav ? (s.el.querySelector(`[data-key="nav-${s.tab || id}"]`) as HTMLElement | null) : null;
    this.focus(nav || this.restoreTarget(s));
  }

  push(s: Screen) {
    this.stack.push(s);
    this.render();
    if (s.onShow) s.onShow();
    this.focus(this.restoreTarget(s));
  }

  pop() {
    if (this.stack.length <= 1) return;
    this.stack.pop();
    const s = this.top()!;
    this.render();
    if (s.onShow) s.onShow();
    this.focus(this.restoreTarget(s));
  }

  /** Remove the top screen and push another in its place (a dialog that leads elsewhere). */
  replaceTop(s: Screen) {
    this.stack.pop();
    this.push(s);
  }

  /**
   * Back: the top screen first, then pop, then Home. On Home, Back does nothing: Samsung's remote has its own Home
   * key, which leaves the app.
   */
  back() {
    const s = this.top();
    if (!s) return;
    if (s.onKey && s.onKey('back', this.focused)) return;
    if (this.stack.length > 1) this.pop();
    else if (s.tab && s.tab !== 'home') this.goTab('home', { focusNav: true });
  }

  focus(el: HTMLElement | null | undefined) {
    const s = this.top();
    if (!el || !s) return;
    if (this.focused) this.focused.classList.remove('is-focused');
    el.classList.add('is-focused');
    this.focused = el;
    if (!s.memory) s.memory = {};
    s.lastFocus = el;
    s.lastFocusKey = el.getAttribute('data-key') || undefined;
    const group = el.getAttribute('data-group');
    if (group) s.memory[group] = el;
    ensureVisible(el, this.scale);
    const handler = handlerOf(el);
    if (handler && handler.onFocus) handler.onFocus();
    if (s.onFocus) s.onFocus(el);
  }

  /** Focus survives re-renders by key; falls back to the screen's default. A hidden item is passed over. */
  restoreTarget(s: Screen): HTMLElement | null {
    if (s.lastFocus && s.el.contains(s.lastFocus) && onScreen(s.lastFocus)) return s.lastFocus;
    if (s.lastFocusKey) {
      const el = s.el.querySelector(`[data-key="${CSS.escape(s.lastFocusKey)}"]`) as HTMLElement | null;
      if (onScreen(el)) return el;
    }
    return (s.defaultFocus && s.defaultFocus()) || (s.el.querySelector('[data-focus]') as HTMLElement | null);
  }

  /** Call after a screen re-renders part of itself. */
  refocus() {
    const s = this.top();
    if (!s) return;
    if (onScreen(this.focused) && !this.focused!.closest('[data-inert]')) return;
    this.focus(this.restoreTarget(s));
  }

  /** Puts `el` over every screen, above the toast; the stack's changes leave it in place. */
  overlay(el: HTMLElement) {
    this.overlays.push(el);
    this.stage.appendChild(el);
  }

  /** A message at the foot of the screen for `ms` (longer for one a person has to read, like where a setting is). */
  toast(text: string, bad = false, ms = 2400) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('is-shown');
    this.toastEl.classList.toggle('is-bad', bad);
    // v1 (dev) builds keep the last message small at the top left, so a screenshot taken later still shows what
    // happened. v0 leaves it out: it's a debug line, not for the family.
    if (V1 && !this.lastEl) {
      this.lastEl = h('div.lastaction');
      this.stage.appendChild(this.lastEl);
    }
    if (this.lastEl) this.lastEl.textContent = 'Last: ' + text;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('is-shown'), ms);
  }

  private visible(): Screen[] {
    let base = this.stack.length - 1;
    while (base > 0 && (this.stack[base].layer || 'screen') !== 'screen') base--;
    const out = [this.stack[base]];
    const above = this.stack.slice(base + 1);
    const lastPopup = above.map((s) => s.layer).lastIndexOf('popup');
    above.forEach((s, i) => {
      if (s.layer === 'dialog' || i === lastPopup) out.push(s);
    });
    return out.filter(Boolean);
  }

  private render() {
    const show = this.visible();
    const children = Array.prototype.slice.call(this.stage.children) as HTMLElement[];
    for (const child of children) {
      if (child !== this.toastEl && child !== this.lastEl && this.overlays.indexOf(child) < 0 && !show.some((s) => s.el === child)) this.stage.removeChild(child);
    }
    for (const s of show) this.stage.insertBefore(s.el, this.toastEl);
    this.listeners.forEach((fn) => fn());
  }

  /** A D-pad move on the top screen: the screen sees it first. Left and Right on the nav stay on it. */
  move(dir: Dir) {
    const s = this.top();
    if (!s) return;
    if (!this.focused || !s.el.contains(this.focused) || !onScreen(this.focused)) {
      this.focus(this.restoreTarget(s));
      return;
    }
    const bar = this.focused.closest('.nav');
    if (bar && (dir === 'left' || dir === 'right')) {
      const n = nearest(bar, this.focused, dir);
      if (n) this.focus(n);
      return;
    }
    if (s.onKey && s.onKey(dir, this.focused)) return;
    const next = this.intoNav(findNext(s.el, this.focused, dir, s.memory || {}));
    if (next) this.focus(next);
  }

  /** Spatial move limited to `root`, for screens that handle edges themselves. */
  moveWithin(root: Element, dir: Dir): boolean {
    const s = this.top();
    if (!s || !this.focused) return false;
    const next = this.intoNav(findNext(root, this.focused, dir, s.memory || {}));
    if (next) this.focus(next);
    return !!next;
  }

  /** A move from the page into the nav lands on the page's own section. */
  private intoNav(next: HTMLElement | null): HTMLElement | null {
    const bar = next && next.closest('.nav');
    if (!bar || (this.focused && this.focused.closest('.nav'))) return next;
    return (bar.querySelector('.nav-left .is-active') as HTMLElement | null) || next;
  }

  private ok() {
    const s = this.top();
    if (!s) return;
    if (s.onKey && s.onKey('ok', this.focused)) return;
    const handler = handlerOf(this.focused);
    if (handler && handler.onOk) handler.onOk();
  }

  longOkOn(el: HTMLElement | null): boolean {
    const s = this.top();
    if (!s || !el) return false;
    return !!(s.onLongOk && s.onLongOk(el)) || !!(this.longOk && this.longOk(el));
  }

  private onKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = this.keys[e.keyCode];
    const s = this.top();
    if (key === 'ok') {
      // As on Android, OK acts when it's let go, unless it was held long enough to open a hold-OK menu instead.
      e.preventDefault();
      if (e.repeat || this.okDown) return;
      this.okDown = true;
      this.okHeld = false;
      const held = this.focused;
      this.okTarget = held;
      this.okScreen = s || null;
      this.okTimer = window.setTimeout(() => {
        this.okTimer = 0;
        this.okHeld = this.focused === held && this.longOkOn(held);
      }, HOLD_MS);
    } else if (key === 'back') {
      e.preventDefault();
      if (!e.repeat) this.back();
    } else if (key) {
      e.preventDefault();
      this.move(key);
    } else if (s && s.onText && typed(e) && s.onText(typed(e))) {
      // A screen that takes typing (Search) has the printable keys before the remote's extra keys (C opens Checks).
      e.preventDefault();
    } else if (this.extraKeys[e.keyCode]) {
      e.preventDefault();
      this.extraKeys[e.keyCode]();
    }
  }

  private onKeyUp(e: KeyboardEvent) {
    if (this.keys[e.keyCode] !== 'ok' || !this.okDown) return;
    e.preventDefault();
    this.okDown = false;
    clearTimeout(this.okTimer);
    this.okTimer = 0;
    // Only the item OK went down on, on the screen it was on: a move or Back while it was held cancels it.
    const same = this.focused === this.okTarget && this.top() === this.okScreen;
    if (!this.okHeld && same) this.ok();
    this.okHeld = false;
    this.okTarget = null;
    this.okScreen = null;
  }

  private onClick(e: MouseEvent) {
    const s = this.top();
    const el = (e.target as HTMLElement).closest('[data-focus]') as HTMLElement | null;
    if (!s || !el || !s.el.contains(el) || el.closest('[data-inert]')) return;
    this.focus(el);
    this.ok();
  }

  private fit() {
    const viewport = this.stage.parentElement!;
    const w = viewport.clientWidth;
    const hgt = viewport.clientHeight;
    this.scale = Math.min(w / STAGE_W, hgt / STAGE_H);
    this.stage.style.transform = `scale(${this.scale})`;
    this.stage.style.left = `${(w - STAGE_W * this.scale) / 2}px`;
    this.stage.style.top = `${(hgt - STAGE_H * this.scale) / 2}px`;
  }
}

export const shell = new Shell();
