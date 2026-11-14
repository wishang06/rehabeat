import { describe, expect, it } from 'vitest';
import { JOINT_NAMES } from '../types';
import { angleBetween, computeJointAngles } from './angles';
import { MIN_VISIBILITY } from './landmarks';
import { hiddenPose, point, standingPose, withLandmarks } from './poseFixtures';

const ORIGIN = { x: 0, y: 0, z: 0 };

describe('angleBetween', () => {
  it('measures a right angle', () => {
    expect(angleBetween({ x: 1, y: 0, z: 0 }, ORIGIN, { x: 0, y: 1, z: 0 })).toBeCloseTo(90, 9);
  });

  it('measures 180 for opposite rays and 0 for the same ray', () => {
    expect(angleBetween({ x: 2, y: 0, z: 0 }, ORIGIN, { x: -5, y: 0, z: 0 })).toBeCloseTo(180, 9);
    expect(angleBetween({ x: 2, y: 0, z: 0 }, ORIGIN, { x: 7, y: 0, z: 0 })).toBeCloseTo(0, 9);
  });

  it('uses all three dimensions', () => {
    expect(angleBetween({ x: 1, y: 0, z: 0 }, ORIGIN, { x: 0, y: 0, z: 1 })).toBeCloseTo(90, 9);
    // (1,1,0) . (0,1,1) = 1 and both are sqrt(2) long: cos = 1/2.
    expect(angleBetween({ x: 1, y: 1, z: 0 }, ORIGIN, { x: 0, y: 1, z: 1 })).toBeCloseTo(60, 9);
  });

  it('measures at the vertex wherever the vertex is', () => {
    const vertex = { x: 3, y: -2, z: 5 };
    const a = { x: 4, y: -2, z: 5 };
    const c = { x: 3 + Math.cos(2), y: -2 + Math.sin(2), z: 5 };
    expect(angleBetween(a, vertex, c)).toBeCloseTo((2 * 180) / Math.PI, 9);
  });

  it('is symmetric and ignores ray length', () => {
    const a = { x: 0.3, y: -0.1, z: 0.2 };
    const c = { x: -0.4, y: 0.25, z: 0.1 };
    const far = { x: c.x * 10, y: c.y * 10, z: c.z * 10 };
    expect(angleBetween(a, ORIGIN, c)).toBeCloseTo(angleBetween(c, ORIGIN, a), 9);
    expect(angleBetween(a, ORIGIN, far)).toBeCloseTo(angleBetween(a, ORIGIN, c), 9);
  });

  it('returns 0 rather than NaN for a zero-length ray', () => {
    const p = { x: 1, y: 2, z: 3 };
    expect(angleBetween(p, p, { x: 4, y: 5, z: 6 })).toBe(0);
    expect(angleBetween({ x: 4, y: 5, z: 6 }, p, p)).toBe(0);
    expect(angleBetween(p, p, p)).toBe(0);
  });

  it('returns 0 rather than NaN for non-finite coordinates', () => {
    expect(angleBetween({ x: Number.NaN, y: 0, z: 0 }, ORIGIN, { x: 0, y: 1, z: 0 })).toBe(0);
  });

  it('never leaves 0-180 for parallel rays whose cosine rounds past 1', () => {
    for (let i = 1; i <= 200; i++) {
      const a = { x: 0.1 * i, y: 0.37 * i, z: -0.73 * i };
      const same = { x: a.x * 3.3, y: a.y * 3.3, z: a.z * 3.3 };
      const opposite = { x: -a.x * 0.7, y: -a.y * 0.7, z: -a.z * 0.7 };
      expect(angleBetween(a, ORIGIN, same)).toBeCloseTo(0, 4);
      expect(angleBetween(a, ORIGIN, opposite)).toBeCloseTo(180, 4);
    }
  });
});

describe('computeJointAngles', () => {
  it('measures every joint of a standing pose', () => {
    const { angles, visible } = computeJointAngles(standingPose());
    expect(visible).toEqual([...JOINT_NAMES]);
    expect(angles.leftShoulder).toBeCloseTo(0, 6);
    expect(angles.rightShoulder).toBeCloseTo(0, 6);
    expect(angles.leftElbow).toBeCloseTo(180, 6);
    expect(angles.rightElbow).toBeCloseTo(180, 6);
    expect(angles.leftHip).toBeCloseTo(180, 6);
    expect(angles.rightHip).toBeCloseTo(180, 6);
    expect(angles.leftKnee).toBeCloseTo(180, 6);
    expect(angles.rightKnee).toBeCloseTo(180, 6);
  });

  it('measures an arm raised to the side as a 90 degree shoulder', () => {
    const pose = withLandmarks(standingPose(), {
      leftElbow: point(0.45, -0.5),
      leftWrist: point(0.75, -0.5),
    });
    const { angles } = computeJointAngles(pose);
    expect(angles.leftShoulder).toBeCloseTo(90, 6);
    expect(angles.leftElbow).toBeCloseTo(180, 6);
    expect(angles.rightShoulder).toBeCloseTo(0, 6);
  });

  it('measures an arm overhead as a 180 degree shoulder', () => {
    const pose = withLandmarks(standingPose(), {
      rightElbow: point(-0.15, -0.8),
      rightWrist: point(-0.15, -1.1),
    });
    expect(computeJointAngles(pose).angles.rightShoulder).toBeCloseTo(180, 6);
  });

  it('uses depth: a forearm pointing at the camera bends the elbow to 90', () => {
    const pose = withLandmarks(standingPose(), { leftWrist: point(0.15, -0.2, -0.3) });
    expect(computeJointAngles(pose).angles.leftElbow).toBeCloseTo(90, 6);
  });

  it('measures a seated pose: hips and knees at 90', () => {
    const pose = withLandmarks(standingPose(), {
      leftKnee: point(0.15, 0, -0.45),
      rightKnee: point(-0.15, 0, -0.45),
      leftAnkle: point(0.15, 0.45, -0.45),
      rightAnkle: point(-0.15, 0.45, -0.45),
    });
    const { angles } = computeJointAngles(pose);
    expect(angles.leftHip).toBeCloseTo(90, 6);
    expect(angles.rightHip).toBeCloseTo(90, 6);
    expect(angles.leftKnee).toBeCloseTo(90, 6);
    expect(angles.rightKnee).toBeCloseTo(90, 6);
  });

  it('skips only the joints that use a poorly visible landmark', () => {
    const pose = withLandmarks(standingPose(), { leftWrist: point(0.15, 0.1, 0, 0.59) });
    const { angles, visible } = computeJointAngles(pose);
    expect(visible).toEqual(JOINT_NAMES.filter((joint) => joint !== 'leftElbow'));
    expect(angles).not.toHaveProperty('leftElbow');
    expect(Object.keys(angles).sort()).toEqual([...visible].sort());
  });

  it('skips every joint that shares a hidden landmark', () => {
    const pose = withLandmarks(standingPose(), { leftHip: point(0.15, 0, 0, 0.1) });
    const { visible } = computeJointAngles(pose);
    expect(visible).toEqual([
      'rightShoulder',
      'leftElbow',
      'rightElbow',
      'rightHip',
      'rightKnee',
    ]);
  });

  it('counts a landmark exactly at the threshold as visible', () => {
    const pose = withLandmarks(standingPose(), {
      leftWrist: point(0.15, 0.1, 0, MIN_VISIBILITY),
    });
    expect(computeJointAngles(pose).visible).toContain('leftElbow');
  });

  it('honours a custom visibility threshold', () => {
    const pose = withLandmarks(standingPose(), { rightAnkle: point(-0.15, 0.9, 0, 0.3) });
    expect(computeJointAngles(pose).visible).not.toContain('rightKnee');
    expect(computeJointAngles(pose, 0.25).visible).toContain('rightKnee');
    expect(computeJointAngles(standingPose(), 1.01).visible).toEqual([]);
  });

  it('returns nothing for a pose with no visible landmarks or no landmarks at all', () => {
    expect(computeJointAngles(hiddenPose())).toEqual({ angles: {}, visible: [] });
    expect(computeJointAngles([])).toEqual({ angles: {}, visible: [] });
  });
});
