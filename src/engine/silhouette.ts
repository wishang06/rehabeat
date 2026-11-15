/**
 * The body the target figure is laid on: where its shoulders and hips are and
 * how long its limbs are. Also the pose type and the standing rest pose. Pure
 * geometry with no canvas. The figure itself is in stick.ts.
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
 * hands of the figure don't merge into its hips. Joints a move leaves out take these.
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
export const PROPORTION = {
  torso: 1.2,
  hipWidth: 0.58,
  segments: { upperArm: 0.78, forearm: 0.68, thigh: 1.08, shin: 1.05 } satisfies SegmentLengths,
};

/** How wide each limb is, as radii [nearer the body, further out] in body scales (about shoulder width). */
export const LIMB_RADII = {
  upperArm: [0.13, 0.105],
  forearm: [0.1, 0.075],
  thigh: [0.19, 0.14],
  shin: [0.13, 0.085],
  neck: [0.11, 0.11],
} as const;

/** Anchor landmarks below this visibility don't place a body. */
const MIN_ANCHOR_VISIBILITY = 0.5;

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
 * Mirrored by default, like the stage: the left of the player on the left of the viewer.
 */
export function standardBody(options: { center: Point; shoulderWidth: number; mirrored?: boolean }): BodyFrame {
  const { center, shoulderWidth: width } = options;
  // Which way the left of the player is on screen.
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
 * The live body in canvas pixels (unmirrored camera image space), exactly as
 * this frame's landmarks give it: unsteadied, so it suits sizing things drawn
 * on the player, not placing the figure (anchor.ts does that). Segment
 * lengths come from the world landmarks, measured against the torso, when
 * those are given. Null until both shoulders and both hips are at least
 * `minVisibility`.
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
