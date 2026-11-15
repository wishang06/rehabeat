/**
 * The letter grade and stars for a finished run. Display only: nothing here
 * feeds back into scoring. The grade is read off the run's mean move score;
 * the stars off its points as a share of the most the run could have
 * scored, the same fill the score tube shows during play, so the tube and
 * the results always agree.
 */
import { pointsFor } from '../scoring';

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

export const MAX_STARS = 5;

/**
 * The share of the run's maximum points each star needs, lowest first. The
 * score tube draws its marks here, and SUPERSTAR is all five.
 */
export const STAR_THRESHOLDS = [0.1, 0.25, 0.45, 0.65, 0.85] as const;

/** What the stars need from a run. */
export interface StarredRun {
  /** Moves scored. */
  moves: number;
  points: number;
  /**
   * The most the run could have scored (maxPointsFor its planned moves).
   * Missing for a run kept from before this was recorded: the moves it
   * scored stand in for the plan.
   */
  maxPoints?: number;
}

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

/** The most `moves` moves can score: every one Perfect, in one unbroken combo. Read off pointsFor. */
export function maxPointsFor(moves: number): number {
  let total = 0;
  for (let combo = 1; combo <= Math.floor(moves); combo++) total += pointsFor('Perfect', combo);
  return total;
}

/** Points as a share of the maximum, 0 to 1. Past the maximum (free play beyond one pass of the song) it stays full. */
export function scoreFraction(points: number, maxPoints: number): number {
  if (!(maxPoints > 0) || !(points > 0)) return 0;
  return Math.min(1, points / maxPoints);
}

/** Stars for a fill of the score tube: one for each threshold it has reached. */
export function starsForFraction(fraction: number): number {
  return STAR_THRESHOLDS.filter((threshold) => fraction >= threshold).length;
}

/** The stars (0-based) a fill passes on its way from `before` to `after`, lowest first. None if it went down. */
export function starsCrossed(before: number, after: number): number[] {
  const from = starsForFraction(before);
  const to = starsForFraction(after);
  return Array.from({ length: Math.max(0, to - from) }, (_, index) => from + index);
}

/** All five stars: the tube turns gold. */
export function isSuperstar(fraction: number): boolean {
  return starsForFraction(fraction) >= MAX_STARS;
}

/** Stars for a finished run, from the same fill as the score tube. None for a run that scored no moves. */
export function starsFor(run: StarredRun): number {
  if (run.moves <= 0) return 0;
  return starsForFraction(scoreFraction(run.points, run.maxPoints ?? maxPointsFor(run.moves)));
}
