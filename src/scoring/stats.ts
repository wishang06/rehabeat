import type { BeatResult } from '../types';

export interface Stats {
  /** Moves scored so far. */
  total: number;
  perfect: number;
  good: number;
  miss: number;
  /** Current run of moves that were not a Miss. */
  combo: number;
  bestCombo: number;
  /** Current run of consecutive Perfects. */
  streak: number;
  bestStreak: number;
  /** Mean move score so far, 0-100. */
  accuracy: number;
}

export function initialStats(): Stats {
  return {
    total: 0,
    perfect: 0,
    good: 0,
    miss: 0,
    combo: 0,
    bestCombo: 0,
    streak: 0,
    bestStreak: 0,
    accuracy: 0,
  };
}

export function applyResult(stats: Stats, result: BeatResult): Stats {
  const total = stats.total + 1;
  const combo = result.label === 'Miss' ? 0 : stats.combo + 1;
  const streak = result.label === 'Perfect' ? stats.streak + 1 : 0;
  return {
    total,
    perfect: stats.perfect + (result.label === 'Perfect' ? 1 : 0),
    good: stats.good + (result.label === 'Good' ? 1 : 0),
    miss: stats.miss + (result.label === 'Miss' ? 1 : 0),
    combo,
    bestCombo: Math.max(stats.bestCombo, combo),
    streak,
    bestStreak: Math.max(stats.bestStreak, streak),
    accuracy: (stats.accuracy * stats.total + result.score) / total,
  };
}
