// How a screen opens one that lives in a module not on this branch yet, without an import cycle: the person page is
// ported with Movies and TV Shows (W4, design_preview's screens/person.ts). That module sets `routes.person`.
import { shell } from '../shell/app';

export const routes: { person: ((name: string, id: number) => void) | null; account: (() => void) | null } = { person: null, account: null };

/** The person page for TMDB's person `id` (0 when it isn't known), named `name` until it loads. */
export function openPerson(name: string, id = 0) {
  if (routes.person) routes.person(name, id);
  else shell.toast(`${name}: the person page isn’t on Samsung yet.`);
}
