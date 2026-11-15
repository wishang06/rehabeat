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
 * What a target joint the camera cannot see is charged, in tolerances. More
 * than any joint that is in tolerance, so hiding a limb never beats landing
 * it; less than a limb left at rest, because some poses hide a joint when
 * done right (the lifted foot behind the standing leg in Tree Pose) and the
 * player should not be scored as if they had not tried.
 */
export const UNSEEN_JOINT_TOLERANCES = 1.5;

/** The error charged for a target joint that is not visible. */
export function unseenJointError(tolerance: number): number {
  return tolerance * UNSEEN_JOINT_TOLERANCES;
}

/**
 * The angle a joint is judged by: of the frame's two readings of it (3D, and
 * flat in the camera picture when the frame has one), the one nearer
 * `target`. The 3D reading bends straight limbs by its depth error, the flat
 * one cannot see a limb pointing at the camera; a joint is in place if
 * either says so. Undefined when the joint is not visible.
 */
export function jointReading(frame: PoseFrame, joint: JointName, target: number): number | undefined {
  const deep = frame.angles[joint];
  if (deep === undefined) return undefined;
  const flat = frame.flatAngles?.[joint];
  if (flat === undefined) return deep;
  return Math.abs(flat - target) < Math.abs(deep - target) ? flat : deep;
}

/**
 * Mean absolute angle error in degrees over the move's joints only, each
 * joint by its jointReading. A target joint that is not visible is charged
 * unseenJointError. With fewer than half of the move's joints in view there
 * is no pose to judge, and the error is the zero-score error: a player who
 * has stepped out of the picture scores nothing.
 */
export function meanAngleError(frame: PoseFrame, move: Move): number {
  const targets = Object.entries(move.joints) as [JointName, number][];
  if (targets.length === 0) return zeroScoreError(move.tolerance);

  const missing = unseenJointError(move.tolerance);
  let total = 0;
  let seen = 0;
  for (const [joint, target] of targets) {
    const angle = jointReading(frame, joint, target);
    if (angle === undefined) {
      total += missing;
    } else {
      total += Math.abs(angle - target);
      seen++;
    }
  }
  if (seen * 2 < targets.length) return zeroScoreError(move.tolerance);
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
