import { describe, expect, it } from 'vitest';
import { LM, SKELETON_BONES } from './landmarks';
import { hiddenPose, point, withLandmarks } from './poseFixtures';
import { drawSkeleton, layoutSkeleton, SKELETON_MIN_VISIBILITY } from './skeleton';

/** The 12 landmarks that SKELETON_BONES joins, each at its own normalised spot. */
function fullImagePose() {
  return withLandmarks(hiddenPose(), {
    leftShoulder: point(0.6, 0.3),
    rightShoulder: point(0.4, 0.3),
    leftElbow: point(0.65, 0.45),
    rightElbow: point(0.35, 0.45),
    leftWrist: point(0.7, 0.6),
    rightWrist: point(0.3, 0.6),
    leftHip: point(0.56, 0.6),
    rightHip: point(0.44, 0.6),
    leftKnee: point(0.57, 0.78),
    rightKnee: point(0.43, 0.78),
    leftAnkle: point(0.58, 0.95),
    rightAnkle: point(0.42, 0.95),
  });
}

/**
 * Just enough of a 2D context to record what drawSkeleton does. Any method it
 * does not have (clearRect, scale, translate, ...) throws if called.
 */
function recordingContext() {
  const calls: string[] = [];
  const record =
    (name: string) =>
    (...args: number[]): void => {
      calls.push(`${name}(${args.map((arg) => Number(arg.toFixed(3))).join(',')})`);
    };
  const fake = {
    lineWidth: 1,
    lineCap: 'butt',
    strokeStyle: '#000000',
    fillStyle: '#000000',
    save: record('save'),
    restore: record('restore'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    arc: record('arc'),
    stroke: (): void => {
      calls.push(`stroke[${fake.strokeStyle},${fake.lineWidth}]`);
    },
    fill: (): void => {
      calls.push(`fill[${fake.fillStyle}]`);
    },
  };
  return { calls, fake, ctx: fake as unknown as CanvasRenderingContext2D };
}

describe('layoutSkeleton', () => {
  it('scales every bone and joint of a fully visible pose to canvas pixels', () => {
    const { bones, joints } = layoutSkeleton(fullImagePose(), 640, 480);
    expect(bones).toHaveLength(SKELETON_BONES.length);
    expect(joints).toHaveLength(12);
    // The first bone joins the shoulders.
    expect(bones[0][0]).toBeCloseTo(0.6 * 640, 9);
    expect(bones[0][1]).toBeCloseTo(0.3 * 480, 9);
    expect(bones[0][2]).toBeCloseTo(0.4 * 640, 9);
    expect(bones[0][3]).toBeCloseTo(0.3 * 480, 9);
  });

  it('does not mirror: a larger x stays further right', () => {
    const pose = fullImagePose();
    const { bones } = layoutSkeleton(pose, 1000, 500);
    const [leftShoulderX, , rightShoulderX] = bones[0];
    expect(pose[LM.leftShoulder].x).toBeGreaterThan(pose[LM.rightShoulder].x);
    expect(leftShoulderX).toBeGreaterThan(rightShoulderX);
  });

  it('skips bones with an endpoint below the visibility threshold', () => {
    const pose = withLandmarks(fullImagePose(), { leftWrist: point(0.7, 0.6, 0, 0.49) });
    const { bones, joints } = layoutSkeleton(pose, 640, 480);
    expect(bones).toHaveLength(SKELETON_BONES.length - 1);
    expect(joints).toHaveLength(11);
    for (const [x1, y1, x2, y2] of bones) {
      expect([x1, y1]).not.toEqual([0.7 * 640, 0.6 * 480]);
      expect([x2, y2]).not.toEqual([0.7 * 640, 0.6 * 480]);
    }
  });

  it('defaults to a threshold of 0.5 and accepts another', () => {
    expect(SKELETON_MIN_VISIBILITY).toBe(0.5);
    const pose = withLandmarks(fullImagePose(), { leftWrist: point(0.7, 0.6, 0, 0.5) });
    expect(layoutSkeleton(pose, 640, 480).bones).toHaveLength(SKELETON_BONES.length);
    expect(layoutSkeleton(pose, 640, 480, 0.8).bones).toHaveLength(SKELETON_BONES.length - 1);
  });

  it('lays out nothing for a hidden or missing pose', () => {
    expect(layoutSkeleton(hiddenPose(), 640, 480)).toEqual({ bones: [], joints: [] });
    expect(layoutSkeleton([], 640, 480)).toEqual({ bones: [], joints: [] });
  });
});

describe('drawSkeleton', () => {
  it('wraps its drawing in save and restore and draws nothing else', () => {
    const { calls, ctx } = recordingContext();
    drawSkeleton(ctx, fullImagePose(), { width: 640, height: 480 });

    expect(calls[0]).toBe('save()');
    expect(calls[calls.length - 1]).toBe('restore()');
    expect(calls.filter((call) => call === 'save()')).toHaveLength(1);
    expect(calls.filter((call) => call === 'restore()')).toHaveLength(1);
    expect(calls.filter((call) => call.startsWith('lineTo'))).toHaveLength(SKELETON_BONES.length);
    expect(calls.filter((call) => call.startsWith('arc'))).toHaveLength(12);
    expect(calls.filter((call) => call.startsWith('stroke'))).toHaveLength(1);
    expect(calls.filter((call) => call.startsWith('fill'))).toHaveLength(1);
  });

  it('draws bones in canvas pixel coordinates', () => {
    const { calls, ctx } = recordingContext();
    const pose = withLandmarks(hiddenPose(), {
      leftShoulder: point(0.75, 0.25),
      leftElbow: point(0.5, 0.5),
    });
    drawSkeleton(ctx, pose, { width: 400, height: 200, lineWidth: 6 });

    expect(calls).toContain('moveTo(300,50)');
    expect(calls).toContain('lineTo(200,100)');
    expect(calls.filter((call) => call.startsWith('lineTo'))).toHaveLength(1);
    // One dot per visible endpoint, centred on it.
    expect(calls.filter((call) => call.startsWith('arc(300,50,'))).toHaveLength(1);
    expect(calls.filter((call) => call.startsWith('arc(200,100,'))).toHaveLength(1);
    expect(calls.filter((call) => call.startsWith('arc'))).toHaveLength(2);
  });

  it('applies the given colours and line width', () => {
    const { calls, ctx } = recordingContext();
    drawSkeleton(ctx, fullImagePose(), {
      width: 640,
      height: 480,
      lineColor: '#ff00aa',
      jointColor: '#00ffcc',
      lineWidth: 7,
    });
    expect(calls).toContain('stroke[#ff00aa,7]');
    expect(calls).toContain('fill[#00ffcc]');
  });

  it('passes minVisibility through', () => {
    const { calls, ctx } = recordingContext();
    const pose = withLandmarks(fullImagePose(), { rightAnkle: point(0.42, 0.95, 0, 0.7) });
    drawSkeleton(ctx, pose, { width: 640, height: 480, minVisibility: 0.9 });
    expect(calls.filter((call) => call.startsWith('lineTo'))).toHaveLength(
      SKELETON_BONES.length - 1,
    );
  });

  it('still saves and restores when there is nothing to draw', () => {
    const { calls, ctx } = recordingContext();
    drawSkeleton(ctx, hiddenPose(), { width: 640, height: 480 });
    expect(calls[0]).toBe('save()');
    expect(calls[calls.length - 1]).toBe('restore()');
    expect(calls.some((call) => call.startsWith('lineTo') || call.startsWith('arc'))).toBe(false);
  });
});
