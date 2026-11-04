// Which apps Home's row shows, and in what order: All apps' hold-OK menu adds an app or takes it off (design_preview's
// settings.homeApps). Kept in the page's localStorage under `hometv-home-row`. An entry is a Home tile's key from
// apps.ts ("netflix") or "app:" and the TV's own app id for any other installed app; its name is kept too, so the row
// can draw before the TV has listed its apps. Pure apart from the storage passed in, so tests run it in Node; callers
// pass the row's size, @hometv/core's HOME_ROW_MAX (7).

export const HOME_ROW_KEY = 'hometv-home-row';

export interface RowEntry {
  id: string;
  name: string;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The row as saved, or `defaults` when nothing is saved or what is saved can't be read. */
export function loadRow(storage: KeyValueStore | null, defaults: RowEntry[], max: number): RowEntry[] {
  try {
    const raw = storage && storage.getItem(HOME_ROW_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as unknown;
      if (Array.isArray(saved)) {
        const out: RowEntry[] = [];
        for (const e of saved as RowEntry[]) {
          if (e && typeof e.id === 'string' && e.id && typeof e.name === 'string' && !out.some((x) => x.id === e.id)) out.push({ id: e.id, name: e.name });
        }
        return out.slice(0, max);
      }
    }
  } catch (e) {
    // Blocked or corrupt storage: the default row.
  }
  return defaults.slice();
}

export function saveRow(storage: KeyValueStore | null, row: RowEntry[]): void {
  try {
    if (storage) storage.setItem(HOME_ROW_KEY, JSON.stringify(row));
  } catch (e) {
    // The choice lasts until the page reloads.
  }
}

export const onRow = (row: RowEntry[], id: string) => row.some((e) => e.id === id);

/**
 * Adds the app at the row's end, or takes it off. A full row refuses an addition (design_preview's toast: "Home's row
 * holds 7 apps. Take one off first.").
 */
export function toggleOnRow(row: RowEntry[], entry: RowEntry, max: number): { row: RowEntry[]; result: 'added' | 'removed' | 'full' } {
  if (onRow(row, entry.id)) return { row: row.filter((e) => e.id !== entry.id), result: 'removed' };
  if (row.length >= max) return { row, result: 'full' };
  return { row: row.concat([{ id: entry.id, name: entry.name }]), result: 'added' };
}
