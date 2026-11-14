/** The slice of AudioContext the clock reads, kept narrow so tests can pass a fake. */
export interface ClockContext {
  readonly currentTime: number;
  readonly baseLatency?: number;
  readonly outputLatency?: number;
  getOutputTimestamp?(): { contextTime?: number; performanceTime?: number };
}

function isPositive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * The single timeline for audio, scoring and visuals: AudioContext.currentTime.
 * Video frame times live on the performance.now() timeline and are mapped onto it.
 */
export class MasterClock {
  private readonly ctx: ClockContext;
  private readonly perfNow: () => number;

  constructor(ctx: ClockContext, perfNow: () => number = () => performance.now()) {
    this.ctx = ctx;
    this.perfNow = perfNow;
  }

  /** ctx.currentTime: use for scheduling audio. */
  now(): number {
    return this.ctx.currentTime;
  }

  /** Maps a performance.now()-timeline time in ms to master-clock seconds, as heard at the speakers. */
  fromPerformanceTime(perfMs: number): number {
    const stamp = this.ctx.getOutputTimestamp?.();
    const contextTime = stamp?.contextTime;
    const performanceTime = stamp?.performanceTime;
    if (isPositive(contextTime) && isPositive(performanceTime)) {
      return contextTime + (perfMs - performanceTime) / 1000;
    }
    // The timestamp is all zeros until the context is running, and some browsers lack the method.
    const latency = this.ctx.outputLatency || this.ctx.baseLatency || 0;
    return this.ctx.currentTime - latency - (this.perfNow() - perfMs) / 1000;
  }

  /** fromPerformanceTime(performance.now()): what is audible right now. Use for visuals and scoring. */
  audibleNow(): number {
    return this.fromPerformanceTime(this.perfNow());
  }
}
