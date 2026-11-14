/**
 * Adding a song: one flow for both the interactive questions and --yes. Every question
 * goes through deps.ui, Python through deps.pipeline and playback through deps.player,
 * so the tests can script the whole thing without a terminal.
 *
 * Work is staged in tools/out/staging/<id>/ and only moved into public/songs/<id>/ once
 * the user keeps it; anything that stops the flow deletes the staged files.
 */
import { existsSync, statSync } from 'node:fs';
import { copyFile, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  buildCreditLine,
  catalogueForBpm,
  checkLicence,
  DIFFICULTIES,
  difficultyForBpm,
  formatDuration,
  isPlayableBpm,
  LICENCES,
  MAX_BPM,
  MIN_BPM,
  SONG_ID_PATTERN,
  slugify,
  tempoFix,
  uniqueSlug,
  type Difficulty,
  type LicenceId,
  type SongIndex,
  type SongMeta,
} from '../../src/songs/model';
import { deleteOnExit, release } from './cleanup';
import { downloadAudio } from './download';
import { SongToolError, UsageError } from './errors';
import { bpmText, fieldLines, jitterText, megabytes, signedDb } from './format';
import { cleanInputPath, isHttpUrl, repoRelative, stagingFolder, type Layout } from './paths';
import type { AnalyzeReport, Pipeline, PreflightReport, StemsReport } from './pipeline';
import type { Player, PlayHandle } from './player';
import { titleFromFileName, type ProbeInfo } from './probe';
import { clock, describeStemsProgress, type DemucsProgress } from './progress';
import type { Prompter, Validate } from './prompts';
import { addToIndex, findCatalogue } from './songIndex';
import { installSongFiles, loadIndex, readJson, regenerateCredits, saveIndex, takenIds } from './store';

export interface AddOptions {
  input?: string;
  title?: string;
  artist?: string;
  licence?: string;
  sourceUrl?: string;
  id?: string;
  catalogue?: string;
  difficulty?: Difficulty;
  bpmHint?: number;
  maxJitter: number;
  keepSource: boolean;
  yes: boolean;
}

export interface AddDeps {
  layout: Layout;
  ui: Prompter;
  pipeline: Pipeline;
  /** One line per missing requirement (with its fix) for a preflight report; empty if all is well. */
  requirementProblems(report: PreflightReport): string[];
  probe(file: string): Promise<ProbeInfo>;
  /** A player, given whether ffplay is installed. */
  player(hasFfplay: boolean): Player;
  fetchImpl?: typeof fetch;
  platform?: NodeJS.Platform;
  home?: string;
  now?: () => number;
  /** Calls fn every ms milliseconds until the returned function is called. */
  every?: (fn: () => void, ms: number) => () => void;
}

export type AddOutcome =
  | { status: 'added'; meta: SongMeta; folder: string; gitCommand: string; checkPath: string; stems: StemsReport }
  | { status: 'discarded'; reason: string };

/** Ends the flow without adding anything, deliberately (the user chose so). */
class StopAdd extends Error {}

const defaultEvery = (fn: () => void, ms: number) => {
  const timer = setInterval(fn, ms);
  return () => clearInterval(timer);
};

/** The default catalogue for a tempo, if index.json has it; else its first catalogue. */
export function suggestCatalogue(index: SongIndex, bpm: number): string {
  const id = catalogueForBpm(bpm);
  return index.catalogues.some((catalogue) => catalogue.id === id) ? id : index.catalogues[0].id;
}

/** slugify(title), made unique against the ids in use. */
export function suggestId(title: string, taken: readonly string[]): string {
  return uniqueSlug(slugify(title), taken);
}

export function validateId(value: string, taken: readonly string[]): string | undefined {
  if (!SONG_ID_PATTERN.test(value)) return 'Use lowercase letters and digits joined by single hyphens, like "past-sadness".';
  if (taken.includes(value)) return `"${value}" is already used; "${uniqueSlug(value, taken)}" is free.`;
  return undefined;
}

export function validateBpm(value: string): string | undefined {
  const bpm = Number(value.trim());
  return Number.isFinite(bpm) && bpm >= 20 && bpm <= 400 ? undefined : 'Give a tempo in BPM, like 72.';
}

/** The meta.json for a song, with the credit line built from its fields. */
export function buildMeta(fields: Omit<SongMeta, 'creditLine'>): SongMeta {
  const { id, title, artist, licence, sourceUrl, bpm, durationSec, catalogue, difficulty } = fields;
  return {
    id,
    title,
    artist,
    licence,
    sourceUrl,
    creditLine: buildCreditLine({ title, artist, sourceUrl, licence }),
    bpm,
    durationSec,
    catalogue,
    difficulty,
  };
}

const nonEmpty =
  (what: string): Validate =>
  (value) =>
    value.trim() ? undefined : `Give ${what}.`;

const httpAddress: Validate = (value) =>
  isHttpUrl(value.trim()) ? undefined : 'Give the http(s) address of the page the song came from.';

export async function addSong(options: AddOptions, deps: AddDeps): Promise<AddOutcome> {
  const { ui, layout: where } = deps;
  const auto = options.yes;
  const platform = deps.platform ?? process.platform;
  const now = deps.now ?? (() => Date.now());
  const every = deps.every ?? defaultEvery;
  const clean = (text: string) => cleanInputPath(text, platform, deps.home);

  if (auto) {
    const missing: string[] = [];
    if (!options.input) missing.push('<file-or-url>');
    if (!options.title) missing.push('--title');
    if (!options.artist) missing.push('--artist');
    if (!options.licence) missing.push('--licence');
    if (!options.sourceUrl && !(options.input && isHttpUrl(clean(options.input)))) missing.push('--source-url');
    if (missing.length > 0) throw new UsageError(`add --yes needs ${missing.join(', ')}.`);
  }
  const flagLicence = options.licence === undefined ? undefined : checkLicence(options.licence);
  if (flagLicence && !flagLicence.ok) throw new SongToolError(`Licence refused: ${flagLicence.reason}`);

  ui.intro('Add a song to Rehabeat');

  const preflight = await deps.pipeline.preflight();
  const problems = deps.requirementProblems(preflight);
  if (problems.length > 0) throw new SongToolError(problems.join('\n'));

  // ---------------------------------------------------------------- 1. the audio

  const checkInput = (value: string): string | undefined => {
    const cleaned = clean(value);
    if (!cleaned) return 'Give a file path or an http(s) address.';
    if (isHttpUrl(cleaned)) return undefined;
    if (/^[a-z][a-z0-9+.-]+:\/\//i.test(cleaned)) return 'Only http(s) addresses can be downloaded.';
    if (!existsSync(cleaned)) return `There is no file at ${cleaned}`;
    if (!statSync(cleaned).isFile()) return `${cleaned} is a folder, not a file.`;
    return undefined;
  };

  let raw = options.input;
  if (raw === undefined) {
    raw = await ui.text({
      message: 'Song file or address',
      placeholder: 'drag the file in here, or paste a path or an https:// link',
      validate: checkInput,
    });
  }
  const inputProblem = checkInput(raw);
  if (inputProblem) throw new SongToolError(inputProblem);

  const cleanedInput = clean(raw);
  let audio: string;
  let downloadUrl: string | undefined;
  if (!isHttpUrl(cleanedInput)) {
    audio = path.resolve(cleanedInput);
  } else {
    downloadUrl = cleanedInput;
    const spin = ui.spinner();
    spin.start(`Downloading ${downloadUrl}`);
    try {
      const got = await downloadAudio(downloadUrl, where.downloadsDir, {
        fetchImpl: deps.fetchImpl,
        onProgress: (received, total) =>
          spin.message(`Downloading: ${megabytes(received)}${total ? ` of ${megabytes(total)}` : ''}`),
      });
      audio = got.file;
      spin.stop(`Downloaded ${got.kind.toUpperCase()}, ${megabytes(got.bytes)}: ${got.file}`);
    } catch (error) {
      spin.error('Download failed');
      throw error;
    }
  }

  // ---------------------------------------------------------------- 2. title, artist, id

  const info = await deps.probe(audio);
  const index = await loadIndex(where);
  const taken = await takenIds(where, index);
  if (options.catalogue !== undefined) findCatalogue(index, options.catalogue); // fail before the slow part

  const ask = async (question: {
    flag?: string;
    flagName: string;
    message: string;
    initial?: string;
    placeholder?: string;
    validate: Validate;
  }): Promise<string> => {
    if (question.flag !== undefined) {
      const problem = question.validate(question.flag);
      if (problem) throw new SongToolError(`${question.flagName}: ${problem}`);
      return question.flag.trim();
    }
    if (auto) {
      const value = question.initial ?? '';
      const problem = question.validate(value);
      if (problem) throw new UsageError(`${question.flagName}: ${problem}`);
      return value.trim();
    }
    const answer = await ui.text({
      message: question.message,
      initialValue: question.initial,
      placeholder: question.placeholder,
      validate: question.validate,
    });
    return answer.trim();
  };

  const title = await ask({
    flag: options.title,
    flagName: '--title',
    message: 'Title',
    initial: info.title ?? titleFromFileName(audio),
    validate: nonEmpty('a title'),
  });
  const artist = await ask({
    flag: options.artist,
    flagName: '--artist',
    message: 'Artist',
    initial: info.artist ?? undefined,
    validate: nonEmpty('the artist'),
  });
  const id = await ask({
    flag: options.id,
    flagName: '--id',
    message: 'Song id (its folder in public/songs/)',
    initial: suggestId(title, taken),
    validate: (value) => validateId(value.trim(), taken),
  });

  // ---------------------------------------------------------------- 3. licence and source

  let licence: LicenceId;
  if (flagLicence?.ok) {
    licence = flagLicence.id;
  } else {
    const choice = await ui.select<LicenceId | 'other'>({
      message: 'Licence, as the source page states it',
      options: [
        ...(Object.keys(LICENCES) as LicenceId[]).map((key) => ({ value: key, label: LICENCES[key].name })),
        { value: 'other' as const, label: 'Something else', hint: 'type it in' },
      ],
    });
    if (choice === 'other') {
      const typed = await ui.text({
        message: 'Licence, as written on the source page (Ctrl+C to stop)',
        placeholder: 'for example CC BY 4.0',
        validate: (value) => {
          const check = checkLicence(value);
          return check.ok ? undefined : `Refused: ${check.reason}`;
        },
      });
      const check = checkLicence(typed);
      if (!check.ok) throw new SongToolError(`Licence refused: ${check.reason}`);
      licence = check.id;
    } else {
      licence = choice;
    }
  }

  const sourceUrl = await ask({
    flag: options.sourceUrl,
    flagName: '--source-url',
    message: 'Source page (where the song and its licence are published)',
    initial: downloadUrl,
    placeholder: 'https://',
    validate: httpAddress,
  });

  // ---------------------------------------------------------------- staging

  const staging = stagingFolder(where, id);
  const stagedCheck = path.join(staging, 'check.wav');
  const keptCheck = path.join(where.checksDir, `${id}.wav`);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  deleteOnExit(staging);

  /** Moves the click check out of staging, so it outlives the run, and returns where it is. */
  const keepCheck = async (): Promise<string> => {
    if (!existsSync(stagedCheck)) return keptCheck;
    await mkdir(where.checksDir, { recursive: true });
    await rm(keptCheck, { force: true });
    await rename(stagedCheck, keptCheck).catch(async () => {
      await copyFile(stagedCheck, keptCheck);
    });
    return keptCheck;
  };

  try {
    // -------------------------------------------------------------- 4. analysis

    const analyse = async (hint: number | undefined, mayFixTempo: boolean): Promise<AnalyzeReport> => {
      const spin = ui.spinner();
      spin.start(hint === undefined ? 'Finding the beat' : `Finding the beat, near ${bpmText(hint)} BPM`);
      let report: AnalyzeReport;
      try {
        report = await deps.pipeline.analyze(audio, { outDir: staging, bpmHint: hint, click: stagedCheck });
      } catch (error) {
        spin.error('Beat analysis failed');
        throw error;
      }
      spin.stop(`${bpmText(report.bpm)} BPM, ${report.beatCount} beats, jitter ${jitterText(report.jitterMs)}`);

      if (report.beatCount < 2 || report.jitterMs === null) {
        throw new SongToolError(`No steady beat found (${report.beatCount} beats). Is the file silent, or without a pulse?`);
      }
      if (!isPlayableBpm(report.bpm) && mayFixTempo) {
        const fix = tempoFix(report.bpm);
        if (fix) {
          const outside = `${bpmText(report.bpm)} BPM is outside the game's ${MIN_BPM}-${MAX_BPM} BPM range; at ${fix.label} tempo it is about ${bpmText(fix.bpm)} BPM.`;
          if (auto) {
            ui.info(`${outside} Using ${fix.label} tempo.`);
            return analyse(fix.bpm, false);
          }
          ui.warn(outside);
          if (await ui.confirm({ message: `Re-run the analysis at ${fix.label} tempo?`, initialValue: true })) {
            return analyse(fix.bpm, false);
          }
        } else {
          ui.warn(
            `${bpmText(report.bpm)} BPM is outside the game's ${MIN_BPM}-${MAX_BPM} BPM range, and neither half nor double tempo is inside it.`,
          );
        }
      }
      if (report.jitterMs >= options.maxJitter) {
        const unsteady = `The beat grid is unsteady: jitter ${jitterText(report.jitterMs)} (${options.maxJitter} ms or more), so the beats may drift from the music.`;
        if (auto) {
          const check = await keepCheck();
          throw new SongToolError(
            `${unsteady} Not added. Listen to ${check}, then try --bpm-hint N, or accept it with --max-jitter ${Math.ceil(report.jitterMs + 1)}.`,
          );
        }
        ui.warn(unsteady);
        if (!(await ui.confirm({ message: 'Go on with this beat grid anyway?', initialValue: false }))) {
          throw new StopAdd('Discarded: the beat grid was too unsteady. Nothing was added.');
        }
      }
      return report;
    };

    let grid = await analyse(options.bpmHint, options.bpmHint === undefined);

    const chooseCatalogue = async (bpm: number): Promise<string> => {
      if (options.catalogue !== undefined) return findCatalogue(index, options.catalogue).id;
      const suggested = suggestCatalogue(index, bpm);
      if (auto) return suggested;
      return ui.select({
        message: 'Catalogue',
        options: index.catalogues.map((catalogue) => ({
          value: catalogue.id,
          label: catalogue.name,
          hint: catalogue.id === suggested ? `suggested for ${bpmText(bpm)} BPM` : catalogue.description,
        })),
        initialValue: suggested,
      });
    };
    const chooseDifficulty = async (bpm: number): Promise<Difficulty> => {
      if (options.difficulty !== undefined) return options.difficulty;
      const suggested = difficultyForBpm(bpm);
      if (auto) return suggested;
      return ui.select<Difficulty>({
        message: 'Difficulty',
        options: DIFFICULTIES.map((difficulty) => ({
          value: difficulty,
          label: difficulty,
          hint: difficulty === suggested ? `suggested for ${bpmText(bpm)} BPM` : undefined,
        })),
        initialValue: suggested,
      });
    };
    let catalogue = await chooseCatalogue(grid.bpm);
    let difficulty = await chooseDifficulty(grid.bpm);

    // -------------------------------------------------------------- 5. stems

    const durationSec = info.durationSec ?? grid.durationSec;
    const spin = ui.spinner();
    const started = now();
    let progress: DemucsProgress | null = null;
    const progressLine = () => describeStemsProgress((now() - started) / 1000, progress, durationSec);
    spin.start(progressLine());
    const stopTicking = every(() => spin.message(progressLine()), 1000);
    let stems: StemsReport;
    try {
      stems = await deps.pipeline.stems(audio, {
        outDir: staging,
        separatedDir: where.separatedDir,
        onProgress(latest) {
          progress = latest;
          spin.message(progressLine());
        },
      });
    } catch (error) {
      spin.error('Stem separation failed');
      throw error;
    } finally {
      stopTicking();
    }
    spin.stop(
      `Stems ready in ${clock((now() - started) / 1000)} (Demucs ${stems.demucsSeconds.toFixed(1)} s); ` +
        `levelled ${signedDb(stems.gainDb)}, drums + melody peak at ${stems.sumPeakDbfs.toFixed(1)} dBFS`,
    );

    // -------------------------------------------------------------- 6. the check

    if (!auto) {
      const player = deps.player(preflight.commands.ffplay);
      for (;;) {
        let playing: PlayHandle | null = null;
        const listen = await ui.confirm({
          message: 'Play the click check? (the song with a click on every beat, higher on each downbeat)',
          initialValue: true,
        });
        if (listen) {
          playing = player.play(stagedCheck);
          ui.info(
            playing.via === 'ffplay'
              ? 'Playing with ffplay. Answer below to stop it.'
              : `Opened ${stagedCheck} in ${playing.via}.`,
          );
        } else {
          ui.info(`Click check: ${stagedCheck}`);
        }
        let verdict: 'keep' | 'retry' | 'discard';
        try {
          verdict = await ui.select({
            message: 'Beats line up?',
            options: [
              { value: 'keep', label: 'Keep', hint: 'add the song to the library' },
              { value: 'retry', label: 'Retry with a BPM hint', hint: 'the stems are kept' },
              { value: 'discard', label: 'Discard', hint: 'delete what was staged' },
            ],
            initialValue: 'keep',
          });
        } finally {
          playing?.stop();
        }
        if (verdict === 'keep') break;
        if (verdict === 'discard') throw new StopAdd('Discarded. Nothing was added.');

        const hint = Number(
          await ui.text({
            message: 'BPM hint: the tempo you hear (the grid moves to that octave)',
            initialValue: String(Math.round(grid.bpm)),
            validate: validateBpm,
          }),
        );
        grid = await analyse(hint, false);
        if (options.catalogue === undefined && suggestCatalogue(index, grid.bpm) !== catalogue) {
          ui.info(`At ${bpmText(grid.bpm)} BPM a different catalogue is suggested.`);
          catalogue = await chooseCatalogue(grid.bpm);
        }
        if (options.difficulty === undefined && difficultyForBpm(grid.bpm) !== difficulty) {
          difficulty = await chooseDifficulty(grid.bpm);
        }
      }
    }

    // -------------------------------------------------------------- 7. keep

    const beatmap = (await readJson(path.join(staging, 'beatmap.json'))) as { bpm: number };
    const meta = buildMeta({
      id,
      title,
      artist,
      licence,
      sourceUrl,
      bpm: beatmap.bpm,
      durationSec: Math.round(grid.durationSec * 100) / 100,
      catalogue,
      difficulty,
    });
    // Read the index again: it may have changed during the minutes Demucs took.
    const nextIndex = addToIndex(await loadIndex(where), id, catalogue);
    const folder = await installSongFiles(where, staging, meta);
    try {
      await saveIndex(where, nextIndex);
    } catch (error) {
      await rm(folder, { recursive: true, force: true });
      throw error;
    }
    await regenerateCredits(where);

    const gitPaths = [`public/songs/${id}`, 'public/songs/index.json', 'public/CREDITS.md'];
    if (options.keepSource) {
      const track = path.join(where.tracksDir, `${id}${path.extname(audio).toLowerCase() || '.mp3'}`);
      if (existsSync(track)) {
        ui.warn(`${repoRelative(where, track)} already exists, so the source was not copied.`);
      } else {
        await mkdir(where.tracksDir, { recursive: true });
        await copyFile(audio, track);
        gitPaths.push(repoRelative(where, track));
      }
    }
    const checkPath = await keepCheck();
    const catalogueName = index.catalogues.find((entry) => entry.id === catalogue)?.name ?? catalogue;
    const gitCommand = `git add ${gitPaths.join(' ')}`;

    ui.note(
      fieldLines([
        ['ID', id],
        ['Catalogue', `${catalogueName} (${catalogue})`],
        ['Difficulty', difficulty],
        ['BPM', meta.bpm.toFixed(2)],
        ['Beat jitter', `${jitterText(grid.jitterMs)} over ${grid.beatCount} beats`],
        ['Duration', formatDuration(meta.durationSec)],
        ['Licence', LICENCES[licence].name],
        ['Demucs', `${stems.demucsSeconds.toFixed(1)} s`],
        ['Levelling', `${signedDb(stems.gainDb)}; drums + melody peak at ${stems.sumPeakDbfs.toFixed(1)} dBFS`],
      ]),
      `Added "${title}"`,
    );
    if (auto) ui.info(`Click check (listen to confirm the beat grid): ${checkPath}`);
    ui.outro(`To commit it: ${gitCommand}`);
    return { status: 'added', meta, folder, gitCommand, checkPath, stems };
  } catch (error) {
    if (error instanceof StopAdd) {
      ui.cancel(error.message);
      return { status: 'discarded', reason: error.message };
    }
    throw error; // CancelledError and real errors: the CLI reports them
  } finally {
    await rm(staging, { recursive: true, force: true });
    release(staging);
  }
}
