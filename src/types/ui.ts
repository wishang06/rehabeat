/**
 * Contracts between the game engine and the UI. src/engine builds these every
 * display frame; screens, HUD panels and the canvas overlay read them.
 * See src/engine/README.md.
 */
import type { JointName } from '../types';

/**
 * A drawn body segment. Each one is driven by exactly one scored joint:
 * upper arm by the shoulder, forearm by the elbow, thigh by the hip, shin by
 * the knee. Left and right are the player's own.
 */
export type LimbName =
  | 'leftUpperArm'
  | 'leftForearm'
  | 'rightUpperArm'
  | 'rightForearm'
  | 'leftThigh'
  | 'leftShin'
  | 'rightThigh'
  | 'rightShin';

/**
 * - green: within the move's tolerance of the target
 * - amber: within two tolerances
 * - red: further off than that
 * - grey: scored, but under the visibility cutoff, so it can't be measured
 * - idle: not being judged right now (the move doesn't score it, or the
 *   phase is the count-in or a release)
 */
export type LimbStatus = 'green' | 'amber' | 'red' | 'grey' | 'idle';

/** `ready` is the count-in before the first move. */
export type FeedbackPhase = 'ready' | 'reach' | 'hold' | 'release';

export interface LimbFeedback {
  limb: LimbName;
  /** The joint whose angle drives this limb. */
  joint: JointName;
  status: LimbStatus;
  /** True when the current move scores this limb's joint. */
  scored: boolean;
  /** |current - target| in degrees. null when not scored or not measured. */
  errorDeg: number | null;
  /** The live, smoothed joint angle in degrees, or null when not measured. */
  currentDeg: number | null;
  /** The move's target angle, or null when the move doesn't score this joint. */
  targetDeg: number | null;
  /**
   * The lowest visibility (0-1) of the three landmarks that measure the
   * joint, or null without a pose. Scoring needs 0.6 or more.
   */
  visibility: number | null;
}

export interface FeedbackHint {
  joint: JointName;
  limb: LimbName;
  /** Two to four words, e.g. "left arm lower", "straighten right elbow". */
  text: string;
  status: 'amber' | 'red';
}

export interface MoveRef {
  id: string;
  name: string;
}

/** Everything a first-time player needs to know about the current moment. */
export interface FeedbackFrame {
  /** Master-clock seconds (the audible AudioContext timeline) this frame describes. */
  t: number;
  phase: FeedbackPhase;
  /** 0 to 1 through the current phase. */
  phaseProgress: number;
  /** Beats until the next phase starts (fractional; Math.ceil it for a countdown). */
  beatsToNextPhase: number;
  /** The move being performed, or null during the count-in. */
  move: MoveRef | null;
  /** The move after this one; during the count-in, the first move. */
  nextMove: MoveRef;
  limbs: Record<LimbName, LimbFeedback>;
  /** The scored, measured joint furthest from its target, or null if there is none. */
  worstJoint: JointName | null;
  /**
   * What to fix, once a joint has been out of tolerance for 300 ms in a reach
   * or hold. null otherwise, and always null while `lowVisibility` is set.
   */
  hint: FeedbackHint | null;
  /** 0 before the hold, rising to 1 through it, 1 after it. */
  holdProgress: number;
  /** 0-100: this frame against the current move, by the scoring formula. */
  score: number;
  /** Mean frame score over the hold so far (from the scoring engine), or null outside it. */
  holdScore: number | null;
  /** True in a reach or hold while `score` is Good or better. */
  onTarget: boolean;
  /** True once any scored joint has been under the visibility cutoff for more than 500 ms. */
  lowVisibility: boolean;
  /** The scored joints that have been under the cutoff for more than 500 ms. */
  hiddenJoints: JointName[];
}
