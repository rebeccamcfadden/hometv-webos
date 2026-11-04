// How a screen opens one that lives in a module not on this branch yet, without an import cycle: the person page is
// ported with Movies and TV Shows (W4, design_preview's screens/person.ts). That module sets `routes.person`.
import { shell } from '../shell/app';

export const routes: { person: ((name: string) => void) | null } = { person: null };

export function openPerson(name: string) {
  if (routes.person) routes.person(name);
  else shell.toast(`${name}: the person page isn’t on Samsung yet.`);
}
