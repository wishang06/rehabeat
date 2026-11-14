import { describe, expect, it } from 'vitest';
import {
  FPS_SMOOTHING,
  MAX_CAPTURE_SKEW_MS,
  MIN_TIMESTAMP_STEP_MS,
  nextDetectTimestamp,
  pickFrameTime,
  smoothFps,
} from './frameTime';

describe('pickFrameTime', () => {
  it('prefers the capture time', () => {
    expect(pickFrameTime(5000, { captureTime: 4950, expectedDisplayTime: 5016 })).toBe(4950);
  });

  it('accepts a capture time up to 1000 ms from now, in either direction', () => {
    expect(MAX_CAPTURE_SKEW_MS).toBe(1000);
    expect(pickFrameTime(5000, { captureTime: 4000, expectedDisplayTime: 5016 })).toBe(4000);
    expect(pickFrameTime(5000, { captureTime: 6000, expectedDisplayTime: 5016 })).toBe(6000);
  });

  it('rejects a capture time on another timeline', () => {
    expect(pickFrameTime(5000, { captureTime: 3999, expectedDisplayTime: 5016 })).toBe(5016);
    expect(pickFrameTime(5000, { captureTime: 6001, expectedDisplayTime: 5016 })).toBe(5016);
    // A wall-clock (epoch) capture time is nowhere near a performance.now() value.
    expect(pickFrameTime(5000, { captureTime: 1.7e12, expectedDisplayTime: 5016 })).toBe(5016);
  });

  it('falls back to the expected display time when there is no usable capture time', () => {
    expect(pickFrameTime(5000, { expectedDisplayTime: 5016 })).toBe(5016);
    expect(pickFrameTime(5000, { captureTime: Number.NaN, expectedDisplayTime: 5016 })).toBe(5016);
    expect(
      pickFrameTime(5000, { captureTime: Number.POSITIVE_INFINITY, expectedDisplayTime: 5016 }),
    ).toBe(5016);
  });

  it('falls back to now when nothing else is finite', () => {
    expect(pickFrameTime(5000, {})).toBe(5000);
    expect(pickFrameTime(5000)).toBe(5000);
    expect(pickFrameTime(5000, { captureTime: 100, expectedDisplayTime: Number.NaN })).toBe(5000);
    expect(
      pickFrameTime(5000, {
        captureTime: Number.NaN,
        expectedDisplayTime: Number.NEGATIVE_INFINITY,
      }),
    ).toBe(5000);
  });
});

describe('nextDetectTimestamp', () => {
  it('uses the frame time for the first frame', () => {
    expect(nextDetectTimestamp(1234.5, null)).toBe(1234.5);
  });

  it('passes an increasing frame time through', () => {
    expect(nextDetectTimestamp(1033.4, 1000)).toBe(1033.4);
  });

  it('steps past the previous timestamp when the frame time repeats', () => {
    expect(nextDetectTimestamp(1000, 1000)).toBe(1000 + MIN_TIMESTAMP_STEP_MS);
  });

  it('steps past the previous timestamp when the frame time goes backwards', () => {
    expect(nextDetectTimestamp(940, 1000)).toBe(1000 + MIN_TIMESTAMP_STEP_MS);
  });

  it('widens an advance of less than one step to a full step', () => {
    expect(nextDetectTimestamp(1000.4, 1000)).toBe(1000 + MIN_TIMESTAMP_STEP_MS);
  });

  it('never yields a non-finite timestamp', () => {
    expect(nextDetectTimestamp(Number.NaN, null)).toBe(0);
    expect(nextDetectTimestamp(Number.NaN, 1000)).toBe(1000 + MIN_TIMESTAMP_STEP_MS);
    expect(nextDetectTimestamp(Number.POSITIVE_INFINITY, 1000)).toBe(1000 + MIN_TIMESTAMP_STEP_MS);
  });

  it('stays strictly increasing over a jittery run of frame times', () => {
    const frameTimes = [100, 133, 133, 120, 121, 167, 166.9, 200, Number.NaN, 233];
    let previous: number | null = null;
    for (const frameTime of frameTimes) {
      const next = nextDetectTimestamp(frameTime, previous);
      if (previous !== null) {
        expect(next).toBeGreaterThanOrEqual(previous + MIN_TIMESTAMP_STEP_MS);
      }
      previous = next;
    }
    expect(previous).toBe(233);
  });
});

describe('smoothFps', () => {
  it('takes the first interval as the estimate', () => {
    expect(smoothFps(0, 40)).toBe(25);
  });

  it('moves a fraction of the way toward the newest rate', () => {
    // 20 ms is 50 fps; from 30 fps the estimate moves 10% of the way.
    expect(smoothFps(30, 20)).toBeCloseTo(30 + FPS_SMOOTHING * 20, 9);
    expect(smoothFps(30, 20, 0.5)).toBeCloseTo(40, 9);
  });

  it('settles on a steady frame rate', () => {
    let fps = 0;
    for (let i = 0; i < 200; i++) fps = smoothFps(fps, i < 20 ? 100 : 1000 / 30);
    expect(fps).toBeCloseTo(30, 3);
  });

  it('leaves the estimate alone for an unusable interval', () => {
    expect(smoothFps(30, 0)).toBe(30);
    expect(smoothFps(30, -5)).toBe(30);
    expect(smoothFps(30, Number.NaN)).toBe(30);
    expect(smoothFps(30, Number.POSITIVE_INFINITY)).toBe(30);
    expect(smoothFps(0, 0)).toBe(0);
  });
});
