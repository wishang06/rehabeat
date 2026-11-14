import { describe, expect, it } from 'vitest';
import type { Beatmap } from '../types';
import { BeatGrid } from './beatGrid';
import { generateBeatmap } from './beatmap';

/** 120 BPM nominal, with deliberately uneven spacing. */
const UNEVEN: Beatmap = { bpm: 120, offset: 0.5, beats: [0.5, 1.0, 1.6, 2.1] };
/** Four beats inside a 2.2 s loop: the wrap segment (1.7 -> 2.3) is 0.6 s long. */
const LOOPED: Beatmap = { bpm: 110, offset: 0.1, beats: [0.1, 0.6, 1.2, 1.7] };
const LOOP_SEC = 2.2;

function range(from: number, to: number, step: number): number[] {
  const count = Math.round((to - from) / step);
  return Array.from({ length: count + 1 }, (_, i) => from + i * step);
}

function expectStrictlyIncreasing(values: number[]): void {
  for (let i = 1; i < values.length; i += 1) {
    expect(values[i]).toBeGreaterThan(values[i - 1]);
  }
}

describe('BeatGrid without a loop', () => {
  const grid = new BeatGrid(UNEVEN);

  it('exposes the tempo', () => {
    expect(grid.bpm).toBe(120);
    expect(grid.secondsPerBeat).toBe(0.5);
  });

  it('returns the listed time for each listed beat', () => {
    UNEVEN.beats.forEach((time, index) => {
      expect(grid.timeOfBeat(index)).toBeCloseTo(time, 12);
      expect(grid.beatAt(time)).toBeCloseTo(index, 12);
    });
  });

  it('interpolates linearly between beats', () => {
    expect(grid.timeOfBeat(0.5)).toBeCloseTo(0.75, 12);
    expect(grid.timeOfBeat(1.5)).toBeCloseTo(1.3, 12);
    expect(grid.timeOfBeat(2.25)).toBeCloseTo(1.725, 12);
    expect(grid.beatAt(1.3)).toBeCloseTo(1.5, 12);
    expect(grid.beatAt(1.9)).toBeCloseTo(2.6, 12);
  });

  it('extrapolates past the last beat at 60 / bpm', () => {
    expect(grid.timeOfBeat(4)).toBeCloseTo(2.6, 12);
    expect(grid.timeOfBeat(5.5)).toBeCloseTo(3.35, 12);
    expect(grid.beatAt(3.1)).toBeCloseTo(5, 12);
  });

  it('extrapolates before the first beat at 60 / bpm', () => {
    expect(grid.timeOfBeat(-1)).toBeCloseTo(0, 12);
    expect(grid.timeOfBeat(-2.5)).toBeCloseTo(-0.75, 12);
    expect(grid.beatAt(0)).toBeCloseTo(-1, 12);
    expect(grid.beatAt(-0.25)).toBeCloseTo(-1.5, 12);
  });

  it('round-trips integer and fractional indices in every region', () => {
    for (const index of [-7, -2.75, -0.001, 0, 0.3, 1, 1.999, 2.5, 3, 3.001, 4.4, 9, 40.125]) {
      expect(grid.beatAt(grid.timeOfBeat(index))).toBeCloseTo(index, 9);
    }
  });

  it('round-trips times in every region', () => {
    for (const time of [-3, 0, 0.49, 0.5, 0.77, 1.6, 2.09, 2.1, 2.11, 17.3]) {
      expect(grid.timeOfBeat(grid.beatAt(time))).toBeCloseTo(time, 9);
    }
  });

  it('is strictly monotonic in both directions', () => {
    expectStrictlyIncreasing(range(-6, 12, 0.125).map((index) => grid.timeOfBeat(index)));
    expectStrictlyIncreasing(range(-3, 6, 0.05).map((time) => grid.beatAt(time)));
  });

  it('handles a single listed beat', () => {
    const single = new BeatGrid({ bpm: 60, offset: 2, beats: [2] });
    expect(single.timeOfBeat(0)).toBe(2);
    expect(single.timeOfBeat(3)).toBe(5);
    expect(single.timeOfBeat(-1.5)).toBe(0.5);
    expect(single.beatAt(4.5)).toBe(2.5);
  });

  it('matches a generated beatmap exactly on and beyond its beats', () => {
    const even = new BeatGrid(generateBeatmap(72, 8));
    for (const index of [0, 1, 7, 8, 100]) {
      expect(even.timeOfBeat(index)).toBeCloseTo((index * 60) / 72, 9);
    }
  });
});

describe('BeatGrid with an empty beat list', () => {
  const grid = new BeatGrid({ bpm: 60, offset: 0.25, beats: [] });

  it('behaves as an even grid starting at the offset', () => {
    expect(grid.timeOfBeat(0)).toBe(0.25);
    expect(grid.timeOfBeat(4)).toBe(4.25);
    expect(grid.timeOfBeat(-2)).toBe(-1.75);
    expect(grid.timeOfBeat(1.5)).toBe(1.75);
    expect(grid.beatAt(0.25)).toBe(0);
    expect(grid.beatAt(3)).toBe(2.75);
  });

  it('stays an even grid when a loop is requested', () => {
    const looped = new BeatGrid({ bpm: 60, offset: 0.25, beats: [] }, { loopDuration: 3.7 });
    expect(looped.timeOfBeat(10)).toBe(10.25);
    expect(looped.beatAt(10.25)).toBe(10);
  });
});

describe('BeatGrid with a loop', () => {
  const grid = new BeatGrid(LOOPED, { loopDuration: LOOP_SEC });

  it('keeps the listed times inside the first loop', () => {
    LOOPED.beats.forEach((time, index) => {
      expect(grid.timeOfBeat(index)).toBeCloseTo(time, 12);
    });
  });

  it('repeats the beats one loop later', () => {
    expect(grid.timeOfBeat(4)).toBeCloseTo(2.3, 12);
    expect(grid.timeOfBeat(5)).toBeCloseTo(2.8, 12);
    expect(grid.timeOfBeat(7)).toBeCloseTo(3.9, 12);
    expect(grid.timeOfBeat(8)).toBeCloseTo(4.5, 12);
    expect(grid.timeOfBeat(4 * 25 + 2)).toBeCloseTo(25 * LOOP_SEC + 1.2, 9);
  });

  it('interpolates the wrap segment toward the first beat of the next loop', () => {
    expect(grid.timeOfBeat(3.5)).toBeCloseTo(2.0, 12);
    expect(grid.timeOfBeat(3.75)).toBeCloseTo(2.15, 12);
    expect(grid.beatAt(2.0)).toBeCloseTo(3.5, 12);
    expect(grid.beatAt(LOOP_SEC)).toBeCloseTo(3 + 0.5 / 0.6, 12);
  });

  it('loops backwards for negative indices', () => {
    expect(grid.timeOfBeat(-1)).toBeCloseTo(-0.5, 12);
    expect(grid.timeOfBeat(-4)).toBeCloseTo(-2.1, 12);
    expect(grid.timeOfBeat(-0.5)).toBeCloseTo(-0.2, 12);
    expect(grid.beatAt(0)).toBeCloseTo(-1 / 6, 12);
  });

  it('round-trips indices, including across loop boundaries', () => {
    const indices = [-9, -4.5, -0.25, -1e-12, 0, 0.5, 2.9, 3, 3.4, 3.999, 4, 4.001, 7.75, 8, 13.3, 400.6];
    for (const index of indices) {
      expect(grid.beatAt(grid.timeOfBeat(index))).toBeCloseTo(index, 9);
    }
  });

  it('round-trips times, including across loop boundaries', () => {
    for (const time of [-5, -0.01, 0, 0.1, 1.69, 1.7, 2.19, 2.2, 2.21, 2.3, 4.4, 100.07]) {
      expect(grid.timeOfBeat(grid.beatAt(time))).toBeCloseTo(time, 9);
    }
  });

  it('is strictly monotonic in both directions across loops', () => {
    expectStrictlyIncreasing(range(-9, 17, 0.125).map((index) => grid.timeOfBeat(index)));
    expectStrictlyIncreasing(range(-5, 9, 0.05).map((time) => grid.beatAt(time)));
  });

  it('stays finite at an index a rounding error below zero', () => {
    expect(grid.timeOfBeat(-1e-17)).toBeCloseTo(0.1, 12);
  });

  it('uses only the beats that start before the loop ends', () => {
    const trimmed = new BeatGrid({ bpm: 60, offset: 0, beats: [0, 1, 2, 3] }, { loopDuration: 2.5 });
    expect(trimmed.timeOfBeat(2)).toBe(2);
    expect(trimmed.timeOfBeat(3)).toBe(2.5);
    expect(trimmed.timeOfBeat(2.5)).toBe(2.25);
    expect(trimmed.timeOfBeat(4)).toBe(3.5);
    expect(trimmed.beatAt(2.5)).toBe(3);
  });

  it('drops a beat that falls exactly on the loop end', () => {
    const exact = new BeatGrid({ bpm: 120, offset: 0, beats: [0, 0.5, 1, 1.5, 2] }, { loopDuration: 2 });
    expect(exact.timeOfBeat(4)).toBe(2);
    expect(exact.timeOfBeat(5)).toBe(2.5);
    expect(exact.beatAt(3.25)).toBe(6.5);
  });

  it('handles a loop holding a single beat', () => {
    const single = new BeatGrid({ bpm: 30, offset: 0.5, beats: [0.5] }, { loopDuration: 2 });
    expect(single.timeOfBeat(3)).toBe(6.5);
    expect(single.timeOfBeat(0.5)).toBe(1.5);
    expect(single.beatAt(4.5)).toBe(2);
  });

  it('ignores a loop length that is not a positive finite number', () => {
    for (const loopDuration of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const unlooped = new BeatGrid(UNEVEN, { loopDuration });
      expect(unlooped.timeOfBeat(5)).toBeCloseTo(3.1, 12);
    }
  });
});
