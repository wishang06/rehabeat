/**
 * The add flow through the real clack prompts, typed into with simulated keystrokes.
 * The other add tests use a scripted fake; these check that the clack wrapper (option
 * lists, validation messages, cancel) behaves the same way.
 */
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addSong, type AddDeps } from './add';
import { CancelledError } from './errors';
import type { Layout } from './paths';
import { clackPrompter, plainPrompter } from './prompts';
import { fakePipeline, fakePlayer, tempRoot } from './testing/fakes';
import { clickTrackWav } from './testing/wav';

const ENTER = '\r';
const DOWN = '\x1b[B';
const CTRL_C = '\x03';
const plain = (text: string) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

/** A pretend terminal: what clack draws, and a way to answer each prompt once it is drawn. */
function terminal() {
  const input = new PassThrough();
  let screen = '';
  let seen = 0;
  const output = new Writable({
    write(chunk, _encoding, done) {
      screen += chunk.toString();
      done();
    },
  });
  Object.assign(output, { columns: 160, rows: 50 });
  return {
    input,
    output,
    screen: () => plain(screen),
    /** Waits for `text` to be drawn (after the last answer), then types `keys`. */
    async answer(text: string, keys: string) {
      await vi.waitFor(
        () => {
          if (!plain(screen.slice(seen)).includes(text)) throw new Error(`still waiting for "${text}"`);
        },
        { timeout: 5000, interval: 5 },
      );
      seen = screen.length;
      input.write(keys);
    },
  };
}

let where: Layout;
let song: string;

beforeEach(async () => {
  where = await tempRoot();
  song = path.join(where.root, 'incoming', 'my song.wav');
  await mkdir(path.dirname(song), { recursive: true });
  await writeFile(song, clickTrackWav({ bpm: 72, seconds: 1 }));
});

afterEach(async () => {
  await rm(where.root, { recursive: true, force: true });
});

function deps(ui: AddDeps['ui']): AddDeps {
  return {
    layout: where,
    ui,
    pipeline: fakePipeline(),
    requirementProblems: () => [],
    probe: async () => ({ durationSec: 30, title: 'Morning Light', artist: 'Tagged Artist' }),
    player: () => fakePlayer(),
    every: () => () => undefined,
  };
}

describe('add, typed into the real clack prompts', () => {
  it('goes from the file to the summary with Enter on every default', async () => {
    const term = terminal();
    const flow = addSong({ maxJitter: 10, keepSource: false, yes: false }, deps(clackPrompter(term)));

    await term.answer('Song file or address', `${song}${ENTER}`);
    await term.answer('Title', ENTER);
    await term.answer('Artist', ENTER);
    await term.answer('Song id', ENTER);
    await term.answer('Licence, as the source page states it', `${DOWN}${DOWN}${ENTER}`); // CC0, CC BY 3.0, CC BY 4.0
    await term.answer('Source page', `https://example.org/morning-light${ENTER}`);
    await term.answer('Catalogue', ENTER);
    await term.answer('Difficulty', ENTER);
    await term.answer('Play the click check?', ENTER);
    await term.answer('Beats line up?', ENTER);
    const outcome = await flow;

    expect(outcome.status).toBe('added');
    expect(outcome.status === 'added' && outcome.meta).toMatchObject({
      id: 'morning-light',
      title: 'Morning Light',
      artist: 'Tagged Artist',
      licence: 'CC-BY-4.0',
      catalogue: 'steady-flow',
      difficulty: 'steady',
    });
    expect(existsSync(path.join(where.songsDir, 'morning-light', 'meta.json'))).toBe(true);
    const screen = term.screen();
    expect(screen).toContain('Something else');
    expect(screen).toContain('suggested for 72.0 BPM');
    expect(screen).toContain('Added "Morning Light"');
    expect(screen).toContain('git add public/songs/morning-light public/songs/index.json public/CREDITS.md');
  });

  it('shows a refused licence with its reason, and Ctrl+C stops cleanly', async () => {
    const term = terminal();
    const run = deps(clackPrompter(term));
    const flow = addSong({ input: song, maxJitter: 10, keepSource: false, yes: false }, run);

    await term.answer('Title', ENTER);
    await term.answer('Artist', ENTER);
    await term.answer('Song id', ENTER);
    await term.answer('Licence, as the source page states it', `${DOWN.repeat(4)}${ENTER}`); // Something else
    await term.answer('Licence, as written on the source page', `CC BY-NC 4.0${ENTER}`);
    await term.answer('Refused: NonCommercial licences are not allowed in the repo.', CTRL_C);

    await expect(flow).rejects.toThrow(CancelledError);
    expect((run.pipeline as ReturnType<typeof fakePipeline>).analyzed).toEqual([]);
    expect(existsSync(path.join(where.songsDir, 'morning-light'))).toBe(false);
  });
});

describe('plainPrompter', () => {
  it('prints lines, throttles spinner progress, and refuses to ask', async () => {
    const lines: string[] = [];
    let now = 0;
    const ui = plainPrompter((line) => lines.push(line), (line) => lines.push(`ERR ${line}`), 15, () => now);
    const spin = ui.spinner();
    spin.start('Separating stems');
    now = 5_000;
    spin.message('10%');
    now = 16_000;
    spin.message('40%');
    spin.stop('done');
    ui.warn('careful');
    expect(lines).toEqual(['Separating stems...', '  40%', 'done', 'ERR warning: careful']);
    await expect(ui.text({ message: 'Title' })).rejects.toThrow('without a terminal');
  });
});
