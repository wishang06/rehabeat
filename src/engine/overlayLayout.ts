/**
 * Where the overlay's live parts go: the player's own body as capsules, and
 * the hint callout. Pure, in canvas pixels of the unmirrored camera image
 * (the stage mirrors the canvas for display).
 */
import { LM } from '../pose/landmarks';
import { SKELETON_MIN_VISIBILITY } from '../pose/skeleton';
import type { JointName, Landmark } from '../types';
import type { LimbName } from '../types/ui';
import { LIMBS } from './limbs';
import { LIMB_RADII, bodyFromLandmarks, bodyScale, type Bounds, type Capsule, type Point } from './silhouette';

/** The player's limbs are drawn this fraction as wide as the target figure's, so both read. */
export const PLAYER_WIDTH = 0.5;

const SEGMENT_OF: Record<LimbName, keyof typeof LIMB_RADII> = {
  leftUpperArm: 'upperArm',
  rightUpperArm: 'upperArm',
  leftForearm: 'forearm',
  rightForearm: 'forearm',
  leftThigh: 'thigh',
  rightThigh: 'thigh',
  leftShin: 'shin',
  rightShin: 'shin',
};

type Size = { width: number; height: number };

export interface PlayerBodyLayout {
  /** One per limb with both ends visible; `part` names the limb. */
  capsules: (Capsule & { part: LimbName })[];
  /** Shoulders and hips, when all four are visible. */
  torso: Point[] | null;
  /** The body scale the widths come from (about shoulder width, in pixels). */
  scale: number;
  bounds: Bounds | null;
}

function pixel(landmarks: Landmark[], index: number, size: Size, minVisibility: number): Point | null {
  const lm = landmarks[index];
  if (!lm || lm.visibility < minVisibility) return null;
  return { x: lm.x * size.width, y: lm.y * size.height };
}

export interface PlayerBodyOptions {
  /** Ends below this visibility leave their limb out. */
  minVisibility?: number;
  /**
   * Limbs to lay out down to KEEP_VISIBILITY instead: scored limbs the
   * player has to be shown they've lost, at the detector's best guess.
   */
  keep?: ReadonlySet<LimbName>;
}

/** The floor for `keep` limbs: below this the detector's guess isn't worth drawing. */
export const KEEP_VISIBILITY = 0.05;

/** The player's own limbs as capsules, sized to their body like the target figure. */
export function layoutPlayerBody(landmarks: Landmark[], size: Size, options: PlayerBodyOptions = {}): PlayerBodyLayout {
  const minVisibility = options.minVisibility ?? SKELETON_MIN_VISIBILITY;
  const at = (index: number, floor = minVisibility) => pixel(landmarks, index, size, floor);
  const body = bodyFromLandmarks(landmarks, size);
  const ls = at(LM.leftShoulder);
  const rs = at(LM.rightShoulder);
  const scale = body
    ? bodyScale(body)
    : ls && rs
      ? Math.hypot(ls.x - rs.x, ls.y - rs.y)
      : size.width * 0.12;

  const capsules: PlayerBodyLayout['capsules'] = [];
  for (const { limb, from, to } of LIMBS) {
    const floor = options.keep?.has(limb) ? Math.min(minVisibility, KEEP_VISIBILITY) : minVisibility;
    const a = at(from, floor);
    const b = at(to, floor);
    if (!a || !b) continue;
    const [ra, rb] = LIMB_RADII[SEGMENT_OF[limb]];
    capsules.push({ part: limb, a, b, ra: ra * PLAYER_WIDTH * scale, rb: rb * PLAYER_WIDTH * scale });
  }

  const lh = at(LM.leftHip);
  const rh = at(LM.rightHip);
  const torso = ls && rs && lh && rh ? [ls, rs, rh, lh] : null;

  let bounds: Bounds | null = null;
  const include = (p: Point, r: number) => {
    bounds = bounds ?? { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    bounds.left = Math.min(bounds.left, p.x - r);
    bounds.top = Math.min(bounds.top, p.y - r);
    bounds.right = Math.max(bounds.right, p.x + r);
    bounds.bottom = Math.max(bounds.bottom, p.y + r);
  };
  for (const c of capsules) {
    include(c.a, c.ra);
    include(c.b, c.rb);
  }
  for (const p of torso ?? []) include(p, 0);

  return { capsules, torso, scale, bounds };
}

/** The landmark a hint about each joint points at: the part its words name. */
const ANCHOR: Record<JointName, readonly [number, number]> = {
  // [the part named, the joint itself as a fallback]
  leftShoulder: [LM.leftElbow, LM.leftShoulder],
  rightShoulder: [LM.rightElbow, LM.rightShoulder],
  leftElbow: [LM.leftElbow, LM.leftElbow],
  rightElbow: [LM.rightElbow, LM.rightElbow],
  leftHip: [LM.leftKnee, LM.leftHip],
  rightHip: [LM.rightKnee, LM.rightHip],
  leftKnee: [LM.leftKnee, LM.leftKnee],
  rightKnee: [LM.rightKnee, LM.rightKnee],
};

/**
 * Where the hint arrow points. "left arm higher" points at the left elbow,
 * the middle of the arm; "left knee higher" at the knee. Falls back to the
 * joint itself, then to null when neither is in view.
 */
export function hintAnchor(
  joint: JointName,
  landmarks: Landmark[],
  size: Size,
  minVisibility: number = SKELETON_MIN_VISIBILITY,
): Point | null {
  const [part, fallback] = ANCHOR[joint];
  return pixel(landmarks, part, size, minVisibility) ?? pixel(landmarks, fallback, size, minVisibility);
}

export interface HintLayoutInput {
  anchor: Point;
  /** The x of the player's midline; the label goes on the far side of the anchor from it. */
  bodyCenterX: number;
  /** Body scale in pixels (about shoulder width). */
  scale: number;
  width: number;
  height: number;
  labelWidth: number;
  labelHeight: number;
  /** Bands at the top and bottom the label must stay out of (the HUD corners live there). */
  safeTop: number;
  safeBottom: number;
  /** Minimum space between the label and the canvas's side edges. */
  margin?: number;
  /** Something the label shouldn't cover if the other side is free of it: the target figure. */
  avoid?: Bounds | null;
}

export interface HintLayout {
  label: { x: number; y: number; width: number; height: number };
  /** Arrow start, on the label's edge facing the anchor. */
  tail: Point;
  /** Arrow end, just short of the anchor. */
  tip: Point;
}

/**
 * A callout beside the limb: the label sits outward from the body at the
 * anchor's height, and an arrow runs from it to the anchor. The label flips
 * to the inner side when the outer side has no room, and stays inside the
 * canvas and between the safe bands either way.
 */
export function layoutHint(input: HintLayoutInput): HintLayout {
  const { anchor, scale, width, height, labelWidth, labelHeight } = input;
  const margin = input.margin ?? 16;
  const gap = 0.9 * scale;
  const outward = anchor.x >= input.bodyCenterX ? 1 : -1;

  const lowest = height - input.safeBottom - labelHeight;
  const y = Math.max(input.safeTop, Math.min(lowest, anchor.y - labelHeight / 2 - 0.35 * scale));

  const xFor = (direction: number) => (direction > 0 ? anchor.x + gap : anchor.x - gap - labelWidth);
  const fits = (x: number) => x >= margin && x + labelWidth <= width - margin;
  const avoid = input.avoid;
  const covers = (x: number) =>
    !!avoid && x < avoid.right && x + labelWidth > avoid.left && y < avoid.bottom && y + labelHeight > avoid.top;
  const good = (direction: number) => fits(xFor(direction)) && !covers(xFor(direction));

  let direction = outward;
  if (!good(direction) && good(-direction)) direction = -direction;
  else if (!fits(xFor(direction)) && fits(xFor(-direction))) direction = -direction;
  const x = Math.min(width - margin - labelWidth, Math.max(margin, xFor(direction)));

  const tail = { x: direction > 0 ? x : x + labelWidth, y: y + labelHeight / 2 };
  const dx = anchor.x - tail.x;
  const dy = anchor.y - tail.y;
  const length = Math.hypot(dx, dy) || 1;
  const stop = Math.min(0.2 * scale, length / 2);
  const tip = { x: anchor.x - (dx / length) * stop, y: anchor.y - (dy / length) * stop };

  return { label: { x, y, width: labelWidth, height: labelHeight }, tail, tip };
}

export interface BannerLayoutInput {
  width: number;
  height: number;
  bannerWidth: number;
  bannerHeight: number;
  /** The band the banner stays in, as for layoutHint. */
  safeTop: number;
  safeBottom: number;
  /** What the banner should not cover: the limbs it is warning about, the hint. */
  avoid: readonly Bounds[];
}

/**
 * A full-width-centred banner in the band between the HUD rows: as near the
 * middle of that band as it can be without covering anything in `avoid`, or
 * covering as little of it as possible when nowhere is clear.
 */
export function layoutBanner(input: BannerLayoutInput): { x: number; y: number; width: number; height: number } {
  const { width, height, bannerWidth, bannerHeight, safeTop, avoid } = input;
  const x = (width - bannerWidth) / 2;
  const top = safeTop;
  const bottom = Math.max(top, height - input.safeBottom - bannerHeight);
  const preferred = (top + bottom) / 2;

  const covered = (y: number) => {
    let area = 0;
    for (const b of avoid) {
      const w = Math.min(x + bannerWidth, b.right) - Math.max(x, b.left);
      const h = Math.min(y + bannerHeight, b.bottom) - Math.max(y, b.top);
      if (w > 0 && h > 0) area += w * h;
    }
    return area;
  };

  const step = Math.max(1, bannerHeight / 4);
  let best = preferred;
  let bestArea = covered(preferred);
  for (let k = 1; bestArea > 0 && (preferred - k * step >= top || preferred + k * step <= bottom); k++) {
    for (const y of [preferred - k * step, preferred + k * step]) {
      if (y < top || y > bottom) continue;
      const area = covered(y);
      if (area < bestArea) {
        best = y;
        bestArea = area;
      }
    }
  }
  return { x, y: best, width: bannerWidth, height: bannerHeight };
}
