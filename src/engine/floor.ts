/**
 * The floor under the target figure.
 *
 * The figure stands on the player's hips (anchor.ts), which suits a standing
 * pose: its feet land on the player's feet. A pose whose legs bend or
 * spread, or one that sits or goes down on the hands, drawn from standing
 * hips leaves the figure hanging in the air until the player has moved into
 * it. Such a pose is moved straight up or down until its lowest point rests
 * on the floor: the line of the player's feet, held still like the anchor.
 *
 * A pose that stands as the rest pose does (an arm raise, a knee raise on a
 * straight standing leg) is left on the hips, so its arms stay exactly on
 * the player's shoulders. So is every pose until the player's feet have been
 * seen: with no feet in the picture there is no floor in it either.
 */
import { LM } from '../pose/landmarks';
import type { Landmark } from '../types';
import { Follower } from './anchor';
import type { BodyFrame } from './silhouette';
import { STICK_JOINTS, type StickPoints } from './stick';

/** Ankles below this visibility don't say where the floor is. */
const MIN_VISIBILITY = 0.5;
/**
 * The feet have to move this far (a share of the picture's height) before
 * the floor follows, and the floor stops once it is this close: a step toward
 * or away from the camera, not detector noise or a lifted heel.
 */
const FLOOR_RANGE = { outer: 0.04, inner: 0.006, followMs: 250 };
const MAX_STEP_MS = 100;
/**
 * A pose whose lowest point is within this of the standing feet (as a share
 * of the torso's length) already stands on the floor, and is left alone.
 */
const STANDS_WITHIN = 0.1;

type Size = { width: number; height: number };

/** The lowest point of the figure in the picture (the largest y, since y grows downward). */
export function lowestPoint(points: StickPoints): number {
  return Math.max(...STICK_JOINTS.map((joint) => points[joint].y));
}

/** The figure moved straight up or down so its lowest point rests on `floorY`. Its shape does not change. */
export function groundPoints(points: StickPoints, floorY: number): StickPoints {
  const dy = floorY - lowestPoint(points);
  const out = {} as StickPoints;
  for (const joint of STICK_JOINTS) out[joint] = { x: points[joint].x, y: points[joint].y + dy };
  return out;
}

/** Where the feet of `body` are when it stands straight. */
export function standingFloor(body: BodyFrame): number {
  const left = body.leftHip.y + body.left.thigh + body.left.shin;
  const right = body.rightHip.y + body.right.thigh + body.right.shin;
  return Math.max(left, right);
}

/** True when the pose's lowest point is where the body's standing feet are: it needs no grounding. */
export function standsOnItsFeet(points: StickPoints, body: BodyFrame): boolean {
  const torso = Math.hypot(
    (body.leftShoulder.x + body.rightShoulder.x - body.leftHip.x - body.rightHip.x) / 2,
    (body.leftShoulder.y + body.rightShoulder.y - body.leftHip.y - body.rightHip.y) / 2,
  );
  return Math.abs(lowestPoint(points) - standingFloor(body)) <= STANDS_WITHIN * torso;
}

/**
 * The pose to draw: `points` (built on `body`) put on the floor at `floorY`
 * if it would otherwise float or sink, and unchanged if it stands on its
 * feet or the floor is not known (`floorY` null).
 */
export function onTheFloor(points: StickPoints, body: BodyFrame, floorY: number | null): StickPoints {
  if (floorY === null || standsOnItsFeet(points, body)) return points;
  return groundPoints(points, floorY);
}

/**
 * The player's floor line, in canvas pixels: the lower of their visible
 * ankles (with one knee raised, the standing foot). It holds still until the
 * feet have really moved, then follows and stops again. Null until an ankle
 * has been seen.
 */
export class FloorTracker {
  private readonly line = new Follower(FLOOR_RANGE, (a, b, unit) => Math.abs(a[0] - b[0]) / unit);
  private canvas: Size | null = null;
  private lastMs: number | null = null;

  update(landmarks: Landmark[] | null, size: Size, nowMs: number): number | null {
    if (this.canvas && (this.canvas.width !== size.width || this.canvas.height !== size.height)) this.line.reset();
    this.canvas = { width: size.width, height: size.height };
    const dtMs = this.lastMs === null ? 0 : Math.min(MAX_STEP_MS, Math.max(0, nowMs - this.lastMs));
    this.lastMs = nowMs;

    const seen = [LM.leftAnkle, LM.rightAnkle]
      .map((index) => landmarks?.[index])
      .filter((ankle): ankle is Landmark => ankle !== undefined && ankle.visibility >= MIN_VISIBILITY);
    if (seen.length > 0) {
      const lowest = Math.max(...seen.map((ankle) => ankle.y)) * size.height;
      this.line.update([lowest], size.height, nowMs, dtMs);
    }
    return this.line.value?.[0] ?? null;
  }
}
