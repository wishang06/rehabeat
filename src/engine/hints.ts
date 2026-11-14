import type { JointName } from '../types';

/** A joint further off than this many tolerances is red; up to it, amber. */
export const RED_AFTER_TOLERANCES = 2;

/**
 * Once a joint is the hint, another joint has to be this many degrees worse
 * to take over, so the hint doesn't flicker between two similar errors.
 */
export const HINT_SWITCH_MARGIN_DEG = 8;

/**
 * Green within one tolerance (on its own, that joint would still score Good),
 * amber within two, red beyond.
 */
export function jointStatus(errorDeg: number, tolerance: number): 'green' | 'amber' | 'red' {
  if (errorDeg <= tolerance) return 'green';
  if (errorDeg <= tolerance * RED_AFTER_TOLERANCES) return 'amber';
  return 'red';
}

const sideOf = (joint: JointName) => (joint.startsWith('left') ? 'left' : 'right');

/**
 * Two to four words saying which way to move a joint, in the player's own
 * left and right. Angles are as in src/types.ts: shoulders open as the arm
 * rises, hips close as the knee comes up, elbows and knees are 180 straight.
 */
export function hintText(joint: JointName, currentDeg: number, targetDeg: number): string {
  const side = sideOf(joint);
  const below = currentDeg < targetDeg;
  if (joint.endsWith('Shoulder')) return `${side} arm ${below ? 'higher' : 'lower'}`;
  if (joint.endsWith('Hip')) return `${side} knee ${below ? 'lower' : 'higher'}`;
  const part = joint.endsWith('Elbow') ? 'elbow' : 'knee';
  return below ? `straighten ${side} ${part}` : `bend ${side} ${part}`;
}

/**
 * The joint a hint should be about: the largest error among joints that are
 * out of tolerance. The current hint joint is kept while it is still out of
 * tolerance unless another is worse by HINT_SWITCH_MARGIN_DEG.
 */
export function pickHintJoint(
  errors: Partial<Record<JointName, number>>,
  tolerance: number,
  current: JointName | null,
): JointName | null {
  let worst: JointName | null = null;
  let worstError = -Infinity;
  for (const [joint, error] of Object.entries(errors) as [JointName, number][]) {
    if (error > tolerance && error > worstError) {
      worst = joint;
      worstError = error;
    }
  }
  if (worst === null) return null;

  const currentError = current === null ? undefined : errors[current];
  if (
    current !== null &&
    currentError !== undefined &&
    currentError > tolerance &&
    worstError < currentError + HINT_SWITCH_MARGIN_DEG
  ) {
    return current;
  }
  return worst;
}
