import { describe, expect, it } from 'vitest';
import { POSE_EASE_MS } from './ease';
import { REST_POSE, standardBody, type SilhouettePose } from './silhouette';
import { DEFAULT_ORDER, StickEaser, pictureAngle, stickFigure, stickPoints, viewForPose, type FigureView } from './stick';

/** Camera-image convention: the left of the player at the larger x. */
const BODY = standardBody({ center: { x: 500, y: 300 }, shoulderWidth: 100, mirrored: false });
const pose = (joints: Partial<SilhouettePose>): SilhouettePose => ({ ...REST_POSE, ...joints });

describe('viewForPose and stickPoints', () => {
  it('draws arms at the angles scoring measures: hip-shoulder-elbow and shoulder-elbow-wrist', () => {
    const view = viewForPose(pose({ leftShoulder: 90, rightShoulder: 170, leftElbow: 120, rightElbow: 175 }));
    const points = stickPoints(view, BODY);
    // The shoulder is measured from the line to the hip, which slants in a little from the shoulder.
    expect(Math.abs(pictureAngle(points, 'leftShoulder') - 90)).toBeLessThan(12);
    expect(Math.abs(pictureAngle(points, 'rightShoulder') - 170)).toBeLessThan(12);
    expect(pictureAngle(points, 'leftElbow')).toBeCloseTo(120, 0);
    expect(pictureAngle(points, 'rightElbow')).toBeCloseTo(175, 0);
  });

  it('raises an arm out to its own side', () => {
    const points = stickPoints(viewForPose(pose({ leftShoulder: 90, leftElbow: 180 })), BODY);
    // The left of the player is at the larger x in the camera image.
    expect(points.leftWrist.x).toBeGreaterThan(points.leftShoulder.x + 100);
    expect(points.leftWrist.y).toBeCloseTo(points.leftShoulder.y, 0);
    expect(points.rightWrist.x).toBeLessThan(points.rightShoulder.x);
  });

  it('follows the body it is given when that is mirrored', () => {
    const mirrored = standardBody({ center: { x: 500, y: 300 }, shoulderWidth: 100 });
    const points = stickPoints(viewForPose(pose({ leftShoulder: 90, leftElbow: 180 })), mirrored);
    expect(points.leftWrist.x).toBeLessThan(points.leftShoulder.x - 100);
  });

  it('stands at rest with straight legs under the hips and the head above the shoulders', () => {
    const points = stickPoints(viewForPose(REST_POSE), BODY);
    expect(points.leftAnkle.x).toBeCloseTo(points.leftHip.x);
    expect(points.leftAnkle.y).toBeCloseTo(points.leftHip.y + BODY.left.thigh + BODY.left.shin);
    expect(points.head.x).toBeCloseTo(500);
    expect(points.head.y).toBeLessThan(points.shoulderMid.y);
    expect(points.hipMid.x).toBeCloseTo(500);
    expect(points.hipMid.y).toBeCloseTo(BODY.leftHip.y);
  });

  it('shortens a thigh lifted toward the camera and cants it outward, with the shin hanging below', () => {
    const points = stickPoints(viewForPose(pose({ leftHip: 90, leftKnee: 90 })), BODY);
    const thigh = Math.hypot(points.leftKnee.x - points.leftHip.x, points.leftKnee.y - points.leftHip.y);
    expect(thigh).toBeLessThan(BODY.left.thigh * 0.6);
    expect(points.leftKnee.x).toBeGreaterThan(points.leftHip.x);
    expect(points.leftAnkle.y).toBeGreaterThan(points.leftKnee.y);
    // The other leg is untouched.
    expect(points.rightAnkle.x).toBeCloseTo(points.rightHip.x);
  });

  it('leans the torso, shoulders and head together, and turns the hips half as far', () => {
    const view: FigureView = { ...viewForPose(REST_POSE), torso: 90 };
    const points = stickPoints(view, BODY);
    // Level, toward the left of the player.
    expect(points.shoulderMid.y).toBeCloseTo(points.hipMid.y);
    expect(points.shoulderMid.x).toBeGreaterThan(points.hipMid.x);
    expect(points.head.x).toBeGreaterThan(points.shoulderMid.x);
    expect(points.leftShoulder.x).toBeCloseTo(points.rightShoulder.x);
    // A quarter turn of the torso is an eighth of a turn at the hips.
    expect(points.leftHip.y - points.rightHip.y).toBeCloseTo(points.leftHip.x - points.rightHip.x);
  });

  it('draws a side-on body narrow', () => {
    const points = stickPoints({ ...viewForPose(REST_POSE), width: 0.1 }, BODY);
    expect(Math.abs(points.leftShoulder.x - points.rightShoulder.x)).toBeCloseTo(10);
  });

  it('shows only part of a bone that points toward the camera', () => {
    const points = stickPoints({ ...viewForPose(REST_POSE), leftThigh: [90, 0.5] }, BODY);
    expect(points.leftKnee.x - points.leftHip.x).toBeCloseTo(BODY.left.thigh * 0.5);
    expect(points.leftKnee.y).toBeCloseTo(points.leftHip.y);
  });
});

describe('stickFigure', () => {
  const points = stickPoints(viewForPose(REST_POSE), BODY);

  it('draws the limbs in the order given, furthest first', () => {
    expect(stickFigure(points, 100).limbs.map((limb) => limb.chain)).toEqual(DEFAULT_ORDER);
    const order = ['leftArm', 'leftLeg', 'rightLeg', 'rightArm'] as const;
    expect(stickFigure(points, 100, order).limbs.map((limb) => limb.chain)).toEqual(order);
  });

  it('runs each limb from the body outward', () => {
    const arm = stickFigure(points, 100).limbs.find((limb) => limb.chain === 'leftArm');
    expect(arm?.points).toEqual([points.leftShoulder, points.leftElbow, points.leftWrist]);
  });

  it('stops the neck at the edge of the head ring', () => {
    const figure = stickFigure(points, 100);
    const neckEnd = figure.trunk[0][2];
    const gap = Math.hypot(neckEnd.x - figure.head.center.x, neckEnd.y - figure.head.center.y);
    expect(gap).toBeCloseTo(figure.head.radius);
    expect(figure.head.radius).toBeCloseTo(25);
  });
});

describe('StickEaser', () => {
  const rest = stickPoints(viewForPose(REST_POSE), BODY);
  const raised = stickPoints(viewForPose(pose({ leftShoulder: 90 })), BODY);

  it('shows the first pose at once', () => {
    const shown = new StickEaser().update('rest', rest, BODY, 0);
    expect(shown.leftWrist.x).toBeCloseTo(rest.leftWrist.x);
    expect(shown.leftWrist.y).toBeCloseTo(rest.leftWrist.y);
  });

  it('moves to a new pose over the ease time, without a jump', () => {
    const easer = new StickEaser();
    easer.update('rest', rest, BODY, 0);
    const started = easer.update('raise', raised, BODY, 1000);
    expect(started.leftWrist.x).toBeCloseTo(rest.leftWrist.x);
    const halfway = easer.update('raise', raised, BODY, 1000 + POSE_EASE_MS / 2);
    expect(halfway.leftWrist.x).toBeGreaterThan(rest.leftWrist.x);
    expect(halfway.leftWrist.x).toBeLessThan(raised.leftWrist.x);
    const done = easer.update('raise', raised, BODY, 1000 + POSE_EASE_MS);
    expect(done.leftWrist.x).toBeCloseTo(raised.leftWrist.x);
    expect(done.leftWrist.y).toBeCloseTo(raised.leftWrist.y);
  });

  it('does not restart when it is handed the same pose again', () => {
    const easer = new StickEaser();
    easer.update('rest', rest, BODY, 0);
    easer.update('raise', raised, BODY, 1000);
    easer.update('raise', raised, BODY, 1050);
    const done = easer.update('raise', raised, BODY, 1000 + POSE_EASE_MS);
    expect(done.leftWrist.x).toBeCloseTo(raised.leftWrist.x);
  });

  it('turns around from wherever it is when the pose changes mid-move', () => {
    const easer = new StickEaser();
    easer.update('rest', rest, BODY, 0);
    easer.update('raise', raised, BODY, 1000);
    const before = easer.update('raise', raised, BODY, 1060);
    const after = easer.update('rest', rest, BODY, 1060);
    expect(after.leftWrist.x).toBeCloseTo(before.leftWrist.x);
    expect(after.leftWrist.y).toBeCloseTo(before.leftWrist.y);
    const back = easer.update('rest', rest, BODY, 1060 + POSE_EASE_MS);
    expect(back.leftWrist.x).toBeCloseTo(rest.leftWrist.x);
  });

  it('stays on the body while the body moves under it', () => {
    const easer = new StickEaser();
    easer.update('rest', rest, BODY, 0);
    const moved = standardBody({ center: { x: 700, y: 350 }, shoulderWidth: 100, mirrored: false });
    const shown = easer.update('rest', stickPoints(viewForPose(REST_POSE), moved), moved, 16);
    expect(shown.hipMid.x).toBeCloseTo(700);
    expect(shown.leftWrist.x).toBeCloseTo(rest.leftWrist.x + 200);
  });
});
