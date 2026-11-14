/** list, preview, remove and move. None of them needs Python. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { LICENCES, formatDuration, type Difficulty } from '../../src/songs/model';
import { SongToolError, UsageError } from './errors';
import { jitterText, renderTable } from './format';
import { songFolder, type Layout } from './paths';
import type { Player } from './player';
import type { Prompter } from './prompts';
import { catalogueOf, findCatalogue, moveInIndex, removeFromIndex, unknownSongMessage } from './songIndex';
import { loadDiskLibrary, loadIndex, readMeta, regenerateCredits, saveIndex, writeMeta, type DiskLibrary } from './store';

export function gitAddCommand(id: string): string {
  return `git add public/songs/${id} public/songs/index.json public/CREDITS.md`;
}

// ------------------------------------------------------------------ list

export function libraryTable(library: DiskLibrary): string {
  const rows = library.songs.map((song) => [
    song.catalogueName,
    song.meta.id,
    song.meta.title,
    song.meta.artist,
    song.meta.bpm.toFixed(2),
    jitterText(song.jitterMs),
    LICENCES[song.meta.licence].name,
  ]);
  return renderTable(['Catalogue', 'ID', 'Title', 'Artist', 'BPM', 'Jitter', 'Licence'], rows);
}

export async function listSongs(where: Layout, out: (line: string) => void): Promise<DiskLibrary> {
  const library = await loadDiskLibrary(where);
  if (library.songs.length === 0) out('No songs yet. Add one with: npm run songs -- add <file-or-url>');
  else out(libraryTable(library));
  out('');
  out(
    `Catalogues: ${library.index.catalogues
      .map((catalogue) => `${catalogue.name} (${catalogue.id}) ${catalogue.songIds.length}`)
      .join(', ')}`,
  );
  if (library.problems.length > 0) {
    out('');
    out(`Problems (${library.problems.length}):`);
    for (const problem of library.problems) out(`  - ${problem}`);
  }
  return library;
}

/** Asks which song, when a command was started from the menu or without an id. */
export async function pickSong(ui: Prompter, where: Layout, message: string): Promise<string> {
  const library = await loadDiskLibrary(where);
  if (library.songs.length === 0) throw new SongToolError('The library is empty.');
  return ui.select({
    message,
    options: library.songs.map((song) => ({
      value: song.meta.id,
      label: `${song.meta.title} - ${song.meta.artist}`,
      hint: `${song.catalogueName}, ${song.meta.bpm.toFixed(0)} BPM`,
    })),
  });
}

// ------------------------------------------------------------------ preview

export const PREVIEW_SECONDS = 10;
export const PREVIEW_FADE_SECONDS = 0.5;

/** Where a preview starts: about 30% in, and never so late that the 10 s run off the end. */
export function previewStart(durationSec: number): number {
  return Math.max(0, Math.min(durationSec * 0.3, durationSec - PREVIEW_SECONDS));
}

function cutExcerpt(source: string, target: string, startSec: number): Promise<void> {
  const fadeOut = PREVIEW_SECONDS - PREVIEW_FADE_SECONDS;
  const args = [
    '-y', '-v', 'error',
    '-ss', startSec.toFixed(2), '-t', String(PREVIEW_SECONDS),
    '-i', source,
    '-af', `afade=t=in:st=0:d=${PREVIEW_FADE_SECONDS},afade=t=out:st=${fadeOut}:d=${PREVIEW_FADE_SECONDS}`,
    target,
  ]; // prettier-ignore
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: 'ignore', windowsHide: true });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new SongToolError(`ffmpeg could not cut the preview (exit code ${code}).`))));
  });
}

export async function previewSong(
  where: Layout,
  id: string,
  deps: { ui: Prompter; player: Player; hasFfplay: boolean; hasFfmpeg: boolean },
): Promise<void> {
  const index = await loadIndex(where);
  if (!catalogueOf(index, id)) throw new SongToolError(unknownSongMessage(index, id));
  const meta = await readMeta(where, id);
  const melody = path.join(songFolder(where, id), 'melody.mp3');
  if (!existsSync(melody)) throw new SongToolError(`public/songs/${id}/melody.mp3 is missing.`);
  const start = previewStart(meta.durationSec);
  const what = `10 s of "${meta.title}" (melody stem) from ${formatDuration(start)}`;

  if (deps.hasFfplay) {
    deps.ui.info(`Playing ${what}...`);
    await deps.player.play(melody, { startSec: start, durationSec: PREVIEW_SECONDS, fadeSec: PREVIEW_FADE_SECONDS }).done;
    return;
  }
  if (deps.hasFfmpeg) {
    const excerpt = path.join(where.previewDir, `${id}.wav`);
    await mkdir(where.previewDir, { recursive: true });
    await cutExcerpt(melody, excerpt, start);
    deps.player.play(excerpt);
    deps.ui.info(`ffplay is not installed, so ${what} was opened in the default player: ${excerpt}`);
    return;
  }
  deps.player.play(melody);
  deps.ui.info(`ffplay and ffmpeg are not installed, so the whole melody stem was opened in the default player: ${melody}`);
}

// ------------------------------------------------------------------ remove

export async function removeSong(where: Layout, id: string, deps: { ui: Prompter; yes: boolean }): Promise<boolean> {
  const index = await loadIndex(where);
  const from = catalogueOf(index, id);
  if (!from) throw new SongToolError(unknownSongMessage(index, id));
  const title = await readMeta(where, id).then(
    (meta) => `"${meta.title}" by ${meta.artist}`,
    () => `"${id}"`,
  );

  if (!deps.yes) {
    if (!deps.ui.interactive) throw new UsageError('remove asks before deleting; add --yes to remove without asking.');
    const sure = await deps.ui.confirm({
      message: `Remove ${title} from ${from.name} and delete public/songs/${id}/?`,
      initialValue: false,
    });
    if (!sure) {
      deps.ui.info('Nothing was removed.');
      return false;
    }
  }
  await saveIndex(where, removeFromIndex(index, id).index);
  await rm(songFolder(where, id), { recursive: true, force: true });
  await regenerateCredits(where);
  deps.ui.success(`Removed ${title} (${id}) from ${from.name}.`);
  deps.ui.info(`To commit it: ${gitAddCommand(id)}`);
  return true;
}

// ------------------------------------------------------------------ move

export async function moveSong(
  where: Layout,
  id: string,
  toCatalogueId: string,
  deps: { ui: Prompter; difficulty?: Difficulty },
): Promise<void> {
  const index = await loadIndex(where);
  const from = catalogueOf(index, id);
  if (!from) throw new SongToolError(unknownSongMessage(index, id));
  const to = findCatalogue(index, toCatalogueId);
  const meta = await readMeta(where, id);
  const difficulty = deps.difficulty ?? meta.difficulty;

  if (from.id === to.id && difficulty === meta.difficulty) {
    throw new SongToolError(`"${id}" is already in ${to.name} (${to.id}).`);
  }
  const nextIndex = from.id === to.id ? index : moveInIndex(index, id, to.id).index;
  await writeMeta(where, { ...meta, catalogue: to.id, difficulty });
  await saveIndex(where, nextIndex);
  await regenerateCredits(where);

  const parts = [];
  if (from.id !== to.id) parts.push(`from ${from.name} to ${to.name}`);
  if (difficulty !== meta.difficulty) parts.push(`difficulty ${meta.difficulty} -> ${difficulty}`);
  deps.ui.success(`Moved "${meta.title}" (${id}): ${parts.join(', ')}.`);
  deps.ui.info(`To commit it: ${gitAddCommand(id)}`);
}
