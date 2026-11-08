// How a screen opens one that lives in a module not on this branch yet, without an import cycle: the person page is
// ported with Movies and TV Shows (W4, design_preview's screens/person.ts). That module sets `routes.person`.
import { shell } from '../shell/app';

/** v1's TMDB steps in First run (screens/setup.ts): the key from the API keys page, then the account. */
export interface TmdbSetup {
  /** Whether the household's TMDB key is saved on the TV; read from HomeTV's service, so it takes a moment. */
  keySaved(): Promise<boolean>;
  /** The account's name while signed in, '' otherwise. */
  signedInAs(): string;
  /** The API keys page (its QR leads a phone to the key page, which explains getting the key). */
  openKeys(): void;
  /** The TMDB account screen (sign in with a phone). */
  openAccount(): void;
  /** Called when the account changes; returns the way to stop. */
  on(fn: () => void): () => void;
}

export const routes: { person: ((name: string, id: number) => void) | null; account: (() => void) | null; tmdbSetup: TmdbSetup | null } = {
  person: null,
  account: null,
  tmdbSetup: null,
};

/** The person page for TMDB's person `id` (0 when it isn't known), named `name` until it loads. */
export function openPerson(name: string, id = 0) {
  if (routes.person) routes.person(name, id);
  else shell.toast(`${name}: the person page isn’t on Samsung yet.`);
}
