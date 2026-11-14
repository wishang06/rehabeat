import { describe, expect, it } from 'vitest';
import { LM } from '../pose/landmarks';
import type { Landmark, Move } from '../types';
import { computeGhost } from './ghost';

const SIZE = { width: 640, height: 480 };

/**
 * A player facing the camera in an unmirrored frame: their left side is on the
 * image's right. Torso is 144 px tall (0.3 of 480).
 */
function standingLandmarks(): Landmark[] {
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 1,
  }));
  const set = (index: number, x: number, y: number) => {
    landmarks[index] = { x, y, z: 0, visibility: 1 };
  };
  set(LM.leftShoulder, 0.6, 0.3);
  set(LM.rightShoulder, 0.4, 0.3);
  set(LM.leftHip, 0.6, 0.6);
  set(LM.rightHip, 0.4, 0.6);
  return landmarks;
}

function move(joints: Move['joints']): Move {
  return {
    id: 'm',
    name: 'M',
    joints,
    tolerance: 20,
    beats: { reach: 2, hold: 4, release: 2 },
    formRules: [],
  };
}

const TORSO_PX = 144;

describe('computeGhost', () => {
  it('lays a 90 degree raise straight out to each side from the live shoulders', () => {
    const limbs = computeGhost(
      move({ leftShoulder: 90, rightShoulder: 90, leftElbow: 180, rightElbow: 180 }),
      standingLandmarks(),
      SIZE,
    );
    expect(limbs).toHaveLength(2);

    const [left, right] = limbs;
    expect(left[0]).toEqual({ x: 0.6 * 640, y: 0.3 * 480 });
    expect(left[1].x).toBeCloseTo(0.6 * 640 + 0.6 * TORSO_PX, 5);
    expect(left[1].y).toBeCloseTo(0.3 * 480, 5);
    // A straight elbow carries on in the same direction.
    expect(left[2].x).toBeGreaterThan(left[1].x);
    expect(left[2].y).toBeCloseTo(0.3 * 480, 5);

    expect(right[0]).toEqual({ x: 0.4 * 640, y: 0.3 * 480 });
    expect(right[1].x).toBeCloseTo(0.4 * 640 - 0.6 * TORSO_PX, 5);
    expect(right[2].x).toBeLessThan(right[1].x);
  });

  it('points an overhead raise up and slightly outward', () => {
    const [left, right] = computeGhost(
      move({ leftShoulder: 170, rightShoulder: 170 }),
      standingLandmarks(),
      SIZE,
    );
    expect(left[1].y).toBeLessThan(left[0].y);
    expect(left[1].x).toBeGreaterThan(left[0].x);
    expect(right[1].y).toBeLessThan(right[0].y);
    expect(right[1].x).toBeLessThan(right[0].x);
  });

  it('bends the forearm upward for a 90 degree elbow on a side raise', () => {
    const [left] = computeGhost(
      move({ leftShoulder: 90, leftElbow: 90 }),
      standingLandmarks(),
      SIZE,
    );
    expect(left[2].x).toBeCloseTo(left[1].x, 5);
    expect(left[2].y).toBeLessThan(left[1].y);
  });

  it('foreshortens a knee raise: knee at the hip, shin hanging straight down', () => {
    const limbs = computeGhost(move({ leftHip: 90, leftKnee: 90 }), standingLandmarks(), SIZE);
    expect(limbs).toHaveLength(1);
    const [hip, knee, ankle] = limbs[0];
    expect(knee.x).toBeCloseTo(hip.x, 5);
    expect(knee.y).toBeCloseTo(hip.y, 5);
    expect(ankle.x).toBeCloseTo(hip.x, 5);
    expect(ankle.y).toBeCloseTo(hip.y + 0.85 * TORSO_PX, 5);
  });

  it('draws a straight standing leg for a 180 degree hip and knee', () => {
    const [[hip, knee, ankle]] = computeGhost(
      move({ rightHip: 180, rightKnee: 180 }),
      standingLandmarks(),
      SIZE,
    );
    expect(knee.y).toBeCloseTo(hip.y + 0.85 * TORSO_PX, 5);
    expect(ankle.y).toBeCloseTo(knee.y + 0.85 * TORSO_PX, 5);
  });

  it("uses the player's own segment lengths when world landmarks are available", () => {
    const world: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
    world[LM.leftShoulder] = { x: 0.2, y: -0.5, z: 0, visibility: 1 };
    world[LM.leftHip] = { x: 0.2, y: 0, z: 0, visibility: 1 };
    world[LM.leftElbow] = { x: 0.2, y: -0.25, z: 0, visibility: 1 };
    world[LM.leftWrist] = { x: 0.2, y: -0.05, z: 0, visibility: 1 };
    world[LM.rightShoulder] = { x: -0.2, y: -0.5, z: 0, visibility: 1 };

    const [left] = computeGhost(move({ leftShoulder: 90 }), standingLandmarks(), SIZE, world);
    // Upper arm is half the torso in world space, so half the torso in pixels.
    expect(left[1].x - left[0].x).toBeCloseTo(0.5 * TORSO_PX, 5);
    expect(left[2].x - left[1].x).toBeCloseTo(0.4 * TORSO_PX, 5);
  });

  it('skips a side whose shoulder or hip is not visible', () => {
    const landmarks = standingLandmarks();
    landmarks[LM.leftHip].visibility = 0.1;
    const limbs = computeGhost(
      move({ leftShoulder: 90, rightShoulder: 90 }),
      landmarks,
      SIZE,
    );
    expect(limbs).toHaveLength(1);
    expect(limbs[0][0].x).toBeCloseTo(0.4 * 640, 5);
  });
});
