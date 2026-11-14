import type { BeatLabel, JointName } from '../types';

/** How one scored joint did over one hold. */
export interface JointHold {
  /** The joint's target, as a game angle (see src/types.ts). */
  target: number;
  /**
   * Mean of (measured - target) in degrees over the part of the hold in which
   * the joint was visible, weighted by time like the hold's score. Signed, so
   * it says which way the joint was off. 0 when it was never visible: read it
   * together with `seen`.
   */
  meanError: number;
  /** 0 to 1: the share of the hold's covered time in which the joint was visible. 0 when no frame covered the hold. */
  seen: number;
}

/**
 * Everything measured about one move cycle: the BeatResult's numbers plus
 * where each joint was, which form rules were flagged and which limited
 * joints went past their limit. This is what a program session records.
 */
export interface HoldDetail {
  /** 0-based count of cycles since the routine began. */
  cycleIndex: number;
  moveId: string;
  /** 0-100, the same score as the cycle's BeatResult. */
  score: number;
  label: BeatLabel;
  timingOffsetMs: number;
  /** One entry per joint the move scores. */
  joints: Partial<Record<JointName, JointHold>>;
  /** Form-rule ids flagged during the reach or the hold, each once, in the order first flagged. */
  formFlags: string[];
  /** Limited joints that stayed past their limit at any point in the cycle, each once. */
  overLimit: JointName[];
}
