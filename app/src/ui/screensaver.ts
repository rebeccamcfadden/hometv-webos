// F36: the clock screensaver, ported from hometv-launcher's design_preview/src/ui/screensaver.ts at 2bf3c2d (back from
// the old launcher, upstream's ClockScene). The time and date float over a slow coloured glow, or black (launcherSettings.ts).
// Every minute the clock fades out, moves to a new spot and fades in, and the glow follows it and shifts colour, so
// nothing burns in. It starts only on Home, after Home has sat untouched for the chosen time, never over a menu,
// another page, an input or another app. Any key wakes it and is swallowed, so the key that wakes it doesn't also act
// on Home (upstream's rule).
//
// Changes for Samsung: Midnight only, so no 'picture' back; the glow's colour is written as rgba() (no color-mix() in
// Chromium 56); the clock's words are written out (saverModel.ts) rather than toLocale…String; keys by keyCode; the
// phone remote's hook is left out (on the back burner). Light on a 1 GB TV: one opacity fade a minute, and the glow
// steps 16 times over 8 s once a minute rather than animating every frame. With Motion off it just moves.

import './screensaver.css';
import { prefs } from '../launcherSettings';
import { h } from '../shell/dom';
import { shell } from '../shell/app';
import { afterMs, clockText, createIdle, glowBackground, mix, PALETTE } from './saverModel';

const MOVE_MS = 60000;
/** The glow's colour change: 16 steps over 8 s, as the launcher draws it. */
const GLOW_STEPS = 16;
const GLOW_STEP_MS = 500;

/**
 * ?saver=fast (a PC, `npm run dev`): the clock moves every 8 s and "5 min" means 10 s, to review it without waiting;
 * with the screensaver off it counts as 5 min (there is no Settings page to turn it on yet).
 */
const fast = /[?&]saver=fast\b/.test(location.search);
const moveMs = () => (fast ? 8000 : MOVE_MS);

const idle = createIdle(() => Date.now());
let el: HTMLElement | null = null;
let clock!: HTMLElement;
let time!: HTMLElement;
let ampm!: HTMLElement;
let date!: HTMLElement;
let glow!: HTMLElement;
let moveTimer = 0;
/** The fade's halfway point in move(): cleared by hide(), so it can't move the clock in a later showing. */
let fadeTimer = 0;
let tickTimer = 0;
let glowTimers: number[] = [];
let colour = Math.floor(Math.random() * PALETTE.length);
let glowColour = PALETTE[colour];
let gx = 960;
let gy = 540;

function build() {
  time = h('span.saver-time');
  ampm = h('span.saver-ampm');
  date = h('div.saver-date');
  clock = h('div.saver-clock', h('div', time, ampm), date);
  glow = h('div.saver-glow');
  el = h('div.saver', glow, clock);
  el.addEventListener('click', wake);
  shell.overlay(el);
}

function tick() {
  const t = clockText(new Date());
  time.textContent = t.time;
  ampm.textContent = t.ampm;
  date.textContent = t.date;
}

function paintGlow() {
  glow.style.background = glowBackground(glowColour, gx, gy);
}

/** A spot that keeps the whole clock on screen, 10-90% of the room each way, with the glow centred behind it. */
function place() {
  const stage = el!.getBoundingClientRect();
  const box = clock.getBoundingClientRect();
  const scale = shell.scale || 1;
  const w = box.width / scale;
  const hgt = box.height / scale;
  const maxX = Math.max(0, stage.width / scale - w);
  const maxY = Math.max(0, stage.height / scale - hgt);
  const x = maxX * (0.1 + 0.8 * Math.random());
  const y = maxY * (0.1 + 0.8 * Math.random());
  clock.style.left = `${Math.round(x)}px`;
  clock.style.top = `${Math.round(y)}px`;
  gx = x + w / 2;
  gy = y + hgt / 2;
  paintGlow();
}

function setGlow(c: string) {
  glowColour = c;
  paintGlow();
}

function shiftGlow() {
  if (prefs.get().screensaverBack !== 'glow') return;
  const from = glowColour;
  colour = (colour + 1) % PALETTE.length;
  const to = PALETTE[colour];
  for (let i = 1; i <= GLOW_STEPS; i++) {
    glowTimers.push(window.setTimeout(() => setGlow(mix(from, to, i / GLOW_STEPS)), i * GLOW_STEP_MS));
  }
}

/** Fades the clock out, moves it and fades it in; with Motion off it just moves. */
function move() {
  if (prefs.get().motion === 'off') {
    place();
  } else {
    clock.classList.add('is-out');
    fadeTimer = window.setTimeout(() => {
      place();
      clock.classList.remove('is-out');
    }, 900);
  }
  shiftGlow();
  moveTimer = window.setTimeout(move, moveMs());
}

export function showScreensaver() {
  if (idle.isShown()) return;
  if (!el) build();
  idle.show();
  el!.setAttribute('data-back', prefs.get().screensaverBack);
  tick();
  tickTimer = window.setInterval(tick, 15000);
  el!.classList.add('is-shown');
  clock.classList.add('is-out');
  requestAnimationFrame(() => {
    place();
    clock.classList.remove('is-out');
  });
  moveTimer = window.setTimeout(move, moveMs());
}

/** Takes the clock down and stops its timers. */
function stop() {
  if (!el) return;
  el.classList.remove('is-shown');
  clearTimeout(moveTimer);
  clearTimeout(fadeTimer);
  clearInterval(tickTimer);
  glowTimers.forEach((t) => clearTimeout(t));
  glowTimers = [];
}

function wake() {
  if (!idle.isShown()) return;
  idle.hide();
  stop();
}

/**
 * Watches for Home sitting untouched, and wakes the screensaver on any key. Keys are caught before the shell sees
 * them (capture on window), as the launcher's screensaver is its own window on top.
 */
export function initScreensaver() {
  window.addEventListener(
    'keydown',
    (e) => {
      const wasShown = idle.isShown();
      if (!idle.keyDown(e.keyCode)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (wasShown) stop();
    },
    true,
  );
  window.addEventListener(
    'keyup',
    (e) => {
      if (!idle.keyUp(e.keyCode)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );
  window.addEventListener('mousedown', () => idle.touch(), true);
  // Time behind another app isn't idle time on Home: it starts again when HomeTV is back, and a clock up goes away.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      idle.hide();
      stop();
    } else idle.touch();
  });
  window.setInterval(() => {
    const top = shell.top();
    const home = !!top && top.tab === 'home' && (top.layer || 'screen') === 'screen';
    const after = prefs.get().screensaverAfter;
    if (idle.due(afterMs(fast && after === 'off' ? '5' : after, fast), { home, visible: !document.hidden })) showScreensaver();
  }, 1000);
}
