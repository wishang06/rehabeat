import type { FormMetrics, PoseFrame } from '../types';

/** What calibration measures and scoring applies. */
export interface Calibration {
  /** Median of (arm-up detected time minus click time), in ms. */
  offsetMs: number;
  /** Resting FormMetrics.shoulderEarRatio, or null if it could not be measured. */
  shoulderEarBaseline: number | null;
}

export const DEFAULT_CALIBRATION: Calibration = { offsetMs: 0, shoulderEarBaseline: null };

const STORAGE_KEY = 'rehabeat.calibration';

/** The saved calibration, or null if there is none (or storage is unavailable). */
export function loadCalibration(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): Calibration | null {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { offsetMs, shoulderEarBaseline } = value as Record<string, unknown>;
    if (typeof offsetMs !== 'number' || !Number.isFinite(offsetMs)) return null;
    return {
      offsetMs,
      shoulderEarBaseline:
        typeof shoulderEarBaseline === 'number' && Number.isFinite(shoulderEarBaseline)
          ? shoulderEarBaseline
          : null,
    };
  } catch {
    return null;
  }
}

export function saveCalibration(
  calibration: Calibration,
  storage: Pick<Storage, 'setItem'> | undefined = safeStorage(),
): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(calibration));
  } catch {
    // Private windows can refuse writes; calibration then lasts for this visit only.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** Arms count as resting below this raise angle, in degrees. */
const REST_ARM_DEG = 35;
const MIN_BASELINE_SAMPLES = 15;

/**
 * Collects the resting shoulder-to-ear ratio during calibration, using only
 * frames where both arms are down, so the shrug rule has a baseline to compare with.
 */
export class ShrugBaselineCollector {
  private readonly samples: number[] = [];

  push(frame: PoseFrame, form: FormMetrics): void {
    if (form.shoulderEarRatio === null) return;
    const left = frame.angles.leftShoulder;
    const right = frame.angles.rightShoulder;
    if (left === undefined || right === undefined) return;
    if (left < REST_ARM_DEG && right < REST_ARM_DEG) this.samples.push(form.shoulderEarRatio);
  }

  /** The median resting ratio, or null if too few resting frames were seen. */
  result(): number | null {
    if (this.samples.length < MIN_BASELINE_SAMPLES) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
}
