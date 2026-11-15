import { describe, expect, it } from 'vitest';
import { point } from '../pose/poseFixtures';
import { LandmarkSmoother } from './landmarkSmoother';

const FRAME_MS = 1000 / 60;

/** A repeatable source of noise in [-amplitude, amplitude]. */
function noiseSource(amplitude: number, seed = 3): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return (state / 4294967296 - 0.5) * 2 * amplitude;
  };
}

/** Runs one landmark through the smoother; the camera delivers a new position every second display frame. */
function run(smoother: LandmarkSmoother, frames: number, xAt: (sample: number) => number, startMs = 0): number[] {
  const out: number[] = [];
  let sample = [point(0, 0.5)];
  for (let i = 0; i < frames; i++) {
    if (i % 2 === 0) sample = [point(xAt(i / 2), 0.5, 0.2, 0.9)];
    out.push(smoother.update(sample, startMs + i * FRAME_MS)![0].x);
  }
  return out;
}

const spread = (values: number[]) => Math.max(...values) - Math.min(...values);

describe('LandmarkSmoother', () => {
  it('returns the first pose as it is', () => {
    const smoothed = new LandmarkSmoother().update([point(0.3, 0.6, 0.1, 0.8)], 0);
    expect(smoothed).toEqual([point(0.3, 0.6, 0.1, 0.8)]);
  });

  it('takes most of the shake out of a joint that is not moving', () => {
    const noise = noiseSource(0.01);
    const raw: number[] = [];
    const smoothed = run(new LandmarkSmoother(), 240, () => {
      raw.push(0.5 + noise());
      return raw[raw.length - 1];
    });
    expect(spread(smoothed.slice(30))).toBeLessThan(spread(raw) * 0.35);
  });

  it('keeps up with a joint that moves', () => {
    const smoother = new LandmarkSmoother();
    run(smoother, 30, () => 0.3);
    // A quick reach across a third of the picture in a quarter of a second, then still.
    const moved = run(smoother, 36, (i) => 0.3 + 0.3 * Math.min(1, i / 7.5), 30 * FRAME_MS);
    expect(moved[moved.length - 1]).toBeGreaterThan(0.57);
  });

  it('moves between camera frames instead of stepping with them', () => {
    const smoother = new LandmarkSmoother();
    run(smoother, 10, () => 0.3);
    const moved = run(smoother, 60, (i) => 0.3 + i * 0.004, 10 * FRAME_MS);
    let repeats = 0;
    for (let i = 21; i < moved.length; i++) if (moved[i] === moved[i - 1]) repeats++;
    expect(repeats).toBe(0);
  });

  it('keeps visibility and depth untouched', () => {
    const smoother = new LandmarkSmoother();
    smoother.update([point(0.3, 0.6, 0.1, 0.8)], 0);
    const [landmark] = smoother.update([point(0.4, 0.6, 0.25, 0.4)], FRAME_MS)!;
    expect(landmark.z).toBe(0.25);
    expect(landmark.visibility).toBe(0.4);
  });

  it('starts fresh after the pose is lost', () => {
    const smoother = new LandmarkSmoother();
    run(smoother, 30, () => 0.2);
    expect(smoother.update(null, 600)).toBeNull();
    expect(smoother.update([point(0.8, 0.5)], 700)![0].x).toBe(0.8);
  });
});
