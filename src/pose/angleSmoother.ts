import { JOINT_NAMES } from '../types';
import type { JointName } from '../types';
import { OneEuroFilter } from './oneEuro';
import type { OneEuroOptions } from './oneEuro';

/** Tuned for joint angles in degrees sampled at about 30 fps. */
export const ANGLE_MIN_CUTOFF = 1.5;
export const ANGLE_BETA = 0.02;
export const ANGLE_D_CUTOFF = 1.0;

/** One One Euro filter per scored joint. */
export class AngleSmoother {
  private readonly filters = new Map<JointName, OneEuroFilter>();

  constructor(options: OneEuroOptions = {}) {
    const resolved: OneEuroOptions = {
      minCutoff: options.minCutoff ?? ANGLE_MIN_CUTOFF,
      beta: options.beta ?? ANGLE_BETA,
      dCutoff: options.dCutoff ?? ANGLE_D_CUTOFF,
    };
    for (const joint of JOINT_NAMES) {
      this.filters.set(joint, new OneEuroFilter(resolved));
    }
  }

  /**
   * Smoothed angles for the joints present in `angles`. A joint that is absent
   * has its filter reset, so when it reappears it starts from the new reading
   * instead of easing in from a stale one.
   */
  smooth(
    angles: Partial<Record<JointName, number>>,
    tSeconds: number,
  ): Partial<Record<JointName, number>> {
    const smoothed: Partial<Record<JointName, number>> = {};
    for (const [joint, filter] of this.filters) {
      const angle = angles[joint];
      if (angle === undefined || !Number.isFinite(angle)) {
        filter.reset();
        continue;
      }
      smoothed[joint] = filter.filter(angle, tSeconds);
    }
    return smoothed;
  }

  reset(): void {
    for (const filter of this.filters.values()) filter.reset();
  }
}
