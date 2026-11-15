import { describe, expect, it } from 'vitest';
import { point, standingPose } from '../pose/poseFixtures';
import type { Landmark } from '../types';
import { FloorTracker, groundPoints, lowestPoint, standingFloor } from './floor';
import { viewForMove } from './moveViews';
import { REST_POSE, standardBody } from './silhouette';
import { STICK_JOINTS, stickPoints, viewForPose } from './stick';
import { LM } from '../pose/landmarks';

const BODY = standardBody({ center: { x: 500, y: 300 }, shoulderWidth: 100, mirrored: false });
const SIZE = { width: 1000, height: 800 };

/** Landmarks with both ankles at `y` (normalised), everything else hidden. */
function ankles(leftY: number, rightY = leftY, visibility = 1): Landmark[] {
  const pose = standingPose().map((landmark) => ({ ...landmark, visibility: 0 }));
  pose[LM.leftAnkle] = point(0.55, leftY, 0, visibility);
  pose[LM.rightAnkle] = point(0.45, rightY, 0, visibility);
  return pose;
}

describe('groundPoints', () => {
  it('moves the figure so its lowest point rests on the floor, without changing its shape', () => {
    const lifted = stickPoints(viewForPose({ ...REST_POSE, leftHip: 90, leftKnee: 90 }), BODY);
    const grounded = groundPoints(lifted, 900);
    expect(lowestPoint(grounded)).toBeCloseTo(900, 9);
    const dy = grounded.head.y - lifted.head.y;
    for (const joint of STICK_JOINTS) {
      expect(grounded[joint].x).toBeCloseTo(lifted[joint].x, 9);
      expect(grounded[joint].y - lifted[joint].y).toBeCloseTo(dy, 9);
    }
  });

  it('stands a deep pose on the floor instead of hanging it from standing hips', () => {
    // A wide squat drawn on standing hips leaves its feet above the floor.
    const squat = stickPoints(viewForMove('goddess-pose', {}), BODY);
    const floor = standingFloor(BODY);
    expect(lowestPoint(squat)).toBeLessThan(floor - 10);
    const grounded = groundPoints(squat, floor);
    expect(lowestPoint(grounded)).toBeCloseTo(floor, 9);
    // So its hips come down: it squats.
    expect(grounded.hipMid.y).toBeGreaterThan(squat.hipMid.y);
  });

  it('leaves a standing figure where it is when the floor is where its feet are', () => {
    const standing = stickPoints(viewForPose(REST_POSE), BODY);
    const grounded = groundPoints(standing, standingFloor(BODY));
    expect(grounded.hipMid.y).toBeCloseTo(standing.hipMid.y, 6);
  });
});

describe('standingFloor', () => {
  it('is where the feet of the body standing straight would be', () => {
    const standing = stickPoints(viewForPose(REST_POSE), BODY);
    expect(standingFloor(BODY)).toBeCloseTo(Math.max(standing.leftAnkle.y, standing.rightAnkle.y), 6);
  });
});

describe('FloorTracker', () => {
  it('reads the floor from the lower of the two ankles, in canvas pixels', () => {
    const floor = new FloorTracker();
    // One knee raised: the standing foot is the floor.
    expect(floor.update(ankles(0.7, 0.9), SIZE, 0)).toBeCloseTo(720, 6);
  });

  it('holds still through detector noise', () => {
    const floor = new FloorTracker();
    floor.update(ankles(0.9), SIZE, 0);
    let held = 0;
    for (let t = 33; t < 2000; t += 33) held = floor.update(ankles(0.9 + (t % 66 === 0 ? 0.008 : -0.008)), SIZE, t) ?? 0;
    expect(held).toBe(720);
  });

  it('follows a real step toward the camera, then stops', () => {
    const floor = new FloorTracker();
    floor.update(ankles(0.8), SIZE, 0);
    let held = 0;
    for (let t = 33; t < 3000; t += 33) held = floor.update(ankles(0.9), SIZE, t) ?? 0;
    expect(held).toBeGreaterThan(710);
    expect(held).toBeLessThanOrEqual(720);
  });

  it('ignores ankles it cannot see, keeping the last floor, and has none before it has seen one', () => {
    const floor = new FloorTracker();
    expect(floor.update(ankles(0.9, 0.9, 0.1), SIZE, 0)).toBeNull();
    floor.update(ankles(0.8), SIZE, 33);
    expect(floor.update(null, SIZE, 66)).toBeCloseTo(640, 6);
    expect(floor.update(ankles(0.2, 0.2, 0.1), SIZE, 99)).toBeCloseTo(640, 6);
  });

  it('starts again when the canvas changes size', () => {
    const floor = new FloorTracker();
    floor.update(ankles(0.8), SIZE, 0);
    expect(floor.update(ankles(0.8), { width: 500, height: 400 }, 33)).toBeCloseTo(320, 6);
  });
});
