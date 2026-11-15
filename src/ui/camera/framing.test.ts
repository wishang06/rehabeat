import { describe, expect, it } from 'vitest';
import { hiddenPose, point, withLandmarks } from '../../pose/poseFixtures';
import { bodyCutOff } from './framing';

/** A whole body in normalised camera coordinates: head near the top, ankles near the bottom. */
function wholeBody() {
  return withLandmarks(hiddenPose(), {
    nose: point(0.5, 0.14),
    leftShoulder: point(0.56, 0.3),
    rightShoulder: point(0.44, 0.3),
    leftHip: point(0.55, 0.55),
    rightHip: point(0.45, 0.55),
    leftAnkle: point(0.55, 0.9),
    rightAnkle: point(0.45, 0.91),
  });
}

describe('bodyCutOff', () => {
  it('is false for a whole body in the picture', () => {
    expect(bodyCutOff(wholeBody())).toBe(false);
  });

  it('is true when the head is out of the top of the picture', () => {
    expect(bodyCutOff(withLandmarks(wholeBody(), { nose: point(0.5, 0.14, 0, 0.1) }))).toBe(true);
    // The nose is in, but the top of the head is not.
    expect(bodyCutOff(withLandmarks(wholeBody(), { nose: point(0.5, 0.05) }))).toBe(true);
  });

  it('is true when the feet are out of the bottom of the picture', () => {
    const noFeet = withLandmarks(wholeBody(), {
      leftAnkle: point(0.55, 1.08, 0, 0.2),
      rightAnkle: point(0.45, 1.1, 0, 0.1),
    });
    expect(bodyCutOff(noFeet)).toBe(true);
    expect(bodyCutOff(withLandmarks(wholeBody(), { rightAnkle: point(0.45, 0.99) }))).toBe(true);
  });

  it('is false when there is nobody to judge', () => {
    expect(bodyCutOff(null)).toBe(false);
    expect(bodyCutOff(undefined)).toBe(false);
    expect(bodyCutOff(hiddenPose())).toBe(false);
  });
});
