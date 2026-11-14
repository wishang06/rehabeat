import {
  DIFFICULTIES,
  SONG_ID_PATTERN,
  isLicenceId,
  type CatalogueEntry,
  type Difficulty,
  type SongIndex,
  type SongMeta,
} from './model';

/** Where the game serves the library from: public/songs/ in the repo. */
export const SONGS_BASE = '/songs';

/** The song picked when nothing has been picked before. */
export const DEFAULT_SONG_ID = 'past-sadness';

export class SongLibraryError extends Error {}

function fail(where: string, problem: string): never {
  throw new SongLibraryError(`${where}: ${problem}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') fail(where, `"${key}" must be a non-empty string`);
  return value;
}

/** Validates public/songs/index.json, naming the catalogue and field at fault. */
export function parseIndex(value: unknown): SongIndex {
  if (!isRecord(value) || !Array.isArray(value.catalogues)) {
    fail('songs/index.json', 'expected { "catalogues": [...] }');
  }
  if (value.catalogues.length === 0) fail('songs/index.json', 'needs at least one catalogue');

  const listedIn = new Map<string, string>();
  const catalogueIds = new Set<string>();
  const catalogues = value.catalogues.map((entry, index): CatalogueEntry => {
    const at = `songs/index.json catalogues[${index}]`;
    if (!isRecord(entry)) fail(at, 'each catalogue must be an object');
    const id = entry.id;
    const where = typeof id === 'string' ? `${at} (${id})` : at;
    if (typeof id !== 'string' || !SONG_ID_PATTERN.test(id)) {
      fail(where, '"id" must be lowercase words joined by hyphens, like "calm-stretch"');
    }
    if (catalogueIds.has(id)) fail('songs/index.json', `duplicate catalogue id "${id}"`);
    catalogueIds.add(id);

    const name = text(entry, 'name', where);
    const description = typeof entry.description === 'string' ? entry.description : fail(where, '"description" must be a string');
    if (!Array.isArray(entry.songIds) || !entry.songIds.every((songId) => typeof songId === 'string')) {
      fail(where, '"songIds" must be a list of song ids (it may be empty)');
    }
    for (const songId of entry.songIds) {
      const other = listedIn.get(songId);
      if (other !== undefined) fail('songs/index.json', `song "${songId}" is listed in both "${other}" and "${id}"`);
      listedIn.set(songId, id);
    }
    return { id, name, description, songIds: [...entry.songIds] };
  });
  return { catalogues };
}

function positive(record: Record<string, unknown>, key: string, where: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) fail(where, `"${key}" must be a positive number`);
  return value;
}

/**
 * Validates one public/songs/<id>/meta.json. With `folderId`, also checks the
 * song's id matches the folder it was loaded from.
 */
export function parseMeta(value: unknown, folderId?: string): SongMeta {
  const named = isRecord(value) && typeof value.id === 'string' ? value.id : folderId ?? '?';
  const where = `songs/${named}/meta.json`;
  if (!isRecord(value)) fail(where, 'expected an object');

  const id = value.id;
  if (typeof id !== 'string' || !SONG_ID_PATTERN.test(id)) {
    fail(where, '"id" must be lowercase words joined by hyphens, like "past-sadness"');
  }
  if (folderId !== undefined && id !== folderId) fail(where, `"id" is "${id}" but the folder is "${folderId}"`);

  const licence = value.licence;
  if (!isLicenceId(licence)) fail(where, '"licence" must be one of CC0-1.0, CC-BY-3.0, CC-BY-4.0, PD');

  const sourceUrl = text(value, 'sourceUrl', where);
  if (!/^https?:\/\//.test(sourceUrl)) fail(where, '"sourceUrl" must be an http(s) address');

  const difficulty = value.difficulty;
  if (typeof difficulty !== 'string' || !DIFFICULTIES.includes(difficulty as Difficulty)) {
    fail(where, `"difficulty" must be one of ${DIFFICULTIES.join(', ')}`);
  }

  return {
    id,
    title: text(value, 'title', where),
    artist: text(value, 'artist', where),
    licence,
    sourceUrl,
    creditLine: text(value, 'creditLine', where),
    bpm: positive(value, 'bpm', where),
    durationSec: positive(value, 'durationSec', where),
    catalogue: text(value, 'catalogue', where),
    difficulty: difficulty as Difficulty,
  };
}

/** The library as loaded: every catalogue, the songs that loaded, and why any did not. */
export interface Library {
  catalogues: CatalogueEntry[];
  songs: Record<string, SongMeta>;
  problems: string[];
}

async function fetchJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new SongLibraryError(`${url}: HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new SongLibraryError(`${url}: not valid JSON`);
  }
}

/**
 * Loads index.json and every song's meta.json. A broken index is fatal; a
 * broken song is skipped and described in `problems`, so one bad folder
 * cannot take the whole menu down.
 */
export async function loadLibrary(fetchImpl: typeof fetch = fetch, base = SONGS_BASE): Promise<Library> {
  const index = parseIndex(await fetchJson(fetchImpl, `${base}/index.json`));

  const listed = index.catalogues.flatMap((catalogue) =>
    catalogue.songIds.map((songId) => ({ songId, catalogueId: catalogue.id })),
  );
  const loaded = await Promise.all(
    listed.map(async ({ songId, catalogueId }) => {
      try {
        const song = parseMeta(await fetchJson(fetchImpl, `${base}/${songId}/meta.json`), songId);
        if (song.catalogue !== catalogueId) {
          return {
            problem: `songs/${songId}/meta.json says catalogue "${song.catalogue}" but it is listed in "${catalogueId}"`,
          };
        }
        return { song };
      } catch (error) {
        return { problem: `song "${songId}": ${error instanceof Error ? error.message : String(error)}` };
      }
    }),
  );

  const songs: Record<string, SongMeta> = {};
  const problems: string[] = [];
  for (const result of loaded) {
    if ('song' in result && result.song) songs[result.song.id] = result.song;
    else if ('problem' in result && result.problem) problems.push(result.problem);
  }
  return { catalogues: index.catalogues, songs, problems };
}

export interface CatalogueGroup {
  catalogue: CatalogueEntry;
  songs: SongMeta[];
}

/** Catalogues in index order with their loaded songs in listed order. Empty catalogues are kept. */
export function groupByCatalogue(library: Library): CatalogueGroup[] {
  return library.catalogues.map((catalogue) => ({
    catalogue,
    songs: catalogue.songIds.flatMap((songId) => library.songs[songId] ?? []),
  }));
}

/** Where a song's files are served. The stems are `${folder}/drums.mp3` and `${folder}/melody.mp3`. */
export function songUrls(id: string, base = SONGS_BASE) {
  const folder = `${base}/${id}`;
  return { folder, beatmap: `${folder}/beatmap.json`, melody: `${folder}/melody.mp3` };
}
