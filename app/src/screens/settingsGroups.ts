// Settings' sections and groups (design_preview's groups, F23, with the sections v0 has), apart from the page so tests
// read them in Node. "Use LG's Home" is on the LG root edition only (webos/rootEdition.ts shows()).

export type SectionId = 'size' | 'theme' | 'performance' | 'screensaver' | 'apps' | 'weather' | 'region' | 'setup' | 'lghome' | 'updates' | 'about';

export const GROUPS: { title: string; items: SectionId[] }[] = [
  { title: 'Home & look', items: ['size', 'theme', 'performance', 'screensaver', 'apps', 'weather'] },
  { title: 'This TV', items: ['region', 'setup', 'lghome', 'updates', 'about'] },
];

/** The groups the page shows: without "Use LG's Home" unless `rootShows`. */
export const groupsNow = (rootShows: boolean) =>
  GROUPS.map((g) => ({ title: g.title, items: g.items.filter((id) => id !== 'lghome' || rootShows) }));
