import { describe, expect, it } from 'vitest';
import { point, standingPose, withLandmarks } from '../pose/poseFixtures';
import { Routine, type LiveState } from '../scoring';
import type { Move, PoseFrame } from '../types';
import {
  FeedbackTracker,
  HINT_DELAY_MS,
  LOW_VISIBILITY_MS,
  buildFeedbackFrame,
  initialFeedbackState,
  type FeedbackInput,
} from './feedback';

const overhead: Move = {
  id: 'overhead-arm-raise',
  name: 'Overhead Arm Raise',
  joints: { leftShoulder: 170, rightShoulder: 170, leftElbow: 175, rightElbow: 175 },
  tolerance: 25,
  beats: { reach: 2, hold: 4, release: 2 },
  formRules: [],
};
const kneeRaise: Move = {
  id: 'standing-knee-raise',
  name: 'Standing Knee Raise',
  joints: { leftHip: 90, leftKnee: 90 },
  tolerance: 25,
  beats: { reach: 2, hold: 2, release: 4 },
  formRules: [],
};

// Count-in 0-4. Overhead: reach 4-6, hold 6-10, release 10-12. Knee raise: reach 12-14, hold 14-16, release 16-20.
const routine = new Routine([overhead, kneeRaise], 4);

const NO_LIVE: LiveState = { cycle: null, phase: null, frameScore: 0, holdScore: null, formNote: null, locked: false };

/** Arms down, every joint measured. */
const ARMS_DOWN: PoseFrame['angles'] = {
  leftShoulder: 10,
  rightShoulder: 10,
  leftElbow: 175,
  rightElbow: 175,
  leftHip: 178,
  rightHip: 178,
  leftKnee: 179,
  rightKnee: 179,
};
const ARMS_UP: PoseFrame['angles'] = { ...ARMS_DOWN, leftShoulder: 165, rightShoulder: 168 };

function frameOf(angles: PoseFrame['angles']): PoseFrame {
  return { t: 0, angles, visible: Object.keys(angles) as PoseFrame['visible'] };
}

function input(overrides: Partial<FeedbackInput>): FeedbackInput {
  return { now: 0, beat: 5, frame: frameOf(ARMS_DOWN), world: standingPose(), live: NO_LIVE, ...overrides };
}

const build = (overrides: Partial<FeedbackInput>) =>
  buildFeedbackFrame(routine, input(overrides), initialFeedbackState()).frame;

describe('buildFeedbackFrame: phase and moves', () => {
  it('reports the count-in as "ready" with the first move up next', () => {
    const frame = build({ beat: 1 });
    expect(frame.phase).toBe('ready');
    expect(frame.move).toBeNull();
    expect(frame.nextMove).toEqual({ id: 'overhead-arm-raise', name: 'Overhead Arm Raise' });
    expect(frame.beatsToNextPhase).toBeCloseTo(3);
    expect(frame.phaseProgress).toBeCloseTo(0.25);
    expect(frame.holdProgress).toBe(0);
  });

  it('names the current and next move and counts beats to the next phase', () => {
    const frame = build({ beat: 5 });
    expect(frame.phase).toBe('reach');
    expect(frame.move?.name).toBe('Overhead Arm Raise');
    expect(frame.nextMove.name).toBe('Standing Knee Raise');
    expect(frame.beatsToNextPhase).toBeCloseTo(1);
    expect(frame.phaseProgress).toBeCloseTo(0.5);
  });

  it('runs holdProgress from 0 in the reach, through the hold, to 1 in the release', () => {
    expect(build({ beat: 5 }).holdProgress).toBe(0);
    expect(build({ beat: 8 }).holdProgress).toBeCloseTo(0.5);
    expect(build({ beat: 11 }).holdProgress).toBe(1);
  });
});

describe('buildFeedbackFrame: limbs', () => {
  it('colours scored limbs by error against tolerance and leaves the rest idle', () => {
    const frame = build({ beat: 5, frame: frameOf({ ...ARMS_DOWN, leftShoulder: 130 }) });
    // Tolerance 25: 40 deg off is amber, 160 deg off is red, 0 deg off is green.
    expect(frame.limbs.leftUpperArm).toMatchObject({ status: 'amber', errorDeg: 40, scored: true });
    expect(frame.limbs.rightUpperArm).toMatchObject({ status: 'red', errorDeg: 160 });
    expect(frame.limbs.leftForearm).toMatchObject({ status: 'green', errorDeg: 0, targetDeg: 175, currentDeg: 175 });
    expect(frame.limbs.leftThigh).toMatchObject({ status: 'idle', scored: false, errorDeg: null, targetDeg: null });
  });

  it('judges nothing during the count-in or a release', () => {
    for (const beat of [1, 11]) {
      const frame = build({ beat });
      expect(Object.values(frame.limbs).every((limb) => limb.status === 'idle')).toBe(true);
      expect(frame.hint).toBeNull();
    }
  });

  it('reads each limb visibility as the least visible of its joint landmarks', () => {
    const world = withLandmarks(standingPose(), { leftWrist: point(0.15, 0.1, 0, 0.7) });
    const frame = build({ world });
    expect(frame.limbs.leftForearm.visibility).toBeCloseTo(0.7);
    expect(frame.limbs.rightForearm.visibility).toBe(1);
    expect(build({ world: null }).limbs.leftForearm.visibility).toBeNull();
  });

  it('names the worst measured scored joint even when it is within tolerance', () => {
    const frame = build({ beat: 5, frame: frameOf({ ...ARMS_UP, rightShoulder: 150 }) });
    expect(frame.worstJoint).toBe('rightShoulder');
    expect(frame.hint).toBeNull();
  });
});

describe('buildFeedbackFrame: score', () => {
  it('reports the scoring engine live score while it is on the same cycle', () => {
    const cycle = routine.cycle(0);
    const live: LiveState = { cycle, phase: 'hold', frameScore: 72, holdScore: 70, formNote: null, locked: true };
    const frame = build({ beat: 8, live });
    expect(frame.score).toBe(72);
    expect(frame.holdScore).toBe(70);
    expect(frame.onTarget).toBe(true);
  });

  it('reports 0 while the scoring engine is still on the previous cycle', () => {
    const live: LiveState = { cycle: routine.cycle(0), phase: 'release', frameScore: 90, holdScore: null, formNote: null, locked: true };
    const frame = build({ beat: 12.1, live });
    expect(frame.score).toBe(0);
    expect(frame.onTarget).toBe(false);
  });

  it('is never on target in a release', () => {
    const live: LiveState = { cycle: routine.cycle(0), phase: 'release', frameScore: 95, holdScore: null, formNote: null, locked: true };
    expect(build({ beat: 11, live }).onTarget).toBe(false);
  });
});

describe('FeedbackTracker: hint timing', () => {
  const at = (tracker: FeedbackTracker, ms: number, angles: PoseFrame['angles'], beat = 7) =>
    tracker.update(input({ now: 10 + ms / 1000, beat, frame: frameOf(angles) }));

  it(`shows a hint only after ${HINT_DELAY_MS} ms of continuous error`, () => {
    const tracker = new FeedbackTracker(routine);
    const leftLow = { ...ARMS_UP, leftShoulder: 60 };
    expect(at(tracker, 0, leftLow).hint).toBeNull();
    expect(at(tracker, HINT_DELAY_MS - 10, leftLow).hint).toBeNull();
    expect(at(tracker, HINT_DELAY_MS + 10, leftLow).hint).toEqual({
      joint: 'leftShoulder',
      limb: 'leftUpperArm',
      text: 'left arm higher',
      status: 'red',
    });
  });

  it('starts the wait again after the error clears', () => {
    const tracker = new FeedbackTracker(routine);
    const leftLow = { ...ARMS_UP, leftShoulder: 60 };
    at(tracker, 0, leftLow);
    expect(at(tracker, 400, leftLow).hint).not.toBeNull();
    expect(at(tracker, 450, ARMS_UP).hint).toBeNull();
    expect(at(tracker, 500, leftLow).hint).toBeNull();
    expect(at(tracker, 500 + HINT_DELAY_MS + 10, leftLow).hint).not.toBeNull();
  });

  it('starts the wait again when a new move begins', () => {
    const tracker = new FeedbackTracker(routine);
    const leftLow = { ...ARMS_UP, leftShoulder: 60 };
    at(tracker, 0, leftLow, 9);
    expect(at(tracker, 400, leftLow, 9.5).hint).not.toBeNull();
    // Next move's reach, with the knee nowhere near its target: the hip is 88 off, the knee 60.
    const standing = { ...ARMS_DOWN, leftKnee: 150 };
    expect(at(tracker, 450, standing, 12.5).hint).toBeNull();
    expect(at(tracker, 450 + HINT_DELAY_MS + 10, standing, 12.9).hint?.text).toBe('left knee higher');
  });
});

describe('FeedbackTracker: low visibility', () => {
  const without = (joint: keyof PoseFrame['angles']): PoseFrame => {
    const angles = { ...ARMS_UP };
    delete angles[joint];
    return frameOf(angles);
  };
  const at = (tracker: FeedbackTracker, ms: number, frame: PoseFrame | null) =>
    tracker.update(input({ now: 20 + ms / 1000, beat: 7, frame }));

  it(`flags a scored joint hidden for more than ${LOW_VISIBILITY_MS} ms`, () => {
    const tracker = new FeedbackTracker(routine);
    at(tracker, 0, frameOf(ARMS_UP));
    expect(at(tracker, 10, without('leftElbow')).lowVisibility).toBe(false);
    expect(at(tracker, 10 + LOW_VISIBILITY_MS - 20, without('leftElbow')).lowVisibility).toBe(false);
    const flagged = at(tracker, 10 + LOW_VISIBILITY_MS + 20, without('leftElbow'));
    expect(flagged.lowVisibility).toBe(true);
    expect(flagged.hiddenJoints).toEqual(['leftElbow']);
  });

  it('keeps a briefly hidden limb on its last colour, then greys it', () => {
    const tracker = new FeedbackTracker(routine);
    expect(at(tracker, 0, frameOf(ARMS_UP)).limbs.leftForearm.status).toBe('green');
    expect(at(tracker, 100, without('leftElbow')).limbs.leftForearm.status).toBe('green');
    expect(at(tracker, 100 + LOW_VISIBILITY_MS + 20, without('leftElbow')).limbs.leftForearm.status).toBe('grey');
  });

  it('greys a limb straight away when it was never measured', () => {
    const tracker = new FeedbackTracker(routine);
    expect(at(tracker, 0, without('leftElbow')).limbs.leftForearm.status).toBe('grey');
  });

  it('ignores hidden joints the move does not score', () => {
    const tracker = new FeedbackTracker(routine);
    at(tracker, 0, without('leftKnee'));
    expect(at(tracker, 1000, without('leftKnee')).lowVisibility).toBe(false);
  });

  it('treats a missing pose as every scored joint hidden', () => {
    const tracker = new FeedbackTracker(routine);
    at(tracker, 0, null);
    const frame = at(tracker, LOW_VISIBILITY_MS + 20, null);
    expect(frame.lowVisibility).toBe(true);
    expect(frame.hiddenJoints).toEqual(['leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow']);
  });

  it('holds back joint hints while the player is out of view', () => {
    const tracker = new FeedbackTracker(routine);
    const frame = { ...without('leftElbow'), angles: { ...without('leftElbow').angles, rightShoulder: 40 } };
    at(tracker, 0, frame);
    expect(at(tracker, 1000, frame).hint).toBeNull();
  });
});
