/**
 * Experience points and levels. XP is a progress meter kept in the browser;
 * it is separate from the run's points, which go to the leaderboard.
 */
import type { Grade } from './grade';

export const XP_PER_PERFECT = 10;
export const XP_PER_GOOD = 6;
export const XP_PER_MISS = 1;
export const GRADE_BONUS: Record<Grade, number> = { S: 50, A: 30, B: 15, C: 5 };
/** For the first finished run of a day. */
export const DAILY_BONUS = 20;

/** XP the first level-up costs, and how much more each later one costs. */
export const FIRST_LEVEL_XP = 100;
export const LEVEL_STEP_XP = 50;

export interface XpRun {
  moves: number;
  perfect: number;
  good: number;
  miss: number;
}

export interface XpGain {
  /** From the moves themselves. */
  moves: number;
  /** For the grade. */
  grade: number;
  /** For the first run of the day, or 0. */
  daily: number;
  total: number;
}

/** A run that scored no moves earns nothing, whatever its grade. */
export function xpForRun(run: XpRun, grade: Grade, firstRunToday: boolean): XpGain {
  if (run.moves <= 0) return { moves: 0, grade: 0, daily: 0, total: 0 };
  const moves = run.perfect * XP_PER_PERFECT + run.good * XP_PER_GOOD + run.miss * XP_PER_MISS;
  const bonus = GRADE_BONUS[grade];
  const daily = firstRunToday ? DAILY_BONUS : 0;
  return { moves, grade: bonus, daily, total: moves + bonus + daily };
}

/** XP that going from `level` to the next one costs: 100, 150, 200, ... */
export function xpForLevel(level: number): number {
  return FIRST_LEVEL_XP + LEVEL_STEP_XP * (Math.max(1, Math.floor(level)) - 1);
}

/** Total XP at which `level` starts. Level 1 starts at 0. */
export function xpToReach(level: number): number {
  const steps = Math.max(1, Math.floor(level)) - 1;
  // The sum of the first `steps` level costs.
  return steps * FIRST_LEVEL_XP + (LEVEL_STEP_XP * steps * (steps - 1)) / 2;
}

export interface LevelProgress {
  level: number;
  /** XP earned inside this level. */
  into: number;
  /** XP this level takes from start to finish. */
  span: number;
  /** `into / span`, 0 to 1. */
  fraction: number;
}

export function levelFor(totalXp: number): LevelProgress {
  const xp = Number.isFinite(totalXp) ? Math.max(0, Math.floor(totalXp)) : 0;
  let level = 1;
  while (xp >= xpToReach(level + 1)) level += 1;
  const into = xp - xpToReach(level);
  const span = xpForLevel(level);
  return { level, into, span, fraction: into / span };
}
