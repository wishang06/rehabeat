import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseIndex, parseMeta } from '../../src/songs/library';
import { jitterMs } from '../../src/songs/model';
import { listSongs, moveSong, previewSong, previewStart, removeSong } from './commands';
import { CREDITS_START } from './credits';
import { SongToolError, UsageError } from './errors';
import type { Layout } from './paths';
import { ffplayArgs, openCommand } from './player';
import { defaultIndex, formatJson } from './songIndex';
import { loadDiskLibrary } from './store';
import { addSongFixture, ENTER, fakePlayer, fakePrompter, sampleMeta, TEAM_CREDITS, tempRoot } from './testing/fakes';

let where: Layout;
const beats = [1.0, 1.8333, 2.6667, 3.5, 4.3341];

beforeEach(async () => {
  where = await tempRoot();
  await addSongFixture(where, sampleMeta({ id: 'past-sadness' }), beats);
  await addSongFixture(
    where,
    sampleMeta({ id: 'slow-one', title: 'Slow One', artist: 'Someone', licence: 'CC0-1.0', bpm: 60, catalogue: 'calm-stretch', difficulty: 'gentle' }),
  );
});

afterEach(async () => {
  await rm(where.root, { recursive: true, force: true });
});

const readIndex = async () => parseIndex(JSON.parse(await readFile(where.indexPath, 'utf8')));
const readMetaFile = async (id: string) => parseMeta(JSON.parse(await readFile(path.join(where.songsDir, id, 'meta.json'), 'utf8')), id);

describe('list', () => {
  it('shows every song with its BPM, its jitter from beatmap.json and its licence', async () => {
    const lines: string[] = [];
    await listSongs(where, (line) => lines.push(line));
    const table = lines[0].split('\n');
    expect(table[0]).toMatch(/^Catalogue +ID +Title +Artist +BPM +Jitter +Licence$/);
    expect(table[2]).toMatch(/^Calm Stretch +slow-one +Slow One +Someone +60\.00 +[\d.]+ ms +CC0 1\.0$/);
    expect(table[3]).toContain(`${jitterMs(beats)!.toFixed(2)} ms`);
    expect(table[3]).toMatch(/^Steady Flow +past-sadness +Past Sadness +Kevin MacLeod +72\.00 .* CC BY 4\.0$/);
    expect(lines).toContain('Catalogues: Calm Stretch (calm-stretch) 1, Steady Flow (steady-flow) 1, Active Rehab (active-rehab) 0');
    expect(lines.some((line) => line.startsWith('Problems'))).toBe(false);
  });

  it('reports the problems it finds while loading', async () => {
    await rm(path.join(where.songsDir, 'slow-one', 'melody.mp3'));
    await mkdir(path.join(where.songsDir, 'stray-folder'));
    const meta = await readMetaFile('past-sadness');
    await writeFile(path.join(where.songsDir, 'past-sadness', 'meta.json'), formatJson({ ...meta, catalogue: 'active-rehab' }));
    const index = await readIndex();
    index.catalogues[2].songIds.push('ghost');
    await writeFile(where.indexPath, formatJson(index));

    const library = await loadDiskLibrary(where);

    expect(library.problems).toEqual([
      'public/songs/slow-one/melody.mp3 is missing.',
      'public/songs/past-sadness/meta.json says catalogue "active-rehab" but index.json lists it in "steady-flow" (the game skips it).',
      'song "ghost": public/songs/ghost/meta.json is missing.',
      'public/songs/stray-folder/ is not listed in index.json (the game ignores it).',
    ]);
    const lines: string[] = [];
    await listSongs(where, (line) => lines.push(line));
    expect(lines).toContain('Problems (4):');
  });

  it('creates index.json with the default catalogues when it is missing', async () => {
    const empty = await tempRoot({ index: false });
    try {
      const lines: string[] = [];
      await listSongs(empty, (line) => lines.push(line));
      expect(lines[0]).toMatch(/^No songs yet/);
      expect(JSON.parse(await readFile(empty.indexPath, 'utf8'))).toEqual(defaultIndex());
    } finally {
      await rm(empty.root, { recursive: true, force: true });
    }
  });
});

describe('remove', () => {
  it('with --yes: unlists the song, deletes its folder and regenerates the credits', async () => {
    const ui = fakePrompter([], false);
    expect(await removeSong(where, 'past-sadness', { ui, yes: true })).toBe(true);

    expect((await readIndex()).catalogues.map((catalogue) => catalogue.songIds)).toEqual([['slow-one'], [], []]);
    expect(existsSync(path.join(where.songsDir, 'past-sadness'))).toBe(false);
    const credits = await readFile(where.creditsPath, 'utf8');
    expect(credits.startsWith(TEAM_CREDITS)).toBe(true);
    expect(credits).toContain('Slow One');
    expect(credits).not.toContain('Past Sadness');
    expect(ui.transcript).toContain(
      'info: To commit it: git add public/songs/past-sadness public/songs/index.json public/CREDITS.md',
    );
  });

  it('asks first without --yes, and needs --yes without a terminal', async () => {
    const no = fakePrompter([{ ask: 'Remove "Past Sadness" by Kevin MacLeod from Steady Flow', answer: ENTER }]);
    expect(await removeSong(where, 'past-sadness', { ui: no, yes: false })).toBe(false);
    expect(no.offered.values().next().value).toBe(false); // the default answer is no
    expect(existsSync(path.join(where.songsDir, 'past-sadness'))).toBe(true);

    await expect(removeSong(where, 'past-sadness', { ui: fakePrompter([], false), yes: false })).rejects.toThrow(UsageError);
    await expect(removeSong(where, 'nope', { ui: no, yes: true })).rejects.toThrow(
      'There is no song "nope". The songs are: slow-one, past-sadness.',
    );
  });
});

describe('move', () => {
  it('moves the song to the end of the other catalogue, keeping its difficulty', async () => {
    const ui = fakePrompter([], false);
    await moveSong(where, 'past-sadness', 'calm-stretch', { ui });

    expect((await readIndex()).catalogues.map((catalogue) => catalogue.songIds)).toEqual([['slow-one', 'past-sadness'], [], []]);
    const meta = await readMetaFile('past-sadness');
    expect(meta.catalogue).toBe('calm-stretch');
    expect(meta.difficulty).toBe('steady');
    const section = (await readFile(where.creditsPath, 'utf8')).slice(TEAM_CREDITS.length);
    expect(section).toContain(CREDITS_START);
    expect(section).toMatch(/\| Past Sadness \| Kevin MacLeod \| Calm Stretch \|/);
    expect(ui.transcript[0]).toBe('success: Moved "Past Sadness" (past-sadness): from Steady Flow to Calm Stretch.');
  });

  it('sets the difficulty when asked, even without changing catalogue', async () => {
    await moveSong(where, 'past-sadness', 'active-rehab', { ui: fakePrompter([], false), difficulty: 'active' });
    expect(await readMetaFile('past-sadness')).toMatchObject({ catalogue: 'active-rehab', difficulty: 'active' });
    await moveSong(where, 'past-sadness', 'active-rehab', { ui: fakePrompter([], false), difficulty: 'gentle' });
    expect((await readMetaFile('past-sadness')).difficulty).toBe('gentle');
  });

  it('refuses an unknown song, an unknown catalogue and a move to where it already is', async () => {
    const ui = fakePrompter([], false);
    await expect(moveSong(where, 'ghost', 'calm-stretch', { ui })).rejects.toThrow('There is no song "ghost"');
    await expect(moveSong(where, 'past-sadness', 'disco', { ui })).rejects.toThrow(
      'There is no catalogue "disco". The catalogues are: calm-stretch, steady-flow, active-rehab.',
    );
    await expect(moveSong(where, 'past-sadness', 'steady-flow', { ui })).rejects.toThrow(SongToolError);
  });
});

describe('preview', () => {
  it('plays 10 s of the melody from about 30% in, with a fade, through ffplay', async () => {
    const player = fakePlayer();
    const ui = fakePrompter([], false);
    await previewSong(where, 'past-sadness', { ui, player, hasFfplay: true, hasFfmpeg: true });
    expect(player.played).toEqual([
      {
        file: path.join(where.songsDir, 'past-sadness', 'melody.mp3'),
        options: { startSec: previewStart(213.39), durationSec: 10, fadeSec: 0.5 },
      },
    ]);
    expect(ui.transcript[0]).toBe('info: Playing 10 s of "Past Sadness" (melody stem) from 1:04...');
  });

  it('starts early enough for a short song to play 10 s', () => {
    expect(previewStart(213.39)).toBeCloseTo(64.017, 3);
    expect(previewStart(12)).toBe(2);
    expect(previewStart(5)).toBe(0);
  });

  it('builds the ffplay and default-player commands', () => {
    expect(ffplayArgs('C:\\a b.mp3', { startSec: 64, durationSec: 10, fadeSec: 0.5 })).toEqual([
      '-nodisp', '-autoexit', '-loglevel', 'error', '-ss', '64.00', '-t', '10',
      '-af', 'asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.5,afade=t=out:st=9.5:d=0.5',
      'C:\\a b.mp3',
    ]); // prettier-ignore
    expect(ffplayArgs('x.wav')).toEqual(['-nodisp', '-autoexit', '-loglevel', 'error', 'x.wav']);
    expect(openCommand('C:\\My Songs\\check.wav', 'win32')).toEqual({
      command: 'cmd',
      args: ['/d', '/c', 'start', '""', '"C:\\My Songs\\check.wav"'],
      windowsVerbatimArguments: true,
    });
    expect(openCommand('/x/check.wav', 'darwin')).toEqual({ command: 'open', args: ['/x/check.wav'] });
    expect(openCommand('/x/check.wav', 'linux')).toEqual({ command: 'xdg-open', args: ['/x/check.wav'] });
  });
});
