import { JOINT_NAMES } from '../types';
import type { JointName } from '../types';
import { OneEuroFilter } from './oneEuro';
import type { OneEuroOptions } from './oneEuro';

/**
 * Tuned for joint angles in degrees sampled at about 30 fps, so that a limb
 * arriving on the beat is seen arriving on the beat. On a simulated
 * minimum-jerk reach with 2-4° of landmark noise, the smoothed angle crosses
 * the Good line 18 ms (a 0.6 s reach) to 25 ms (a 1.2 s reach) after the raw
 * one; with minCutoff 1.5 and beta 0.02 it was 35 to 46 ms. At rest it
 * jitters 4-10% more than before.
 */
export const ANGLE_MIN_CUTOFF = 1.0;
export const ANGLE_BETA = 0.05;
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
