import type { JointName, Landmark, PoseSample } from '../types';
import type { AngleSmoother } from './angleSmoother';
import { computeFlatAngles, computeJointAngles } from './angles';
import { computeFormMetrics } from './formMetrics';

/** A landmark as the detector returns it: visibility may be missing. */
export interface RawLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface PoseSampleInput {
  /** Master-clock seconds; becomes PoseFrame.t. */
  t: number;
  /**
   * The frame's time in seconds on the performance timeline. It only paces the
   * smoothing filters, which need a steady clock rather than the master clock.
   */
  filterSeconds: number;
  landmarks: Landmark[] | null;
  worldLandmarks: Landmark[] | null;
  /**
   * The camera frame's width over its height. With it (and a second smoother
   * passed to buildPoseSample) the frame also carries PoseFrame.flatAngles.
   */
  aspect?: number;
  detectMs: number;
  fps: number;
  /**
   * The joints the previous frame measured. They stay measured down to
   * KEEP_MEASURED_VISIBILITY, so a joint hovering at the cutoff does not flicker.
   */
  previousVisible?: readonly JointName[];
}

/** Copies one pose's landmarks into our Landmark type, or null when there is no pose. */
export function normaliseLandmarks(
  raw: readonly RawLandmark[] | null | undefined,
): Landmark[] | null {
  if (!raw || raw.length === 0) return null;
  return raw.map(({ x, y, z, visibility }) => ({ x, y, z, visibility: visibility ?? 0 }));
}

/**
 * Turns one frame's detection into a PoseSample. Without a pose the sample is
 * empty and the smoothers are reset, so the next pose does not ease in from the
 * angles of the one that was lost. `flatSmoother` steadies the flat angles
 * the same way `smoother` steadies the 3D ones; without it, or without
 * `input.aspect`, the frame has no flat angles.
 */
export function buildPoseSample(
  input: PoseSampleInput,
  smoother: AngleSmoother,
  flatSmoother?: AngleSmoother,
): PoseSample {
  const { t, landmarks, worldLandmarks, detectMs, fps } = input;

  if (!landmarks || !worldLandmarks) {
    smoother.reset();
    flatSmoother?.reset();
    return {
      frame: { t, angles: {}, visible: [] },
      landmarks: null,
      worldLandmarks: null,
      form: computeFormMetrics(null),
      detectMs,
      fps,
    };
  }

  const { angles, visible } = computeJointAngles(
    worldLandmarks,
    undefined,
    new Set(input.previousVisible ?? []),
  );
  const frame: PoseSample['frame'] = { t, angles: smoother.smooth(angles, input.filterSeconds), visible };
  if (flatSmoother && input.aspect !== undefined && input.aspect > 0) {
    frame.flatAngles = flatSmoother.smooth(
      computeFlatAngles(landmarks, input.aspect, visible),
      input.filterSeconds,
    );
  }
  return {
    frame,
    landmarks,
    worldLandmarks,
    form: computeFormMetrics(worldLandmarks),
    detectMs,
    fps,
  };
}
