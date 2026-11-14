import type { BeatLabel, JointName, Move, PoseFrame } from '../types';

export const PERFECT_SCORE = 85;
export const GOOD_SCORE = 60;

/**
 * Points lost per tolerance-worth of mean error. A mean error equal to the
 * move's tolerance therefore scores exactly GOOD_SCORE, which is what
 * "tolerance" means to whoever authors a move.
 */
const POINTS_PER_TOLERANCE = 100 - GOOD_SCORE;

/** The mean error at which the score bottoms out at 0 (2.5 tolerances). */
export function zeroScoreError(tolerance: number): number {
  return (tolerance * 100) / POINTS_PER_TOLERANCE;
}

/**
 * Mean absolute angle error in degrees over the move's joints only.
 * A target joint that is not visible counts as a zero-score error, so hiding
 * a limb never scores better than attempting the move.
 */
export function meanAngleError(frame: PoseFrame, move: Move): number {
  const targets = Object.entries(move.joints) as [JointName, number][];
  if (targets.length === 0) return zeroScoreError(move.tolerance);

  const missing = zeroScoreError(move.tolerance);
  let total = 0;
  for (const [joint, target] of targets) {
    const angle = frame.angles[joint];
    total += angle === undefined ? missing : Math.abs(angle - target);
  }
  return total / targets.length;
}

/** 0-100: 100 at no error, GOOD_SCORE at one tolerance, 0 at 2.5 tolerances. */
export function scoreFromError(meanError: number, tolerance: number): number {
  const score = 100 - (POINTS_PER_TOLERANCE * meanError) / tolerance;
  return Math.min(100, Math.max(0, score));
}

export function scoreFrame(frame: PoseFrame, move: Move): number {
  return scoreFromError(meanAngleError(frame, move), move.tolerance);
}

export function labelFor(score: number): BeatLabel {
  if (score >= PERFECT_SCORE) return 'Perfect';
  if (score >= GOOD_SCORE) return 'Good';
  return 'Miss';
}
