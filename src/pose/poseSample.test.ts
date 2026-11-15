import { describe, expect, it } from 'vitest';
import { JOINT_NAMES } from '../types';
import { AngleSmoother } from './angleSmoother';
import { point, standingPose, withLandmarks } from './poseFixtures';
import { buildPoseSample, normaliseLandmarks } from './poseSample';
import type { PoseSampleInput } from './poseSample';

const FRAME = 1 / 30;

/** Image landmarks only ride along in the sample, so their values do not matter here. */
const IMAGE_LANDMARKS = standingPose();

function input(overrides: Partial<PoseSampleInput> = {}): PoseSampleInput {
  return {
    t: 12.5,
    filterSeconds: 3,
    landmarks: IMAGE_LANDMARKS,
    worldLandmarks: standingPose(),
    detectMs: 8.25,
    fps: 29.7,
    ...overrides,
  };
}

function armsOutPose() {
  return withLandmarks(standingPose(), {
    leftElbow: point(0.45, -0.5),
    leftWrist: point(0.75, -0.5),
    rightElbow: point(-0.45, -0.5),
    rightWrist: point(-0.75, -0.5),
  });
}

describe('normaliseLandmarks', () => {
  it('fills in a missing visibility with 0', () => {
    expect(
      normaliseLandmarks([
        { x: 0.1, y: 0.2, z: 0.3 },
        { x: 0.4, y: 0.5, z: 0.6, visibility: 0.9 },
      ]),
    ).toEqual([
      { x: 0.1, y: 0.2, z: 0.3, visibility: 0 },
      { x: 0.4, y: 0.5, z: 0.6, visibility: 0.9 },
    ]);
  });

  it('keeps only the fields of our Landmark type', () => {
    const raw = [{ x: 1, y: 2, z: 3, visibility: 0.5, presence: 0.7 }];
    expect(normaliseLandmarks(raw)).toEqual([{ x: 1, y: 2, z: 3, visibility: 0.5 }]);
  });

  it('returns null when there is no pose', () => {
    expect(normaliseLandmarks(undefined)).toBeNull();
    expect(normaliseLandmarks(null)).toBeNull();
    expect(normaliseLandmarks([])).toBeNull();
  });
});

describe('buildPoseSample', () => {
  it('builds a full sample from a detected pose', () => {
    const world = standingPose();
    const sample = buildPoseSample(input({ worldLandmarks: world }), new AngleSmoother());

    expect(sample.frame.t).toBe(12.5);
    expect(sample.frame.visible).toEqual([...JOINT_NAMES]);
    expect(Object.keys(sample.frame.angles).sort()).toEqual([...JOINT_NAMES].sort());
    expect(sample.frame.angles.leftShoulder).toBeCloseTo(0, 6);
    expect(sample.frame.angles.leftKnee).toBeCloseTo(180, 6);
    expect(sample.landmarks).toBe(IMAGE_LANDMARKS);
    expect(sample.worldLandmarks).toBe(world);
    expect(sample.form.trunkLeanDeg).toBeCloseTo(0, 9);
    expect(sample.form.shoulderEarRatio).toBeCloseTo(0.3, 9);
    expect(sample.detectMs).toBe(8.25);
    expect(sample.fps).toBe(29.7);
  });

  it('keeps angles and visible in step when a joint is hidden', () => {
    const world = withLandmarks(standingPose(), { rightAnkle: point(-0.15, 0.9, 0, 0.1) });
    const { frame } = buildPoseSample(input({ worldLandmarks: world }), new AngleSmoother());
    expect(frame.visible).not.toContain('rightKnee');
    expect(frame.angles).not.toHaveProperty('rightKnee');
    expect(Object.keys(frame.angles).sort()).toEqual([...frame.visible].sort());
  });

  it('smooths angles across frames using filterSeconds', () => {
    const smoother = new AngleSmoother();
    buildPoseSample(input({ filterSeconds: 3 }), smoother);
    const { frame } = buildPoseSample(
      input({ filterSeconds: 3 + FRAME, worldLandmarks: armsOutPose() }),
      smoother,
    );
    // The raw shoulder angle jumped from 0 to 90; the smoothed one is on its way.
    expect(frame.angles.leftShoulder).toBeGreaterThan(0);
    expect(frame.angles.leftShoulder).toBeLessThan(90);
  });

  it('measures angles from the world landmarks, not the image landmarks', () => {
    const sample = buildPoseSample(
      input({ landmarks: armsOutPose(), worldLandmarks: standingPose() }),
      new AngleSmoother(),
    );
    expect(sample.frame.angles.leftShoulder).toBeCloseTo(0, 6);
  });

  it('emits an empty sample when no pose was found', () => {
    const sample = buildPoseSample(
      input({ landmarks: null, worldLandmarks: null }),
      new AngleSmoother(),
    );
    expect(sample).toEqual({
      frame: { t: 12.5, angles: {}, visible: [] },
      landmarks: null,
      worldLandmarks: null,
      form: { trunkLeanDeg: null, shoulderEarRatio: null },
      detectMs: 8.25,
      fps: 29.7,
    });
  });

  it('resets the smoother when the pose is lost', () => {
    const smoother = new AngleSmoother();
    buildPoseSample(input({ filterSeconds: 3 }), smoother);
    buildPoseSample(
      input({ filterSeconds: 3 + FRAME, landmarks: null, worldLandmarks: null }),
      smoother,
    );
    const { frame } = buildPoseSample(
      input({ filterSeconds: 3 + 2 * FRAME, worldLandmarks: armsOutPose() }),
      smoother,
    );
    // No easing in from the pose before the gap.
    expect(frame.angles.leftShoulder).toBeCloseTo(90, 6);
  });

  it("uses the previous frame's visible joints as hysteresis", () => {
    const hovering = withLandmarks(standingPose(), { leftWrist: point(0.15, 0.1, 0, 0.55) });
    const fresh = buildPoseSample(input({ worldLandmarks: hovering }), new AngleSmoother());
    expect(fresh.frame.visible).not.toContain('leftElbow');
    const kept = buildPoseSample(
      input({ worldLandmarks: hovering, previousVisible: ['leftElbow'] }),
      new AngleSmoother(),
    );
    expect(kept.frame.visible).toContain('leftElbow');
    expect(kept.frame.angles.leftElbow).toBeDefined();
  });
});

describe('buildPoseSample: flat angles', () => {
  /** The left elbow pushed toward the camera in 3D; the picture (IMAGE_LANDMARKS) has the arm straight. */
  const bentInDepth = () => withLandmarks(standingPose(), { leftElbow: point(0.15, -0.2, -0.2) });

  it('adds them when it is given the aspect and a second smoother', () => {
    const { frame } = buildPoseSample(
      input({ worldLandmarks: bentInDepth(), aspect: 16 / 9 }),
      new AngleSmoother(),
      new AngleSmoother(),
    );
    expect(frame.angles.leftElbow).toBeLessThan(120);
    expect(frame.flatAngles?.leftElbow).toBeCloseTo(180, 6);
    expect(Object.keys(frame.flatAngles ?? {}).sort()).toEqual([...frame.visible].sort());
  });

  it('leaves them out without the aspect or without the second smoother', () => {
    expect(buildPoseSample(input({ aspect: 16 / 9 }), new AngleSmoother()).frame).not.toHaveProperty('flatAngles');
    expect(buildPoseSample(input(), new AngleSmoother(), new AngleSmoother()).frame).not.toHaveProperty('flatAngles');
  });

  it('measures them only for the joints the 3D reading counts as visible', () => {
    const world = withLandmarks(standingPose(), { rightAnkle: point(-0.15, 0.9, 0, 0.1) });
    const { frame } = buildPoseSample(
      input({ worldLandmarks: world, aspect: 16 / 9 }),
      new AngleSmoother(),
      new AngleSmoother(),
    );
    expect(frame.flatAngles).not.toHaveProperty('rightKnee');
    expect(frame.flatAngles).toHaveProperty('leftKnee');
  });

  it('starts the flat angles afresh after the pose was lost', () => {
    const flatSmoother = new AngleSmoother();
    const armsOut = armsOutPose();
    buildPoseSample(input({ landmarks: armsOut, aspect: 1, filterSeconds: 3 }), new AngleSmoother(), flatSmoother);
    buildPoseSample(
      input({ landmarks: null, worldLandmarks: null, aspect: 1, filterSeconds: 3 + FRAME }),
      new AngleSmoother(),
      flatSmoother,
    );
    const { frame } = buildPoseSample(
      input({ aspect: 1, filterSeconds: 3 + 2 * FRAME }),
      new AngleSmoother(),
      flatSmoother,
    );
    // Arms down again: no easing in from the arms-out reading of two frames ago.
    expect(frame.flatAngles?.leftShoulder).toBeCloseTo(0, 6);
  });
});
