// Which streaming services the household has, read off the apps installed on the TV: Included means "on a service you
// have", and on a TV that is a service whose app is installed. A pick service (Settings' Streaming services pane) counts
// when an installed app is its Home tile (by the tile's id, so "Max" is HBO Max) or has the same name.
import type { PickService } from '@hometv/core/services.ts';

export interface InstalledApp {
  name: string;
  /** The Home tile the app is (apps.ts keyForName), or null. */
  key: string | null;
}

const bare = (s: string): string => s.toLowerCase().replace(/\s+-\s.*$/, '').replace(/[^a-z0-9+]/g, '');

/** The pick services' ids to tick for the installed apps. `idOfKey` maps a Home tile's key to its service id (appletv to appletvplus). */
export function installedPicks(apps: InstalledApp[], picks: PickService[], idOfKey: Record<string, string>): string[] {
  const names = apps.map((a) => bare(a.name));
  const ids = apps.map((a) => (a.key ? idOfKey[a.key] : undefined));
  return picks
    .filter((p) => ids.some((id) => !!id && (id === p.id || id === p.catalog)) || names.indexOf(bare(p.name)) >= 0)
    .map((p) => p.id);
}
