import { JOINT_NAMES, type JointName, type PoseFrame } from '../types';

/**
 * A doctor's restriction on one joint. `off` means the joint is not to be
 * exercised at all; `range` allows movement up to `maxDeg` from rest.
 */
export type JointLimit = { kind: 'off' } | { kind: 'range'; maxDeg: number };
export type JointLimits = Partial<Record<JointName, JointLimit>>;

/**
 * How far past its limit a joint must read before it counts. A scaled move's
 * target sits exactly on the limit and the camera's reading wobbles around it.
 */
export const LIMIT_MARGIN_DEG = 10;
/** A joint must stay past its limit for longer than this before it is flagged. */
export const LIMIT_PERSIST_MS = 500;

const isShoulder = (joint: JointName) => joint.endsWith('Shoulder');

/**
 * Degrees a joint has moved from rest, which is how a limit is prescribed
 * ("raise up to 90", "bend up to 60"). A shoulder's angle is already that
 * (0 is the arm at the side); elbows, hips and knees are straight at 180.
 */
export function movementOf(joint: JointName, angleDeg: number): number {
  return isShoulder(joint) ? angleDeg : 180 - angleDeg;
}

/** The game angle (as in src/types.ts) at which a joint has moved `movementDeg` from rest. */
export function angleForMovement(joint: JointName, movementDeg: number): number {
  return isShoulder(joint) ? movementDeg : 180 - movementDeg;
}

/**
 * Watches the range-limited joints and reports the ones that have stayed
 * past their limit. Guidance for the player, not a safety system: the angles
 * are estimates from a webcam.
 */
export class LimitWatcher {
  private readonly since = new Map<JointName, number>();
  private readonly watched: [JointName, number][];

  constructor(
    limits: JointLimits,
    private readonly marginDeg = LIMIT_MARGIN_DEG,
    private readonly persistMs = LIMIT_PERSIST_MS,
  ) {
    this.watched = [];
    for (const joint of JOINT_NAMES) {
      const limit = limits[joint];
      // A joint that is off has no number to compare with: its moves are simply never played.
      if (limit?.kind === 'range') this.watched.push([joint, limit.maxDeg]);
    }
  }

  /**
   * Feed one frame's angles at time `t` (seconds). Returns the joints that
   * have been past limit + margin continuously for longer than the
   * persistence window, in JOINT_NAMES order. A joint out of view starts over.
   */
  update(t: number, angles: PoseFrame['angles']): JointName[] {
    const flagged: JointName[] = [];
    for (const [joint, maxDeg] of this.watched) {
      const angle = angles[joint];
      if (angle === undefined || movementOf(joint, angle) <= maxDeg + this.marginDeg) {
        this.since.delete(joint);
        continue;
      }
      const start = this.since.get(joint);
      if (start === undefined) {
        this.since.set(joint, t);
      } else if ((t - start) * 1000 > this.persistMs) {
        flagged.push(joint);
      }
    }
    return flagged;
  }

  reset(): void {
    this.since.clear();
  }
}
