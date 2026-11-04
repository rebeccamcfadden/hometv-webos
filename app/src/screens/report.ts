// "Report a problem" (from Settings › About and the Checks screen): the last problems HomeTV noted on
// this TV (errors.ts, report.ts) as a short report a person can read out, photograph, or scan with a phone. The QR
// holds the report's text itself, so the phone shows it with no page or network behind it. Nothing is sent anywhere.

import './report.css';
import { bridge } from '../bridge';
import { clearErrors, errorLog } from '../errors';
import { V1 } from '../features';
import { reportText, type About } from '../report';
import { h, replace } from '../shell/dom';
import { shell, type Screen } from '../shell/app';
import { qrCanvas } from '../ui/qrCanvas';
import { button } from '../ui/widgets';

/** Entries the QR holds: fewer than the screen, so its squares stay big enough for a phone across the room. */
const QR_ENTRIES = 6;
/** The QR's text at most: about a version-15 code at the lowest correction. */
const QR_MAX = 600;

export function aboutThisTv(): About {
  return {
    build: V1 ? 'v1' : 'v0',
    mode: bridge.mode(),
    brand: bridge.platform.brand,
    os: bridge.platform.os,
    osVersion: bridge.platform.osVersion(),
    engine: (/Chrome\/(\d+)/.exec(navigator.userAgent) || ['', ''])[1],
    screen: `${window.screen.width}x${window.screen.height}`,
  };
}

/** The QR's text: the report with as many of the newest entries as fit QR_MAX. */
export function qrText(about: About, made: Date): string {
  const log = errorLog();
  for (let n = QR_ENTRIES; n >= 0; n--) {
    const text = reportText(log, about, made, n);
    if (text.length <= QR_MAX || n === 0) return text.slice(0, QR_MAX);
  }
  return '';
}

let open: Screen | null = null;

export function showReport(): void {
  if (open && shell.has(open)) return;
  const text = h('pre.report-text');
  const qrBox = h('div.report-qr');
  const count = h('div.report-count');
  const paint = () => {
    const about = aboutThisTv();
    const made = new Date();
    text.textContent = reportText(errorLog(), about, made);
    const n = errorLog().length;
    count.textContent = n ? `${n} problem${n === 1 ? '' : 's'} noted on this TV` : 'No problems noted on this TV';
    let qr: HTMLElement;
    try {
      qr = qrCanvas(qrText(about, made), 480, 'L');
    } catch (e) {
      qr = h('div.report-noqr', 'The report is too long for a code: read it out or take a photo.');
    }
    replace(qrBox, qr, h('div.report-qrnote', 'Scan with a phone’s camera: it shows this report as text.'));
  };
  const back = button('Back', { icon: 'back', small: true, key: 'back', onOk: () => shell.back() });
  const clear = button('Clear the list', {
    key: 'clear',
    onOk: () => {
      clearErrors();
      paint();
      shell.toast('The list is empty');
    },
  });
  const el = h(
    'div.screen.screen--full.report-page',
    back,
    h('h1.page-title', 'Report a problem'),
    h(
      'p.report-lead',
      'HomeTV keeps a short list of its own problems on this TV: which kind, when, and which of Home’s apps. Nothing is sent. To report one, read this out, take a photo, or scan the code.',
    ),
    h('div.report-cols', h('div.report-left', count, text, h('div.report-actions', clear)), qrBox),
  );
  paint();
  open = { label: 'Report a problem', el, defaultFocus: () => back, onShow: paint };
  shell.push(open);
}
