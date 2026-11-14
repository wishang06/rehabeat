import { describe, expect, it } from 'vitest';
import { ANGLE_BETA, ANGLE_D_CUTOFF, ANGLE_MIN_CUTOFF, AngleSmoother } from './angleSmoother';
import { OneEuroFilter } from './oneEuro';

const FRAME = 1 / 30;

/** Minimum-jerk position 0 to 1 for s in [0, 1]: how a hand moves to a target. */
const minJerk = (s: number) => (s <= 0 ? 0 : s >= 1 ? 1 : 10 * s ** 3 - 15 * s ** 4 + 6 * s ** 5);

/** The time the clean reach `from` to `to` over `duration` from `start` passes `level`. */
function crossingTime(from: number, to: number, level: number, start: number, duration: number): number {
  const target = (level - from) / (to - from);
  let low = 0;
  let high = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (minJerk(mid) < target) low = mid;
    else high = mid;
  }
  return start + low * duration;
}

/** Seeded standard normal noise, so the jitter test never flakes. */
function gaussian(seed: number): () => number {
  let state = seed;
  const uniform = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(uniform() + 1e-12)) * Math.cos(2 * Math.PI * uniform());
}

describe('AngleSmoother', () => {
  it('exports the default filter parameters', () => {
    expect(ANGLE_MIN_CUTOFF).toBe(1.0);
    expect(ANGLE_BETA).toBe(0.05);
    expect(ANGLE_D_CUTOFF).toBe(1.0);
  });

  it('passes the first reading of each joint through', () => {
    const smoother = new AngleSmoother();
    expect(smoother.smooth({ leftElbow: 170, rightKnee: 95 }, 0)).toEqual({
      leftElbow: 170,
      rightKnee: 95,
    });
  });

  it('returns only the joints it was given', () => {
    const smoother = new AngleSmoother();
    smoother.smooth({ leftElbow: 170, rightKnee: 95 }, 0);
    expect(Object.keys(smoother.smooth({ rightKnee: 96 }, FRAME))).toEqual(['rightKnee']);
    expect(smoother.smooth({}, 2 * FRAME)).toEqual({});
  });

  it('smooths each joint like its own OneEuroFilter with the default parameters', () => {
    const smoother = new AngleSmoother();
    const options = { minCutoff: ANGLE_MIN_CUTOFF, beta: ANGLE_BETA, dCutoff: ANGLE_D_CUTOFF };
    const elbow = new OneEuroFilter(options);
    const knee = new OneEuroFilter(options);
    for (let i = 0; i < 30; i++) {
      const t = i * FRAME;
      const elbowAngle = 90 + 60 * Math.sin(i / 5) + (i % 2);
      const kneeAngle = 170 - 3 * i;
      const smoothed = smoother.smooth({ leftElbow: elbowAngle, rightKnee: kneeAngle }, t);
      expect(smoothed.leftElbow).toBe(elbow.filter(elbowAngle, t));
      expect(smoothed.rightKnee).toBe(knee.filter(kneeAngle, t));
    }
  });

  it('damps a sudden jump', () => {
    const smoother = new AngleSmoother();
    smoother.smooth({ leftShoulder: 20 }, 0);
    const jumped = smoother.smooth({ leftShoulder: 60 }, FRAME).leftShoulder ?? Number.NaN;
    expect(jumped).toBeGreaterThan(20);
    expect(jumped).toBeLessThan(60);
  });

  it('restarts a joint that was absent for a frame', () => {
    const smoother = new AngleSmoother();
    smoother.smooth({ leftShoulder: 20, rightShoulder: 20 }, 0);
    smoother.smooth({ rightShoulder: 20 }, FRAME);
    const back = smoother.smooth({ leftShoulder: 150, rightShoulder: 150 }, 2 * FRAME);
    // The left filter was reset, so it reports the new reading as it is.
    expect(back.leftShoulder).toBe(150);
    // The right one was present throughout and still eases toward it.
    expect(back.rightShoulder).toBeLessThan(150);
  });

  it('treats a non-finite reading as absent', () => {
    const smoother = new AngleSmoother();
    smoother.smooth({ leftKnee: 100 }, 0);
    expect(smoother.smooth({ leftKnee: Number.NaN }, FRAME)).toEqual({});
    expect(smoother.smooth({ leftKnee: 40 }, 2 * FRAME)).toEqual({ leftKnee: 40 });
  });

  it('restarts every joint on reset', () => {
    const smoother = new AngleSmoother();
    smoother.smooth({ leftHip: 180, rightHip: 180 }, 0);
    smoother.reset();
    expect(smoother.smooth({ leftHip: 90, rightHip: 100 }, FRAME)).toEqual({
      leftHip: 90,
      rightHip: 100,
    });
  });

  it('accepts its own filter parameters', () => {
    const loose = new AngleSmoother({ minCutoff: 30 });
    const tight = new AngleSmoother({ minCutoff: 0.2, beta: 0 });
    loose.smooth({ leftElbow: 0 }, 0);
    tight.smooth({ leftElbow: 0 }, 0);
    const looseStep = loose.smooth({ leftElbow: 90 }, FRAME).leftElbow ?? Number.NaN;
    const tightStep = tight.smooth({ leftElbow: 90 }, FRAME).leftElbow ?? Number.NaN;
    expect(looseStep).toBeGreaterThan(70);
    expect(tightStep).toBeLessThan(10);
  });

  // The lag at arrival decides how late the player looks to the beat grid.
  it('follows a reach to within 25 ms of the true arrival', () => {
    const smoother = new AngleSmoother();
    const [from, to, level, start, duration] = [10, 90, 70, 1, 0.8];
    let previous: { t: number; angle: number } | null = null;
    let crossed: number | null = null;
    for (let i = 0; i <= 3 * 30; i++) {
      const t = i * FRAME;
      const raw = from + (to - from) * minJerk((t - start) / duration);
      const angle = smoother.smooth({ leftShoulder: raw }, t).leftShoulder ?? Number.NaN;
      if (crossed === null && previous && previous.angle < level && angle >= level) {
        crossed = previous.t + ((level - previous.angle) / (angle - previous.angle)) * (t - previous.t);
      }
      previous = { t, angle };
    }
    const lagMs = ((crossed ?? Number.NaN) - crossingTime(from, to, level, start, duration)) * 1000;
    expect(lagMs).toBeGreaterThan(0);
    expect(lagMs).toBeLessThan(25);
  });

  it('still settles jitter at rest', () => {
    const smoother = new AngleSmoother();
    const noise = gaussian(7);
    const settled: number[] = [];
    for (let i = 0; i < 3 * 30; i++) {
      const t = i * FRAME;
      const angle = smoother.smooth({ leftShoulder: 90 + 2 * noise() }, t).leftShoulder ?? Number.NaN;
      if (t >= 1) settled.push(angle);
    }
    const mean = settled.reduce((sum, value) => sum + value, 0) / settled.length;
    const sd = Math.sqrt(settled.reduce((sum, value) => sum + (value - mean) ** 2, 0) / settled.length);
    expect(sd).toBeLessThan(1.0);
  });
});
