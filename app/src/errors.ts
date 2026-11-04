// The page's side of the error log (report.ts): catches HomeTV's uncaught errors and unhandled promise failures, and
// takes the failures other code reports (an app that didn't open, a download or page-update check that failed, an
// input that didn't show). Everything goes through report.ts's allowlist before it is kept. Nothing is sent anywhere.

import { HOME_APPS } from './apps';
import { addEntry, clean, loadLog, LOG_KEY, saveLog, type ErrorKind, type Known, type LogEntry } from './report';

const known: Known = { apps: HOME_APPS.map((a) => a.key) };

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch (e) {
    return null;
  }
}

let log: LogEntry[] | null = null;
const current = (): LogEntry[] => {
  if (!log) log = loadLog(storage(), known);
  return log;
};

/** Notes a problem. `data` may hold anything: only the allowlisted fields survive (report.ts FIELDS). */
export function recordError(kind: ErrorKind, data: Record<string, unknown> = {}): void {
  try {
    const e = clean(kind, data, known, new Date());
    if (!e) return;
    log = addEntry(current(), e);
    saveLog(storage(), log);
  } catch (err) {
    // The log must never be the page's problem.
  }
}

/** The log, oldest first. */
export const errorLog = (): LogEntry[] => current().slice();

/** Empties the log (the report screen's Clear). */
export function clearErrors(): void {
  log = [];
  try {
    const s = storage();
    if (s) s.removeItem(LOG_KEY);
  } catch (e) {
    // Blocked storage: empty until the page reloads.
  }
}

let loggedCheck: number | null = null;

/**
 * A page-update check that failed (the loader's status, bridge.platform.pageUpdates()): one entry per check, saying
 * only that it was a page update. No address, no version.
 */
export function noteUpdateCheck(s: { checkedAt: number | null; failed: boolean } | null): void {
  if (!s || !s.failed || !s.checkedAt || s.checkedAt === loggedCheck) return;
  loggedCheck = s.checkedAt;
  recordError('fetch_failed', { what: 'page update' });
}

let watching = false;

/** Catches the page's uncaught errors and unhandled promise failures, from here on. */
export function watchErrors(): void {
  if (watching) return;
  watching = true;
  window.addEventListener('error', (ev: ErrorEvent) => {
    // A failed image or script load comes as an error event without a message; those aren't HomeTV's code failing.
    if (!ev || (!ev.message && !ev.error)) return;
    const err = ev.error as { name?: unknown } | undefined;
    recordError('error', { error: err && err.name, code: ev.message, file: ev.filename, line: ev.lineno, col: ev.colno });
  });
  window.addEventListener('unhandledrejection', (ev: Event) => {
    const reason = (ev as unknown as { reason?: { name?: unknown; message?: unknown } }).reason;
    recordError('rejection', { error: reason && reason.name, code: reason && typeof reason === 'object' ? reason.message : reason });
  });
}
