import { describe, expect, it } from 'vitest';
import type { BeatResult, FormMetrics, Move, PoseFrame } from '../types';
import { formNoteFor } from './formRules';
import { Routine } from './routine';
import {
  MAX_FRAME_SPAN_SEC,
  ScoringEngine,
  melodyShouldPlay,
  type LiveState,
  type ScoringEngineOptions,
} from './scoringEngine';

const FPS = 30;
const FRAME_MS = 1000 / FPS;

/** Minimum-jerk position 0 to 1 for s in [0, 1]: how a hand moves to a target. */
const minJerk = (s: number) => (s <= 0 ? 0 : s >= 1 ? 1 : 10 * s ** 3 - 15 * s ** 4 + 6 * s ** 5);

/** The time the clean reach `from` to `to` over `duration` from `start` passes `level`. */
function crossingTime(from: number, to: number, level: number, start: number, duration: number): number {
  const target = (level - from) / (to - from);
  let low = 0;
  let high = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (minJerk(mid) < target) low = mid;
    else high = mid;
  }
  return start + low * duration;
}
/** 120 BPM: beat i is at i * 0.5 s. */
const timeOfBeat = (beat: number) => beat * 0.5;

const sideRaise: Move = {
  id: 'side-arm-raise',
  name: 'Side Arm Raise',
  joints: { leftShoulder: 90, rightShoulder: 90 },
  tolerance: 20,
  beats: { reach: 2, hold: 4, release: 2 },
  formRules: ['trunk-lean', 'shoulder-shrug'],
};
const kneeRaise: Move = {
  id: 'standing-knee-raise',
  name: 'Standing Knee Raise',
  joints: { leftHip: 90, leftKnee: 90 },
  tolerance: 25,
  beats: { reach: 2, hold: 2, release: 4 },
  formRules: [],
};

// With sideRaise first and the routine starting at beat 0:
// reach 0.0-1.0 s, hold 1.0-3.0 s, release 3.0-4.0 s.
const HOLD_START = 1;
const HOLD_END = 3;

const ON_TARGET: PoseFrame['angles'] = { leftShoulder: 90, rightShoulder: 90 };
const ARMS_DOWN: PoseFrame['angles'] = { leftShoulder: 10, rightShoulder: 10 };
const UPRIGHT: FormMetrics = { trunkLeanDeg: 2, shoulderEarRatio: 0.3 };

function engine(options: Partial<ScoringEngineOptions> = {}): ScoringEngine {
  return new ScoringEngine({ routine: new Routine([sideRaise, kneeRaise]), timeOfBeat, ...options });
}

/**
 * Feeds synthetic frames at 30 fps for seconds [from, to). `pose` and `form`
 * are given the frame's time, with index-derived times so comparisons are exact.
 */
function play(
  target: ScoringEngine,
  from: number,
  to: number,
  pose: (t: number) => PoseFrame['angles'],
  form: (t: number) => FormMetrics = () => UPRIGHT,
): BeatResult[] {
  const results: BeatResult[] = [];
  for (let i = Math.round(from * FPS); i < Math.round(to * FPS); i++) {
    const t = i / FPS;
    const angles = pose(t);
    const frame: PoseFrame = { t, angles, visible: Object.keys(angles) as PoseFrame['visible'] };
    results.push(...target.push(frame, form(t)));
  }
  return results;
}

/** Feeds one frame at each of `times` (seconds), in order. */
function pushAt(
  target: ScoringEngine,
  times: readonly number[],
  pose: (t: number) => PoseFrame['angles'],
): BeatResult[] {
  const results: BeatResult[] = [];
  for (const t of times) {
    const angles = pose(t);
    results.push(...target.push({ t, angles, visible: Object.keys(angles) as PoseFrame['visible'] }, UPRIGHT));
  }
  return results;
}

/** `count` evenly spaced times from `from`, `step` apart. */
const times = (from: number, count: number, step: number) =>
  Array.from({ length: count }, (_, i) => from + i * step);

describe('ScoringEngine', () => {
  it('scores a move held on target as a Perfect 100', () => {
    const results = play(engine(), 0, 4, () => ON_TARGET);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ moveId: 'side-arm-raise', score: 100, label: 'Perfect' });
  });

  it('only counts frames inside the hold window', () => {
    const onlyDuringHold = play(engine(), 0, 4, (t) =>
      t >= HOLD_START && t < HOLD_END ? ON_TARGET : ARMS_DOWN,
    );
    expect(onlyDuringHold[0]).toMatchObject({ score: 100, label: 'Perfect' });

    const everywhereButHold = play(engine(), 0, 4, (t) =>
      t >= HOLD_START && t < HOLD_END ? ARMS_DOWN : ON_TARGET,
    );
    expect(everywhereButHold[0]).toMatchObject({ score: 0, label: 'Miss' });
  });

  it('averages frame scores across the hold', () => {
    // On target for the second half of the hold only.
    const [late] = play(engine(), 0, 4, (t) => (t >= 2 ? ON_TARGET : ARMS_DOWN));
    expect(late.score).toBeCloseTo(50, 5);
    expect(late.label).toBe('Miss');

    // Held throughout but 10 degrees short on both arms: 100 - 40 * 10 / 20.
    const [short] = play(engine(), 0, 4, () => ({ leftShoulder: 80, rightShoulder: 80 }));
    expect(short.score).toBeCloseTo(80, 5);
    expect(short.label).toBe('Good');
  });

  it('emits the result on the first frame after the hold closes, not before', () => {
    const target = engine();
    expect(play(target, 0, HOLD_END, () => ON_TARGET)).toHaveLength(0);
    expect(target.lastResult).toBeNull();
    expect(play(target, HOLD_END, HOLD_END + 1 / FPS, () => ON_TARGET)).toHaveLength(1);
    expect(target.lastResult?.label).toBe('Perfect');
  });

  it('reports how early or late the player arrived at the pose', () => {
    // A step pose lands somewhere between two frames; the engine places it within that frame.
    const [onTime] = play(engine(), 0, 4, (t) => (t >= HOLD_START ? ON_TARGET : ARMS_DOWN));
    expect(Math.abs(onTime.timingOffsetMs)).toBeLessThan(FRAME_MS);

    const [early] = play(engine(), 0, 4, (t) => (t >= 0.5 ? ON_TARGET : ARMS_DOWN));
    expect(Math.abs(early.timingOffsetMs + 500)).toBeLessThan(FRAME_MS);

    const [late] = play(engine(), 0, 4, (t) => (t >= 2 ? ON_TARGET : ARMS_DOWN));
    expect(Math.abs(late.timingOffsetMs - 1000)).toBeLessThan(FRAME_MS);

    const [never] = play(engine(), 0, 4, () => ARMS_DOWN);
    expect(never.timingOffsetMs).toBeCloseTo(2000, 5);
  });

  it('measures arrival between frames on a continuous reach', () => {
    // Both arms rise 10 to 90 degrees over 0.6 s, arriving on the first hold beat.
    const [from, to, start, duration] = [10, 90, 0.4, 0.6];
    const arm = (t: number) => from + (to - from) * minJerk((t - start) / duration);
    const [result] = play(engine(), 0, 4, (t) => ({ leftShoulder: arm(t), rightShoulder: arm(t) }));
    // The score crosses 60 where the error is one tolerance: at 70 degrees.
    const truthMs = (crossingTime(from, to, 70, start, duration) - HOLD_START) * 1000;
    expect(Math.abs(result.timingOffsetMs - truthMs)).toBeLessThan(3);
  });

  it('does not count a pass-through as arriving', () => {
    // On target for two frames in the reach (67 ms), then not again until 2 s.
    const [result] = play(engine(), 0, 4, (t) => ((t >= 0.5 && t < 0.55) || t >= 2 ? ON_TARGET : ARMS_DOWN));
    expect(Math.abs(result.timingOffsetMs - 1000)).toBeLessThan(FRAME_MS);
  });

  it('counts a pose landed just before the hold closes', () => {
    // On target from 2.95 s: the hold closes at 3 s, before the 100 ms lock could engage.
    const [result] = play(engine(), 0, 4, (t) => (t >= 2.95 ? ON_TARGET : ARMS_DOWN));
    expect(result.timingOffsetMs).toBeLessThan(2000 - 30);
  });

  it('exposes whether the player is locked in the pose, with hysteresis', () => {
    const target = engine();
    play(target, 0, 1.5, () => ON_TARGET);
    expect(target.live.locked).toBe(true);
    // 22.5 degrees short scores 55: under Good, but above the line that lets go.
    play(target, 1.5, 2, () => ({ leftShoulder: 67.5, rightShoulder: 67.5 }));
    expect(target.live.frameScore).toBeCloseTo(55, 6);
    expect(target.live.locked).toBe(true);
    play(target, 2, 2.2, () => ARMS_DOWN);
    expect(target.live.locked).toBe(false);
  });

  it('shifts frames by the calibration offset before scoring', () => {
    // The camera sees everything 400 ms late: a hold that was really on the
    // beat shows up in frames stamped 1.4 s to 3.4 s.
    const seenLate = (t: number) => (t >= 1.4 && t < 3.4 ? ON_TARGET : ARMS_DOWN);

    const [uncalibrated] = play(engine(), 0, 4, seenLate);
    expect(uncalibrated.score).toBeCloseTo(80, 5);
    expect(uncalibrated.label).toBe('Good');
    expect(Math.abs(uncalibrated.timingOffsetMs - 400)).toBeLessThan(FRAME_MS);

    const [calibrated] = play(engine({ offsetMs: 400 }), 0, 4.5, seenLate);
    expect(calibrated.score).toBe(100);
    expect(calibrated.label).toBe('Perfect');
    expect(Math.abs(calibrated.timingOffsetMs)).toBeLessThan(FRAME_MS);
  });

  it('moves through the routine and loops it', () => {
    const target = engine();
    // sideRaise 0-4 s, kneeRaise 4-8 s (hold 5-6 s), sideRaise again 8-12 s.
    const results = play(target, 0, 12, (t) => {
      if (t < 4) return ON_TARGET;
      if (t < 8) return { leftHip: 90, leftKnee: 90 };
      return ARMS_DOWN;
    });
    expect(results.map((r) => [r.moveId, r.label])).toEqual([
      ['side-arm-raise', 'Perfect'],
      ['standing-knee-raise', 'Perfect'],
      ['side-arm-raise', 'Miss'],
    ]);
  });

  it('tracks combo, streak and accuracy across results', () => {
    const target = engine();
    play(target, 0, 8, (t) => (t < 4 ? ON_TARGET : { leftHip: 75, leftKnee: 75 }));
    // Perfect (100) then Good (100 - 40 * 15 / 25 = 76).
    expect(target.stats).toMatchObject({ total: 2, perfect: 1, good: 1, miss: 0, combo: 2, streak: 0, bestStreak: 1 });
    expect(target.stats.accuracy).toBeCloseTo(88, 5);

    play(target, 8, 12, () => ARMS_DOWN);
    expect(target.stats).toMatchObject({ total: 3, miss: 1, combo: 0, bestCombo: 2 });
    expect(target.stats.accuracy).toBeCloseTo((100 + 76 + 0) / 3, 5);
  });

  it('scores a cycle with no frames at all as a Miss', () => {
    const target = engine();
    play(target, 0, 0.5, () => ON_TARGET);
    // The camera stalls until partway through the second move's release.
    const results = play(target, 7, 7.1, () => ARMS_DOWN);
    expect(results.map((r) => [r.moveId, r.score, r.label])).toEqual([
      ['side-arm-raise', 0, 'Miss'],
      ['standing-knee-raise', 0, 'Miss'],
    ]);
  });

  it('ignores frames before the routine starts', () => {
    const target = new ScoringEngine({ routine: new Routine([sideRaise], 4), timeOfBeat });
    expect(play(target, 0, 2, () => ON_TARGET)).toHaveLength(0);
    expect(target.live.cycle).toBeNull();
    play(target, 2, 2.1, () => ON_TARGET);
    expect(target.live).toMatchObject({ phase: 'reach', cycle: { index: 0 } });
  });

  it('exposes the live phase, frame score and running hold score', () => {
    const target = engine();
    play(target, 0, 0.5, () => ARMS_DOWN);
    expect(target.live).toMatchObject({ phase: 'reach', frameScore: 0, holdScore: null });

    play(target, 0.5, 2, (t) => (t >= 1.5 ? ON_TARGET : ARMS_DOWN));
    expect(target.live.phase).toBe('hold');
    expect(target.live.frameScore).toBe(100);
    // Time-weighted: on target since 1.5 s, out of the hold time elapsed by the last frame.
    const last = 59 / FPS;
    expect(target.live.holdScore).toBeCloseTo(((last - 1.5) / (last - HOLD_START)) * 100, 5);

    play(target, 2, 3.5, () => ON_TARGET);
    expect(target.live).toMatchObject({ phase: 'release', holdScore: null });
  });
});

describe('ScoringEngine: the hold is judged by time, not by frame count', () => {
  it('weights each frame by the time it covers, not by count', () => {
    const target = engine();
    const frames = [...times(0, 30, 1 / 30), ...times(1, 60, 1 / 60), ...times(2, 15, 1 / 15), 3];
    const [result] = pushAt(target, frames, (t) => (t >= 1 && t < 2 ? ON_TARGET : ARMS_DOWN));
    // One second on target and one second off. Counting frames would give 60 / 75 = 80.
    expect(result.score).toBeCloseTo(50, 6);
  });

  it('does not stretch one frame across a camera stall', () => {
    expect(MAX_FRAME_SPAN_SEC).toBe(0.2);
    const target = engine();
    const frames = [...times(0, 45, 1 / 30), ...times(2.5, 45, 1 / 30)];
    const [result] = pushAt(target, frames, (t) => (t < 1.5 ? ON_TARGET : ARMS_DOWN));
    // The last frame before the stall (44/30 s) stands for 0.2 s at most.
    const onTarget = 44 / 30 + MAX_FRAME_SPAN_SEC - HOLD_START;
    expect(result.score).toBeCloseTo((onTarget / (onTarget + 0.5)) * 100, 6);
  });

  it("integrates a span that crosses into the next cycle's hold", () => {
    const straightIn: Move = { ...sideRaise, id: 'straight-in', beats: { reach: 0, hold: 2, release: 2 } };
    // sideRaise 0-4 s, then straightIn's hold starts at once: 4-5 s.
    const target = new ScoringEngine({ routine: new Routine([sideRaise, straightIn]), timeOfBeat });
    const frames = [...times(0.05, 41, 0.1), 5.5];
    const results = pushAt(target, frames, (t) => (t < 4 ? ON_TARGET : ARMS_DOWN));
    // The frame at 3.95 s stands until 4.05 s, so 0.05 s of the second hold is on target;
    // the frame at 4.05 s is off and stands for 0.2 s before the stall.
    expect(results.map((r) => r.moveId)).toEqual(['side-arm-raise', 'straight-in']);
    expect(results[1].score).toBeCloseTo((0.05 / 0.25) * 100, 6);
  });

  it('counts the span toward a hold that the same frame closes', () => {
    const straightIn: Move = { ...sideRaise, id: 'straight-in', beats: { reach: 0, hold: 2, release: 2 } };
    const target = new ScoringEngine({ routine: new Routine([sideRaise, straightIn]), timeOfBeat });
    // The camera stalls after 3.95 s and the next frame lands after the second hold has closed.
    const results = pushAt(target, [...times(0.05, 40, 0.1), 5.5], () => ON_TARGET);
    expect(results.map((r) => [r.moveId, r.score])).toEqual([
      ['side-arm-raise', 100],
      ['straight-in', 100],
    ]);
  });
});

describe('ScoringEngine.tick', () => {
  it('closes a hold window when frames stop arriving', () => {
    const target = engine();
    // The camera stalls halfway through the hold.
    play(target, 0, 2, () => ON_TARGET);
    expect(target.tick(2.9)).toEqual([]);

    const results = target.tick(3.1);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ moveId: 'side-arm-raise', score: 100, label: 'Perfect' });
    expect(target.lastResult).toBe(results[0]);
  });

  it('never reports the same hold twice', () => {
    const target = engine();
    play(target, 0, 3, () => ON_TARGET);
    expect(target.tick(3.1)).toHaveLength(1);
    expect(target.tick(3.2)).toEqual([]);
    expect(play(target, 3.2, 4, () => ON_TARGET)).toEqual([]);
    expect(target.stats.total).toBe(1);
  });

  it('scores a move with no frames as a Miss and moves on to the next move', () => {
    const target = engine();
    const results = target.tick(4.1);
    expect(results.map((r) => [r.moveId, r.label])).toEqual([['side-arm-raise', 'Miss']]);
    expect(target.live).toMatchObject({ cycle: { index: 1 }, phase: 'reach', frameScore: 0, formNote: null });
  });

  it('does nothing before the routine starts', () => {
    const target = new ScoringEngine({ routine: new Routine([sideRaise], 4), timeOfBeat });
    expect(target.tick(1.5)).toEqual([]);
    expect(target.live.cycle).toBeNull();
  });

  it('applies the calibration offset', () => {
    const target = engine({ offsetMs: 400 });
    // The hold ends at 3.0 s on the beat grid, which is 3.4 s in camera time.
    expect(target.tick(3.3)).toEqual([]);
    expect(target.tick(3.45)).toHaveLength(1);
  });
});

describe('form guidance in the engine', () => {
  const leaning: FormMetrics = { trunkLeanDeg: 22, shoulderEarRatio: 0.3 };

  it('adds a form note when a rule persists for more than 500 ms', () => {
    const [result] = play(
      engine(),
      0,
      4,
      () => ON_TARGET,
      (t) => (t >= 1.5 && t < 2.2 ? leaning : UPRIGHT),
    );
    expect(result.formNote).toBe(formNoteFor('trunk-lean'));
    expect(result.label).toBe('Perfect');
  });

  it('leaves the note off when the lean is shorter than 500 ms', () => {
    const [result] = play(
      engine(),
      0,
      4,
      () => ON_TARGET,
      (t) => (t >= 1.5 && t < 1.9 ? leaning : UPRIGHT),
    );
    expect(result.formNote).toBeUndefined();
  });

  it("only applies the rules the move lists", () => {
    const results = play(engine(), 0, 8, (t) => (t < 4 ? ON_TARGET : { leftHip: 90, leftKnee: 90 }), () => leaning);
    expect(results[0].formNote).toBe(formNoteFor('trunk-lean'));
    expect(results[1].formNote).toBeUndefined();
  });

  it('flags a shrug against the calibration baseline, and never without one', () => {
    const shrugging: FormMetrics = { trunkLeanDeg: 2, shoulderEarRatio: 0.2 };

    const [withBaseline] = play(engine({ shoulderEarBaseline: 0.3 }), 0, 4, () => ON_TARGET, () => shrugging);
    expect(withBaseline.formNote).toBe(formNoteFor('shoulder-shrug'));

    const [noBaseline] = play(engine(), 0, 4, () => ON_TARGET, () => shrugging);
    expect(noBaseline.formNote).toBeUndefined();
  });

  it('clears the note for the next cycle', () => {
    const target = new ScoringEngine({ routine: new Routine([sideRaise]), timeOfBeat });
    const results = play(target, 0, 8, () => ON_TARGET, (t) => (t < 4 ? leaning : UPRIGHT));
    expect(results[0].formNote).toBeDefined();
    expect(results[1].formNote).toBeUndefined();
  });
});

describe('melodyShouldPlay', () => {
  const cycle = new Routine([sideRaise]).cycle(0);
  const live = (phase: LiveState['phase'], locked: boolean, frameScore = locked ? 90 : 0): LiveState => ({
    cycle: phase === null ? null : cycle,
    phase,
    frameScore,
    holdScore: null,
    formNote: null,
    locked,
  });
  const result = (score: number): BeatResult => ({ moveId: 'm', score, label: 'Good', timingOffsetMs: 0 });

  it('plays during a hold only while the player is in the pose', () => {
    expect(melodyShouldPlay(live('hold', true), null)).toBe(true);
    expect(melodyShouldPlay(live('hold', true), result(0))).toBe(true);
    expect(melodyShouldPlay(live('hold', false), result(100))).toBe(false);
  });

  it('plays during a reach when the player has landed the pose or a good hold is carrying it', () => {
    expect(melodyShouldPlay(live('reach', true), result(0))).toBe(true);
    expect(melodyShouldPlay(live('reach', false), result(72))).toBe(true);
    expect(melodyShouldPlay(live('reach', false), result(40))).toBe(false);
    expect(melodyShouldPlay(live('reach', false), null)).toBe(false);
  });

  it('stops when the pose sags under Good, even while the lock still holds', () => {
    // The lock only lets go under 50; the melody follows the Good line the judgement uses.
    expect(melodyShouldPlay(live('hold', true, 55), result(100))).toBe(false);
    expect(melodyShouldPlay(live('reach', true, 55), null)).toBe(false);
    expect(melodyShouldPlay(live('reach', true, 55), result(72))).toBe(true);
  });

  it('carries the result through the release', () => {
    expect(melodyShouldPlay(live('release', false), result(60))).toBe(true);
    expect(melodyShouldPlay(live('release', true), result(59.9))).toBe(false);
  });

  it('is off before the routine starts', () => {
    expect(melodyShouldPlay(live(null, true), result(100))).toBe(false);
  });
});
