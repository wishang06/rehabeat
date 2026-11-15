import { describe, expect, it } from 'vitest';
import { MOVES } from '../moves';
import { JOINT_NAMES } from '../types';
import { MOVE_VIEWS, REST_VIEW, viewForMove } from './moveViews';
import { REST_POSE, poseForMove, standardBody } from './silhouette';
import { pictureAngle, stickPoints, viewForPose } from './stick';

const BODY = standardBody({ center: { x: 0, y: 0 }, shoulderWidth: 100, mirrored: false });

describe('MOVE_VIEWS', () => {
  it('only pictures moves that exist', () => {
    const ids = new Set(MOVES.map((move) => move.id));
    for (const id of Object.keys(MOVE_VIEWS)) expect(ids, id).toContain(id);
  });

  // The picture is what the player copies, so it has to show the angles the move scores.
  for (const move of MOVES) {
    it(`draws ${move.id} with every scored joint within tolerance of its target`, () => {
      const points = stickPoints(viewForMove(move.id, move.joints), BODY);
      for (const joint of JOINT_NAMES) {
        const target = move.joints[joint];
        if (target === undefined) continue;
        const drawn = pictureAngle(points, joint);
        expect(Math.abs(drawn - target), `${joint}: drawn ${drawn.toFixed(0)}, target ${target}`).toBeLessThanOrEqual(
          move.tolerance,
        );
      }
    });
  }

  it('keeps both feet on the floor in the standing poses with a wide stance', () => {
    for (const id of ['warrior-ii', 'goddess-pose', 'triangle-pose']) {
      const points = stickPoints(MOVE_VIEWS[id], BODY);
      expect(Math.abs(points.leftAnkle.y - points.rightAnkle.y), id).toBeLessThan(12);
    }
  });
});

describe('viewForMove', () => {
  it('uses the picture written for a move when there is one', () => {
    expect(viewForMove('triangle-pose', {})).toBe(MOVE_VIEWS['triangle-pose']);
  });

  it('builds a front view from the joint angles otherwise, with unscored joints at rest', () => {
    const joints = { leftShoulder: 90, rightShoulder: 90 };
    expect(viewForMove('side-arm-raise', joints)).toEqual(viewForPose(poseForMove({ joints })));
    expect(viewForMove(null, {})).toEqual(REST_VIEW);
    expect(REST_VIEW).toEqual(viewForPose(REST_POSE));
  });
});
