/** The slice of AudioParam the fader drives, kept narrow so tests can pass a fake. */
export interface RampParam {
  cancelScheduledValues(cancelTime: number): unknown;
  setValueAtTime(value: number, startTime: number): unknown;
  linearRampToValueAtTime(value: number, endTime: number): unknown;
}

/**
 * Fades a gain between a floor (inactive, 0 unless given) and 1 (active) with
 * a linear ramp. Expects the param to be at the floor when the fader is created.
 *
 * Safe to call every frame: a ramp is only scheduled when the state changes.
 * The value a new ramp starts from is computed from the ramp this class last
 * scheduled rather than read back from the param, so reversing mid-ramp does
 * not depend on how promptly the browser reflects automation in
 * AudioParam.value.
 */
export class GainFader {
  private readonly param: RampParam;
  private readonly rampSec: number;
  private readonly floor: number;
  private on = false;
  private from: number;
  private to: number;
  private rampStart = 0;
  private rampEnd = 0;

  constructor(param: RampParam, rampSec = 0.3, floor = 0) {
    this.param = param;
    this.rampSec = rampSec;
    this.floor = floor;
    this.from = floor;
    this.to = floor;
  }

  get active(): boolean {
    return this.on;
  }

  /** The gain this fader has scheduled for `time`. */
  valueAt(time: number): number {
    if (time >= this.rampEnd) return this.to;
    if (time <= this.rampStart) return this.from;
    const progress = (time - this.rampStart) / (this.rampEnd - this.rampStart);
    return this.from + (this.to - this.from) * progress;
  }

  /**
   * Ramps toward 1 (active) or the floor (inactive), starting at `now` from
   * the gain in effect at that moment. Returns true when a new ramp was scheduled.
   */
  setActive(active: boolean, now: number): boolean {
    if (active === this.on) return false;
    const current = this.valueAt(now);
    this.on = active;
    this.from = current;
    this.to = active ? 1 : this.floor;
    this.rampStart = now;
    this.rampEnd = now + this.rampSec;
    this.param.cancelScheduledValues(now);
    this.param.setValueAtTime(current, now);
    this.param.linearRampToValueAtTime(this.to, this.rampEnd);
    return true;
  }
}
