import { describe, expect, it } from 'vitest';
import type { BeatResult, FormMetrics, Move, PoseFrame } from '../types';
import { formNoteFor } from './formRules';
import { Routine } from './routine';
import { ScoringEngine, melodyShouldPlay, type ScoringEngineOptions } from './scoringEngine';

const FPS = 30;
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
    const [onTime] = play(engine(), 0, 4, (t) => (t >= HOLD_START ? ON_TARGET : ARMS_DOWN));
    expect(onTime.timingOffsetMs).toBeCloseTo(0, 5);

    const [early] = play(engine(), 0, 4, (t) => (t >= 0.5 ? ON_TARGET : ARMS_DOWN));
    expect(early.timingOffsetMs).toBeCloseTo(-500, 5);

    const [late] = play(engine(), 0, 4, (t) => (t >= 2 ? ON_TARGET : ARMS_DOWN));
    expect(late.timingOffsetMs).toBeCloseTo(1000, 5);

    const [never] = play(engine(), 0, 4, () => ARMS_DOWN);
    expect(never.timingOffsetMs).toBeCloseTo(2000, 5);
  });

  it('shifts frames by the calibration offset before scoring', () => {
    // The camera sees everything 400 ms late: a hold that was really on the
    // beat shows up in frames stamped 1.4 s to 3.4 s.
    const seenLate = (t: number) => (t >= 1.4 && t < 3.4 ? ON_TARGET : ARMS_DOWN);

    const [uncalibrated] = play(engine(), 0, 4, seenLate);
    expect(uncalibrated.score).toBeCloseTo(80, 5);
    expect(uncalibrated.label).toBe('Good');
    expect(uncalibrated.timingOffsetMs).toBeCloseTo(400, 5);

    const [calibrated] = play(engine({ offsetMs: 400 }), 0, 4.5, seenLate);
    expect(calibrated.score).toBe(100);
    expect(calibrated.label).toBe('Perfect');
    expect(Math.abs(calibrated.timingOffsetMs)).toBeLessThan(1);
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
    expect(target.live.holdScore).toBeCloseTo(50, 5);

    play(target, 2, 3.5, () => ON_TARGET);
    expect(target.live).toMatchObject({ phase: 'release', holdScore: null });
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
  const live = { cycle: null, phase: null, frameScore: 0, formNote: null };
  const result = (score: number): BeatResult => ({ moveId: 'm', score, label: 'Good', timingOffsetMs: 0 });

  it('follows the running hold score during a hold', () => {
    expect(melodyShouldPlay({ ...live, holdScore: 60 }, null)).toBe(true);
    expect(melodyShouldPlay({ ...live, holdScore: 59.9 }, result(100))).toBe(false);
  });

  it('carries the last result between holds, and is off before any result', () => {
    expect(melodyShouldPlay({ ...live, holdScore: null }, result(72))).toBe(true);
    expect(melodyShouldPlay({ ...live, holdScore: null }, result(40))).toBe(false);
    expect(melodyShouldPlay({ ...live, holdScore: null }, null)).toBe(false);
  });
});
