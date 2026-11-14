import { describe, expect, it } from 'vitest';
import { computeFormMetrics } from './formMetrics';
import { hiddenPose, point, standingPose, withLandmarks } from './poseFixtures';

describe('computeFormMetrics', () => {
  it('measures nothing without a pose', () => {
    expect(computeFormMetrics(null)).toEqual({ trunkLeanDeg: null, shoulderEarRatio: null });
    expect(computeFormMetrics(hiddenPose())).toEqual({
      trunkLeanDeg: null,
      shoulderEarRatio: null,
    });
    expect(computeFormMetrics([])).toEqual({ trunkLeanDeg: null, shoulderEarRatio: null });
  });

  it('measures an upright pose: no lean, ears 0.15 above shoulders on a 0.5 torso', () => {
    const form = computeFormMetrics(standingPose());
    expect(form.trunkLeanDeg).toBeCloseTo(0, 9);
    expect(form.shoulderEarRatio).toBeCloseTo(0.3, 9);
  });

  it('measures a sideways lean, the same for either direction', () => {
    // Shoulder midpoint moved 0.5 sideways over a 0.5 rise: 45 degrees.
    const leanOneWay = withLandmarks(standingPose(), {
      leftShoulder: point(0.65, -0.5),
      rightShoulder: point(0.35, -0.5),
    });
    const leanOtherWay = withLandmarks(standingPose(), {
      leftShoulder: point(-0.35, -0.5),
      rightShoulder: point(-0.65, -0.5),
    });
    expect(computeFormMetrics(leanOneWay).trunkLeanDeg).toBeCloseTo(45, 9);
    expect(computeFormMetrics(leanOtherWay).trunkLeanDeg).toBeCloseTo(45, 9);
  });

  it('measures a small lean', () => {
    const offset = 0.5 * Math.tan((10 * Math.PI) / 180);
    const pose = withLandmarks(standingPose(), {
      leftShoulder: point(0.15 + offset, -0.5),
      rightShoulder: point(-0.15 + offset, -0.5),
    });
    expect(computeFormMetrics(pose).trunkLeanDeg).toBeCloseTo(10, 9);
  });

  it('ignores depth for the lean but not for the torso length', () => {
    const pose = withLandmarks(standingPose(), {
      leftShoulder: point(0.15, -0.5, -0.5),
      rightShoulder: point(-0.15, -0.5, -0.5),
    });
    const form = computeFormMetrics(pose);
    expect(form.trunkLeanDeg).toBeCloseTo(0, 9);
    expect(form.shoulderEarRatio).toBeCloseTo(0.15 / Math.hypot(0.5, 0.5), 9);
  });

  it('needs both shoulders and both hips', () => {
    for (const name of ['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip'] as const) {
      const standing = standingPose();
      const hidden = withLandmarks(standing, { [name]: point(0, 0, 0, 0.2) });
      expect(computeFormMetrics(hidden)).toEqual({ trunkLeanDeg: null, shoulderEarRatio: null });
    }
  });

  it('shrinks the ratio as the shoulders rise toward the ears', () => {
    const shrugged = withLandmarks(standingPose(), {
      leftShoulder: point(0.15, -0.58),
      rightShoulder: point(-0.15, -0.58),
    });
    const relaxed = computeFormMetrics(standingPose()).shoulderEarRatio;
    const raised = computeFormMetrics(shrugged).shoulderEarRatio;
    expect(raised).toBeCloseTo(0.07 / 0.58, 9);
    expect(raised).toBeLessThan(relaxed ?? 0);
  });

  it('averages the two sides', () => {
    const pose = withLandmarks(standingPose(), {
      leftEar: point(0.08, -0.6),
      rightEar: point(-0.08, -0.7),
    });
    // Gaps of 0.1 and 0.2 average to 0.15.
    expect(computeFormMetrics(pose).shoulderEarRatio).toBeCloseTo(0.3, 9);
  });

  it('uses the one visible ear when the other is hidden', () => {
    const pose = withLandmarks(standingPose(), {
      leftEar: point(0.08, -0.6),
      rightEar: point(-0.08, -0.7, 0, 0.1),
    });
    expect(computeFormMetrics(pose).shoulderEarRatio).toBeCloseTo(0.1 / 0.5, 9);
  });

  it('gives a lean but no ratio when neither ear is visible', () => {
    const pose = withLandmarks(standingPose(), {
      leftEar: point(0.08, -0.65, 0, 0),
      rightEar: point(-0.08, -0.65, 0, 0),
    });
    const form = computeFormMetrics(pose);
    expect(form.trunkLeanDeg).toBeCloseTo(0, 9);
    expect(form.shoulderEarRatio).toBeNull();
  });

  it('gives no ratio when the torso has no length', () => {
    const pose = withLandmarks(standingPose(), {
      leftShoulder: point(0.15, 0),
      rightShoulder: point(-0.15, 0),
    });
    const form = computeFormMetrics(pose);
    expect(form.shoulderEarRatio).toBeNull();
    expect(Number.isNaN(form.trunkLeanDeg)).toBe(false);
  });

  it('honours a custom visibility threshold', () => {
    const pose = withLandmarks(standingPose(), { leftHip: point(0.15, 0, 0, 0.4) });
    expect(computeFormMetrics(pose).trunkLeanDeg).toBeNull();
    expect(computeFormMetrics(pose, 0.3).trunkLeanDeg).toBeCloseTo(0, 9);
  });
});
