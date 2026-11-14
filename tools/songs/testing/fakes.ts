/** Test doubles for the CLI: a scripted prompter, a fake pipeline and player, and temp repo roots. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildCreditLine, type SongMeta } from '../../../src/songs/model';
import { CancelledError } from '../errors';
import { layout, type Layout } from '../paths';
import type { AnalyzeReport, Pipeline, PreflightReport, StemsReport } from '../pipeline';
import type { Player, PlayOptions } from '../player';
import type { ConfirmQuestion, Prompter, SelectQuestion, TextQuestion } from '../prompts';
import { defaultIndex, formatJson } from '../songIndex';
import { encodeWav } from './wav';

// ------------------------------------------------------------------ prompter

/** Press Ctrl+C at this prompt. */
export const CANCEL = Symbol('cancel');
/** Press Enter: take the prompt's initial value. */
export const ENTER = Symbol('enter');

export type Answer = string | boolean | typeof CANCEL | typeof ENTER;

export interface Step {
  /** Part of the prompt's message, or a pattern for it: the script fails loudly if the flow asks something else. */
  ask: string | RegExp;
  answer: Answer;
}

export interface FakePrompter extends Prompter {
  /** Everything shown and asked, in order, one line each ("warn: ...", "text: Title -> X"). */
  transcript: string[];
  /** Messages a text prompt's validation showed. */
  rejected: string[];
  /** Initial values the prompts offered, by message. */
  offered: Map<string, string | boolean | undefined>;
  /** Scripted steps not used yet. */
  remaining(): Step[];
}

export function fakePrompter(steps: Step[], interactive = true): FakePrompter {
  const queue = [...steps];
  const transcript: string[] = [];
  const rejected: string[] = [];
  const offered = new Map<string, string | boolean | undefined>();

  const next = (kind: string, message: string): Answer => {
    const step = queue.shift();
    if (!step) throw new Error(`No scripted answer left for ${kind} "${message}"`);
    const matches = typeof step.ask === 'string' ? message.includes(step.ask) : step.ask.test(message);
    if (!matches) throw new Error(`Script expected a prompt like ${String(step.ask)}, but the flow asked ${kind} "${message}"`);
    if (step.answer === CANCEL) {
      transcript.push(`${kind}: ${message} -> (cancelled)`);
      throw new CancelledError();
    }
    return step.answer;
  };

  return {
    interactive,
    transcript,
    rejected,
    offered,
    remaining: () => [...queue],
    intro: (title) => transcript.push(`intro: ${title}`),
    outro: (message) => transcript.push(`outro: ${message}`),
    cancel: (message) => transcript.push(`cancel: ${message}`),
    note: (body, title) => transcript.push(`note: ${title ?? ''}\n${body}`),
    info: (message) => transcript.push(`info: ${message}`),
    success: (message) => transcript.push(`success: ${message}`),
    warn: (message) => transcript.push(`warn: ${message}`),
    error: (message) => transcript.push(`error: ${message}`),
    async text(question: TextQuestion) {
      offered.set(question.message, question.initialValue);
      for (;;) {
        const answer = next('text', question.message);
        const value = answer === ENTER ? (question.initialValue ?? '') : String(answer);
        transcript.push(`text: ${question.message} -> ${value}`);
        const problem = question.validate?.(value);
        if (!problem) return value;
        rejected.push(problem);
        transcript.push(`rejected: ${problem}`);
      }
    },
    async select<T extends string>(question: SelectQuestion<T>) {
      offered.set(question.message, question.initialValue);
      const answer = next('select', question.message);
      const value = answer === ENTER ? (question.initialValue ?? question.options[0].value) : answer;
      const option = question.options.find((candidate) => candidate.value === value);
      if (!option) {
        const values = question.options.map((candidate) => candidate.value).join(', ');
        throw new Error(`"${String(value)}" is not an option of "${question.message}" (${values})`);
      }
      transcript.push(`select: ${question.message} -> ${option.value}${option.hint ? ` (${option.hint})` : ''}`);
      return option.value;
    },
    async confirm(question: ConfirmQuestion) {
      offered.set(question.message, question.initialValue);
      const answer = next('confirm', question.message);
      const value = answer === ENTER ? (question.initialValue ?? false) : answer;
      if (typeof value !== 'boolean') throw new Error(`confirm "${question.message}" needs true or false`);
      transcript.push(`confirm: ${question.message} -> ${value}`);
      return value;
    },
    spinner() {
      return {
        start: (message) => transcript.push(`spinner: ${message}`),
        message: (message) => transcript.push(`spinner: ${message}`),
        stop: (message) => transcript.push(`spinner done: ${message}`),
        error: (message) => transcript.push(`spinner failed: ${message}`),
      };
    },
  };
}

// ------------------------------------------------------------------ pipeline

export interface FakePipelineOptions {
  /** The BPM the "analysis" finds, given the hint it was run with. Default 72 whatever the hint. */
  bpm?: (hint: number | undefined) => number;
  jitterMs?: (hint: number | undefined) => number;
  beatCount?: number;
  durationSec?: number;
  missingPackages?: string[];
  ffplay?: boolean;
}

export interface FakePipeline extends Pipeline {
  analyzed: Array<{ audio: string; hint: number | undefined }>;
  separated: string[];
}

export function fakePipeline(options: FakePipelineOptions = {}): FakePipeline {
  const analyzed: FakePipeline['analyzed'] = [];
  const separated: string[] = [];
  const durationSec = options.durationSec ?? 30;
  return {
    analyzed,
    separated,
    async preflight(): Promise<PreflightReport> {
      const packages: Record<string, string | null> = {
        librosa: '0.11.0',
        soundfile: '0.14.0',
        demucs: '4.0.1',
        torch: '2.8.0',
        torchaudio: '2.8.0',
      };
      for (const name of options.missingPackages ?? []) packages[name] = null;
      return {
        python: '3.11.9',
        executable: 'C:\\repo\\tools\\.venv\\Scripts\\python.exe',
        packages,
        commands: { ffmpeg: true, ffprobe: true, ffplay: options.ffplay ?? true },
      };
    },
    async analyze(audio, { outDir, bpmHint, click }): Promise<AnalyzeReport> {
      analyzed.push({ audio, hint: bpmHint });
      const bpm = options.bpm?.(bpmHint) ?? 72;
      const jitter = options.jitterMs?.(bpmHint) ?? 1.2;
      const count = options.beatCount ?? 20;
      const beats = Array.from({ length: count }, (_, i) => Math.round((1 + (i * 60) / bpm) * 10000) / 10000);
      const beatmapPath = path.join(outDir, 'beatmap.json');
      await mkdir(outDir, { recursive: true });
      await writeFile(
        beatmapPath,
        formatJson({ bpm: Math.round(bpm * 100) / 100, offset: beats[0] ?? 0, beats, downbeats: beats.filter((_, i) => i % 4 === 0), source: path.basename(audio) }),
      );
      if (click) await writeFile(click, encodeWav(new Float32Array(441), 44100, 1));
      return {
        source: path.basename(audio),
        bpm: Math.round(bpm * 100) / 100,
        bpmHint: bpmHint ?? null,
        detectedTempo: bpm,
        tempo: bpm,
        beatCount: count,
        firstBeat: beats[0] ?? null,
        lastBeat: beats.at(-1) ?? null,
        meanGapMs: 60000 / bpm,
        jitterMs: count >= 2 ? jitter : null,
        durationSec,
        beatmapPath,
        clickPath: click ?? null,
      };
    },
    async stems(audio, { outDir, onProgress }): Promise<StemsReport> {
      separated.push(audio);
      onProgress?.({ percent: 50, phase: 'separating' });
      await writeFile(path.join(outDir, 'drums.mp3'), 'ID3 fake drums');
      await writeFile(path.join(outDir, 'melody.mp3'), 'ID3 fake melody');
      return {
        drums: path.join(outDir, 'drums.mp3'),
        melody: path.join(outDir, 'melody.mp3'),
        demucsSeconds: 12.5,
        gainDb: -3.25,
        sumPeakBeforeDbfs: -8.75,
        sumPeakDbfs: -12.02,
        targetDbfs: -12,
      };
    },
  };
}

// ------------------------------------------------------------------ player

export interface FakePlayer extends Player {
  played: Array<{ file: string; options?: PlayOptions }>;
  stopped: number;
}

export function fakePlayer(): FakePlayer {
  const player: FakePlayer = {
    played: [],
    stopped: 0,
    play(file, options) {
      player.played.push({ file, options });
      return { via: 'ffplay', done: Promise.resolve(), stop: () => (player.stopped += 1) };
    },
  };
  return player;
}

// ------------------------------------------------------------------ repo roots

export const TEAM_CREDITS = `# Music credits

Hand-written by the team. **Keep me** exactly as I am: | pipes |, _underscores_ and all.

| Track | Artist |
| --- | --- |
| Something | Someone |
`;

/** A temp repo root with public/songs/index.json (default catalogues) and a hand-written CREDITS.md. */
export async function tempRoot(options: { credits?: string | null; index?: boolean } = {}): Promise<Layout> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rehabeat-songs-'));
  const where = layout(root);
  await mkdir(where.songsDir, { recursive: true });
  if (options.index !== false) await writeFile(where.indexPath, formatJson(defaultIndex()));
  const credits = options.credits === undefined ? TEAM_CREDITS : options.credits;
  if (credits !== null) await writeFile(where.creditsPath, credits);
  return where;
}

export function sampleMeta(overrides: Partial<SongMeta> & Pick<SongMeta, 'id'>): SongMeta {
  const meta = {
    title: 'Past Sadness',
    artist: 'Kevin MacLeod',
    licence: 'CC-BY-4.0' as const,
    sourceUrl: 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1900007',
    bpm: 72,
    durationSec: 213.39,
    catalogue: 'steady-flow',
    difficulty: 'steady' as const,
    ...overrides,
  };
  return { ...meta, creditLine: overrides.creditLine ?? buildCreditLine(meta) };
}

/** Writes a complete song folder and lists it in index.json. */
export async function addSongFixture(where: Layout, meta: SongMeta, beats: number[] = [1, 1.8333, 2.6667, 3.5]): Promise<void> {
  const folder = path.join(where.songsDir, meta.id);
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'meta.json'), formatJson(meta));
  await writeFile(path.join(folder, 'beatmap.json'), formatJson({ bpm: meta.bpm, offset: beats[0], beats, downbeats: [beats[0]], source: 'x.mp3' }));
  await writeFile(path.join(folder, 'drums.mp3'), 'ID3');
  await writeFile(path.join(folder, 'melody.mp3'), 'ID3');
  const index = JSON.parse(await readFile(where.indexPath, 'utf8'));
  index.catalogues.find((entry: { id: string }) => entry.id === meta.catalogue).songIds.push(meta.id);
  await writeFile(where.indexPath, formatJson(index));
}
