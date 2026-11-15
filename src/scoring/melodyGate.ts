/** How long the melody rule has to say no before the melody fades back to its quiet level, in beats. */
export const MELODY_HOLD_OFF_BEATS = 0.5;

/**
 * Smooths the melody rule into something that sounds like music: the melody
 * comes in the moment the rule says yes, and only goes out once the rule has
 * said no for `holdOffSec` (half a beat). That covers landing the pose a
 * fraction late at the start of a hold, letting go a fraction early at the
 * end of one, and a wobble in between, none of which should cut the tune.
 */
export class MelodyGate {
  private on = false;
  /** When the rule started saying no while the melody was on, or null. */
  private quietSince: number | null = null;

  constructor(private readonly holdOffSec: number) {}

  /** Feed the rule's answer at master-clock time `now`; returns whether the melody plays. */
  update(now: number, wanted: boolean): boolean {
    if (wanted) {
      this.on = true;
      this.quietSince = null;
    } else if (this.on) {
      this.quietSince ??= now;
      if (now - this.quietSince >= this.holdOffSec) {
        this.on = false;
        this.quietSince = null;
      }
    }
    return this.on;
  }

  reset(): void {
    this.on = false;
    this.quietSince = null;
  }
}
