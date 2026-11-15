import { describe, expect, it } from 'vitest';
import { hiddenPose, point, standingPose, withLandmarks } from '../pose/poseFixtures';
import type { Landmark } from '../types';
import { FigureAnchor } from './anchor';
import type { BodyFrame } from './silhouette';

const SIZE = { width: 1000, height: 750 };
const FRAME_MS = 1000 / 60;

interface Stance {
  /** Midpoint between the hips, in canvas pixels. */
  hipX: number;
  hipY: number;
  /** Shoulder width and shoulder-to-hip length, in canvas pixels. */
  shoulders: number;
  torso: number;
  /** The shoulders' sideways shift from above the hips, in pixels: a lean. */
  lean?: number;
  /** Visibility of the hips; the shoulders are always in view. */
  hipVisibility?: number;
}

const STANDING: Stance = { hipX: 500, hipY: 420, shoulders: 150, torso: 200 };

/** Image landmarks of a player facing the camera: their left is at the larger x, as the camera sees it. */
function pose(stance: Stance, noise: () => number = () => 0): Landmark[] {
  const { hipX, hipY, shoulders, torso } = stance;
  const lean = stance.lean ?? 0;
  const hipVisibility = stance.hipVisibility ?? 1;
  const at = (x: number, y: number, visibility = 1) =>
    point((x + noise()) / SIZE.width, (y + noise()) / SIZE.height, 0, visibility);
  const hipHalf = shoulders * 0.3;
  return withLandmarks(hiddenPose(), {
    leftShoulder: at(hipX + lean + shoulders / 2, hipY - torso),
    rightShoulder: at(hipX + lean - shoulders / 2, hipY - torso),
    leftHip: at(hipX + hipHalf, hipY, hipVisibility),
    rightHip: at(hipX - hipHalf, hipY, hipVisibility),
  });
}

/** A repeatable source of noise in [-amplitude, amplitude]. */
function noiseSource(amplitude: number, seed = 1): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return (state / 4294967296 - 0.5) * 2 * amplitude;
  };
}

/**
 * Runs the anchor for `frames` display frames. The camera delivers a new pose
 * every second frame, as a 30 fps camera does on a 60 Hz screen.
 */
function run(
  anchor: FigureAnchor,
  frames: number,
  poseAt: (sampleIndex: number) => Landmark[] | null,
  options: { startMs?: number; world?: (sampleIndex: number) => Landmark[] | null } = {},
): { bodies: (BodyFrame | null)[]; endMs: number } {
  const startMs = options.startMs ?? 0;
  const bodies: (BodyFrame | null)[] = [];
  let landmarks: Landmark[] | null = null;
  let world: Landmark[] | null = null;
  for (let i = 0; i < frames; i++) {
    if (i % 2 === 0) {
      landmarks = poseAt(i / 2);
      world = options.world?.(i / 2) ?? null;
    }
    bodies.push(anchor.update(landmarks, world, SIZE, startMs + i * FRAME_MS));
  }
  return { bodies, endMs: startMs + frames * FRAME_MS };
}

const shoulderMid = (body: BodyFrame) => ({
  x: (body.leftShoulder.x + body.rightShoulder.x) / 2,
  y: (body.leftShoulder.y + body.rightShoulder.y) / 2,
});
const hipMid = (body: BodyFrame) => ({ x: (body.leftHip.x + body.rightHip.x) / 2, y: (body.leftHip.y + body.rightHip.y) / 2 });
const shoulderWidth = (body: BodyFrame) => Math.abs(body.leftShoulder.x - body.rightShoulder.x);

function expectNear(actual: { x: number; y: number }, expected: { x: number; y: number }): void {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
}

function last(bodies: (BodyFrame | null)[]): BodyFrame {
  const body = bodies[bodies.length - 1];
  if (!body) throw new Error('no body');
  return body;
}

/** The furthest the figure's shoulder midpoint gets from where it started, in pixels. */
function travel(bodies: (BodyFrame | null)[]): number {
  const first = bodies.find((body) => body !== null);
  if (!first) throw new Error('no body');
  const origin = shoulderMid(first);
  let furthest = 0;
  for (const body of bodies) {
    if (!body) continue;
    const p = shoulderMid(body);
    furthest = Math.max(furthest, Math.hypot(p.x - origin.x, p.y - origin.y));
  }
  return furthest;
}

/** The biggest move between one display frame and the next, in pixels. */
function biggestStep(bodies: (BodyFrame | null)[]): number {
  let biggest = 0;
  for (let i = 1; i < bodies.length; i++) {
    const a = bodies[i - 1];
    const b = bodies[i];
    if (!a || !b) continue;
    const p = shoulderMid(a);
    const q = shoulderMid(b);
    biggest = Math.max(biggest, Math.hypot(q.x - p.x, q.y - p.y));
  }
  return biggest;
}

describe('FigureAnchor', () => {
  it("stands the figure on the player: hips on their hips, shoulders their torso's length above", () => {
    const body = new FigureAnchor().update(pose(STANDING), null, SIZE, 0);
    expect(body).not.toBeNull();
    expectNear(hipMid(body!), { x: 500, y: 420 });
    expectNear(shoulderMid(body!), { x: 500, y: 220 });
    expect(shoulderWidth(body!)).toBeCloseTo(150);
    // The player's left is at the larger x in the camera image.
    expect(body!.leftShoulder.x).toBeGreaterThan(body!.rightShoulder.x);
  });

  it('does not move at all while a still player’s landmarks jitter', () => {
    const noise = noiseSource(6);
    const { bodies } = run(new FigureAnchor(), 240, () => pose(STANDING, noise));
    expect(travel(bodies.slice(1))).toBe(0);
    expect(shoulderWidth(last(bodies))).toBe(shoulderWidth(bodies[1]!));
  });

  it('does not follow a small sway', () => {
    // A slow 15 px sway each way: a tenth of the shoulder width.
    const { bodies } = run(new FigureAnchor(), 360, (i) => pose({ ...STANDING, hipX: 500 + 15 * Math.sin(i / 12) }));
    expect(travel(bodies)).toBe(0);
  });

  it('ignores a one-frame detector glitch', () => {
    const { bodies } = run(new FigureAnchor(), 120, (i) => pose(i === 20 ? { ...STANDING, hipX: 800, hipY: 200 } : STANDING));
    expect(travel(bodies)).toBe(0);
  });

  it('glides over when the player steps aside, with no jump', () => {
    const anchor = new FigureAnchor();
    const before = run(anchor, 30, () => pose(STANDING));
    const after = run(anchor, 90, () => pose({ ...STANDING, hipX: 800 }), { startMs: before.endMs });
    // Back on the player within a second and a half, to within a twentieth of their shoulder width.
    expect(Math.abs(hipMid(last(after.bodies)).x - 800)).toBeLessThan(7.5);
    // 300 px in one go would be a jump; a glide moves a little each frame.
    expect(biggestStep([last(before.bodies), ...after.bodies])).toBeLessThan(30);
  });

  it('stays upright and where it is when the player leans their torso over', () => {
    const anchor = new FigureAnchor();
    const before = run(anchor, 30, () => pose(STANDING));
    // A side bend: the shoulders go 120 px sideways and the torso looks shorter; the hips stay put.
    const leaning = run(anchor, 120, () => pose({ ...STANDING, lean: 120, torso: 160 }), { startMs: before.endMs });
    const body = last(leaning.bodies);
    expect(travel([last(before.bodies), ...leaning.bodies])).toBe(0);
    expect(body.leftShoulder.y).toBe(body.rightShoulder.y);
    expect(shoulderMid(body).x).toBeCloseTo(hipMid(body).x);
    expect(hipMid(body).y - shoulderMid(body).y).toBeCloseTo(200);
  });

  it('keeps its size when the player turns side-on', () => {
    const anchor = new FigureAnchor();
    const before = run(anchor, 30, () => pose(STANDING));
    const turned = run(anchor, 120, () => pose({ ...STANDING, shoulders: 40 }), { startMs: before.endMs });
    expect(shoulderWidth(last(turned.bodies))).toBeCloseTo(150);
  });

  it('resizes when the player steps back', () => {
    const anchor = new FigureAnchor();
    const before = run(anchor, 30, () => pose(STANDING));
    const far = { hipX: 500, hipY: 400, shoulders: 105, torso: 140 };
    const after = run(anchor, 120, () => pose(far), { startMs: before.endMs });
    const body = last(after.bodies);
    expect(shoulderWidth(body)).toBeGreaterThan(100);
    expect(shoulderWidth(body)).toBeLessThan(110);
    expect(hipMid(body).y - shoulderMid(body).y).toBeGreaterThan(133);
    expect(hipMid(body).y - shoulderMid(body).y).toBeLessThan(147);
  });

  it('hangs from the shoulders when the hips are out of view', () => {
    const body = new FigureAnchor().update(pose({ ...STANDING, hipVisibility: 0.1 }), null, SIZE, 0);
    expect(body).not.toBeNull();
    expectNear(shoulderMid(body!), { x: 500, y: 220 });
    // No torso to measure, so standard proportions.
    expect(hipMid(body!).y).toBeGreaterThan(220 + 150);
  });

  it('does not move when the hips drop in and out of view', () => {
    const { bodies } = run(new FigureAnchor(), 240, (i) => pose({ ...STANDING, hipVisibility: i % 6 < 3 ? 1 : 0.2 }));
    expect(travel(bodies)).toBe(0);
  });

  it('keeps the figure where it was while the pose is lost', () => {
    const anchor = new FigureAnchor();
    const before = run(anchor, 30, () => pose(STANDING));
    const lost = run(anchor, 60, () => null, { startMs: before.endMs });
    expect(last(lost.bodies)).toEqual(last(before.bodies));
  });

  it('has nothing to draw before the first pose', () => {
    expect(new FigureAnchor().update(null, null, SIZE, 0)).toBeNull();
  });

  it('starts again on the player when the canvas changes size', () => {
    const anchor = new FigureAnchor();
    anchor.update(pose(STANDING), null, SIZE, 0);
    const bigger = { width: 2000, height: 1500 };
    const body = anchor.update(pose(STANDING), null, bigger, FRAME_MS);
    expectNear(hipMid(body!), { x: 1000, y: 840 });
  });

  describe('limb lengths', () => {
    /** A standing world pose whose limbs are stretched by `factor` (the torso is not). */
    function worldPose(factor: number): Landmark[] {
      const base = standingPose();
      return withLandmarks(base, {
        leftElbow: point(0.15, -0.5 + 0.3 * factor),
        rightElbow: point(-0.15, -0.5 + 0.3 * factor),
        leftWrist: point(0.15, -0.5 + 0.6 * factor),
        rightWrist: point(-0.15, -0.5 + 0.6 * factor),
        leftKnee: point(0.15, 0.45 * factor),
        rightKnee: point(-0.15, 0.45 * factor),
        leftAnkle: point(0.15, 0.9 * factor),
        rightAnkle: point(-0.15, 0.9 * factor),
      });
    }

    function visibleLimbs(landmarks: Landmark[]): Landmark[] {
      return landmarks.map((landmark) => ({ ...landmark, visibility: 1 }));
    }

    it("come from the player's own limbs, measured against their torso", () => {
      // World: upper arm 0.3 m on a 0.5 m torso, so 0.6 of the 200 px torso.
      const body = new FigureAnchor().update(visibleLimbs(pose(STANDING)), worldPose(1), SIZE, 0);
      expect(body!.left.upperArm).toBeCloseTo(120);
      expect(body!.right.upperArm).toBeCloseTo(120);
      expect(body!.left.thigh).toBeCloseTo(180);
    });

    it('hold steady while the measured lengths flicker by a tenth each way', () => {
      const noise = noiseSource(0.1, 7);
      const { bodies } = run(new FigureAnchor(), 240, () => visibleLimbs(pose(STANDING)), {
        world: () => worldPose(1 + noise()),
      });
      const lengths = bodies.slice(60).map((body) => body!.left.upperArm);
      expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThan(120 * 0.03);
    });

    it('are the same on both sides, so the figure is symmetrical', () => {
      const lopsided = withLandmarks(worldPose(1), { leftElbow: point(0.15, -0.14), leftWrist: point(0.15, 0.16) });
      const body = new FigureAnchor().update(visibleLimbs(pose(STANDING)), lopsided, SIZE, 0);
      expect(body!.left.upperArm).toBe(body!.right.upperArm);
    });

    it('never stray far from standard proportions, however wrong a measurement is', () => {
      const body = new FigureAnchor().update(visibleLimbs(pose(STANDING)), worldPose(3), SIZE, 0);
      // Standard: an upper arm 0.65 of the torso. Three times that is not a plausible arm.
      expect(body!.left.upperArm).toBeLessThan(200 * 0.65 * 1.35);
    });
  });
});
