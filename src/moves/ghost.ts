import { LM } from '../pose/landmarks';
import type { Landmark, Move } from '../types';

export interface Point {
  x: number;
  y: number;
}

/** One ghost limb as a polyline in canvas pixels, starting at the player's own joint. */
export type GhostLimb = Point[];

const MIN_ANCHOR_VISIBILITY = 0.5;

/**
 * Segment lengths as a fraction of the player's shoulder-to-hip distance.
 * Only used when world landmarks are missing; otherwise the player's own
 * measured segment lengths are used.
 */
const FALLBACK_RATIO = { upperArm: 0.6, forearm: 0.55, thigh: 0.85, shin: 0.85 };

const SIDES = [
  {
    shoulderJoint: 'leftShoulder',
    elbowJoint: 'leftElbow',
    hipJoint: 'leftHip',
    kneeJoint: 'leftKnee',
    shoulder: LM.leftShoulder,
    otherShoulder: LM.rightShoulder,
    elbow: LM.leftElbow,
    wrist: LM.leftWrist,
    hip: LM.leftHip,
    knee: LM.leftKnee,
    ankle: LM.leftAnkle,
  },
  {
    shoulderJoint: 'rightShoulder',
    elbowJoint: 'rightElbow',
    hipJoint: 'rightHip',
    kneeJoint: 'rightKnee',
    shoulder: LM.rightShoulder,
    otherShoulder: LM.leftShoulder,
    elbow: LM.rightElbow,
    wrist: LM.rightWrist,
    hip: LM.rightHip,
    knee: LM.rightKnee,
    ankle: LM.rightAnkle,
  },
] as const;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

function rotate(v: Point, radians: number): Point {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

function distance3(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Builds the target pose as limbs hanging off the player's live shoulders and
 * hips, so the ghost fits whoever is in front of the camera.
 *
 * Arms are laid out in the image plane (a raise to the side). Legs are laid
 * out as seen from the front: the thigh swings toward the camera, so a hip
 * target of 90 degrees foreshortens it to nothing and the foot comes up by a
 * thigh length.
 */
export function computeGhost(
  move: Move,
  landmarks: Landmark[],
  size: { width: number; height: number },
  world?: Landmark[] | null,
): GhostLimb[] {
  const px = (index: number): Point | null => {
    const lm = landmarks[index];
    if (!lm || lm.visibility < MIN_ANCHOR_VISIBILITY) return null;
    return { x: lm.x * size.width, y: lm.y * size.height };
  };

  const limbs: GhostLimb[] = [];

  for (const side of SIDES) {
    const shoulder = px(side.shoulder);
    const hip = px(side.hip);
    if (!shoulder || !hip) continue;

    const torsoPx = Math.hypot(hip.x - shoulder.x, hip.y - shoulder.y);
    if (torsoPx < 1) continue;
    const down: Point = { x: (hip.x - shoulder.x) / torsoPx, y: (hip.y - shoulder.y) / torsoPx };

    const torsoWorld = world ? distance3(world[side.shoulder], world[side.hip]) : 0;
    const segment = (a: number, b: number, fallback: number): number =>
      world && torsoWorld > 0.05
        ? (distance3(world[a], world[b]) / torsoWorld) * torsoPx
        : fallback * torsoPx;

    const shoulderTarget = move.joints[side.shoulderJoint];
    const otherShoulder = px(side.otherShoulder);
    if (shoulderTarget !== undefined && otherShoulder) {
      // Rotate away from the body: whichever direction carries the arm off the far shoulder.
      const outward: Point = { x: shoulder.x - otherShoulder.x, y: shoulder.y - otherShoulder.y };
      const quarter = rotate(down, Math.PI / 2);
      const turn = quarter.x * outward.x + quarter.y * outward.y >= 0 ? 1 : -1;

      const upperDir = rotate(down, turn * toRadians(shoulderTarget));
      const upperLen = segment(side.shoulder, side.elbow, FALLBACK_RATIO.upperArm);
      const elbow: Point = {
        x: shoulder.x + upperDir.x * upperLen,
        y: shoulder.y + upperDir.y * upperLen,
      };

      // The elbow angle is measured between elbow-to-shoulder and elbow-to-wrist.
      const elbowTarget = move.joints[side.elbowJoint] ?? 180;
      const foreDir = rotate({ x: -upperDir.x, y: -upperDir.y }, -turn * toRadians(elbowTarget));
      const foreLen = segment(side.elbow, side.wrist, FALLBACK_RATIO.forearm);
      limbs.push([
        shoulder,
        elbow,
        { x: elbow.x + foreDir.x * foreLen, y: elbow.y + foreDir.y * foreLen },
      ]);
    }

    const hipTarget = move.joints[side.hipJoint];
    if (hipTarget !== undefined) {
      // Angle of the thigh away from straight down, swinging toward the camera.
      const thighSwing = Math.PI - toRadians(hipTarget);
      const thighLen = segment(side.hip, side.knee, FALLBACK_RATIO.thigh);
      const knee: Point = {
        x: hip.x + down.x * Math.cos(thighSwing) * thighLen,
        y: hip.y + down.y * Math.cos(thighSwing) * thighLen,
      };

      const kneeTarget = move.joints[side.kneeJoint] ?? 180;
      const shinSwing = thighSwing - (Math.PI - toRadians(kneeTarget));
      const shinLen = segment(side.knee, side.ankle, FALLBACK_RATIO.shin);
      limbs.push([
        hip,
        knee,
        {
          x: knee.x + down.x * Math.cos(shinSwing) * shinLen,
          y: knee.y + down.y * Math.cos(shinSwing) * shinLen,
        },
      ]);
    }
  }

  return limbs;
}
