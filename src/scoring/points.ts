import type { BeatLabel } from '../types';
import type { Stats } from './stats';

/** Points for a Perfect and a Good move before the combo bonus. */
export const BASE_POINTS: Record<BeatLabel, number> = { Perfect: 100, Good: 50, Miss: 0 };
/** Each move in an unbroken combo adds this much, up to COMBO_BONUS_CAP. */
export const COMBO_BONUS_STEP = 10;
export const COMBO_BONUS_CAP = 100;
/**
 * The most one move can be worth. The database rejects a run whose points
 * exceed moves * MAX_POINTS_PER_MOVE, so keep the two in step.
 */
export const MAX_POINTS_PER_MOVE = BASE_POINTS.Perfect + COMBO_BONUS_CAP;

/**
 * Points for one scored move. `comboAfter` is the combo including this move,
 * so the first move of a combo earns no bonus and the eleventh earns the cap.
 */
export function pointsFor(label: BeatLabel, comboAfter: number): number {
  if (label === 'Miss') return 0;
  const bonus = Math.min(COMBO_BONUS_CAP, COMBO_BONUS_STEP * Math.max(0, comboAfter - 1));
  return BASE_POINTS[label] + bonus;
}

/** A finished run, as shown on the results screen and saved to the leaderboard. */
export interface RunSummary {
  points: number;
  moves: number;
  perfect: number;
  good: number;
  miss: number;
  bestCombo: number;
  /** Mean move score, 0-100. */
  accuracy: number;
  durationSec: number;
  /**
   * The most the run could have scored: its planned moves, every one Perfect
   * in one unbroken combo. The results screen's stars are read off
   * points / maxPoints. Display only; not saved to the leaderboard.
   */
  maxPoints?: number;
}

export function summarizeRun(stats: Stats, points: number, durationSec: number, maxPoints?: number): RunSummary {
  return {
    ...(maxPoints !== undefined && { maxPoints }),
    points,
    moves: stats.total,
    perfect: stats.perfect,
    good: stats.good,
    miss: stats.miss,
    bestCombo: stats.bestCombo,
    accuracy: Math.round(stats.accuracy * 10) / 10,
    durationSec: Math.max(0, Math.round(durationSec)),
  };
}
