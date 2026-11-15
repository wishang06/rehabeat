import { describe, expect, it } from 'vitest';
import type { Move, PoseFrame } from '../types';
import {
  GOOD_SCORE,
  PERFECT_SCORE,
  jointReading,
  labelFor,
  meanAngleError,
  scoreFrame,
  scoreFromError,
  unseenJointError,
  zeroScoreError,
} from './frameScore';

const sideRaise: Move = {
  id: 'side-arm-raise',
  name: 'Side Arm Raise',
  joints: { leftShoulder: 90, rightShoulder: 90 },
  tolerance: 20,
  beats: { reach: 2, hold: 4, release: 2 },
  formRules: [],
};

function frame(angles: PoseFrame['angles'], t = 0): PoseFrame {
  return { t, angles, visible: Object.keys(angles) as PoseFrame['visible'] };
}

describe('scoreFromError', () => {
  it('is 100 with no error and falls linearly', () => {
    expect(scoreFromError(0, 20)).toBe(100);
    expect(scoreFromError(10, 20)).toBe(80);
  });

  it('lands exactly on Good when the error equals the tolerance', () => {
    expect(scoreFromError(20, 20)).toBe(GOOD_SCORE);
    expect(scoreFromError(25, 25)).toBe(GOOD_SCORE);
  });

  it('bottoms out at 0 from 2.5 tolerances', () => {
    expect(zeroScoreError(20)).toBe(50);
    expect(scoreFromError(50, 20)).toBe(0);
    expect(scoreFromError(170, 20)).toBe(0);
  });
});

describe('meanAngleError', () => {
  it('averages the absolute error across the move joints', () => {
    expect(meanAngleError(frame({ leftShoulder: 80, rightShoulder: 110 }), sideRaise)).toBe(15);
  });

  it("ignores joints the move doesn't target", () => {
    const withExtras = frame({ leftShoulder: 90, rightShoulder: 90, leftKnee: 12, rightElbow: 40 });
    expect(meanAngleError(withExtras, sideRaise)).toBe(0);
  });

  it('charges a target joint that is not visible one and a half tolerances', () => {
    expect(unseenJointError(20)).toBe(30);
    // One joint perfect, one hidden: (0 + 30) / 2.
    expect(meanAngleError(frame({ leftShoulder: 90 }), sideRaise)).toBe(15);
  });

  it('so a hidden joint is worse than one in tolerance and better than one left at rest', () => {
    const hidden = scoreFrame(frame({ leftShoulder: 90 }), sideRaise);
    const inTolerance = scoreFrame(frame({ leftShoulder: 90, rightShoulder: 70 }), sideRaise);
    const atRest = scoreFrame(frame({ leftShoulder: 90, rightShoulder: 10 }), sideRaise);
    expect(hidden).toBeLessThan(inTolerance);
    expect(hidden).toBeGreaterThan(atRest);
  });

  it('is the zero-score error when fewer than half of the target joints are in view', () => {
    const fourJoints: Move = {
      ...sideRaise,
      joints: { leftShoulder: 90, rightShoulder: 90, leftElbow: 175, rightElbow: 175 },
    };
    // Two of four in view: judged, with the two hidden ones charged.
    expect(meanAngleError(frame({ leftShoulder: 90, rightShoulder: 90 }), fourJoints)).toBe(15);
    // One of four: not a pose anyone can judge.
    expect(meanAngleError(frame({ leftShoulder: 90 }), fourJoints)).toBe(zeroScoreError(20));
    expect(meanAngleError(frame({}), sideRaise)).toBe(zeroScoreError(20));
  });
});

describe('jointReading', () => {
  const both = (deep: number, flat: number): PoseFrame => ({
    t: 0,
    angles: { leftElbow: deep },
    visible: ['leftElbow'],
    flatAngles: { leftElbow: flat },
  });

  it('is the 3D angle when the frame has no flat reading', () => {
    expect(jointReading(frame({ leftElbow: 150 }), 'leftElbow', 175)).toBe(150);
  });

  it('is whichever reading is nearer the target', () => {
    // A straight arm the depth estimate bends: the picture has it right.
    expect(jointReading(both(150, 172), 'leftElbow', 175)).toBe(172);
    // A limb pointing at the camera: the picture is blind to it, the 3D reading is not.
    expect(jointReading(both(95, 170), 'leftElbow', 90)).toBe(95);
  });

  it('is undefined for a joint that is not visible, whatever the flat reading says', () => {
    const hidden: PoseFrame = { t: 0, angles: {}, visible: [], flatAngles: { leftElbow: 175 } };
    expect(jointReading(hidden, 'leftElbow', 175)).toBeUndefined();
  });

  it('scores a frame by the nearer reading of each joint', () => {
    const arms: PoseFrame = {
      t: 0,
      angles: { leftShoulder: 60, rightShoulder: 90 },
      visible: ['leftShoulder', 'rightShoulder'],
      flatAngles: { leftShoulder: 88, rightShoulder: 40 },
    };
    // Left by the picture (2 off), right by 3D (0 off): mean error 1.
    expect(meanAngleError(arms, sideRaise)).toBe(1);
    expect(scoreFrame(arms, sideRaise)).toBe(98);
  });
});

describe('scoreFrame', () => {
  it('scores a perfect match 100 and an empty frame 0', () => {
    expect(scoreFrame(frame({ leftShoulder: 90, rightShoulder: 90 }), sideRaise)).toBe(100);
    expect(scoreFrame(frame({}), sideRaise)).toBe(0);
  });

  it('scores arms left at the sides as a clear miss', () => {
    expect(scoreFrame(frame({ leftShoulder: 10, rightShoulder: 10 }), sideRaise)).toBe(0);
  });

  it('scores against the tolerance of the move', () => {
    const loose = { ...sideRaise, tolerance: 40 };
    const off = frame({ leftShoulder: 70, rightShoulder: 70 });
    expect(scoreFrame(off, sideRaise)).toBe(60);
    expect(scoreFrame(off, loose)).toBe(80);
  });
});

describe('labelFor', () => {
  it('uses 85 and 60 as the Perfect and Good thresholds', () => {
    expect(labelFor(100)).toBe('Perfect');
    expect(labelFor(PERFECT_SCORE)).toBe('Perfect');
    expect(labelFor(84.9)).toBe('Good');
    expect(labelFor(GOOD_SCORE)).toBe('Good');
    expect(labelFor(59.9)).toBe('Miss');
    expect(labelFor(0)).toBe('Miss');
  });
});
