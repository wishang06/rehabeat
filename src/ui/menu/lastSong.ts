import { DEFAULT_SONG_ID, type Library } from '../../songs/library';

/** Where the last song picked is remembered between visits. */
export const LAST_SONG_KEY = 'rehabeat.lastSong';

/** The songs that can be picked: a list of ids, or the loaded library. */
export type ValidSongs = readonly string[] | Pick<Library, 'catalogues' | 'songs'>;

function idsOf(valid: ValidSongs): readonly string[] {
  if (Array.isArray(valid)) return valid;
  const library = valid as Pick<Library, 'catalogues' | 'songs'>;
  // Catalogue order, so a fallback lands on the first song the menu shows.
  return library.catalogues.flatMap((catalogue) => catalogue.songIds.filter((id) => Object.hasOwn(library.songs, id)));
}

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * The song picked last time, if it can still be picked. Otherwise
 * DEFAULT_SONG_ID, or the first valid song when the default itself did not
 * load. Never throws.
 */
export function loadLastSong(
  valid: ValidSongs,
  storage: Pick<Storage, 'getItem'> | undefined = safeStorage(),
): string {
  const ids = idsOf(valid);
  let stored: string | null = null;
  try {
    stored = storage?.getItem(LAST_SONG_KEY) ?? null;
  } catch {
    // Storage that refuses reads (some private windows) counts as empty.
  }
  if (stored !== null && ids.includes(stored)) return stored;
  if (ids.length === 0 || ids.includes(DEFAULT_SONG_ID)) return DEFAULT_SONG_ID;
  return ids[0];
}

/** Remembers `id` as the last song picked. Never throws. */
export function saveLastSong(id: string, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try {
    storage?.setItem(LAST_SONG_KEY, id);
  } catch {
    // Private windows can refuse writes; the pick then lasts for this visit only.
  }
}
