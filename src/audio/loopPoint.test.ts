import { describe, expect, it } from 'vitest';
import type { Beatmap } from '../types';
import { BeatGrid } from './beatGrid';
import { beatAlignedLoopLength } from './loopPoint';

/** 120 BPM, first beat 30 ms in, eight beats: the last one starts at 3.53 s. */
const BEATMAP: Beatmap = {
  bpm: 120,
  offset: 0.03,
  beats: [0.03, 0.53, 1.03, 1.53, 2.03, 2.53, 3.03, 3.53],
};

/** The time from each beat to the next, for `count` beats, when the audio loops every `loopDuration` seconds. */
function gaps(beatmap: Beatmap, loopDuration: number, count: number): number[] {
  const grid = new BeatGrid(beatmap, { loopDuration });
  return Array.from({ length: count }, (_, i) => grid.timeOfBeat(i + 1) - grid.timeOfBeat(i));
}

describe('beatAlignedLoopLength', () => {
  it("ends the loop where the last full beat ends, pulled in by the first beat's offset", () => {
    // The file runs 60 ms past the end of the eighth beat (4.03 s).
    expect(beatAlignedLoopLength(BEATMAP, 4.09)).toBeCloseTo(4, 9);
  });

  it('keeps every beat one beat apart across the seam', () => {
    const loop = beatAlignedLoopLength(BEATMAP, 4.09);
    for (const gap of gaps(BEATMAP, loop, 24)) expect(gap).toBeCloseTo(0.5, 9);
  });

  it('leaves out a final beat that the end of the file cuts short', () => {
    // The eighth beat would run to 4.03 s but the file stops at 3.9 s, so the loop ends where it starts.
    const loop = beatAlignedLoopLength(BEATMAP, 3.9);
    expect(loop).toBeCloseTo(3.5, 9);
    for (const gap of gaps(BEATMAP, loop, 21)) expect(gap).toBeCloseTo(0.5, 9);
  });

  it('counts a last beat that ends exactly with the file', () => {
    expect(beatAlignedLoopLength({ bpm: 120, offset: 0, beats: [0, 0.5, 1, 1.5] }, 2)).toBe(2);
  });

  it('ignores beats listed beyond the end of the audio', () => {
    // Five beats start inside 2.2 s of audio and the fifth (2.03 s) is cut short.
    expect(beatAlignedLoopLength(BEATMAP, 2.2)).toBeCloseTo(2, 9);
  });

  it('keeps the whole file when there is no beat to align to', () => {
    expect(beatAlignedLoopLength({ bpm: 120, offset: 0, beats: [] }, 7.3)).toBe(7.3);
    expect(beatAlignedLoopLength({ bpm: 120, offset: 9, beats: [9, 9.5] }, 7.3)).toBe(7.3);
    // A single beat that the file cuts short leaves nothing to loop over.
    expect(beatAlignedLoopLength({ bpm: 60, offset: 0.2, beats: [0.2] }, 0.9)).toBe(0.9);
  });
});

// public/beatmap.json is optional, so it is looked up rather than imported outright.
const shipped = Object.values(
  import.meta.glob<Beatmap>('/public/beatmap.json', { eager: true, import: 'default' }),
)[0];

describe.runIf(shipped !== undefined)('the shipped beatmap', () => {
  it('loops with no stretch at the seam', () => {
    const beatmap = shipped;
    const beatLength = 60 / beatmap.bpm;
    const beatCount = beatmap.beats.length;
    // Like the shipped stems: the audio runs a little past the end of the last beat.
    const audioDuration = beatmap.beats[beatCount - 1] + beatLength + 0.029;

    const all = gaps(beatmap, beatAlignedLoopLength(beatmap, audioDuration), beatCount * 2);

    // The seam is the gap from the last beat of the first pass to the first beat of the second.
    expect(all[beatCount - 1]).toBeCloseTo(beatLength, 6);
    // Beat trackers place beats on a frame grid of about 23 ms, so real gaps wobble by a few ms.
    for (const gap of all) expect(Math.abs(gap - beatLength)).toBeLessThan(0.01);
  });
});
