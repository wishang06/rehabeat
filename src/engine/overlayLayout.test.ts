import { describe, expect, it } from 'vitest';
import { hiddenPose, point, withLandmarks } from '../pose/poseFixtures';
import { hintAnchor, layoutBanner, layoutHint, layoutPlayerBody } from './overlayLayout';

const SIZE = { width: 1000, height: 750 };

/** Image landmarks, arms out to the sides, everything visible. */
function arms90() {
  return withLandmarks(hiddenPose(), {
    leftShoulder: point(0.6, 0.3),
    rightShoulder: point(0.4, 0.3),
    leftElbow: point(0.72, 0.3),
    rightElbow: point(0.28, 0.3),
    leftWrist: point(0.84, 0.3),
    rightWrist: point(0.16, 0.3),
    leftHip: point(0.57, 0.6),
    rightHip: point(0.43, 0.6),
    leftKnee: point(0.57, 0.78),
    rightKnee: point(0.43, 0.78),
    leftAnkle: point(0.57, 0.95),
    rightAnkle: point(0.43, 0.95),
  });
}

describe('layoutPlayerBody', () => {
  it('lays a capsule along each visible limb, in canvas pixels', () => {
    const body = layoutPlayerBody(arms90(), SIZE);
    expect(body.capsules.map((c) => c.part)).toHaveLength(8);
    const forearm = body.capsules.find((c) => c.part === 'leftForearm');
    expect(forearm?.a).toEqual({ x: 720, y: 225 });
    expect(forearm?.b).toEqual({ x: 840, y: 225 });
    expect(body.torso).toHaveLength(4);
  });

  it('leaves out limbs whose ends are not visible enough to draw', () => {
    const hidden = withLandmarks(arms90(), { leftWrist: point(0.84, 0.3, 0, 0.2) });
    const parts = layoutPlayerBody(hidden, SIZE).capsules.map((c) => c.part);
    expect(parts).not.toContain('leftForearm');
    expect(parts).toContain('leftUpperArm');
  });

  it('still lays out a limb it is told to keep, however unsure, so it can be shown greyed out', () => {
    const unsure = withLandmarks(arms90(), {
      leftWrist: point(0.84, 0.3, 0, 0.2),
      rightWrist: point(0.16, 0.3, 0, 0.2),
    });
    const parts = layoutPlayerBody(unsure, SIZE, { keep: new Set(['leftForearm'] as const) }).capsules.map((c) => c.part);
    expect(parts).toContain('leftForearm');
    expect(parts).not.toContain('rightForearm');
    expect(layoutPlayerBody(unsure, SIZE).capsules.map((c) => c.part)).not.toContain('leftForearm');
  });

  it('draws limbs narrower than the target figure but scaled to the same body', () => {
    const body = layoutPlayerBody(arms90(), SIZE);
    const upper = body.capsules.find((c) => c.part === 'leftUpperArm');
    // Shoulders are 200 px apart.
    expect(upper?.ra).toBeGreaterThan(0.03 * 200);
    expect(upper?.ra).toBeLessThan(0.13 * 200);
  });

  it('bounds the body it laid out', () => {
    const { bounds } = layoutPlayerBody(arms90(), SIZE);
    expect(bounds?.left).toBeLessThan(160);
    expect(bounds?.right).toBeGreaterThan(840);
  });
});

describe('hintAnchor', () => {
  it('points at the body part the hint names: the elbow for an arm, the knee for a hip', () => {
    const landmarks = arms90();
    expect(hintAnchor('leftShoulder', landmarks, SIZE)).toEqual({ x: 720, y: 225 });
    expect(hintAnchor('rightElbow', landmarks, SIZE)).toEqual({ x: 280, y: 225 });
    expect(hintAnchor('leftHip', landmarks, SIZE)).toEqual({ x: 570, y: 585 });
  });

  it('falls back to the joint itself when that part is out of view, and gives up without either', () => {
    const noElbow = withLandmarks(arms90(), { leftElbow: point(0.72, 0.3, 0, 0.1) });
    expect(hintAnchor('leftShoulder', noElbow, SIZE)).toEqual({ x: 600, y: 225 });
    const neither = withLandmarks(noElbow, { leftShoulder: point(0.6, 0.3, 0, 0.1) });
    expect(hintAnchor('leftShoulder', neither, SIZE)).toBeNull();
  });
});

describe('layoutHint', () => {
  const base = {
    bodyCenterX: 500,
    scale: 120,
    width: SIZE.width,
    height: SIZE.height,
    labelWidth: 220,
    labelHeight: 56,
    safeTop: 140,
    safeBottom: 170,
  };

  it('puts the label on the outer side of the limb, with the arrow ending at the anchor', () => {
    const right = layoutHint({ ...base, anchor: { x: 650, y: 300 } });
    expect(right.label.x).toBeGreaterThan(650);
    // The arrow comes in from the label's side and stops just short of the anchor.
    expect(right.tip.x).toBeGreaterThan(650);
    expect(right.tail.x).toBe(right.label.x);
    expect(Math.hypot(right.tip.x - 650, right.tip.y - 300)).toBeLessThan(0.3 * base.scale);

    const left = layoutHint({ ...base, anchor: { x: 350, y: 300 } });
    expect(left.label.x + left.label.width).toBeLessThan(350);
  });

  it('keeps the label inside the canvas and out of the HUD bands', () => {
    for (const anchor of [
      { x: 990, y: 300 },
      { x: 10, y: 300 },
      { x: 600, y: 20 },
      { x: 400, y: 740 },
    ]) {
      const { label } = layoutHint({ ...base, anchor });
      expect(label.x).toBeGreaterThanOrEqual(0);
      expect(label.x + label.width).toBeLessThanOrEqual(SIZE.width);
      expect(label.y).toBeGreaterThanOrEqual(base.safeTop);
      expect(label.y + label.height).toBeLessThanOrEqual(SIZE.height - base.safeBottom);
    }
  });

  it('moves the label to the inner side rather than cover the target figure', () => {
    const figure = { left: 0, top: 0, right: 300, bottom: 750 };
    const { label } = layoutHint({ ...base, anchor: { x: 350, y: 300 }, avoid: figure });
    expect(label.x).toBeGreaterThan(350);
  });

  it('keeps the outer side when the figure is clear of it', () => {
    const figure = { left: 700, top: 0, right: 1000, bottom: 750 };
    const { label } = layoutHint({ ...base, anchor: { x: 350, y: 300 }, avoid: figure });
    expect(label.x + label.width).toBeLessThan(350);
  });

  it('flips to the inner side when the outer side has no room', () => {
    const { label } = layoutHint({ ...base, anchor: { x: 960, y: 300 } });
    expect(label.x + label.width).toBeLessThan(960);
  });
});

describe('layoutBanner', () => {
  const base = { width: 1000, height: 750, bannerWidth: 600, bannerHeight: 60, safeTop: 150, safeBottom: 200 };

  it('centres the banner in the band between the HUD rows when nothing is in the way', () => {
    const banner = layoutBanner({ ...base, avoid: [] });
    expect(banner.x).toBe(200);
    expect(banner.y + banner.height / 2).toBeCloseTo((150 + 550) / 2, 0);
  });

  it('moves off the limbs it should not cover, staying in the band', () => {
    const arms = { left: 100, top: 320, right: 900, bottom: 380 };
    const banner = layoutBanner({ ...base, avoid: [arms] });
    expect(banner.y + banner.height <= arms.top || banner.y >= arms.bottom).toBe(true);
    expect(banner.y).toBeGreaterThanOrEqual(150);
    expect(banner.y + banner.height).toBeLessThanOrEqual(550);
  });

  it('covers as little as it can when there is no clear spot', () => {
    const everywhere = { left: 0, top: 0, right: 1000, bottom: 750 };
    const thin = { left: 0, top: 480, right: 1000, bottom: 490 };
    const banner = layoutBanner({ ...base, avoid: [everywhere, thin] });
    expect(banner.y + banner.height <= thin.top || banner.y >= thin.bottom).toBe(true);
  });
});
