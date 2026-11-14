import type { PoseFrame } from '../types';
import type { BeatEngine } from './beatEngine';

/** One detected arm raise. `t` is the master-clock time at which the arm arrived at the top. */
export interface ArmRaise {
  t: number;
  peakDeg: number;
}

export interface ArmRaiseDetectorOptions {
  /** A raise begins when the arm angle rises above this. Default 50. */
  upDeg?: number;
  /** The arm counts as lowered below this. Default 30. */
  downDeg?: number;
  /** How far from upDeg toward the peak counts as having arrived, 0-1. Default 0.9. */
  arrivalFraction?: number;
  /** A raise held longer than this is closed without waiting for the arm to drop. Default 1.5. */
  maxRaiseSec?: number;
}

interface Sample {
  t: number;
  deg: number;
}

/** The larger visible shoulder angle, or null when neither arm is visible. */
function armAngle(frame: PoseFrame): number | null {
  const { leftShoulder, rightShoulder } = frame.angles;
  const visible = [leftShoulder, rightShoulder].filter(
    (deg): deg is number => typeof deg === 'number' && Number.isFinite(deg),
  );
  return visible.length > 0 ? Math.max(...visible) : null;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Finds arm raises in a stream of pose frames and reports when the arm
 * arrived at the top of each one, not when it first moved: scoring measures
 * being at the pose, so that is the moment latency has to be measured at.
 */
export class ArmRaiseDetector {
  private readonly upDeg: number;
  private readonly downDeg: number;
  private readonly arrivalFraction: number;
  private readonly maxRaiseSec: number;
  /** True once the arm has been seen lowered since the last raise began. */
  private lowered = false;
  private previous: Sample | null = null;
  /** The raise in progress: the last sample before it began, then every sample in it. Empty when idle. */
  private raise: Sample[] = [];
  private raiseBegan = 0;

  constructor(options: ArmRaiseDetectorOptions = {}) {
    this.upDeg = options.upDeg ?? 50;
    this.downDeg = options.downDeg ?? 30;
    this.arrivalFraction = clamp01(options.arrivalFraction ?? 0.9);
    this.maxRaiseSec = options.maxRaiseSec ?? 1.5;
  }

  /** Feed every frame. Returns a completed raise when one finishes, else null. */
  push(frame: PoseFrame): ArmRaise | null {
    const deg = armAngle(frame);
    if (deg === null) return null;
    const sample: Sample = { t: frame.t, deg };
    const before = this.previous;
    this.previous = sample;

    if (this.raise.length > 0) {
      if (deg < this.downDeg) {
        this.lowered = true;
        return this.complete();
      }
      // Timed out with the arm still up: `lowered` stays false, so holding the arm up yields one raise.
      if (sample.t - this.raiseBegan >= this.maxRaiseSec) return this.complete();
      this.raise.push(sample);
      return null;
    }

    if (deg < this.downDeg) {
      this.lowered = true;
    } else if (this.lowered && deg > this.upDeg && before) {
      this.lowered = false;
      this.raiseBegan = sample.t;
      this.raise = [before, sample];
    }
    return null;
  }

  /** Completes a raise still in progress (call at the end of calibration). */
  flush(): ArmRaise | null {
    return this.raise.length > 0 ? this.complete() : null;
  }

  reset(): void {
    this.lowered = false;
    this.previous = null;
    this.raise = [];
  }

  private complete(): ArmRaise {
    const samples = this.raise;
    this.raise = [];

    const peakDeg = Math.max(...samples.slice(1).map((sample) => sample.deg));
    // Capped at the peak so rounding can never put the arrival level out of reach.
    const arrivalDeg = Math.min(peakDeg, this.upDeg + this.arrivalFraction * (peakDeg - this.upDeg));

    // samples[0] precedes the raise and sits at or below upDeg, so the crossing is always bracketed.
    const reached = samples.findIndex((sample, index) => index > 0 && sample.deg >= arrivalDeg);
    const below = samples[reached - 1];
    const above = samples[reached];
    const fraction = (arrivalDeg - below.deg) / (above.deg - below.deg);
    return { t: below.t + fraction * (above.t - below.t), peakDeg };
  }
}

export interface MatchOptions {
  /** How far before a click a raise may arrive and still belong to it. Default 0.6. */
  beforeSec?: number;
  /** How far after a click a raise may arrive and still belong to it. Default 1.0. */
  afterSec?: number;
}

/**
 * Pairs each click with the nearest raise inside [click - beforeSec, click + afterSec],
 * closest pairs first, using each raise at most once. Returns arrival minus
 * click time in ms for every click that found a raise, in click order.
 */
export function matchOffsets(
  clickTimes: readonly number[],
  raises: readonly ArmRaise[],
  options: MatchOptions = {},
): number[] {
  const { beforeSec = 0.6, afterSec = 1.0 } = options;

  const candidates = clickTimes
    .flatMap((clickTime, click) =>
      raises.map((raise, raiseIndex) => ({ click, raiseIndex, offsetSec: raise.t - clickTime })),
    )
    .filter(({ offsetSec }) => offsetSec >= -beforeSec && offsetSec <= afterSec)
    .sort((a, b) => Math.abs(a.offsetSec) - Math.abs(b.offsetSec));

  const offsetByClick = new Map<number, number>();
  const usedRaises = new Set<number>();
  for (const { click, raiseIndex, offsetSec } of candidates) {
    if (offsetByClick.has(click) || usedRaises.has(raiseIndex)) continue;
    offsetByClick.set(click, offsetSec);
    usedRaises.add(raiseIndex);
  }

  return [...offsetByClick.entries()]
    .sort(([clickA], [clickB]) => clickA - clickB)
    .map(([, offsetSec]) => offsetSec * 1000);
}

/** The middle value, or the mean of the two middle values. NaN for an empty list. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export interface CalibrationResult {
  /** Median of samplesMs: how late (positive) the arm arrives relative to the click. */
  offsetMs: number;
  /** One arrival-minus-click offset per matched click, in click order. */
  samplesMs: number[];
}

export interface CalibrationSessionOptions {
  /** Default 4. */
  clicks?: number;
  /** Seconds between clicks. Default two beats at 72 BPM. */
  intervalSec?: number;
  /** Seconds from start() to the first click. Default 2. */
  leadInSec?: number;
}

const DEFAULT_CLICKS = 4;
const DEFAULT_INTERVAL_SEC = (60 / 72) * 2;
const DEFAULT_LEAD_IN_SEC = 2;
/** Time allowed after the last click for the last raise to arrive. */
const DONE_GRACE_SEC = 1.2;
const MIN_MATCHED_CLICKS = 3;

/**
 * Latency calibration: plays a few clicks, watches the player raise an arm on
 * each one, and reports the median of (arm arrival - click time).
 */
export class CalibrationSession {
  private readonly engine: Pick<BeatEngine, 'clock' | 'playClick'>;
  private readonly clicks: number;
  private readonly intervalSec: number;
  private readonly leadInSec: number;
  private readonly detector = new ArmRaiseDetector();
  private raises: ArmRaise[] = [];
  private scheduled: number[] = [];

  constructor(
    engine: Pick<BeatEngine, 'clock' | 'playClick'>,
    options: CalibrationSessionOptions = {},
  ) {
    this.engine = engine;
    this.clicks = options.clicks ?? DEFAULT_CLICKS;
    this.intervalSec = options.intervalSec ?? DEFAULT_INTERVAL_SEC;
    this.leadInSec = options.leadInSec ?? DEFAULT_LEAD_IN_SEC;
  }

  /**
   * Schedules all clicks now and records their master-clock times. The
   * AudioContext must already be running. Calling it again starts over.
   */
  start(): void {
    const firstClick = this.engine.clock.now() + this.leadInSec;
    this.scheduled = Array.from({ length: this.clicks }, (_, i) => firstClick + i * this.intervalSec);
    this.raises = [];
    this.detector.reset();
    for (const time of this.scheduled) this.engine.playClick(time);
  }

  /** Master-clock times of the clicks. Empty until start(). */
  get clickTimes(): readonly number[] {
    return this.scheduled;
  }

  pushFrame(frame: PoseFrame): void {
    const raise = this.detector.push(frame);
    if (raise) this.raises.push(raise);
  }

  /** How many clicks have sounded by `clockTime` (default clock.audibleNow()). */
  clicksPlayed(clockTime: number = this.engine.clock.audibleNow()): number {
    return this.scheduled.filter((time) => time <= clockTime).length;
  }

  /** True once the last click plus a 1.2 s grace period has passed. False until start(). */
  isDone(clockTime: number = this.engine.clock.audibleNow()): boolean {
    const lastClick = this.scheduled.at(-1);
    return lastClick !== undefined && clockTime >= lastClick + DONE_GRACE_SEC;
  }

  /**
   * The measured offset, or null when fewer than 3 clicks were matched to an
   * arm raise. Closes any raise still in progress, so call it once isDone().
   */
  result(): CalibrationResult | null {
    const unfinished = this.detector.flush();
    if (unfinished) this.raises.push(unfinished);
    const samplesMs = matchOffsets(this.scheduled, this.raises);
    if (samplesMs.length < MIN_MATCHED_CLICKS) return null;
    return { offsetMs: median(samplesMs), samplesMs };
  }
}
