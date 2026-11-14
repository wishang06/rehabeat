import { describe, expect, it } from 'vitest';
import { OVERLAP_FRACTION, armTorsoOverlap, figureOffset, needsOffset } from './placement';
import { REST_POSE, buildSilhouette, poseForMove, standardBody } from './silhouette';

const BODY = standardBody({ center: { x: 500, y: 300 }, shoulderWidth: 100 });

describe('armTorsoOverlap / needsOffset', () => {
  it('finds hands-at-sides arms mostly inside the torso outline', () => {
    expect(armTorsoOverlap(buildSilhouette(REST_POSE, BODY))).toBeGreaterThan(OVERLAP_FRACTION);
    expect(needsOffset(REST_POSE)).toBe(true);
  });

  it('counts arms resting just off the sides as against the body, but not arms out at 45 degrees', () => {
    for (const shoulder of [0, 16, 20]) {
      expect(needsOffset({ ...REST_POSE, leftShoulder: shoulder, rightShoulder: shoulder })).toBe(true);
    }
    expect(needsOffset({ ...REST_POSE, leftShoulder: 45, rightShoulder: 45 })).toBe(false);
  });

  it('finds raised arms clear of the torso', () => {
    for (const shoulder of [90, 170]) {
      const pose = { ...REST_POSE, leftShoulder: shoulder, rightShoulder: shoulder };
      expect(armTorsoOverlap(buildSilhouette(pose, BODY))).toBeLessThan(OVERLAP_FRACTION);
      expect(needsOffset(pose)).toBe(false);
    }
  });

  it('counts an arm folded across the chest as overlapping', () => {
    const pose = { ...REST_POSE, leftShoulder: 25, leftElbow: 40 };
    expect(needsOffset(pose)).toBe(true);
  });

  it('offsets a knee raise, whose arms rest at the sides, but not an overhead raise', () => {
    expect(needsOffset(poseForMove({ joints: { leftHip: 90, leftKnee: 90 } }))).toBe(true);
    expect(
      needsOffset(poseForMove({ joints: { leftShoulder: 170, rightShoulder: 170, leftElbow: 175, rightElbow: 175 } })),
    ).toBe(false);
  });

  it('gives the same answer whatever the body size or facing, so it never flickers with the player', () => {
    const sizes = [60, 140, 300];
    for (const width of sizes) {
      for (const mirrored of [true, false]) {
        const body = standardBody({ center: { x: 700, y: 200 }, shoulderWidth: width, mirrored });
        expect(armTorsoOverlap(buildSilhouette(REST_POSE, body))).toBeCloseTo(armTorsoOverlap(buildSilhouette(REST_POSE, BODY)), 6);
      }
    }
  });
});

describe('figureOffset', () => {
  const canvasWidth = 1280;
  const gap = 20;
  const onBody = (left: number, right: number) => ({ left, top: 100, right, bottom: 700 });

  it('puts the figure beside the player on the side with more room, clear of the body', () => {
    const player = onBody(400, 600);
    const { dx, side } = figureOffset({ figure: onBody(390, 610), player, canvasWidth, gap, previousSide: null });
    expect(side).toBe('right');
    expect(390 + dx).toBeCloseTo(600 + gap);
  });

  it('uses the left when the player stands right of centre', () => {
    const player = onBody(800, 1000);
    const { dx, side } = figureOffset({ figure: onBody(790, 1010), player, canvasWidth, gap, previousSide: null });
    expect(side).toBe('left');
    expect(1010 + dx).toBeCloseTo(800 - gap);
  });

  it('keeps the side it had while the figure still fits there', () => {
    const player = onBody(400, 600);
    const { side } = figureOffset({ figure: onBody(390, 610), player, canvasWidth, gap, previousSide: 'left' });
    expect(side).toBe('left');
  });

  it('moves to the roomier side once the old side no longer fits', () => {
    const player = onBody(150, 350);
    const { side } = figureOffset({ figure: onBody(140, 360), player, canvasWidth, gap, previousSide: 'left' });
    expect(side).toBe('right');
  });

  it('stays inside the canvas when there is not enough room, overlapping the player instead', () => {
    // 300 px free on the left, 280 on the right: neither fits a 720 px figure.
    const player = onBody(300, 1000);
    const { dx, side } = figureOffset({ figure: onBody(290, 1010), player, canvasWidth, gap, previousSide: null });
    expect(side).toBe('left');
    expect(290 + dx).toBeCloseTo(gap);
    expect(dx).toBeLessThan(0);
  });
});
