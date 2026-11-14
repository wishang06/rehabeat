import { describe, expect, it } from 'vitest';
import {
  LOCK_ENTER_SCORE,
  LOCK_ENTER_SEC,
  LOCK_EXIT_SCORE,
  LOCK_EXIT_SEC,
  PoseLock,
  type ScoredSample,
} from './poseLock';

/** Feeds [t, score] pairs in order, passing each one the sample before it. */
function feed(lock: PoseLock, samples: readonly (readonly [number, number])[], previous: ScoredSample | null = null) {
  let last = previous;
  for (const [t, score] of samples) {
    lock.update({ t, score }, last);
    last = { t, score };
  }
  return last;
}

/** A lock that engaged on a run of 80s from t = 0. Returns the last sample. */
function lockedAt(lock: PoseLock): ScoredSample | null {
  const last = feed(lock, [
    [0, 80],
    [0.05, 80],
    [0.1, 80],
  ]);
  expect(lock.locked).toBe(true);
  return last;
}

describe('PoseLock', () => {
  it('uses the Good line to lock and a lower line to let go', () => {
    expect(LOCK_ENTER_SCORE).toBe(60);
    expect(LOCK_EXIT_SCORE).toBe(50);
    expect(LOCK_ENTER_SEC).toBe(0.1);
    expect(LOCK_EXIT_SEC).toBe(0.15);
  });

  it('locks once the score has stayed Good for 100 ms', () => {
    const lock = new PoseLock();
    feed(lock, [
      [0, 80],
      [0.05, 80],
    ]);
    expect(lock.locked).toBe(false);
    expect(lock.since).toBe(0);
    lock.update({ t: 0.1, score: 80 }, { t: 0.05, score: 80 });
    expect(lock.locked).toBe(true);
    expect(lock.since).toBe(0);
  });

  it('ignores a pass-through shorter than 100 ms', () => {
    const lock = new PoseLock();
    feed(lock, [
      [0, 0],
      [0.033, 80],
      [0.067, 80],
      [0.1, 30],
      [0.133, 30],
    ]);
    expect(lock.locked).toBe(false);
    expect(lock.since).toBeNull();
  });

  it('reports the interpolated start of the run', () => {
    const lock = new PoseLock();
    lock.update({ t: 0.04, score: 80 }, { t: 0, score: 40 });
    // 60 is halfway from 40 to 80.
    expect(lock.since).toBeCloseTo(0.02, 9);
  });

  it('stays locked through a dip that stays above 50', () => {
    const lock = new PoseLock();
    let last = lockedAt(lock);
    for (let t = 0.15; t < 0.7; t += 0.05) {
      lock.update({ t, score: 55 }, last);
      last = { t, score: 55 };
    }
    expect(lock.locked).toBe(true);
  });

  it('unlocks after 150 ms below 50', () => {
    const lock = new PoseLock();
    const last = lockedAt(lock);
    // Binary-exact times, so the 150 ms boundary is not lost to rounding.
    const after = feed(
      lock,
      [
        [0.25, 30],
        [0.375, 30],
      ],
      last,
    );
    expect(lock.locked).toBe(true);
    lock.update({ t: 0.40625, score: 30 }, after);
    expect(lock.locked).toBe(false);
    expect(lock.since).toBeNull();
  });

  it('does not let go for dips below 50 shorter than 150 ms', () => {
    const lock = new PoseLock();
    const last = lockedAt(lock);
    feed(
      lock,
      [
        [0.2, 30],
        [0.3, 30],
        [0.34, 80],
        [0.4, 30],
        [0.5, 30],
      ],
      last,
    );
    expect(lock.locked).toBe(true);
  });

  it('reset clears the lock and the run', () => {
    const lock = new PoseLock();
    lockedAt(lock);
    lock.reset();
    expect(lock.locked).toBe(false);
    expect(lock.since).toBeNull();
  });
});
