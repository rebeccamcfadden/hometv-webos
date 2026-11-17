// The root edition's own updates, HomeTV's side (Settings › Updates): its service looks at the signed release, and
// installs the app and root scripts as root (service/service.js updateCheck, updateInstall, updateStatus; the work in
// service/update.js and update-apply.js). In Developer Mode the service isn't root and says so (root: false).

import type { RootUpdateRecord, RootUpdates } from '../updates';
import { luna, lunaError, onWebOS } from './luna';

const SERVICE = 'luna://com.hometv.app.service';

/** The service's look, or null when it doesn't answer (not a TV, or a service without updates). */
export async function rootUpdateCheck(): Promise<RootUpdates | null> {
  if (!onWebOS()) return null;
  const r = await luna(SERVICE + '/updateCheck', {}, 30000);
  if (!r.returnValue) return null;
  const str = (x: unknown) => (typeof x === 'string' ? x : '');
  return {
    on: !!r.on,
    installed: str(r.installed),
    available: str(r.available) || null,
    failedBefore: str(r.failedBefore) || null,
    refused: str(r.refused),
    error: str(r.error),
    root: !!r.root,
  };
}

/** Install update: '' when the service started it (follow it with rootUpdateStatus), else why not. */
export async function rootUpdateInstall(version: string): Promise<string> {
  if (!onWebOS()) return 'not on a webOS TV';
  const r = await luna(SERVICE + '/updateInstall', { version }, 10000);
  return r.returnValue ? '' : lunaError(r);
}

/** The last root update's record and whether one is running; null when the service doesn't answer. */
export async function rootUpdateStatus(): Promise<{ last: RootUpdateRecord | null; busy: boolean } | null> {
  if (!onWebOS()) return null;
  const r = await luna(SERVICE + '/updateStatus', {}, 5000);
  if (!r.returnValue) return null;
  const last = r.last && typeof r.last === 'object' ? (r.last as RootUpdateRecord) : null;
  return { last, busy: !!r.busy };
}
