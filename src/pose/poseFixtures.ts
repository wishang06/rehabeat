/** Synthetic poses for the unit tests. Not part of the public API. */
import type { Landmark } from '../types';
import { LM } from './landmarks';

export type LandmarkName = keyof typeof LM;

export const LANDMARK_COUNT = 33;

export function point(x: number, y: number, z = 0, visibility = 1): Landmark {
  return { x, y, z, visibility };
}

/** 33 landmarks at the origin, none of them visible. */
export function hiddenPose(): Landmark[] {
  return Array.from({ length: LANDMARK_COUNT }, () => point(0, 0, 0, 0));
}

/** A copy of `base` with the named landmarks replaced. */
export function withLandmarks(
  base: Landmark[],
  parts: Partial<Record<LandmarkName, Landmark>>,
): Landmark[] {
  const pose = base.map((landmark) => ({ ...landmark }));
  for (const name of Object.keys(parts) as LandmarkName[]) {
    const landmark = parts[name];
    if (landmark) pose[LM[name]] = landmark;
  }
  return pose;
}

/**
 * Upright and facing the camera with the arms hanging straight down, in world
 * metres with y pointing down. Every limb is vertical, so shoulders measure 0
 * degrees and elbows, hips and knees 180. The torso is 0.5 long and the ears
 * sit 0.15 above the shoulders.
 */
export function standingPose(): Landmark[] {
  return withLandmarks(hiddenPose(), {
    nose: point(0, -0.62, -0.1),
    leftEar: point(0.08, -0.65),
    rightEar: point(-0.08, -0.65),
    leftShoulder: point(0.15, -0.5),
    rightShoulder: point(-0.15, -0.5),
    leftElbow: point(0.15, -0.2),
    rightElbow: point(-0.15, -0.2),
    leftWrist: point(0.15, 0.1),
    rightWrist: point(-0.15, 0.1),
    leftHip: point(0.15, 0),
    rightHip: point(-0.15, 0),
    leftKnee: point(0.15, 0.45),
    rightKnee: point(-0.15, 0.45),
    leftAnkle: point(0.15, 0.9),
    rightAnkle: point(-0.15, 0.9),
  });
}
