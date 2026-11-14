/**
 * The add flow, driven by a scripted prompter with Python faked: every question the
 * interactive flow asks is in these scripts, in order.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseIndex, parseMeta } from '../../src/songs/library';
import { buildCreditLine } from '../../src/songs/model';
import { addSong, type AddDeps, type AddOptions } from './add';
import { renderCreditsSection } from './credits';
import { CancelledError, SongToolError, UsageError } from './errors';
import type { Layout } from './paths';
import type { ProbeInfo } from './probe';
import { plainPrompter } from './prompts';
import {
  addSongFixture,
  CANCEL,
  ENTER,
  fakePipeline,
  fakePlayer,
  fakePrompter,
  sampleMeta,
  TEAM_CREDITS,
  tempRoot,
  type FakePipelineOptions,
  type FakePlayer,
  type FakePrompter,
  type Step,
} from './testing/fakes';
import { clickTrackWav } from './testing/wav';

let where: Layout;
let song: string;

beforeEach(async () => {
  where = await tempRoot();
  await addSongFixture(where, sampleMeta({ id: 'past-sadness' }));
  song = path.join(where.root, 'incoming', 'my song.wav');
  await mkdir(path.dirname(song), { recursive: true });
  await writeFile(song, clickTrackWav({ bpm: 72, seconds: 2 }));
});

afterEach(async () => {
  await rm(where.root, { recursive: true, force: true });
});

const TAGS: ProbeInfo = { durationSec: 30, title: 'Morning Light', artist: 'Tagged Artist' };

interface Run {
  ui: FakePrompter;
  pipeline: ReturnType<typeof fakePipeline>;
  player: FakePlayer;
  deps: AddDeps;
}

function setup(steps: Step[], pipelineOptions: FakePipelineOptions = {}, extra: Partial<AddDeps> = {}): Run {
  const ui = fakePrompter(steps);
  const pipeline = fakePipeline(pipelineOptions);
  const player = fakePlayer();
  const deps: AddDeps = {
    layout: where,
    ui,
    pipeline,
    requirementProblems: () => [],
    probe: async () => TAGS,
    player: () => player,
    every: () => () => undefined,
    ...extra,
  };
  return { ui, pipeline, player, deps };
}

const interactive = (overrides: Partial<AddOptions> = {}): AddOptions => ({ maxJitter: 10, keepSource: false, yes: false, ...overrides });

const index = async () => parseIndex(JSON.parse(await readFile(where.indexPath, 'utf8')));
const credits = () => readFile(where.creditsPath, 'utf8');
const stagingIsEmpty = async () => !existsSync(where.stagingDir) || (await readdir(where.stagingDir)).length === 0;

/** The questions up to the analysis, answered with the defaults where there is one. */
const upToAnalysis = (file: string): Step[] => [
  { ask: 'Song file or address', answer: file },
  { ask: 'Title', answer: ENTER },
  { ask: 'Artist', answer: ENTER },
  { ask: 'Song id', answer: ENTER },
  { ask: 'Licence', answer: 'CC-BY-4.0' },
  { ask: 'Source page', answer: 'https://example.org/morning-light' },
];

describe('interactive add', () => {
  it('happy path: asks one thing at a time, then writes the song, the index and the credits', async () => {
    const { ui, pipeline, player, deps } = setup([
      ...upToAnalysis(`"${song}"`), // pasted with quotes, as Explorer's "Copy as path" does
      { ask: 'Catalogue', answer: ENTER },
      { ask: 'Difficulty', answer: ENTER },
      { ask: 'Play the click check', answer: true },
      { ask: 'Beats line up?', answer: 'keep' },
    ]);

    const outcome = await addSong(interactive(), deps);

    expect(ui.remaining()).toEqual([]);
    expect(outcome.status).toBe('added');
    // Defaults offered: the tags, a slug of the title, the suggested catalogue and difficulty.
    expect(ui.offered.get('Title')).toBe('Morning Light');
    expect(ui.offered.get('Artist')).toBe('Tagged Artist');
    expect(ui.offered.get('Song id (its folder in public/songs/)')).toBe('morning-light');
    expect(ui.offered.get('Catalogue')).toBe('steady-flow');
    expect(ui.offered.get('Difficulty')).toBe('steady');
    expect(ui.transcript).toContain('select: Catalogue -> steady-flow (suggested for 72.0 BPM)');

    const folder = path.join(where.songsDir, 'morning-light');
    for (const file of ['meta.json', 'beatmap.json', 'drums.mp3', 'melody.mp3']) {
      expect(existsSync(path.join(folder, file)), file).toBe(true);
    }
    const meta = parseMeta(JSON.parse(await readFile(path.join(folder, 'meta.json'), 'utf8')), 'morning-light');
    expect(meta).toEqual({
      id: 'morning-light',
      title: 'Morning Light',
      artist: 'Tagged Artist',
      licence: 'CC-BY-4.0',
      sourceUrl: 'https://example.org/morning-light',
      creditLine: buildCreditLine({
        title: 'Morning Light',
        artist: 'Tagged Artist',
        licence: 'CC-BY-4.0',
        sourceUrl: 'https://example.org/morning-light',
      }),
      bpm: 72,
      durationSec: 30,
      catalogue: 'steady-flow',
      difficulty: 'steady',
    });
    // Appended after the song already in Steady Flow.
    expect((await index()).catalogues[1].songIds).toEqual(['past-sadness', 'morning-light']);

    const text = await credits();
    expect(text.startsWith(TEAM_CREDITS)).toBe(true);
    expect(text).toContain(meta.creditLine);
    expect(text).toContain(sampleMeta({ id: 'past-sadness' }).creditLine);

    // Analysis once, Demucs once, the check played and stopped when answered.
    expect(pipeline.analyzed).toEqual([{ audio: song, hint: undefined }]);
    expect(pipeline.separated).toEqual([song]);
    expect(player.played).toHaveLength(1);
    expect(player.played[0].file).toBe(path.join(where.stagingDir, 'morning-light', 'check.wav'));
    expect(player.stopped).toBe(1);
    // Demucs's progress reached the spinner, with a time estimate.
    expect(ui.transcript.some((line) => /spinner: Separating stems: 50% · .* left/.test(line))).toBe(true);
    expect(ui.transcript.some((line) => line.startsWith('spinner done: Stems ready'))).toBe(true);

    expect(outcome.status === 'added' && outcome.gitCommand).toBe(
      'git add public/songs/morning-light public/songs/index.json public/CREDITS.md',
    );
    expect(ui.transcript.at(-1)).toBe(
      'outro: To commit it: git add public/songs/morning-light public/songs/index.json public/CREDITS.md',
    );
    const summary = ui.transcript.find((line) => line.startsWith('note: Added "Morning Light"'));
    for (const field of ['ID', 'Catalogue', 'Difficulty', 'BPM', 'Beat jitter', 'Duration', 'Licence', 'Demucs', 'Levelling']) {
      expect(summary).toMatch(new RegExp(`\\n${field} +`));
    }
    expect(summary).toContain('-3.3 dB; drums + melody peak at -12.0 dBFS');
    expect(await stagingIsEmpty()).toBe(true);
    expect(existsSync(path.join(where.checksDir, 'morning-light.wav'))).toBe(true);
  });

  it('suggests a unique id when the title is taken, and offers the licences by name', async () => {
    const { ui, deps } = setup([
      { ask: 'Song file', answer: song },
      { ask: 'Title', answer: 'Past Sadness' },
      { ask: 'Artist', answer: 'Kevin MacLeod' },
      { ask: 'Song id', answer: ENTER },
      { ask: 'Licence', answer: CANCEL },
    ]);
    await expect(addSong(interactive(), deps)).rejects.toThrow(CancelledError);
    expect(ui.offered.get('Song id (its folder in public/songs/)')).toBe('past-sadness-2');
  });

  it('offers half tempo when the beat tracker locked on at double speed', async () => {
    const { ui, pipeline, deps } = setup(
      [
        ...upToAnalysis(song),
        { ask: 'Re-run the analysis at half tempo?', answer: true },
        { ask: 'Catalogue', answer: ENTER },
        { ask: 'Difficulty', answer: ENTER },
        { ask: 'Play the click check', answer: false },
        { ask: 'Beats line up?', answer: 'keep' },
      ],
      { bpm: (hint) => (hint ? 72 : 144) },
    );

    const outcome = await addSong(interactive(), deps);

    expect(ui.remaining()).toEqual([]);
    expect(ui.transcript).toContain(
      "warn: 144.0 BPM is outside the game's 55-100 BPM range; at half tempo it is about 72.0 BPM.",
    );
    expect(pipeline.analyzed.map((call) => call.hint)).toEqual([undefined, 72]);
    expect(outcome.status === 'added' && outcome.meta.bpm).toBe(72);
    expect(ui.offered.get('Catalogue')).toBe('steady-flow');
  });

  it('keeps an out-of-range tempo if the user says no to the fix', async () => {
    const { pipeline, deps } = setup(
      [
        ...upToAnalysis(song),
        { ask: 'Re-run the analysis at double tempo?', answer: false },
        { ask: 'Catalogue', answer: ENTER },
        { ask: 'Difficulty', answer: ENTER },
        { ask: 'Play the click check', answer: false },
        { ask: 'Beats line up?', answer: 'keep' },
      ],
      { bpm: () => 40 },
    );
    const outcome = await addSong(interactive(), deps);
    expect(pipeline.analyzed).toHaveLength(1);
    expect(outcome.status === 'added' && outcome.meta.catalogue).toBe('calm-stretch');
  });

  it('retry with a BPM hint re-runs the analysis and the check, but not Demucs', async () => {
    const { ui, pipeline, player, deps } = setup(
      [
        ...upToAnalysis(song),
        { ask: 'Catalogue', answer: ENTER },
        { ask: 'Difficulty', answer: ENTER },
        { ask: 'Play the click check', answer: true },
        { ask: 'Beats line up?', answer: 'retry' },
        { ask: 'BPM hint', answer: 'sixty' }, // rejected, typed again
        { ask: 'BPM hint', answer: '60' },
        { ask: 'Catalogue', answer: ENTER }, // 60 BPM suggests another catalogue, so it asks again
        { ask: 'Difficulty', answer: ENTER },
        { ask: 'Play the click check', answer: true },
        { ask: 'Beats line up?', answer: 'keep' },
      ],
      { bpm: (hint) => hint ?? 72 },
    );

    const outcome = await addSong(interactive(), deps);

    expect(ui.remaining()).toEqual([]);
    expect(ui.offered.get('BPM hint: the tempo you hear (the grid moves to that octave)')).toBe('72');
    expect(ui.rejected).toEqual(['Give a tempo in BPM, like 72.']);
    expect(pipeline.analyzed.map((call) => call.hint)).toEqual([undefined, 60]);
    expect(pipeline.separated).toHaveLength(1);
    expect(player.played).toHaveLength(2);
    expect(player.stopped).toBe(2);
    expect(outcome.status === 'added' && [outcome.meta.bpm, outcome.meta.catalogue, outcome.meta.difficulty]).toEqual([
      60,
      'calm-stretch',
      'gentle',
    ]);
    const beatmap = JSON.parse(await readFile(path.join(where.songsDir, 'morning-light', 'beatmap.json'), 'utf8'));
    expect(beatmap.bpm).toBe(60); // the retried grid is the one installed
  });

  it('discard deletes everything staged and changes nothing', async () => {
    const indexBefore = await readFile(where.indexPath, 'utf8');
    const { ui, deps } = setup([
      ...upToAnalysis(song),
      { ask: 'Catalogue', answer: ENTER },
      { ask: 'Difficulty', answer: ENTER },
      { ask: 'Play the click check', answer: false },
      { ask: 'Beats line up?', answer: 'discard' },
    ]);

    const outcome = await addSong(interactive(), deps);

    expect(outcome).toEqual({ status: 'discarded', reason: 'Discarded. Nothing was added.' });
    expect(ui.transcript.at(-1)).toBe('cancel: Discarded. Nothing was added.');
    expect(existsSync(path.join(where.songsDir, 'morning-light'))).toBe(false);
    expect(await readFile(where.indexPath, 'utf8')).toBe(indexBefore);
    expect(await credits()).toBe(TEAM_CREDITS);
    expect(await stagingIsEmpty()).toBe(true);
  });

  it('refuses a disallowed licence with its reason, and accepts an allowed one typed after it', async () => {
    const { ui, deps } = setup([
      { ask: 'Song file', answer: song },
      { ask: 'Title', answer: ENTER },
      { ask: 'Artist', answer: ENTER },
      { ask: 'Song id', answer: ENTER },
      { ask: 'Licence', answer: 'other' },
      { ask: 'Licence, as written', answer: 'CC BY-NC 4.0' },
      { ask: 'Licence, as written', answer: 'Creative Commons Attribution-ShareAlike 4.0' },
      { ask: 'Licence, as written', answer: 'creative commons attribution 4.0' },
      { ask: 'Source page', answer: CANCEL },
    ]);

    await expect(addSong(interactive(), deps)).rejects.toThrow(CancelledError);

    expect(ui.rejected).toEqual([
      'Refused: NonCommercial licences are not allowed in the repo.',
      'Refused: ShareAlike licences are not allowed in the repo.',
    ]);
    expect(ui.remaining()).toEqual([]);
  });

  it('a cancelled licence question stops before anything slow or permanent', async () => {
    const { pipeline, deps } = setup([
      { ask: 'Song file', answer: song },
      { ask: 'Title', answer: ENTER },
      { ask: 'Artist', answer: ENTER },
      { ask: 'Song id', answer: ENTER },
      { ask: 'Licence', answer: 'other' },
      { ask: 'Licence, as written', answer: 'CC BY-ND 4.0' },
      { ask: 'Licence, as written', answer: CANCEL },
    ]);
    await expect(addSong(interactive(), deps)).rejects.toThrow(CancelledError);
    expect(pipeline.analyzed).toEqual([]);
    expect(await credits()).toBe(TEAM_CREDITS);
    expect(await stagingIsEmpty()).toBe(true);
  });

  it('warns about an unsteady beat grid and stops if the user says so', async () => {
    const { ui, pipeline, deps } = setup([...upToAnalysis(song), { ask: 'Go on with this beat grid anyway?', answer: false }], {
      jitterMs: () => 14.2,
    });

    const outcome = await addSong(interactive(), deps);

    expect(outcome.status).toBe('discarded');
    expect(ui.transcript).toContain(
      'warn: The beat grid is unsteady: jitter 14.20 ms (10 ms or more), so the beats may drift from the music.',
    );
    expect(ui.offered.get('Go on with this beat grid anyway?')).toBe(false);
    expect(pipeline.separated).toEqual([]);
    expect(await stagingIsEmpty()).toBe(true);
  });

  it.runIf(process.platform === 'win32')('accepts a Git Bash drag-and-drop path (/c/... with escaped spaces)', async () => {
    const bashPath = song
      .replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`)
      .replace(/\\/g, '/')
      .replace(/ /g, '\\ ');
    expect(bashPath).toMatch(/^\/[a-z]\/.*my\\ song\.wav$/);
    const { ui, deps } = setup([{ ask: 'Song file', answer: bashPath }, { ask: 'Title', answer: CANCEL }]);
    await expect(addSong(interactive(), deps)).rejects.toThrow(CancelledError);
    expect(ui.rejected).toEqual([]); // the file was found
    expect(ui.offered.get('Title')).toBe('Morning Light');
  });

  it('re-asks for a file that does not exist', async () => {
    const { ui, deps } = setup([
      { ask: 'Song file', answer: path.join(where.root, 'nope.mp3') },
      { ask: 'Song file', answer: `& '${song}'` }, // PowerShell's drag-and-drop form
      { ask: 'Title', answer: CANCEL },
    ]);
    await expect(addSong(interactive(), deps)).rejects.toThrow(CancelledError);
    expect(ui.rejected[0]).toMatch(/^There is no file at .*nope\.mp3$/);
  });

  it('stops at once, with the fix, when the preflight finds something missing', async () => {
    const { ui, deps } = setup([], {}, { requirementProblems: () => ['ffmpeg is not on PATH. Fix: winget install Gyan.FFmpeg'] });
    await expect(addSong(interactive({ input: song }), deps)).rejects.toThrow('ffmpeg is not on PATH. Fix: winget install Gyan.FFmpeg');
    expect(ui.transcript).toEqual(['intro: Add a song to Rehabeat']);
  });
});

describe('add from an address', () => {
  const wavBytes = clickTrackWav({ bpm: 72, seconds: 1 });

  it('downloads into tools/out/downloads and uses the address as the default source page', async () => {
    const url = 'https://example.org/files/Morning%20Light.wav?dl=1';
    const fetchImpl = (async () => new Response(wavBytes, { headers: { 'content-type': 'audio/wav' } })) as typeof fetch;
    const { ui, deps } = setup(
      [
        { ask: 'Song file', answer: url },
        { ask: 'Title', answer: ENTER },
        { ask: 'Artist', answer: ENTER },
        { ask: 'Song id', answer: ENTER },
        { ask: 'Licence', answer: 'CC0-1.0' },
        { ask: 'Source page', answer: CANCEL },
      ],
      {},
      { fetchImpl },
    );
    await expect(addSong(interactive(), deps)).rejects.toThrow(CancelledError);
    expect(ui.offered.get('Source page (where the song and its licence are published)')).toBe(url);
    const downloaded = path.join(where.downloadsDir, 'Morning Light.wav');
    expect((await readFile(downloaded)).equals(wavBytes)).toBe(true);
  });

  it('refuses a web page that came back instead of the song', async () => {
    const fetchImpl = (async () =>
      new Response('<!doctype html><html><body>Download</body></html>', { headers: { 'content-type': 'text/html' } })) as typeof fetch;
    const { deps } = setup([], {}, { fetchImpl });
    await expect(addSong(interactive({ input: 'https://example.org/song-page' }), deps)).rejects.toThrow(
      'https://example.org/song-page returned a web page, not an audio file.',
    );
    expect(existsSync(where.downloadsDir) ? await readdir(where.downloadsDir) : []).toEqual([]);
  });

  it('reports an HTTP error', async () => {
    const fetchImpl = (async () => new Response('gone', { status: 404, statusText: 'Not Found' })) as typeof fetch;
    const { deps } = setup([], {}, { fetchImpl });
    await expect(addSong(interactive({ input: 'https://example.org/x.mp3' }), deps)).rejects.toThrow('HTTP 404 Not Found');
  });
});

describe('add --yes', () => {
  const yes = (overrides: Partial<AddOptions> = {}): AddOptions => ({
    input: song,
    title: 'Click 72',
    artist: 'Rehabeat test',
    licence: 'CC0',
    sourceUrl: 'https://example.org/click-72',
    maxJitter: 10,
    keepSource: false,
    yes: true,
    ...overrides,
  });

  function setupYes(pipelineOptions: FakePipelineOptions = {}) {
    const lines: string[] = [];
    const errors: string[] = [];
    const run = setup([], pipelineOptions);
    run.deps.ui = plainPrompter((line) => lines.push(line), (line) => errors.push(line));
    return { ...run, lines, errors };
  }

  it('asks nothing, uses the defaults, and prints the check file instead of playing it', async () => {
    const { deps, lines, player } = setupYes();

    const outcome = await addSong(yes(), deps);

    expect(outcome.status).toBe('added');
    expect(player.played).toEqual([]);
    const meta = outcome.status === 'added' ? outcome.meta : null;
    expect(meta).toMatchObject({ id: 'click-72', catalogue: 'steady-flow', difficulty: 'steady', licence: 'CC0-1.0' });
    const check = path.join(where.checksDir, 'click-72.wav');
    expect(lines).toContain(`Click check (listen to confirm the beat grid): ${check}`);
    expect(existsSync(check)).toBe(true);
    expect(lines.at(-1)).toBe('To commit it: git add public/songs/click-72 public/songs/index.json public/CREDITS.md');
    expect(await credits()).toContain(renderCreditsSection([
      { song: sampleMeta({ id: 'past-sadness' }), catalogueName: 'Steady Flow' },
      { song: meta!, catalogueName: 'Steady Flow' },
    ]));
  });

  it('fixes an out-of-range tempo with tempoFix on its own', async () => {
    const { deps, pipeline, lines } = setupYes({ bpm: (hint) => (hint ? 72 : 144) });
    const outcome = await addSong(yes(), deps);
    expect(pipeline.analyzed.map((call) => call.hint)).toEqual([undefined, 72]);
    expect(lines.some((line) => line.includes('Using half tempo.'))).toBe(true);
    expect(outcome.status === 'added' && outcome.meta.bpm).toBe(72);
  });

  it('respects the flags for id, catalogue, difficulty and BPM hint, and keeps the source when asked', async () => {
    const { deps, pipeline } = setupYes({ bpm: () => 140 });
    const outcome = await addSong(
      yes({ id: 'my-click', catalogue: 'active-rehab', difficulty: 'gentle', bpmHint: 140, keepSource: true }),
      deps,
    );
    expect(pipeline.analyzed.map((call) => call.hint)).toEqual([140]); // a hint from the user is not "fixed"
    expect(outcome.status === 'added' && outcome.meta).toMatchObject({ id: 'my-click', catalogue: 'active-rehab', difficulty: 'gentle' });
    expect(existsSync(path.join(where.tracksDir, 'my-click.wav'))).toBe(true);
    expect(outcome.status === 'added' && outcome.gitCommand).toBe(
      'git add public/songs/my-click public/songs/index.json public/CREDITS.md tools/tracks/my-click.wav',
    );
  });

  it('fails on a disallowed licence before doing any work', async () => {
    const { deps, pipeline } = setupYes();
    await expect(addSong(yes({ licence: 'CC BY-SA 4.0' }), deps)).rejects.toThrow(
      'Licence refused: ShareAlike licences are not allowed in the repo.',
    );
    expect(pipeline.analyzed).toEqual([]);
  });

  it('fails on a jitter at or above --max-jitter, keeping the check file to listen to', async () => {
    const { deps, pipeline } = setupYes({ jitterMs: () => 10 });
    const failure = addSong(yes(), deps);
    await expect(failure).rejects.toThrow(SongToolError);
    await expect(failure).rejects.toThrow(/jitter 10\.00 ms \(10 ms or more\).*--max-jitter 11/);
    expect(pipeline.separated).toEqual([]);
    expect(existsSync(path.join(where.songsDir, 'click-72'))).toBe(false);
    expect(existsSync(path.join(where.checksDir, 'click-72.wav'))).toBe(true);
    expect(await stagingIsEmpty()).toBe(true);

    const relaxed = setupYes({ jitterMs: () => 10 });
    expect((await addSong(yes({ maxJitter: 12 }), relaxed.deps)).status).toBe('added');
  });

  it('fails with a usage message when required flags are missing', async () => {
    const { deps } = setupYes();
    await expect(addSong(yes({ artist: undefined, sourceUrl: undefined }), deps)).rejects.toThrow(
      new UsageError('add --yes needs --artist, --source-url.'),
    );
    await expect(addSong(yes({ input: undefined, title: undefined }), deps)).rejects.toThrow('add --yes needs <file-or-url>, --title.');
  });

  it('refuses a taken id, a bad id and an unknown catalogue', async () => {
    const { deps } = setupYes();
    await expect(addSong(yes({ id: 'past-sadness' }), deps)).rejects.toThrow('--id: "past-sadness" is already used; "past-sadness-2" is free.');
    await expect(addSong(yes({ id: 'Bad Id' }), deps)).rejects.toThrow(/--id: Use lowercase/);
    await expect(addSong(yes({ catalogue: 'disco' }), deps)).rejects.toThrow('There is no catalogue "disco".');
  });

  it('gives a slugged, unique id by default', async () => {
    const { deps } = setupYes();
    const outcome = await addSong(yes({ title: 'Past Sadness' }), deps);
    expect(outcome.status === 'added' && outcome.meta.id).toBe('past-sadness-2');
  });
});
