/**
 * Where the target figure goes. It is drawn on the player's own body, except
 * when its arms would lie against the torso (arms down, hands at the sides,
 * arms across the chest): there it would vanish into the player, so it is
 * drawn beside them instead.
 */
import {
  buildSilhouette,
  standardBody,
  type Bounds,
  type Capsule,
  type Point,
  type Silhouette,
  type SilhouettePose,
} from './silhouette';

/** An arm with more than this fraction of its length against the torso sinks into the body. */
export const OVERLAP_FRACTION = 0.35;
/**
 * How close to the torso, in body scales beyond the arm's own width, still
 * counts as against it. Relaxed arms hang a little off the sides on a real
 * body too, and are just as lost in the picture.
 */
export const TOUCH_MARGIN = 0.12;

const SAMPLES_PER_SEGMENT = 12;

function insidePolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distanceToPolygon(p: Point, polygon: Point[]): number {
  if (insidePolygon(p, polygon)) return 0;
  let best = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    best = Math.min(best, distanceToSegment(p, polygon[i], polygon[(i + 1) % polygon.length]));
  }
  return best;
}

/**
 * The largest fraction of either arm (shoulder to wrist) whose width comes
 * within TOUCH_MARGIN of the torso outline, sampled along each segment's
 * centre line.
 */
export function armTorsoOverlap(s: Silhouette): number {
  const byPart = new Map(s.capsules.map((c) => [c.part, c]));
  let worst = 0;
  for (const side of ['left', 'right'] as const) {
    const segments = [byPart.get(`${side}UpperArm`), byPart.get(`${side}Forearm`)].filter(
      (c): c is Capsule => c !== undefined,
    );
    let touching = 0;
    let total = 0;
    for (const c of segments) {
      for (let i = 0; i < SAMPLES_PER_SEGMENT; i++) {
        const t = (i + 0.5) / SAMPLES_PER_SEGMENT;
        const p = { x: c.a.x + (c.b.x - c.a.x) * t, y: c.a.y + (c.b.y - c.a.y) * t };
        const radius = c.ra + (c.rb - c.ra) * t;
        if (distanceToPolygon(p, s.torso) < radius + TOUCH_MARGIN * s.scale) touching++;
        total++;
      }
    }
    if (total > 0) worst = Math.max(worst, touching / total);
  }
  return worst;
}

/**
 * Whether a pose has to be drawn beside the player. Judged on a standard
 * body, so the answer depends only on the pose and can't flicker as the
 * player moves.
 */
export function needsOffset(pose: SilhouettePose): boolean {
  const body = standardBody({ center: { x: 0, y: 0 }, shoulderWidth: 1 });
  return armTorsoOverlap(buildSilhouette(pose, body)) > OVERLAP_FRACTION;
}

export type Side = 'left' | 'right';

export interface OffsetInput {
  /** The figure's bounds where it would sit on the body. */
  figure: Bounds;
  /** The player's bounds. */
  player: Bounds;
  canvasWidth: number;
  /** Space between the player and the figure, and between the figure and the canvas edge. */
  gap: number;
  /** The side used last frame, kept while it still fits so the figure doesn't hop. */
  previousSide: Side | null;
}

/**
 * How far to shift the figure sideways so it stands next to the player. When
 * neither side has room for all of it, it goes to the roomier side and stops
 * at the canvas edge, overlapping the player rather than leaving the frame.
 */
export function figureOffset({ figure, player, canvasWidth, gap, previousSide }: OffsetInput): { dx: number; side: Side } {
  const width = figure.right - figure.left;
  const toRight = player.right + gap - figure.left;
  const toLeft = player.left - gap - figure.right;
  const fits: Record<Side, boolean> = {
    right: player.right + gap + width <= canvasWidth - gap,
    left: player.left - gap - width >= gap,
  };
  const roomier: Side = canvasWidth - player.right > player.left ? 'right' : 'left';

  let side: Side;
  if (previousSide && fits[previousSide]) side = previousSide;
  else if (fits.right !== fits.left) side = fits.right ? 'right' : 'left';
  else side = roomier;

  const dx = side === 'right' ? Math.min(toRight, canvasWidth - gap - figure.right) : Math.max(toLeft, gap - figure.left);
  return { dx, side };
}
