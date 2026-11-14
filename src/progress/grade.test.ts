import { describe, expect, it } from 'vitest';
import { GOOD_SCORE, PERFECT_SCORE } from '../scoring';
import { A_ACCURACY, B_ACCURACY, MAX_STARS, S_ACCURACY, gradeFor, starsFor } from './grade';

const run = (accuracy: number, miss = 0, moves = 12) => ({ moves, miss, accuracy });

describe('gradeFor', () => {
  it('gives an S for 90 or better with no misses', () => {
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

describe('starsFor', () => {
  it('gives no stars to a run that scored no moves', () => {
    expect(starsFor(run(100, 0, 0))).toBe(0);
  });

  it('gives one star for finishing a move', () => {
    expect(starsFor(run(0, 12))).toBe(1);
    expect(starsFor(run(GOOD_SCORE - 0.1))).toBe(1);
  });

  it('gives two stars for averaging Good and three for averaging Perfect', () => {
    expect(starsFor(run(GOOD_SCORE))).toBe(2);
    expect(starsFor(run(PERFECT_SCORE - 0.1))).toBe(2);
    expect(starsFor(run(PERFECT_SCORE))).toBe(MAX_STARS);
    expect(starsFor(run(100))).toBe(MAX_STARS);
  });

  it('does not take misses into account, only the mean score', () => {
    expect(starsFor(run(PERFECT_SCORE, 3))).toBe(MAX_STARS);
  });
});
