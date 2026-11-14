/**
 * Shared contracts for Rehabeat Part 1.
 *
 * PoseFrame, Move and BeatResult are locked: teammates build against them.
 * Everything else here is internal plumbing between src/pose, src/scoring,
 * src/audio and the UI.
 */

export const JOINT_NAMES = [
  'leftShoulder',
  'rightShoulder',
  'leftElbow',
  'rightElbow',
  'leftHip',
  'rightHip',
  'leftKnee',
  'rightKnee',
] as const;

/**
 * The eight scored joints. Left and right are the player's own left and right.
 *
 * - shoulder: arm raise, the hip-shoulder-elbow angle (0 = arm at the side, 180 = overhead)
 * - elbow: the shoulder-elbow-wrist angle (180 = straight)
 * - hip: hip flexion, the shoulder-hip-knee angle (180 = standing straight)
 * - knee: the hip-knee-ankle angle (180 = straight)
 */
export type JointName = (typeof JOINT_NAMES)[number];

/**
 * One processed video frame. LOCKED.
 *
 * `t` is master-clock seconds (the AudioContext.currentTime timeline).
 * `angles` are smoothed, in degrees (0-180), and only hold joints whose
 * landmarks were all visible. `visible` lists those same joints.
 */
export interface PoseFrame {
  t: number;
  angles: Partial<Record<JointName, number>>;
  visible: JointName[];
}

/**
 * A rehab move. LOCKED: this is the shape of each entry in src/moves/moves.json.
 *
 * `joints` are the target angles in degrees; only these joints are scored.
 * `tolerance` is the mean angle error (degrees) at which a hold still counts as Good.
 * `beats` is how many beats each phase of the move lasts.
 * `formRules` are form-guidance rule ids (see src/scoring/formRules.ts).
 */
export interface Move {
  id: string;
  name: string;
  joints: Partial<Record<JointName, number>>;
  tolerance: number;
  beats: { reach: number; hold: number; release: number };
  formRules: string[];
}

export type BeatLabel = 'Perfect' | 'Good' | 'Miss';

/**
 * The result of one move cycle. LOCKED.
 *
 * `score` is 0-100, the mean frame score over the hold window.
 * `timingOffsetMs` is how late (positive) or early (negative) the player
 * arrived at the pose relative to the first hold beat.
 */
export interface BeatResult {
  moveId: string;
  score: number;
  label: BeatLabel;
  timingOffsetMs: number;
  formNote?: string;
}

/** A pose landmark. Image landmarks are normalised 0-1; world landmarks are metres. */
export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

/** Per-frame body measurements that the form-guidance rules read. */
export interface FormMetrics {
  /**
   * Sideways tilt of the trunk in degrees (>= 0): the angle between vertical
   * and the line from the hip midpoint to the shoulder midpoint, measured in
   * the frontal plane. null when shoulders or hips are not visible.
   */
  trunkLeanDeg: number | null;
  /**
   * Vertical ear-to-shoulder distance divided by torso length, averaged over
   * the visible sides. It shrinks as the shoulders rise toward the ears.
   * null when not measurable.
   */
  shoulderEarRatio: number | null;
}

/** Everything the pose pipeline emits for one video frame. */
export interface PoseSample {
  frame: PoseFrame;
  /** Normalised image landmarks (33 of them), or null when no pose was found. */
  landmarks: Landmark[] | null;
  /** World landmarks in metres, hip-centred, or null when no pose was found. */
  worldLandmarks: Landmark[] | null;
  form: FormMetrics;
  /** Time spent inside the detector for this frame, in ms. */
  detectMs: number;
  /** Smoothed frames per second of the detection loop. */
  fps: number;
}

/** public/songs/<id>/beatmap.json. `offset` and `beats` are seconds from the start of the track. */
export interface Beatmap {
  bpm: number;
  offset: number;
  beats: number[];
}
