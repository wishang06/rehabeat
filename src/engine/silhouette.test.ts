import { describe, expect, it } from 'vitest';
import { LM } from '../pose/landmarks';
import { hiddenPose, point, standingPose, withLandmarks } from '../pose/poseFixtures';
import type { Move } from '../types';
import { REST_POSE, bodyFromLandmarks, bodyScale, poseForMove, standardBody } from './silhouette';

const sideRaise: Move = {
  id: 'side-arm-raise',
  name: 'Side Arm Raise',
  joints: { leftShoulder: 90, rightShoulder: 90, leftElbow: 180, rightElbow: 180 },
  tolerance: 20,
  beats: { reach: 2, hold: 4, release: 2 },
  formRules: [],
};

const BODY = standardBody({ center: { x: 500, y: 300 }, shoulderWidth: 100 });

describe('poseForMove', () => {
  it("uses the move's targets and the rest pose for every joint it leaves out", () => {
    const pose = poseForMove(sideRaise);
    expect(pose.leftShoulder).toBe(90);
    expect(pose.rightElbow).toBe(180);
    expect(pose.leftHip).toBe(REST_POSE.leftHip);
    expect(pose.rightKnee).toBe(REST_POSE.rightKnee);
  });

  it('is the rest pose without a move', () => {
    expect(poseForMove(null)).toEqual(REST_POSE);
  });
});

describe('standardBody', () => {
  it('places the shoulders shoulderWidth apart around the centre, hips below', () => {
    expect(BODY.rightShoulder.x - BODY.leftShoulder.x).toBeCloseTo(100);
    expect((BODY.leftShoulder.x + BODY.rightShoulder.x) / 2).toBeCloseTo(500);
    expect(BODY.leftShoulder.y).toBeCloseTo(300);
    expect(BODY.leftHip.y).toBeGreaterThan(BODY.leftShoulder.y);
  });

  it("is mirrored by default, like the stage: the player's left on the viewer's left", () => {
    expect(BODY.leftShoulder.x).toBeLessThan(BODY.rightShoulder.x);
    const camera = standardBody({ center: { x: 500, y: 300 }, shoulderWidth: 100, mirrored: false });
    expect(camera.leftShoulder.x).toBeGreaterThan(camera.rightShoulder.x);
  });
});

describe('bodyFromLandmarks', () => {
  const SIZE = { width: 640, height: 480 };
  /** Image landmarks: shoulders at y 0.3, hips at 0.6, 0.2 of the width apart. */
  const image = () =>
    withLandmarks(hiddenPose(), {
      leftShoulder: point(0.6, 0.3),
      rightShoulder: point(0.4, 0.3),
      leftHip: point(0.58, 0.6),
      rightHip: point(0.42, 0.6),
    });

  it('anchors on the live shoulders and hips in canvas pixels', () => {
    const body = bodyFromLandmarks(image(), SIZE);
    expect(body?.leftShoulder).toEqual({ x: 384, y: 144 });
    expect(body?.rightHip).toEqual({ x: 0.42 * 640, y: 288 });
  });

  it("uses the player's own segment lengths from world landmarks, relative to the torso", () => {
    // standingPose: torso 0.5 m, upper arm 0.3 m, so the upper arm is 0.6 torsos.
    const body = bodyFromLandmarks(image(), SIZE, standingPose());
    const torsoPx = Math.hypot(384 - 0.58 * 640, 144 - 288);
    expect(body?.left.upperArm).toBeCloseTo(0.6 * torsoPx, 5);
    expect(body?.left.shin).toBeCloseTo(0.9 * torsoPx, 5);
  });

  it('is null until both shoulders and both hips are visible', () => {
    const hidden = withLandmarks(image(), { rightHip: point(0.42, 0.6, 0, 0.1) });
    expect(bodyFromLandmarks(hidden, SIZE)).toBeNull();
    expect(bodyFromLandmarks(image().slice(0, LM.leftHip), SIZE)).toBeNull();
  });

  it('accepts less certain anchors when given a lower visibility floor', () => {
    const unsure = withLandmarks(image(), { rightHip: point(0.42, 0.6, 0, 0.3) });
    expect(bodyFromLandmarks(unsure, SIZE)).toBeNull();
    expect(bodyFromLandmarks(unsure, SIZE, null, 0.2)?.rightHip).toEqual({ x: 0.42 * 640, y: 288 });
  });
});

describe('bodyScale', () => {
  it('is the shoulder width of a body facing the camera', () => {
    expect(bodyScale(BODY)).toBeCloseTo(100);
  });

  it('does not shrink to nothing when the shoulders line up side-on', () => {
    const sideOn = { ...BODY, leftShoulder: { x: 500, y: 300 }, rightShoulder: { x: 505, y: 300 } };
    expect(bodyScale(sideOn)).toBeGreaterThan(70);
  });
});
