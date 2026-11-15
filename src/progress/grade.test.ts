import { describe, expect, it } from 'vitest';
import { pointsFor } from '../scoring';
import {
  A_ACCURACY,
  B_ACCURACY,
  MAX_STARS,
  STAR_THRESHOLDS,
  S_ACCURACY,
  gradeFor,
  isSuperstar,
  maxPointsFor,
  scoreFraction,
  starsCrossed,
  starsFor,
  starsForFraction,
} from './grade';

const run = (accuracy: number, miss = 0, moves = 12) => ({ moves, miss, accuracy });

describe('gradeFor', () => {
  it('gives an S for 85 or better with no misses', () => {
    expect(gradeFor(run(S_ACCURACY))).toBe('S');
    expect(gradeFor(run(100))).toBe('S');
  });

  it('holds a run with any miss to an A, however accurate', () => {
    expect(gradeFor(run(97, 1))).toBe('A');
  });

  it('draws each line at its threshold, inclusive', () => {
    expect(gradeFor(run(S_ACCURACY - 0.1))).toBe('A');
    expect(gradeFor(run(A_ACCURACY))).toBe('A');
    expect(gradeFor(run(A_ACCURACY - 0.1))).toBe('B');
    expect(gradeFor(run(B_ACCURACY))).toBe('B');
    expect(gradeFor(run(B_ACCURACY - 0.1))).toBe('C');
    expect(gradeFor(run(0))).toBe('C');
  });

  it('grades a run that scored no moves as a C', () => {
    expect(gradeFor(run(100, 0, 0))).toBe('C');
  });

  it('never gets better as accuracy falls', () => {
    const order = ['S', 'A', 'B', 'C'];
    let worst = 0;
    for (let accuracy = 100; accuracy >= 0; accuracy -= 0.5) {
      const rank = order.indexOf(gradeFor(run(accuracy)));
      expect(rank).toBeGreaterThanOrEqual(worst);
      worst = rank;
    }
  });
});

describe('maxPointsFor', () => {
  it('is every move Perfect in one unbroken combo, read off pointsFor', () => {
    expect(maxPointsFor(0)).toBe(0);
    expect(maxPointsFor(1)).toBe(100);
    expect(maxPointsFor(2)).toBe(100 + 110);
    // The combo bonus tops out at the eleventh move: 1200 base, 550 for moves 1-11, 100 for the twelfth.
    expect(maxPointsFor(12)).toBe(1850);
    let byHand = 0;
    for (let combo = 1; combo <= 30; combo++) byHand += pointsFor('Perfect', combo);
    expect(maxPointsFor(30)).toBe(byHand);
  });
});

describe('scoreFraction (the tube fill)', () => {
  it('is points over the maximum', () => {
    expect(scoreFraction(0, 1850)).toBe(0);
    expect(scoreFraction(925, 1850)).toBe(0.5);
    expect(scoreFraction(1850, 1850)).toBe(1);
  });

  it('stays full past the maximum, and empty with no maximum', () => {
    expect(scoreFraction(4000, 1850)).toBe(1);
    expect(scoreFraction(500, 0)).toBe(0);
    expect(scoreFraction(-10, 1850)).toBe(0);
    expect(scoreFraction(Number.NaN, 1850)).toBe(0);
  });
});

describe('star thresholds', () => {
  it('has five, rising', () => {
    expect(STAR_THRESHOLDS).toHaveLength(MAX_STARS);
    for (let i = 1; i < STAR_THRESHOLDS.length; i++) expect(STAR_THRESHOLDS[i]).toBeGreaterThan(STAR_THRESHOLDS[i - 1]);
  });

  it('gives a star at each threshold, inclusive', () => {
    expect(starsForFraction(0)).toBe(0);
    STAR_THRESHOLDS.forEach((threshold, index) => {
      expect(starsForFraction(threshold - 0.0001)).toBe(index);
      expect(starsForFraction(threshold)).toBe(index + 1);
    });
    expect(starsForFraction(1)).toBe(MAX_STARS);
  });

  it('names the stars a fill passes on its way up, and none on the way down', () => {
    expect(starsCrossed(0, 0.05)).toEqual([]);
    expect(starsCrossed(0, STAR_THRESHOLDS[0])).toEqual([0]);
    expect(starsCrossed(0.2, 0.5)).toEqual([1, 2]);
    expect(starsCrossed(0, 1)).toEqual([0, 1, 2, 3, 4]);
    expect(starsCrossed(0.5, 0.5)).toEqual([]);
    expect(starsCrossed(0.9, 0.2)).toEqual([]);
  });

  it('is SUPERSTAR from the fifth star', () => {
    expect(isSuperstar(STAR_THRESHOLDS[4] - 0.001)).toBe(false);
    expect(isSuperstar(STAR_THRESHOLDS[4])).toBe(true);
    expect(isSuperstar(1)).toBe(true);
  });
});

describe('starsFor', () => {
  const max = maxPointsFor(12);
  const starred = (points: number, moves = 12) => ({ moves, points, maxPoints: max });

  it('gives no stars to a run that scored no moves', () => {
    expect(starsFor({ moves: 0, points: 0, maxPoints: max })).toBe(0);
  });

  it('agrees with the tube: the stars for points / maxPoints', () => {
    for (const points of [0, 100, 300, 600, 925, 1300, 1600, 1850, 2500]) {
      expect(starsFor(starred(points))).toBe(starsForFraction(scoreFraction(points, max)));
    }
  });

  it('gives all five for a perfect run, and fewer for one that ends early', () => {
    expect(starsFor(starred(max))).toBe(MAX_STARS);
    expect(starsFor(starred(maxPointsFor(3), 3))).toBe(1);
  });

  it('measures a run kept from before maxPoints against the moves it scored', () => {
    expect(starsFor({ moves: 12, points: max })).toBe(MAX_STARS);
  });
});
