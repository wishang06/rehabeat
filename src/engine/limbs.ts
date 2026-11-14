import { JOINT_TRIPLETS, LM } from '../pose/landmarks';
import type { JointName, Landmark } from '../types';
import type { LimbName } from '../types/ui';

export interface LimbSpec {
  limb: LimbName;
  /** The scored joint whose angle this limb shows. */
  joint: JointName;
  /** Landmark indices of the limb's two ends, nearest the body first. */
  from: number;
  to: number;
}

/** Every drawn limb, in JOINT_NAMES order of the joint that drives it. */
export const LIMBS: readonly LimbSpec[] = [
  { limb: 'leftUpperArm', joint: 'leftShoulder', from: LM.leftShoulder, to: LM.leftElbow },
  { limb: 'rightUpperArm', joint: 'rightShoulder', from: LM.rightShoulder, to: LM.rightElbow },
  { limb: 'leftForearm', joint: 'leftElbow', from: LM.leftElbow, to: LM.leftWrist },
  { limb: 'rightForearm', joint: 'rightElbow', from: LM.rightElbow, to: LM.rightWrist },
  { limb: 'leftThigh', joint: 'leftHip', from: LM.leftHip, to: LM.leftKnee },
  { limb: 'rightThigh', joint: 'rightHip', from: LM.rightHip, to: LM.rightKnee },
  { limb: 'leftShin', joint: 'leftKnee', from: LM.leftKnee, to: LM.leftAnkle },
  { limb: 'rightShin', joint: 'rightKnee', from: LM.rightKnee, to: LM.rightAnkle },
];

export const LIMB_OF_JOINT = Object.fromEntries(LIMBS.map((spec) => [spec.joint, spec.limb])) as Record<
  JointName,
  LimbName
>;

/**
 * The lowest visibility of the three landmarks that measure `joint`, or null
 * without landmarks. A joint is scored only when this is at least MIN_VISIBILITY.
 */
export function jointVisibility(landmarks: Landmark[] | null, joint: JointName): number | null {
  if (!landmarks) return null;
  let lowest = 1;
  for (const index of JOINT_TRIPLETS[joint]) {
    lowest = Math.min(lowest, landmarks[index]?.visibility ?? 0);
  }
  return lowest;
}
