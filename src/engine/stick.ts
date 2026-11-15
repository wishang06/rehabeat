/**
 * The target figure as a stick figure: a point for every joint, and the lines
 * between them. Pure geometry with no canvas.
 *
 * A pose is described as a FigureView: which way each bone points in the
 * picture. Arm raises and knee raises get theirs from the move's joint angles
 * (viewForPose). Poses the angles alone can't picture, a side-on dancer or a
 * triangle leaning over wide legs, have one written by hand (moveViews.ts).
 */
import { JOINT_NAMES } from '../types';
import { POSE_EASE_MS, easeOutCubic } from './ease';
import { bodyScale, type BodyFrame, type Point, type SilhouettePose } from './silhouette';

export const STICK_JOINTS = [
  'head',
  'shoulderMid',
  'hipMid',
  'leftShoulder',
  'rightShoulder',
  'leftElbow',
  'rightElbow',
  'leftWrist',
  'rightWrist',
  'leftHip',
  'rightHip',
  'leftKnee',
  'rightKnee',
  'leftAnkle',
  'rightAnkle',
] as const;
export type StickJoint = (typeof STICK_JOINTS)[number];
export type StickPoints = Record<StickJoint, Point>;

/**
 * Which way a bone points in the picture: degrees from straight down, turning
 * toward the player's left. 0 is down, 90 level to their left, 180 up, -90
 * level to their right. A pair adds how much of the bone's length shows
 * (under 1 when it points toward or away from the camera).
 */
export type BoneAim = number | readonly [degrees: number, length: number];

export const BONES = [
  'leftUpperArm',
  'leftForearm',
  'rightUpperArm',
  'rightForearm',
  'leftThigh',
  'leftShin',
  'rightThigh',
  'rightShin',
] as const;
export type Bone = (typeof BONES)[number];

export type LimbChain = 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg';

export interface FigureView extends Record<Bone, BoneAim> {
  /** Which way the torso points, hips to shoulders. 180 (upright) when left out. */
  torso?: number;
  /** How wide the shoulders and hips are drawn: 1 facing the camera (the default), near 0 side-on. */
  width?: number;
  /** The limbs from furthest to nearest. A nearer limb is drawn over the ones before it. */
  order?: readonly LimbChain[];
}

/** Legs behind arms: an arm crossing the body is the commoner overlap. */
export const DEFAULT_ORDER: readonly LimbChain[] = ['rightLeg', 'leftLeg', 'rightArm', 'leftArm'];

/** Head radius, and how far its centre is from the shoulder line, in body scales. */
const HEAD_RADIUS = 0.25;
const HEAD_RISE = 0.62;
/** A thigh lifting toward the camera is drawn pointing outward by this fraction of its length, so the lift reads from the front. */
const THIGH_CANT = 0.5;

/** How far the hip line turns when the torso leans, as a fraction of the lean. */
const PELVIS_FOLLOW = 0.5;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;
const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * The view of a pose given only as joint angles, seen from the front: arms
 * swing in the picture (a raise to the side), and a thigh lifts toward the
 * camera, so it shortens and is drawn canted outward.
 */
export function viewForPose(pose: SilhouettePose): FigureView {
  const arm = (side: 'left' | 'right') => {
    const outward = side === 'left' ? 1 : -1;
    const upper = pose[`${side}Shoulder`];
    return { upper: outward * upper, fore: outward * (upper + 180 - pose[`${side}Elbow`]) };
  };
  const leg = (side: 'left' | 'right') => {
    const outward = side === 'left' ? 1 : -1;
    const swing = toRadians(180 - pose[`${side}Hip`]);
    const across = outward * Math.abs(Math.sin(swing)) * THIGH_CANT;
    const down = Math.cos(swing);
    const shinDown = Math.cos(swing - toRadians(180 - pose[`${side}Knee`]));
    return {
      thigh: [toDegrees(Math.atan2(across, down)), Math.hypot(across, down)] as const,
      shin: [shinDown >= 0 ? 0 : 180, Math.abs(shinDown)] as const,
    };
  };
  const [la, ra, ll, rl] = [arm('left'), arm('right'), leg('left'), leg('right')];
  return {
    leftUpperArm: la.upper,
    leftForearm: la.fore,
    rightUpperArm: ra.upper,
    rightForearm: ra.fore,
    leftThigh: ll.thigh,
    leftShin: ll.shin,
    rightThigh: rl.thigh,
    rightShin: rl.shin,
  };
}

/** Every joint of `view` laid on `body`, in the body's own units (canvas pixels on the overlay). */
export function stickPoints(view: FigureView, body: BodyFrame): StickPoints {
  const scale = bodyScale(body);
  const hipMid = mid(body.leftHip, body.rightHip);
  const bodyShoulderMid = mid(body.leftShoulder, body.rightShoulder);
  const torso = Math.hypot(bodyShoulderMid.x - hipMid.x, bodyShoulderMid.y - hipMid.y);
  const shoulders = Math.hypot(body.leftShoulder.x - body.rightShoulder.x, body.leftShoulder.y - body.rightShoulder.y);
  const hips = Math.hypot(body.leftHip.x - body.rightHip.x, body.leftHip.y - body.rightHip.y);
  // Which way the player's left is across the picture.
  const leftward = body.leftShoulder.x >= body.rightShoulder.x ? 1 : -1;

  const direction = (degrees: number): Point => {
    const radians = toRadians(degrees);
    return { x: leftward * Math.sin(radians), y: Math.cos(radians) };
  };
  const from = (p: Point, degrees: number, length: number): Point => {
    const d = direction(degrees);
    return { x: p.x + d.x * length, y: p.y + d.y * length };
  };
  const along = (p: Point, aim: BoneAim, length: number): Point =>
    typeof aim === 'number' ? from(p, aim, length) : from(p, aim[0], length * aim[1]);

  const lean = view.torso ?? 180;
  const width = view.width ?? 1;
  const shoulderMid = from(hipMid, lean, torso);
  // The shoulders turn with the torso, and the hips half as far, as a pelvis does under a side bend.
  const tilt = (((lean - 180 + 540) % 360) - 180) * PELVIS_FOLLOW;
  const leftShoulder = from(shoulderMid, lean - 90, (shoulders / 2) * width);
  const rightShoulder = from(shoulderMid, lean + 90, (shoulders / 2) * width);
  const leftHip = from(hipMid, 90 + tilt, (hips / 2) * width);
  const rightHip = from(hipMid, -90 + tilt, (hips / 2) * width);

  const leftElbow = along(leftShoulder, view.leftUpperArm, body.left.upperArm);
  const rightElbow = along(rightShoulder, view.rightUpperArm, body.right.upperArm);
  const leftKnee = along(leftHip, view.leftThigh, body.left.thigh);
  const rightKnee = along(rightHip, view.rightThigh, body.right.thigh);

  return {
    head: from(shoulderMid, lean, HEAD_RISE * scale),
    shoulderMid,
    hipMid,
    leftShoulder,
    rightShoulder,
    leftElbow,
    rightElbow,
    leftWrist: along(leftElbow, view.leftForearm, body.left.forearm),
    rightWrist: along(rightElbow, view.rightForearm, body.right.forearm),
    leftHip,
    rightHip,
    leftKnee,
    rightKnee,
    leftAnkle: along(leftKnee, view.leftShin, body.left.shin),
    rightAnkle: along(rightKnee, view.rightShin, body.right.shin),
  };
}

export interface StickFigure {
  /** The trunk: spine and neck, the shoulder line and the hip line. Drawn first, as one shape. */
  trunk: Point[][];
  head: { center: Point; radius: number };
  /** Each limb from the body outward, furthest from the viewer first. */
  limbs: { chain: LimbChain; points: Point[] }[];
  /** The body scale line widths come from (about shoulder width). */
  scale: number;
}

const CHAIN_JOINTS: Record<LimbChain, readonly [StickJoint, StickJoint, StickJoint]> = {
  leftArm: ['leftShoulder', 'leftElbow', 'leftWrist'],
  rightArm: ['rightShoulder', 'rightElbow', 'rightWrist'],
  leftLeg: ['leftHip', 'leftKnee', 'leftAnkle'],
  rightLeg: ['rightHip', 'rightKnee', 'rightAnkle'],
};

/** The lines to draw for a set of joints. `scale` is the body scale (about shoulder width). */
export function stickFigure(points: StickPoints, scale: number, order: readonly LimbChain[] = DEFAULT_ORDER): StickFigure {
  const radius = HEAD_RADIUS * scale;
  const { head, shoulderMid } = points;
  const neck = Math.hypot(head.x - shoulderMid.x, head.y - shoulderMid.y);
  // The neck stops at the head's edge: the head is a ring, with the player's face inside it.
  const t = neck > radius ? (neck - radius) / neck : 0;
  const headEdge = { x: shoulderMid.x + (head.x - shoulderMid.x) * t, y: shoulderMid.y + (head.y - shoulderMid.y) * t };
  return {
    trunk: [
      [points.hipMid, shoulderMid, headEdge],
      [points.leftShoulder, points.rightShoulder],
      [points.leftHip, points.rightHip],
    ],
    head: { center: head, radius },
    limbs: order.map((chain) => ({ chain, points: CHAIN_JOINTS[chain].map((joint) => points[joint]) })),
    scale,
  };
}

/** The scored joint's angle as the picture shows it, in degrees: what the player will copy. */
export function pictureAngle(points: StickPoints, joint: (typeof JOINT_NAMES)[number]): number {
  const side = joint.startsWith('left') ? 'left' : 'right';
  const triplet: Record<string, readonly [StickJoint, StickJoint, StickJoint]> = {
    Shoulder: [`${side}Hip`, `${side}Shoulder`, `${side}Elbow`],
    Elbow: [`${side}Shoulder`, `${side}Elbow`, `${side}Wrist`],
    Hip: [`${side}Shoulder`, `${side}Hip`, `${side}Knee`],
    Knee: [`${side}Hip`, `${side}Knee`, `${side}Ankle`],
  };
  const [a, vertex, c] = triplet[joint.slice(side.length)].map((name) => points[name]);
  const u = { x: a.x - vertex.x, y: a.y - vertex.y };
  const v = { x: c.x - vertex.x, y: c.y - vertex.y };
  const lengths = Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y);
  if (lengths === 0) return 0;
  return toDegrees(Math.acos(Math.min(1, Math.max(-1, (u.x * v.x + u.y * v.y) / lengths))));
}

function mix(from: StickPoints, to: StickPoints, t: number): StickPoints {
  const out = {} as StickPoints;
  for (const joint of STICK_JOINTS) {
    out[joint] = { x: from[joint].x + (to[joint].x - from[joint].x) * t, y: from[joint].y + (to[joint].y - from[joint].y) * t };
  }
  return out;
}

/**
 * Moves the figure from one pose to the next over POSE_EASE_MS, so a new move
 * flows in rather than snapping. It works in the figure's own units (hips at
 * the origin, the torso one unit long), so the figure keeps easing correctly
 * while the body it stands on glides or resizes.
 */
export class StickEaser {
  private key: string | null = null;
  private from: StickPoints | null = null;
  private shown: StickPoints | null = null;
  private start = 0;

  /**
   * `key` names the pose (a new key starts a move toward it); `target` is
   * that pose on `body`. Returns the joints to draw now, on `body`.
   */
  update(key: string, target: StickPoints, body: BodyFrame, nowMs: number): StickPoints {
    const origin = mid(body.leftHip, body.rightHip);
    const shoulderMid = mid(body.leftShoulder, body.rightShoulder);
    const unit = Math.hypot(shoulderMid.x - origin.x, shoulderMid.y - origin.y) || 1;
    const scaled = (points: StickPoints, into: boolean): StickPoints => {
      const out = {} as StickPoints;
      for (const joint of STICK_JOINTS) {
        const p = points[joint];
        out[joint] = into
          ? { x: (p.x - origin.x) / unit, y: (p.y - origin.y) / unit }
          : { x: p.x * unit + origin.x, y: p.y * unit + origin.y };
      }
      return out;
    };

    const to = scaled(target, true);
    if (this.key === null || !this.shown) {
      this.from = null;
    } else if (key !== this.key) {
      this.from = this.shown;
      this.start = nowMs;
    }
    this.key = key;
    const t = (nowMs - this.start) / POSE_EASE_MS;
    this.shown = !this.from || t >= 1 ? to : mix(this.from, to, easeOutCubic(t));
    return scaled(this.shown, false);
  }
}
