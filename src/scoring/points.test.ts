import { describe, expect, it } from 'vitest';
import { MAX_POINTS_PER_MOVE, pointsFor, summarizeRun } from './points';
import { applyResult, initialStats } from './stats';

describe('pointsFor', () => {
  it('gives nothing for a Miss, whatever the combo', () => {
    expect(pointsFor('Miss', 0)).toBe(0);
    expect(pointsFor('Miss', 20)).toBe(0);
  });

  it('gives the base points on the first move of a combo', () => {
    expect(pointsFor('Perfect', 1)).toBe(100);
    expect(pointsFor('Good', 1)).toBe(50);
  });

  it('adds 10 per move of combo, capped at 100', () => {
    expect(pointsFor('Perfect', 2)).toBe(110);
    expect(pointsFor('Good', 5)).toBe(90);
    expect(pointsFor('Perfect', 11)).toBe(200);
    expect(pointsFor('Perfect', 50)).toBe(200);
  });

  it('never exceeds the per-move maximum the database enforces', () => {
    for (let combo = 0; combo < 100; combo++) {
      expect(pointsFor('Perfect', combo)).toBeLessThanOrEqual(MAX_POINTS_PER_MOVE);
    }
  });
});

describe('summarizeRun', () => {
  it('copies the counts and rounds accuracy and duration', () => {
    let stats = initialStats();
    stats = applyResult(stats, { moveId: 'a', score: 95, label: 'Perfect', timingOffsetMs: 0 });
    stats = applyResult(stats, { moveId: 'b', score: 70.33, label: 'Good', timingOffsetMs: 0 });
    stats = applyResult(stats, { moveId: 'c', score: 10, label: 'Miss', timingOffsetMs: 0 });

    expect(summarizeRun(stats, 210, 41.6)).toEqual({
      points: 210,
      moves: 3,
      perfect: 1,
      good: 1,
      miss: 1,
      bestCombo: 2,
      accuracy: 58.4,
      durationSec: 42,
    });
  });
});
