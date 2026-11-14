import { GOOD_SCORE } from './frameScore';

/** The score that starts a lock: Good. */
export const LOCK_ENTER_SCORE = GOOD_SCORE;
/** Once locked, the score has to fall below this to start letting go. */
export const LOCK_EXIT_SCORE = 50;
/** How long the score has to stay Good before the player counts as in the pose. */
export const LOCK_ENTER_SEC = 0.1;
/** How long the score has to stay under the exit line before the lock lets go. */
export const LOCK_EXIT_SEC = 0.15;

/** One frame's score at its (offset-corrected) time. */
export interface ScoredSample {
  t: number;
  score: number;
}

/**
 * Whether the player is in the pose: the score has been Good for 100 ms, and
 * has not since spent 150 ms under 50. The dwell keeps a limb sweeping
 * through the pose from counting as arriving; the gap between 60 and 50
 * keeps a pose held right at the Good line from flickering.
 */
export class PoseLock {
  private isLocked = false;
  /** Start of the current run of Good-or-better frames, or null. */
  private runSince: number | null = null;
  /** When the score last went under the exit line while locked, or null. */
  private exitSince: number | null = null;

  get locked(): boolean {
    return this.isLocked;
  }

  /**
   * Start of the run of Good-or-better frames behind the lock (or the one
   * that may become a lock), interpolated between frames; null without one.
   */
  get since(): number | null {
    return this.runSince;
  }

  /** Feed every frame in time order. `previous` is the frame before, scored the same way. */
  update(sample: ScoredSample, previous: ScoredSample | null): void {
    if (this.isLocked) {
      if (sample.score >= LOCK_EXIT_SCORE) {
        this.exitSince = null;
        return;
      }
      this.exitSince ??= sample.t;
      if (sample.t - this.exitSince >= LOCK_EXIT_SEC) this.reset();
      return;
    }

    if (sample.score < LOCK_ENTER_SCORE) {
      this.runSince = null;
      return;
    }
    this.runSince ??= crossing(sample, previous);
    if (sample.t - this.runSince >= LOCK_ENTER_SEC) {
      this.isLocked = true;
      this.exitSince = null;
    }
  }

  reset(): void {
    this.isLocked = false;
    this.runSince = null;
    this.exitSince = null;
  }
}

/** When the score rose through the Good line, between the previous frame and this one. */
function crossing(sample: ScoredSample, previous: ScoredSample | null): number {
  if (!previous || previous.score >= LOCK_ENTER_SCORE || !(sample.t > previous.t)) return sample.t;
  const fraction = (LOCK_ENTER_SCORE - previous.score) / (sample.score - previous.score);
  return previous.t + fraction * (sample.t - previous.t);
}
