/** Reading and writing the song library on disk: public/songs/ and public/CREDITS.md. */
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseIndex, parseMeta, SongLibraryError } from '../../src/songs/library';
import { jitterMs, type SongIndex, type SongMeta } from '../../src/songs/model';
import { upsertCreditsSection, type CreditsEntry } from './credits';
import { errorMessage, SongToolError } from './errors';
import { songFolder, type Layout } from './paths';
import { defaultIndex, formatJson, listedIds } from './songIndex';

export const SONG_FILES = ['meta.json', 'beatmap.json', 'drums.mp3', 'melody.mp3'] as const;

export async function readJson(file: string): Promise<unknown> {
  const text = await readFile(file, 'utf8');
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch (error) {
    throw new SongToolError(`${file} is not valid JSON: ${errorMessage(error)}`);
  }
}

/** Writes through a temporary file, so a crash cannot leave half a JSON file behind. */
export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, formatJson(value), 'utf8');
  await rename(temporary, file);
}

/** Loads public/songs/index.json, creating it with the default catalogues if it is not there. */
export async function loadIndex(where: Layout): Promise<SongIndex> {
  if (!existsSync(where.indexPath)) {
    const index = defaultIndex();
    await writeJson(where.indexPath, index);
    return index;
  }
  const value = await readJson(where.indexPath);
  try {
    return parseIndex(value);
  } catch (error) {
    if (error instanceof SongLibraryError) throw new SongToolError(`public/${error.message}`);
    throw error;
  }
}

export async function saveIndex(where: Layout, index: SongIndex): Promise<void> {
  await writeJson(where.indexPath, index);
}

export async function readMeta(where: Layout, id: string): Promise<SongMeta> {
  const file = path.join(songFolder(where, id), 'meta.json');
  if (!existsSync(file)) throw new SongToolError(`public/songs/${id}/meta.json is missing.`);
  try {
    return parseMeta(await readJson(file), id);
  } catch (error) {
    if (error instanceof SongLibraryError) throw new SongToolError(`public/${error.message}`);
    throw error;
  }
}

export async function writeMeta(where: Layout, meta: SongMeta): Promise<void> {
  parseMeta(meta, meta.id); // never write a meta.json the game would reject
  await writeJson(path.join(songFolder(where, meta.id), 'meta.json'), meta);
}

/** Every id in use: listed in index.json, or a folder in public/songs/ (listed or not). */
export async function takenIds(where: Layout, index: SongIndex): Promise<string[]> {
  const folders = existsSync(where.songsDir)
    ? (await readdir(where.songsDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    : [];
  return [...new Set([...listedIds(index), ...folders])];
}

// ------------------------------------------------------------------ the whole library

export interface LoadedSong {
  meta: SongMeta;
  /** The catalogue that lists it in index.json (which meta.catalogue should match). */
  catalogueId: string;
  catalogueName: string;
  jitterMs: number | null;
}

export interface DiskLibrary {
  index: SongIndex;
  /** Songs whose meta.json loads, in catalogue order then listed order. */
  songs: LoadedSong[];
  /** Everything wrong that was found, one line each. */
  problems: string[];
}

async function beatJitter(where: Layout, id: string, problems: string[]): Promise<number | null> {
  const file = path.join(songFolder(where, id), 'beatmap.json');
  if (!existsSync(file)) {
    problems.push(`public/songs/${id}/beatmap.json is missing.`);
    return null;
  }
  try {
    const beatmap = await readJson(file);
    const beats = (beatmap as { beats?: unknown }).beats;
    if (!Array.isArray(beats) || !beats.every((beat) => typeof beat === 'number')) {
      problems.push(`public/songs/${id}/beatmap.json has no "beats" list.`);
      return null;
    }
    return jitterMs(beats);
  } catch (error) {
    problems.push(errorMessage(error));
    return null;
  }
}

export async function loadDiskLibrary(where: Layout): Promise<DiskLibrary> {
  const index = await loadIndex(where);
  const songs: LoadedSong[] = [];
  const problems: string[] = [];

  for (const catalogue of index.catalogues) {
    for (const id of catalogue.songIds) {
      let meta: SongMeta;
      try {
        meta = await readMeta(where, id);
      } catch (error) {
        problems.push(`song "${id}": ${errorMessage(error)}`);
        continue;
      }
      if (meta.catalogue !== catalogue.id) {
        problems.push(
          `public/songs/${id}/meta.json says catalogue "${meta.catalogue}" but index.json lists it in "${catalogue.id}" (the game skips it).`,
        );
      }
      for (const file of ['drums.mp3', 'melody.mp3']) {
        if (!existsSync(path.join(songFolder(where, id), file))) problems.push(`public/songs/${id}/${file} is missing.`);
      }
      songs.push({
        meta,
        catalogueId: catalogue.id,
        catalogueName: catalogue.name,
        jitterMs: await beatJitter(where, id, problems),
      });
    }
  }

  const listed = new Set(listedIds(index));
  for (const id of await takenIds(where, index)) {
    if (!listed.has(id)) problems.push(`public/songs/${id}/ is not listed in index.json (the game ignores it).`);
  }
  return { index, songs, problems };
}

// ------------------------------------------------------------------ credits

export async function regenerateCredits(where: Layout): Promise<void> {
  const library = await loadDiskLibrary(where);
  const entries: CreditsEntry[] = library.songs.map((song) => ({ song: song.meta, catalogueName: song.catalogueName }));
  const existing = existsSync(where.creditsPath) ? await readFile(where.creditsPath, 'utf8') : null;
  const next = upsertCreditsSection(existing, entries);
  if (next !== existing) {
    await mkdir(path.dirname(where.creditsPath), { recursive: true });
    await writeFile(where.creditsPath, next, 'utf8');
  }
}

// ------------------------------------------------------------------ installing

async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch {
    await copyFile(from, to); // e.g. across drives
    await rm(from, { force: true });
  }
}

/**
 * Moves a staged song's beatmap and stems into public/songs/<id>/ and writes its
 * meta.json. Refuses to touch an existing folder. If anything fails, the new folder is
 * removed again.
 */
export async function installSongFiles(where: Layout, staging: string, meta: SongMeta): Promise<string> {
  const folder = songFolder(where, meta.id);
  if (existsSync(folder)) throw new SongToolError(`public/songs/${meta.id}/ already exists; pick another id.`);
  for (const file of ['beatmap.json', 'drums.mp3', 'melody.mp3']) {
    if (!existsSync(path.join(staging, file))) throw new SongToolError(`The staged ${file} is missing from ${staging}.`);
  }
  await mkdir(folder, { recursive: true });
  try {
    for (const file of ['beatmap.json', 'drums.mp3', 'melody.mp3']) {
      await moveFile(path.join(staging, file), path.join(folder, file));
    }
    await writeMeta(where, meta);
  } catch (error) {
    await rm(folder, { recursive: true, force: true });
    throw error;
  }
  return folder;
}
