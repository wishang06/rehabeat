/**
 * The target figure as filled shapes: tapered capsules for the limbs and neck,
 * a torso polygon and a head circle. Pure geometry with no canvas, so the
 * overlay, a side card or an SVG can all draw the same figure.
 */
import { LM } from '../pose/landmarks';
import { JOINT_NAMES, type JointName, type Landmark, type Move } from '../types';
import type { LimbName } from '../types/ui';

export interface Point {
  x: number;
  y: number;
}

/**
 * A rounded capsule from `a` to `b`, `ra` wide (radius) at `a` and `rb` at `b`.
 * Limbs run from the body outward, so `a` is the shoulder, elbow, hip or knee.
 */
export interface Capsule {
  part: LimbName | 'neck';
  a: Point;
  b: Point;
  ra: number;
  rb: number;
}

export interface Silhouette {
  /** Every limb, plus the neck. */
  capsules: Capsule[];
  /** Shoulders to hips, wound clockwise on a y-down canvas (as are capsule outlines). */
  torso: Point[];
  head: { center: Point; radius: number };
  /** The body scale the widths were sized from (about shoulder width), in the same units. */
  scale: number;
}

/** An angle for every scored joint, in the same degrees as Move.joints. */
export type SilhouettePose = Record<JointName, number>;

export interface SegmentLengths {
  upperArm: number;
  forearm: number;
  thigh: number;
  shin: number;
}

/** Where a body is and how long its segments are, in canvas pixels. */
export interface BodyFrame {
  leftShoulder: Point;
  rightShoulder: Point;
  leftHip: Point;
  rightHip: Point;
  left: SegmentLengths;
  right: SegmentLengths;
}

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Standing with the arms relaxed just off the sides, far enough out that the
 * figure's hands don't merge into its hips. Joints a move leaves out take these.
 */
export const REST_POSE: SilhouettePose = {
  leftShoulder: 16,
  rightShoulder: 16,
  leftElbow: 180,
  rightElbow: 180,
  leftHip: 180,
  rightHip: 180,
  leftKnee: 180,
  rightKnee: 180,
};

/** Adult proportions as multiples of shoulder width (the distance between the shoulder joints). */
const PROPORTION = {
  torso: 1.2,
  hipWidth: 0.58,
  segments: { upperArm: 0.78, forearm: 0.68, thigh: 1.08, shin: 1.05 } satisfies SegmentLengths,
};

/** Capsule radii [at a, at b] as multiples of the body scale (about shoulder width). */
export const LIMB_RADII = {
  upperArm: [0.13, 0.105],
  forearm: [0.1, 0.075],
  thigh: [0.19, 0.14],
  shin: [0.13, 0.085],
  neck: [0.11, 0.11],
} as const;

const HEAD_RADIUS = 0.25;
/** Head centre above the shoulder line. */
const HEAD_RISE = 0.62;
/**
 * A thigh lifting toward the camera is drawn canted outward by this fraction
 * of its length (at full lift), so a knee raise reads as a raise from the front.
 */
const THIGH_CANT = 0.5;
/** ...and its knee end swells by up to this fraction, as a nearer thing looks bigger. */
const KNEE_SWELL = 0.35;
/** Anchor landmarks below this visibility don't place the figure. */
const MIN_ANCHOR_VISIBILITY = 0.5;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

function rotate(v: Point, radians: number): Point {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

const add = (p: Point, v: Point, scale = 1): Point => ({ x: p.x + v.x * scale, y: p.y + v.y * scale });
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function unit(v: Point): Point {
  const length = Math.hypot(v.x, v.y);
  return length > 1e-9 ? { x: v.x / length, y: v.y / length } : { x: 0, y: 1 };
}

/** The pose a move asks for, with every joint it doesn't score at rest. */
export function poseForMove(move: Pick<Move, 'joints'> | null): SilhouettePose {
  const pose = { ...REST_POSE };
  if (!move) return pose;
  for (const joint of JOINT_NAMES) {
    const target = move.joints[joint];
    if (target !== undefined) pose[joint] = target;
  }
  return pose;
}

/**
 * A standing body of standard proportions, for drawing the figure on its own
 * (a side card, a thumbnail). `center` is the midpoint between the shoulders.
 * Mirrored by default, like the stage: the player's left on the viewer's left.
 */
export function standardBody(options: { center: Point; shoulderWidth: number; mirrored?: boolean }): BodyFrame {
  const { center, shoulderWidth: width } = options;
  // Which way the player's left is on screen.
  const leftward = options.mirrored === false ? 1 : -1;
  const hipY = center.y + PROPORTION.torso * width;
  const halfHip = (PROPORTION.hipWidth * width) / 2;
  const lengths = (): SegmentLengths => ({
    upperArm: PROPORTION.segments.upperArm * width,
    forearm: PROPORTION.segments.forearm * width,
    thigh: PROPORTION.segments.thigh * width,
    shin: PROPORTION.segments.shin * width,
  });
  return {
    leftShoulder: { x: center.x + (leftward * width) / 2, y: center.y },
    rightShoulder: { x: center.x - (leftward * width) / 2, y: center.y },
    leftHip: { x: center.x + leftward * halfHip, y: hipY },
    rightHip: { x: center.x - leftward * halfHip, y: hipY },
    left: lengths(),
    right: lengths(),
  };
}

const distance3 = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * The live body in canvas pixels (unmirrored camera image space), anchored on
 * the player's shoulders and hips. Segment lengths come from the player's own
 * world landmarks, measured against their torso, when those are given.
 * Null until both shoulders and both hips are at least `minVisibility`.
 */
export function bodyFromLandmarks(
  landmarks: Landmark[],
  size: { width: number; height: number },
  world?: Landmark[] | null,
  minVisibility: number = MIN_ANCHOR_VISIBILITY,
): BodyFrame | null {
  const px = (index: number): Point | null => {
    const lm = landmarks[index];
    if (!lm || lm.visibility < minVisibility) return null;
    return { x: lm.x * size.width, y: lm.y * size.height };
  };
  const leftShoulder = px(LM.leftShoulder);
  const rightShoulder = px(LM.rightShoulder);
  const leftHip = px(LM.leftHip);
  const rightHip = px(LM.rightHip);
  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return null;

  const lengths = (shoulder: Point, hip: Point, side: 'left' | 'right'): SegmentLengths => {
    const torsoPx = Math.hypot(hip.x - shoulder.x, hip.y - shoulder.y);
    const ids =
      side === 'left'
        ? { s: LM.leftShoulder, e: LM.leftElbow, w: LM.leftWrist, h: LM.leftHip, k: LM.leftKnee, a: LM.leftAnkle }
        : { s: LM.rightShoulder, e: LM.rightElbow, w: LM.rightWrist, h: LM.rightHip, k: LM.rightKnee, a: LM.rightAnkle };
    const torsoWorld = world && world[ids.s] && world[ids.h] ? distance3(world[ids.s], world[ids.h]) : 0;
    const segment = (from: number, to: number, fallback: number) => {
      if (world && torsoWorld > 0.05 && world[from] && world[to]) {
        return (distance3(world[from], world[to]) / torsoWorld) * torsoPx;
      }
      return (fallback / PROPORTION.torso) * torsoPx;
    };
    return {
      upperArm: segment(ids.s, ids.e, PROPORTION.segments.upperArm),
      forearm: segment(ids.e, ids.w, PROPORTION.segments.forearm),
      thigh: segment(ids.h, ids.k, PROPORTION.segments.thigh),
      shin: segment(ids.k, ids.a, PROPORTION.segments.shin),
    };
  };

  return {
    leftShoulder,
    rightShoulder,
    leftHip,
    rightHip,
    left: lengths(leftShoulder, leftHip, 'left'),
    right: lengths(rightShoulder, rightHip, 'right'),
  };
}

/** The size widths are scaled to: shoulder width, floored so a side-on player doesn't shrink to sticks. */
export function bodyScale(body: BodyFrame): number {
  const shoulders = Math.hypot(body.leftShoulder.x - body.rightShoulder.x, body.leftShoulder.y - body.rightShoulder.y);
  const torso =
    (Math.hypot(body.leftHip.x - body.leftShoulder.x, body.leftHip.y - body.leftShoulder.y) +
      Math.hypot(body.rightHip.x - body.rightShoulder.x, body.rightHip.y - body.rightShoulder.y)) /
    2;
  return Math.max(shoulders, (0.78 * torso) / PROPORTION.torso);
}

function signedArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/**
 * Lays `pose` onto `body`. Arms swing in the image plane (a raise to the
 * side); legs are seen from the front, so a thigh lifting toward the camera
 * shortens, with a slight outward cant so the lift still reads.
 */
export function buildSilhouette(pose: SilhouettePose, body: BodyFrame): Silhouette {
  const scale = bodyScale(body);
  const capsules: Capsule[] = [];
  const capsule = (part: Capsule['part'], a: Point, b: Point, radii: readonly [number, number]) =>
    capsules.push({ part, a, b, ra: radii[0] * scale, rb: radii[1] * scale });

  const shoulderMid = mid(body.leftShoulder, body.rightShoulder);
  const hipMid = mid(body.leftHip, body.rightHip);
  const down = unit(sub(hipMid, shoulderMid));
  const up = { x: -down.x, y: -down.y };

  const sides = [
    { side: 'left', shoulder: body.leftShoulder, other: body.rightShoulder, hip: body.leftHip, otherHip: body.rightHip },
    { side: 'right', shoulder: body.rightShoulder, other: body.leftShoulder, hip: body.rightHip, otherHip: body.leftHip },
  ] as const;

  const torsoSides: Record<'left' | 'right', Point[]> = { left: [], right: [] };

  for (const { side, shoulder, other, hip, otherHip } of sides) {
    const lengths = body[side];
    const sideDown = unit(sub(hip, shoulder));
    const outward = unit(sub(shoulder, other));
    // Rotate away from the body: whichever turn carries "down" toward the outside.
    const quarter = rotate(sideDown, Math.PI / 2);
    const turn = quarter.x * outward.x + quarter.y * outward.y >= 0 ? 1 : -1;

    const upperDir = rotate(sideDown, turn * toRadians(pose[`${side}Shoulder`]));
    const elbow = add(shoulder, upperDir, lengths.upperArm);
    // The elbow angle is between elbow-to-shoulder and elbow-to-wrist.
    const foreDir = rotate({ x: -upperDir.x, y: -upperDir.y }, -turn * toRadians(pose[`${side}Elbow`]));
    const wrist = add(elbow, foreDir, lengths.forearm);
    capsule(`${side}UpperArm`, shoulder, elbow, LIMB_RADII.upperArm);
    capsule(`${side}Forearm`, elbow, wrist, LIMB_RADII.forearm);

    // Legs hang along the body's midline: following the slanted shoulder-to-hip
    // line, as the arms do, would cross the ankles.
    const hipOut = unit(sub(hip, otherHip));
    const thighSwing = Math.PI - toRadians(pose[`${side}Hip`]);
    const lift = Math.abs(Math.sin(thighSwing));
    const knee = add(add(hip, down, Math.cos(thighSwing) * lengths.thigh), hipOut, lift * THIGH_CANT * lengths.thigh);
    const shinSwing = thighSwing - (Math.PI - toRadians(pose[`${side}Knee`]));
    const ankle = add(knee, down, Math.cos(shinSwing) * lengths.shin);
    const swell = 1 + lift * KNEE_SWELL;
    capsule(`${side}Thigh`, hip, knee, [LIMB_RADII.thigh[0], LIMB_RADII.thigh[1] * swell]);
    capsule(`${side}Shin`, knee, ankle, [LIMB_RADII.shin[0] * swell, LIMB_RADII.shin[1]]);

    // Torso outline on this side: shoulder cap, waist, outer hip.
    const waistCenter = lerp(shoulderMid, hipMid, 0.62);
    torsoSides[side] = [
      add(add(shoulder, outward, 0.04 * scale), up, 0.05 * scale),
      add(waistCenter, outward, 0.36 * scale),
      add(hip, hipOut, 0.14 * scale),
    ];
  }

  let torso = [...torsoSides.left, ...torsoSides.right.reverse()];
  if (signedArea(torso) < 0) torso = torso.reverse();

  const headCenter = add(shoulderMid, up, HEAD_RISE * scale);
  capsule('neck', add(shoulderMid, up, 0.05 * scale), headCenter, LIMB_RADII.neck);

  return { capsules, torso, head: { center: headCenter, radius: HEAD_RADIUS * scale }, scale };
}

export type CapsuleOutline =
  | { kind: 'circle'; center: Point; radius: number }
  | {
      kind: 'capsule';
      a: Point;
      b: Point;
      ra: number;
      rb: number;
      /** Arc around `a`, clockwise from aStart to aEnd (radians, canvas convention). */
      aStart: number;
      aEnd: number;
      /** Arc around `b`, clockwise from bStart to bEnd. */
      bStart: number;
      bEnd: number;
    };

/**
 * How to trace a tapered capsule clockwise: the far arc round `a`, the
 * tangent side, the arc round `b`, then the other side back. When one end's
 * circle swallows the other, it is just that circle.
 */
export function capsuleOutline(c: Capsule): CapsuleOutline {
  const d = Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y);
  if (d <= Math.abs(c.ra - c.rb) + 1e-6) {
    return c.ra >= c.rb ? { kind: 'circle', center: c.a, radius: c.ra } : { kind: 'circle', center: c.b, radius: c.rb };
  }
  const theta = Math.atan2(c.b.y - c.a.y, c.b.x - c.a.x);
  const alpha = Math.acos((c.ra - c.rb) / d);
  return {
    kind: 'capsule',
    a: c.a,
    b: c.b,
    ra: c.ra,
    rb: c.rb,
    aStart: theta + alpha,
    aEnd: theta + 2 * Math.PI - alpha,
    bStart: theta - alpha,
    bEnd: theta + alpha,
  };
}

export function silhouetteBounds(s: Silhouette): Bounds {
  const bounds: Bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  const include = (p: Point, r: number) => {
    bounds.left = Math.min(bounds.left, p.x - r);
    bounds.top = Math.min(bounds.top, p.y - r);
    bounds.right = Math.max(bounds.right, p.x + r);
    bounds.bottom = Math.max(bounds.bottom, p.y + r);
  };
  for (const c of s.capsules) {
    include(c.a, c.ra);
    include(c.b, c.rb);
  }
  for (const p of s.torso) include(p, 0);
  include(s.head.center, s.head.radius);
  return bounds;
}

export function translateSilhouette(s: Silhouette, dx: number, dy: number): Silhouette {
  if (dx === 0 && dy === 0) return s;
  const move = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  return {
    capsules: s.capsules.map((c) => ({ ...c, a: move(c.a), b: move(c.b) })),
    torso: s.torso.map(move),
    head: { center: move(s.head.center), radius: s.head.radius },
    scale: s.scale,
  };
}

/**
 * A body fit to draw the figure on. When unsure anchors (a shoulder or hip
 * guessed from outside the frame) collapse the shoulders to less than 0.6 of
 * the torso length, the figure is rebuilt at standard proportions around the
 * same shoulder midpoint and torso length, in camera-image convention (the
 * player's left at the larger x). A plausible body is returned unchanged.
 */
export function steadyBody(body: BodyFrame): BodyFrame {
  const shoulderMid = mid(body.leftShoulder, body.rightShoulder);
  const hipMid = mid(body.leftHip, body.rightHip);
  const torso = Math.hypot(hipMid.x - shoulderMid.x, hipMid.y - shoulderMid.y);
  const shoulders = Math.hypot(body.leftShoulder.x - body.rightShoulder.x, body.leftShoulder.y - body.rightShoulder.y);
  if (torso <= 0 || shoulders >= 0.6 * torso) return body;
  return standardBody({ center: shoulderMid, shoulderWidth: torso / PROPORTION.torso, mirrored: false });
}
