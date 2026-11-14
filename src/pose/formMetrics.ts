import type { FormMetrics, Landmark } from '../types';
import { LM, MIN_VISIBILITY } from './landmarks';
import { isVisible } from './visibility';

const RAD_TO_DEG = 180 / Math.PI;
/** Torso lengths (metres) at or below this cannot be divided by safely. */
const MIN_TORSO_LENGTH = 1e-6;

const EAR_SHOULDER_SIDES = [
  [LM.leftEar, LM.leftShoulder],
  [LM.rightEar, LM.rightShoulder],
] as const;

/**
 * Mean vertical ear-to-shoulder gap over the visible sides, in metres.
 * World y points down, so the gap is positive when the ear is above the shoulder.
 */
function meanEarShoulderGap(world: Landmark[], minVisibility: number): number | null {
  let total = 0;
  let sides = 0;
  for (const [earIndex, shoulderIndex] of EAR_SHOULDER_SIDES) {
    const ear = world[earIndex];
    const shoulder = world[shoulderIndex];
    if (!isVisible(ear, minVisibility) || !isVisible(shoulder, minVisibility)) continue;
    total += shoulder.y - ear.y;
    sides += 1;
  }
  return sides > 0 ? total / sides : null;
}

/** Form measurements from WORLD landmarks. See FormMetrics in src/types.ts. */
export function computeFormMetrics(
  world: Landmark[] | null,
  minVisibility: number = MIN_VISIBILITY,
): FormMetrics {
  const unmeasured: FormMetrics = { trunkLeanDeg: null, shoulderEarRatio: null };
  if (!world) return unmeasured;

  const leftShoulder = world[LM.leftShoulder];
  const rightShoulder = world[LM.rightShoulder];
  const leftHip = world[LM.leftHip];
  const rightHip = world[LM.rightHip];
  if (
    !isVisible(leftShoulder, minVisibility) ||
    !isVisible(rightShoulder, minVisibility) ||
    !isVisible(leftHip, minVisibility) ||
    !isVisible(rightHip, minVisibility)
  ) {
    return unmeasured;
  }

  // Shoulder midpoint minus hip midpoint.
  const dx = (leftShoulder.x + rightShoulder.x - leftHip.x - rightHip.x) / 2;
  const dy = (leftShoulder.y + rightShoulder.y - leftHip.y - rightHip.y) / 2;
  const dz = (leftShoulder.z + rightShoulder.z - leftHip.z - rightHip.z) / 2;

  const trunkLeanDeg = Math.atan2(Math.abs(dx), Math.abs(dy)) * RAD_TO_DEG;

  const torsoLength = Math.hypot(dx, dy, dz);
  const gap = meanEarShoulderGap(world, minVisibility);
  const shoulderEarRatio =
    gap !== null && torsoLength > MIN_TORSO_LENGTH ? gap / torsoLength : null;

  return { trunkLeanDeg, shoulderEarRatio };
}
