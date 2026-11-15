/**
 * The floor under the target figure.
 *
 * The figure stands on the player's hips (anchor.ts), which suits a standing
 * pose. A pose whose legs bend or spread, or one that goes down on the hands,
 * drawn from standing hips leaves the figure's feet hanging in the air. So
 * the figure is moved up or down until its lowest point rests on the floor:
 * the line of the player's feet, held still like the anchor, or, before the
 * feet have been seen, where the feet of the figure's body stand.
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

/** Where the feet of `body` are when it stands straight: the floor before the player's feet have been seen. */
export function standingFloor(body: BodyFrame): number {
  const left = body.leftHip.y + body.left.thigh + body.left.shin;
  const right = body.rightHip.y + body.right.thigh + body.right.shin;
  return Math.max(left, right);
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
