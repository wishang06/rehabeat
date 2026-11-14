/**
 * The letter grade and stars for a finished run. Display only: nothing here
 * feeds back into scoring. Both are read off the run's mean move score, using
 * the same Good and Perfect lines the scoring engine draws.
 */
import { GOOD_SCORE, PERFECT_SCORE } from '../scoring';

export type Grade = 'S' | 'A' | 'B' | 'C';

/** What grading needs from a RunSummary. */
export interface GradedRun {
  /** Moves scored. */
  moves: number;
  miss: number;
  /** Mean move score, 0-100. */
  accuracy: number;
}

/** S needs this accuracy and no misses. */
export const S_ACCURACY = 90;
export const A_ACCURACY = 80;
export const B_ACCURACY = 65;

export const MAX_STARS = 3;

/**
 * S: 90 or better with no misses. A: 80 or better. B: 65 or better. C: the rest.
 * A run that scored no moves is a C.
 */
export function gradeFor(run: GradedRun): Grade {
  if (run.moves <= 0) return 'C';
  if (run.accuracy >= S_ACCURACY && run.miss === 0) return 'S';
  if (run.accuracy >= A_ACCURACY) return 'A';
  if (run.accuracy >= B_ACCURACY) return 'B';
  return 'C';
}

/**
 * One star for finishing a move, two for averaging Good, three for averaging
 * Perfect. None for a run that scored no moves.
 */
export function starsFor(run: GradedRun): number {
  if (run.moves <= 0) return 0;
  if (run.accuracy >= PERFECT_SCORE) return 3;
  if (run.accuracy >= GOOD_SCORE) return 2;
  return 1;
}
