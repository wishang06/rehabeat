import { describe, expect, it } from 'vitest';
import type { JointName, PoseFrame } from '../types';
import { ArmRaiseDetector, CalibrationSession, matchOffsets, median, type ArmRaise } from './calibration';
import { MasterClock } from './clock';

const FPS = 30;
const REST_DEG = 10;

function frame(t: number, left?: number, right?: number): PoseFrame {
  const angles: PoseFrame['angles'] = {};
  const visible: JointName[] = [];
  if (left !== undefined) {
    angles.leftShoulder = left;
    visible.push('leftShoulder');
  }
  if (right !== undefined) {
    angles.rightShoulder = right;
    visible.push('rightShoulder');
  }
  return { t, angles, visible };
}

/** Feeds [time, leftShoulderDeg] pairs and returns what each push returned. */
function feed(detector: ArmRaiseDetector, samples: Array<[number, number]>): Array<ArmRaise | null> {
  return samples.map(([t, deg]) => detector.push(frame(t, deg)));
}

function ease(progress: number): number {
  return (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, progress)))) / 2;
}

/** A smooth raise from rest to `peakDeg` starting at `begin`, held, then lowered again. */
function smoothRaise(t: number, begin: number, peakDeg: number, riseSec = 0.4, holdSec = 0.5): number {
  const up = ease((t - begin) / riseSec);
  const down = ease((t - begin - riseSec - holdSec) / riseSec);
  return REST_DEG + (peakDeg - REST_DEG) * (up - down);
}

/** Seconds into a smoothRaise at which the arm reaches 90% of the way from 50 deg to its peak. */
function arrivalDelay(peakDeg: number, riseSec = 0.4): number {
  const arrivalDeg = 50 + 0.9 * (peakDeg - 50);
  const progress = (arrivalDeg - REST_DEG) / (peakDeg - REST_DEG);
  return (riseSec * Math.acos(1 - 2 * progress)) / Math.PI;
}

/** Frames at 30 fps in which the arm arrives `lateSec` after each of `clickTimes`. */
function framesArrivingLate(clickTimes: readonly number[], lateSec: number, from: number, to: number): PoseFrame[] {
  const peakDeg = 150;
  const begins = clickTimes.map((click) => click + lateSec - arrivalDelay(peakDeg));
  const count = Math.floor((to - from) * FPS);
  return Array.from({ length: count + 1 }, (_, i) => {
    const t = from + i / FPS;
    return frame(t, Math.max(...begins.map((begin) => smoothRaise(t, begin, peakDeg))));
  });
}

describe('ArmRaiseDetector', () => {
  it('reports the interpolated moment the arm reached 90% of the way to its peak', () => {
    const detector = new ArmRaiseDetector();
    const results = feed(detector, [
      [0.0, 10],
      [0.1, 10],
      [0.2, 60],
      [0.3, 110],
      [0.4, 160],
      [0.5, 160],
      [0.6, 20],
    ]);

    expect(results.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    // Arrival level is 50 + 0.9 * (160 - 50) = 149, crossed 78% of the way from 0.3 s to 0.4 s.
    expect(results[6]?.t).toBeCloseTo(0.378, 9);
    expect(results[6]?.peakDeg).toBe(160);
  });

  it('interpolates from the last frame before the raise when the arm arrives within one frame', () => {
    const detector = new ArmRaiseDetector();
    const results = feed(detector, [
      [0.0, 10],
      [0.1, 150],
      [0.2, 150],
      [0.3, 10],
    ]);
    expect(results[3]?.t).toBeCloseTo(0.1 * (130 / 140), 9);
    expect(results[3]?.peakDeg).toBe(150);
  });

  it('measures arrival, not first movement, on a slow smooth raise', () => {
    const detector = new ArmRaiseDetector();
    const begin = 1;
    const raises: ArmRaise[] = [];
    for (let i = 0; i <= 4 * FPS; i += 1) {
      const t = i / FPS;
      const raise = detector.push(frame(t, smoothRaise(t, begin, 150, 0.8, 0.2)));
      if (raise) raises.push(raise);
    }
    expect(raises).toHaveLength(1);
    expect(raises[0].t).toBeCloseTo(begin + arrivalDelay(150, 0.8), 2);
    expect(raises[0].t).toBeGreaterThan(begin + 0.6);
    expect(raises[0].peakDeg).toBeCloseTo(150, 6);
  });

  it('needs the arm to have been lowered before a raise can begin', () => {
    const detector = new ArmRaiseDetector();
    const results = feed(detector, [
      [0.0, 120],
      [0.1, 130],
      [0.2, 120],
    ]);
    expect(results).toEqual([null, null, null]);
    expect(detector.flush()).toBeNull();

    feed(detector, [
      [0.3, 20],
      [0.4, 120],
    ]);
    expect(detector.flush()?.peakDeg).toBe(120);
  });

  it('does not split one raise when the arm dips without dropping below downDeg', () => {
    const detector = new ArmRaiseDetector();
    const results = feed(detector, [
      [0.0, 10],
      [0.1, 100],
      [0.2, 40],
      [0.3, 100],
      [0.4, 10],
    ]);
    expect(results.filter((raise) => raise !== null)).toHaveLength(1);
    expect(results[4]?.peakDeg).toBe(100);
    expect(results[4]?.t).toBeCloseTo(0.1 * (85 / 90), 9);
  });

  it('ignores movement that never rises above upDeg', () => {
    const detector = new ArmRaiseDetector();
    const results = feed(detector, [
      [0.0, 10],
      [0.1, 45],
      [0.2, 50],
      [0.3, 10],
    ]);
    expect(results).toEqual([null, null, null, null]);
    expect(detector.flush()).toBeNull();
  });

  it('closes a raise held longer than maxRaiseSec and reports it only once', () => {
    const detector = new ArmRaiseDetector();
    const raises: Array<{ at: number; raise: ArmRaise }> = [];
    for (let i = 0; i <= 4 * FPS; i += 1) {
      const t = i / FPS;
      const raise = detector.push(frame(t, i < 3 ? 10 : 150));
      if (raise) raises.push({ at: t, raise });
    }
    const began = 3 / FPS;
    expect(raises).toHaveLength(1);
    // Closed on the first frame at or past the limit.
    expect(raises[0].at).toBeGreaterThan(began + 1.5 - 1e-9);
    expect(raises[0].at).toBeLessThan(began + 1.5 + 1 / FPS + 1e-9);
    expect(raises[0].raise.peakDeg).toBe(150);
    expect(detector.flush()).toBeNull();

    const next = feed(detector, [
      [5.0, 10],
      [5.1, 150],
      [5.2, 10],
    ]);
    expect(next[2]?.peakDeg).toBe(150);
  });

  it('uses the larger visible shoulder angle and skips frames with neither arm visible', () => {
    const detector = new ArmRaiseDetector();
    const results = [
      detector.push(frame(0.0, 10, 12)),
      detector.push(frame(0.1, 15, 150)),
      detector.push(frame(0.2)),
      detector.push(frame(0.3, undefined, 150)),
      detector.push(frame(0.4, 20)),
    ];
    expect(results.slice(0, 4)).toEqual([null, null, null, null]);
    expect(results[4]?.peakDeg).toBe(150);
    expect(results[4]?.t).toBeCloseTo(0.1 * (128 / 138), 9);
  });

  it('completes a raise in progress on flush, then has nothing left to flush', () => {
    const detector = new ArmRaiseDetector();
    feed(detector, [
      [0.0, 10],
      [0.1, 90],
      [0.2, 140],
    ]);
    const raise = detector.flush();
    expect(raise?.peakDeg).toBe(140);
    expect(raise?.t).toBeCloseTo(0.1 + 0.1 * (41 / 50), 9);
    expect(detector.flush()).toBeNull();
  });

  it('forgets everything on reset', () => {
    const detector = new ArmRaiseDetector();
    feed(detector, [
      [0.0, 10],
      [0.1, 150],
    ]);
    detector.reset();
    expect(detector.flush()).toBeNull();
    // The arm has not been seen lowered since the reset, so this is not a raise.
    expect(feed(detector, [[0.2, 150]])).toEqual([null]);
    expect(detector.flush()).toBeNull();
  });

  it('honours custom thresholds', () => {
    const detector = new ArmRaiseDetector({ upDeg: 80, downDeg: 60, arrivalFraction: 0.5, maxRaiseSec: 0.25 });
    const results = feed(detector, [
      [0.0, 50],
      [0.1, 70],
      [0.2, 100],
      [0.3, 120],
      [0.4, 120],
      [0.5, 120],
    ]);
    // Began at 0.2 s, so it times out on the first frame at or past 0.45 s.
    expect(results.slice(0, 5)).toEqual([null, null, null, null, null]);
    expect(results[5]?.peakDeg).toBe(120);
    // Arrival level is 80 + 0.5 * (120 - 80) = 100, reached exactly at 0.2 s.
    expect(results[5]?.t).toBeCloseTo(0.2, 9);
  });
});

describe('matchOffsets', () => {
  const raiseAt = (t: number): ArmRaise => ({ t, peakDeg: 150 });

  it('returns arrival minus click time in ms for each click, in click order', () => {
    const offsets = matchOffsets([10, 12, 14], [raiseAt(13.9), raiseAt(10.1), raiseAt(12.2)]);
    expect(offsets).toHaveLength(3);
    expect(offsets[0]).toBeCloseTo(100, 6);
    expect(offsets[1]).toBeCloseTo(200, 6);
    expect(offsets[2]).toBeCloseTo(-100, 6);
  });

  it('ignores raises outside the window around a click', () => {
    expect(matchOffsets([10], [raiseAt(9.39)])).toEqual([]);
    expect(matchOffsets([10], [raiseAt(11.01)])).toEqual([]);
    expect(matchOffsets([10], [raiseAt(9.41)])).toHaveLength(1);
    expect(matchOffsets([10], [raiseAt(10.99)])).toHaveLength(1);
  });

  it('picks the nearest raise when several fall inside the window', () => {
    const offsets = matchOffsets([10], [raiseAt(10.5), raiseAt(10.1), raiseAt(9.7)]);
    expect(offsets).toHaveLength(1);
    expect(offsets[0]).toBeCloseTo(100, 6);
  });

  it('uses each raise at most once, giving it to the closer click', () => {
    const offsets = matchOffsets([10, 10.5], [raiseAt(10.4)]);
    expect(offsets).toHaveLength(1);
    expect(offsets[0]).toBeCloseTo(-100, 6);
  });

  it('leaves out clicks that have no raise', () => {
    const offsets = matchOffsets([10, 12, 14], [raiseAt(10.2), raiseAt(14.3)]);
    expect(offsets).toHaveLength(2);
    expect(offsets[0]).toBeCloseTo(200, 6);
    expect(offsets[1]).toBeCloseTo(300, 6);
  });

  it('honours a custom window', () => {
    const raises = [raiseAt(9.8), raiseAt(10.4)];
    expect(matchOffsets([10], raises, { beforeSec: 0.1, afterSec: 0.3 })).toEqual([]);
    expect(matchOffsets([10], raises, { beforeSec: 0.1, afterSec: 0.5 })[0]).toBeCloseTo(400, 6);
  });

  it('returns nothing for empty input', () => {
    expect(matchOffsets([], [raiseAt(1)])).toEqual([]);
    expect(matchOffsets([1], [])).toEqual([]);
  });
});

describe('median', () => {
  it('returns the middle value of an odd count', () => {
    expect(median([30, 10, 20])).toBe(20);
    expect(median([7])).toBe(7);
  });

  it('averages the two middle values of an even count', () => {
    expect(median([400, 100, 120, 140])).toBe(130);
  });

  it('sorts numerically and leaves the input untouched', () => {
    const values = [100, 9, -20, 1000];
    expect(median(values)).toBe(54.5);
    expect(values).toEqual([100, 9, -20, 1000]);
  });

  it('is NaN for an empty list', () => {
    expect(median([])).toBeNaN();
  });
});

describe('CalibrationSession', () => {
  /** A stand-in engine whose audible time is simply its context time. */
  function fakeEngine(currentTime = 5) {
    const ctx = { currentTime };
    const clicks: Array<{ when: number; accent: boolean | undefined }> = [];
    const engine = {
      clock: new MasterClock(ctx, () => 0),
      playClick: (when: number, accent?: boolean) => {
        clicks.push({ when, accent });
      },
    };
    return { ctx, clicks, engine };
  }

  const TWO_BEATS = (60 / 72) * 2;

  it('does nothing until started', () => {
    const { engine, clicks } = fakeEngine();
    const session = new CalibrationSession(engine);
    expect(session.clickTimes).toEqual([]);
    expect(session.clicksPlayed()).toBe(0);
    expect(session.isDone(1e6)).toBe(false);
    expect(session.result()).toBeNull();
    expect(clicks).toEqual([]);
  });

  it('schedules four clicks two beats apart after a 2 s lead-in', () => {
    const { engine, clicks } = fakeEngine(5);
    const session = new CalibrationSession(engine);

    session.start();

    expect(session.clickTimes).toHaveLength(4);
    session.clickTimes.forEach((time, i) => {
      expect(time).toBeCloseTo(7 + i * TWO_BEATS, 9);
    });
    expect(clicks.map((click) => click.when)).toEqual([...session.clickTimes]);
  });

  it('honours custom click count, interval and lead-in', () => {
    const { engine, clicks } = fakeEngine(1);
    const session = new CalibrationSession(engine, { clicks: 3, intervalSec: 1, leadInSec: 0.5 });
    session.start();
    expect(session.clickTimes).toEqual([1.5, 2.5, 3.5]);
    expect(clicks).toHaveLength(3);
  });

  it('counts the clicks that have sounded', () => {
    const { engine, ctx } = fakeEngine(5);
    const session = new CalibrationSession(engine, { intervalSec: 1 });
    session.start();

    expect(session.clicksPlayed(6.99)).toBe(0);
    expect(session.clicksPlayed(7)).toBe(1);
    expect(session.clicksPlayed(9.5)).toBe(3);
    expect(session.clicksPlayed(60)).toBe(4);

    ctx.currentTime = 8.2;
    expect(session.clicksPlayed()).toBe(2);
  });

  it('is done 1.2 s after the last click', () => {
    const { engine, ctx } = fakeEngine(5);
    const session = new CalibrationSession(engine, { intervalSec: 1 });
    session.start();

    expect(session.isDone(10)).toBe(false);
    expect(session.isDone(11.19)).toBe(false);
    expect(session.isDone(11.21)).toBe(true);

    ctx.currentTime = 11;
    expect(session.isDone()).toBe(false);
    ctx.currentTime = 11.5;
    expect(session.isDone()).toBe(true);
  });

  it('measures an offset near 120 ms when the arm arrives 120 ms after every click', () => {
    const { engine } = fakeEngine(5);
    const session = new CalibrationSession(engine);
    session.start();
    const end = session.clickTimes[3] + 1.5;

    for (const poseFrame of framesArrivingLate(session.clickTimes, 0.12, 5, end)) {
      session.pushFrame(poseFrame);
    }
    const result = session.result();

    expect(result?.samplesMs).toHaveLength(4);
    for (const sample of result?.samplesMs ?? []) {
      expect(Math.abs(sample - 120)).toBeLessThan(5);
    }
    expect(Math.abs((result?.offsetMs ?? 0) - 120)).toBeLessThan(5);
  });

  it('measures a negative offset when the player anticipates the clicks', () => {
    const { engine } = fakeEngine(5);
    const session = new CalibrationSession(engine);
    session.start();
    const end = session.clickTimes[3] + 1.5;

    for (const poseFrame of framesArrivingLate(session.clickTimes, -0.08, 5, end)) {
      session.pushFrame(poseFrame);
    }

    expect(Math.abs((session.result()?.offsetMs ?? 0) + 80)).toBeLessThan(5);
  });

  it('takes the median, so one wild raise does not skew the result', () => {
    const { engine } = fakeEngine(5);
    const session = new CalibrationSession(engine);
    session.start();
    const [first, ...rest] = session.clickTimes;
    const arrivals = [first + 0.45, ...rest.map((click) => click + 0.12)];
    const peakDeg = 150;
    const end = session.clickTimes[3] + 1.5;

    for (let t = 5; t <= end; t += 1 / FPS) {
      const deg = Math.max(...arrivals.map((arrive) => smoothRaise(t, arrive - arrivalDelay(peakDeg), peakDeg)));
      session.pushFrame(frame(t, deg));
    }
    const result = session.result();

    expect(result?.samplesMs).toHaveLength(4);
    expect(Math.abs((result?.samplesMs[0] ?? 0) - 450)).toBeLessThan(5);
    expect(Math.abs((result?.offsetMs ?? 0) - 120)).toBeLessThan(5);
  });

  it('returns null when fewer than three clicks were matched', () => {
    const { engine } = fakeEngine(5);
    const session = new CalibrationSession(engine);
    session.start();
    const end = session.clickTimes[3] + 1.5;

    for (const poseFrame of framesArrivingLate(session.clickTimes.slice(0, 2), 0.12, 5, end)) {
      session.pushFrame(poseFrame);
    }

    expect(session.result()).toBeNull();
  });

  it('counts a raise that is still held when the result is taken', () => {
    const { engine } = fakeEngine(5);
    const session = new CalibrationSession(engine, { clicks: 3 });
    session.start();
    // Stop feeding frames while the third raise is still up.
    const end = session.clickTimes[2] + 0.4;

    for (const poseFrame of framesArrivingLate(session.clickTimes, 0.12, 5, end)) {
      session.pushFrame(poseFrame);
    }
    const result = session.result();

    expect(result?.samplesMs).toHaveLength(3);
    expect(Math.abs((result?.offsetMs ?? 0) - 120)).toBeLessThan(5);
    expect(session.result()).toEqual(result);
  });

  it('starts over when started again', () => {
    const { engine, ctx, clicks } = fakeEngine(5);
    const session = new CalibrationSession(engine);
    session.start();
    const end = session.clickTimes[3] + 1.5;
    for (const poseFrame of framesArrivingLate(session.clickTimes, 0.12, 5, end)) {
      session.pushFrame(poseFrame);
    }
    expect(session.result()).not.toBeNull();

    ctx.currentTime = 30;
    session.start();

    expect(session.clickTimes[0]).toBe(32);
    expect(clicks).toHaveLength(8);
    expect(session.result()).toBeNull();
  });
});
