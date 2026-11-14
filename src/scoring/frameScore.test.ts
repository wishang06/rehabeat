import { describe, expect, it } from 'vitest';
import type { Move, PoseFrame } from '../types';
import {
  GOOD_SCORE,
  PERFECT_SCORE,
  labelFor,
  meanAngleError,
  scoreFrame,
  scoreFromError,
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

  it('counts a target joint that is not visible as a zero-score error', () => {
    // One joint perfect, one hidden: (0 + 50) / 2.
    expect(meanAngleError(frame({ leftShoulder: 90 }), sideRaise)).toBe(25);
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
