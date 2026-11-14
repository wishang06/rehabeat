export interface OneEuroOptions {
  /** Cutoff in Hz while the signal is still. Lower is smoother but lags more. */
  minCutoff?: number;
  /** How far the cutoff rises per unit of signal speed. 0 gives a fixed low-pass. */
  beta?: number;
  /** Cutoff in Hz of the low-pass applied to the derivative estimate. */
  dCutoff?: number;
}

export const ONE_EURO_DEFAULTS: Required<OneEuroOptions> = {
  minCutoff: 1,
  beta: 0,
  dCutoff: 1,
};

/** Interval assumed until a real one has been seen (webcam video is about 30 fps). */
const FALLBACK_DT_SECONDS = 1 / 30;

/** Weight of the new sample in a first-order low-pass: 1 / (1 + tau / dt). */
function smoothingFactor(cutoffHz: number, dtSeconds: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSeconds);
}

/**
 * One Euro filter: a low-pass whose cutoff rises with the speed of the signal,
 * so it removes jitter while the signal rests and keeps up while it moves.
 *
 *   cutoff = minCutoff + beta * |low-passed derivative|
 */
export class OneEuroFilter {
  private readonly minCutoff: number;
  private readonly beta: number;
  private readonly dCutoff: number;

  private primed = false;
  private lastTime = 0;
  private lastDt = FALLBACK_DT_SECONDS;
  private lastRaw = 0;
  private filtered = 0;
  private derivative = 0;

  constructor(options: OneEuroOptions = {}) {
    this.minCutoff = options.minCutoff ?? ONE_EURO_DEFAULTS.minCutoff;
    this.beta = options.beta ?? ONE_EURO_DEFAULTS.beta;
    this.dCutoff = options.dCutoff ?? ONE_EURO_DEFAULTS.dCutoff;
  }

  /** tSeconds must increase; the first call returns x unchanged. */
  filter(x: number, tSeconds: number): number {
    // A non-finite sample would poison the state for good, so it is skipped.
    if (!Number.isFinite(x)) return this.primed ? this.filtered : x;

    if (!this.primed) {
      this.primed = true;
      this.lastTime = tSeconds;
      this.lastRaw = x;
      this.filtered = x;
      this.derivative = 0;
      return x;
    }

    const elapsed = tSeconds - this.lastTime;
    // A repeated, backwards or non-finite timestamp gives no usable interval.
    // Reusing the last good one keeps the output finite.
    const dt = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : this.lastDt;
    this.lastDt = dt;
    if (Number.isFinite(tSeconds)) this.lastTime = tSeconds;

    const rawDerivative = (x - this.lastRaw) / dt;
    this.derivative += smoothingFactor(this.dCutoff, dt) * (rawDerivative - this.derivative);
    this.lastRaw = x;

    const cutoff = this.minCutoff + this.beta * Math.abs(this.derivative);
    this.filtered += smoothingFactor(cutoff, dt) * (x - this.filtered);
    return this.filtered;
  }

  reset(): void {
    this.primed = false;
    this.lastDt = FALLBACK_DT_SECONDS;
  }
}
