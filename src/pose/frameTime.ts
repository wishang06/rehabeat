/** The parts of VideoFrameCallbackMetadata that carry a frame's time. */
export interface FrameTimeMetadata {
  captureTime?: number;
  expectedDisplayTime?: number;
}

/** A capture time further than this from `now` is taken to be on another timeline. */
export const MAX_CAPTURE_SKEW_MS = 1000;

/** Smallest step between two timestamps handed to the detector. */
export const MIN_TIMESTAMP_STEP_MS = 1;

/** Weight of the newest interval in the smoothed frame rate. */
export const FPS_SMOOTHING = 0.1;

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * The best available time for a video frame, on the performance.now() timeline:
 * when the camera captured it, else when it is expected on screen, else `now`.
 */
export function pickFrameTime(now: number, metadata?: FrameTimeMetadata): number {
  const captureTime = metadata?.captureTime;
  if (isFiniteNumber(captureTime) && Math.abs(now - captureTime) <= MAX_CAPTURE_SKEW_MS) {
    return captureTime;
  }
  const expectedDisplayTime = metadata?.expectedDisplayTime;
  if (isFiniteNumber(expectedDisplayTime)) return expectedDisplayTime;
  return now;
}

/**
 * The timestamp to hand to the detector for a frame at `frameMs`. The detector
 * rejects timestamps that repeat or go backwards, so the result is always at
 * least one step past the previous one. `previousMs` is null before the first
 * frame.
 */
export function nextDetectTimestamp(frameMs: number, previousMs: number | null): number {
  if (previousMs === null) return Number.isFinite(frameMs) ? frameMs : 0;
  const earliest = previousMs + MIN_TIMESTAMP_STEP_MS;
  return Number.isFinite(frameMs) && frameMs > earliest ? frameMs : earliest;
}

/**
 * Exponentially smoothed frames per second. `previousFps` of 0 means no
 * estimate yet; an unusable interval leaves the estimate unchanged.
 */
export function smoothFps(
  previousFps: number,
  intervalMs: number,
  weight: number = FPS_SMOOTHING,
): number {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return previousFps;
  const instantFps = 1000 / intervalMs;
  return previousFps > 0 ? previousFps + weight * (instantFps - previousFps) : instantFps;
}
