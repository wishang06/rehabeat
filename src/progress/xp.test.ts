import { describe, expect, it } from 'vitest';
import {
  DAILY_BONUS,
  FIRST_LEVEL_XP,
  GRADE_BONUS,
  LEVEL_STEP_XP,
  XP_PER_GOOD,
  XP_PER_MISS,
  XP_PER_PERFECT,
  levelFor,
  xpForLevel,
  xpForRun,
  xpToReach,
} from './xp';

describe('xpForRun', () => {
  const run = { moves: 6, perfect: 3, good: 2, miss: 1 };

  it('adds up the moves, the grade bonus and the daily bonus', () => {
    const moves = 3 * XP_PER_PERFECT + 2 * XP_PER_GOOD + XP_PER_MISS;
    expect(xpForRun(run, 'A', true)).toEqual({
      moves,
      grade: GRADE_BONUS.A,
      daily: DAILY_BONUS,
      total: moves + GRADE_BONUS.A + DAILY_BONUS,
    });
  });

  it('gives the daily bonus only for the first run of the day', () => {
    expect(xpForRun(run, 'A', false).daily).toBe(0);
    expect(xpForRun(run, 'A', true).total - xpForRun(run, 'A', false).total).toBe(DAILY_BONUS);
  });

  it('pays more for a better grade', () => {
    expect(GRADE_BONUS.S).toBeGreaterThan(GRADE_BONUS.A);
    expect(GRADE_BONUS.A).toBeGreaterThan(GRADE_BONUS.B);
    expect(GRADE_BONUS.B).toBeGreaterThan(GRADE_BONUS.C);
  });

  it('pays more for a Perfect than a Good, and more for a Good than a Miss', () => {
    expect(XP_PER_PERFECT).toBeGreaterThan(XP_PER_GOOD);
    expect(XP_PER_GOOD).toBeGreaterThan(XP_PER_MISS);
  });

  it('earns nothing for a run that scored no moves, even on the first run of the day', () => {
    expect(xpForRun({ moves: 0, perfect: 0, good: 0, miss: 0 }, 'C', true)).toEqual({
      moves: 0,
      grade: 0,
      daily: 0,
      total: 0,
    });
  });
});

describe('levels', () => {
  it('starts at level 1 with nothing earned', () => {
    expect(levelFor(0)).toEqual({ level: 1, into: 0, span: FIRST_LEVEL_XP, fraction: 0 });
  });

  it('costs 50 XP more for each level', () => {
    expect(xpForLevel(1)).toBe(FIRST_LEVEL_XP);
    expect(xpForLevel(2)).toBe(FIRST_LEVEL_XP + LEVEL_STEP_XP);
    expect(xpForLevel(5)).toBe(FIRST_LEVEL_XP + 4 * LEVEL_STEP_XP);
  });

  it('starts each level where the costs before it add up to', () => {
    expect(xpToReach(1)).toBe(0);
    expect(xpToReach(2)).toBe(100);
    expect(xpToReach(3)).toBe(250);
    expect(xpToReach(4)).toBe(450);
    for (let level = 1; level < 30; level++) {
      expect(xpToReach(level + 1) - xpToReach(level)).toBe(xpForLevel(level));
    }
  });

  it('moves up exactly at the threshold', () => {
    expect(levelFor(99).level).toBe(1);
    expect(levelFor(100)).toEqual({ level: 2, into: 0, span: 150, fraction: 0 });
    expect(levelFor(249).level).toBe(2);
    expect(levelFor(250).level).toBe(3);
  });

  it('reports how far into the level the player is', () => {
    expect(levelFor(175)).toEqual({ level: 2, into: 75, span: 150, fraction: 0.5 });
  });

  it('is consistent with xpToReach at every total', () => {
    for (let xp = 0; xp <= 5000; xp += 7) {
      const { level, into, span } = levelFor(xp);
      expect(xpToReach(level) + into).toBe(xp);
      expect(into).toBeLessThan(span);
    }
  });

  it('treats a negative, fractional or broken total as the nearest sound one', () => {
    expect(levelFor(-50).level).toBe(1);
    expect(levelFor(Number.NaN).level).toBe(1);
    expect(levelFor(100.9)).toEqual(levelFor(100));
  });
});
