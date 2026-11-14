import type { JointName } from '../types';

/** Indices into the 33-point pose landmark list. Left/right are the player's own. */
export const LM = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

/** Landmarks must be at least this visible for a joint to be measured. */
export const MIN_VISIBILITY = 0.6;

/**
 * Once a joint is measured it stays measured until a landmark falls below
 * this. Wrists and ankles near the frame edge hover around 0.6; without the
 * gap a joint would drop in and out of scoring from one frame to the next.
 */
export const KEEP_MEASURED_VISIBILITY = 0.5;

/**
 * For each scored joint, the three landmarks [a, vertex, c] whose angle at
 * `vertex` is the joint angle.
 */
export const JOINT_TRIPLETS: Record<JointName, readonly [number, number, number]> = {
  leftShoulder: [LM.leftHip, LM.leftShoulder, LM.leftElbow],
  rightShoulder: [LM.rightHip, LM.rightShoulder, LM.rightElbow],
  leftElbow: [LM.leftShoulder, LM.leftElbow, LM.leftWrist],
  rightElbow: [LM.rightShoulder, LM.rightElbow, LM.rightWrist],
  leftHip: [LM.leftShoulder, LM.leftHip, LM.leftKnee],
  rightHip: [LM.rightShoulder, LM.rightHip, LM.rightKnee],
  leftKnee: [LM.leftHip, LM.leftKnee, LM.leftAnkle],
  rightKnee: [LM.rightHip, LM.rightKnee, LM.rightAnkle],
};

/** Bone segments drawn by the skeleton overlay, as landmark index pairs. */
export const SKELETON_BONES: readonly (readonly [number, number])[] = [
  [LM.leftShoulder, LM.rightShoulder],
  [LM.leftShoulder, LM.leftElbow],
  [LM.leftElbow, LM.leftWrist],
  [LM.rightShoulder, LM.rightElbow],
  [LM.rightElbow, LM.rightWrist],
  [LM.leftShoulder, LM.leftHip],
  [LM.rightShoulder, LM.rightHip],
  [LM.leftHip, LM.rightHip],
  [LM.leftHip, LM.leftKnee],
  [LM.leftKnee, LM.leftAnkle],
  [LM.rightHip, LM.rightKnee],
  [LM.rightKnee, LM.rightAnkle],
];
