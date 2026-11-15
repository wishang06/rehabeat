/**
 * How each pose is pictured, for the poses joint angles alone can't picture.
 *
 * A move's eight joint angles say how far each joint is bent, not which way
 * the limb goes: a hip at 60 degrees is a knee lifted to the front, a leg
 * out to the side, or a torso folded over a straight leg. Drawn from the
 * angles alone, every one of them came out as a knee raise. So each of these
 * poses has its picture written out here, as the direction of each bone, the
 * way a player facing (or side-on to) the camera does it.
 *
 * moveViews.test.ts holds every picture to its move: each scored joint, as
 * drawn, is within the move's tolerance of the angle the move asks for.
 */
import type { JointName, Move } from '../types';
import { REST_POSE, poseForMove } from './silhouette';
import { viewForPose, type FigureView } from './stick';

/** Arms relaxed just off the sides, legs straight down. */
const REST_ARMS = { leftUpperArm: 16, leftForearm: 16, rightUpperArm: -16, rightForearm: -16 } as const;

export const MOVE_VIEWS: Readonly<Record<string, FigureView>> = {
  // Standing on the right leg, left foot on the inner right thigh, knee out to the side.
  'tree-pose': {
    ...REST_ARMS,
    leftThigh: 56,
    leftShin: -83,
    rightThigh: 0,
    rightShin: 0,
    order: ['rightLeg', 'rightArm', 'leftArm', 'leftLeg'],
  },
  // Legs wide, right knee bent over the right foot, arms out level.
  'warrior-ii': {
    leftUpperArm: 95,
    leftForearm: 99,
    rightUpperArm: -100,
    rightForearm: -103,
    leftThigh: 48,
    leftShin: 46,
    rightThigh: -72,
    rightShin: -6,
  },
  // A wide squat: thighs out to the sides, shins upright.
  'goddess-pose': {
    ...REST_ARMS,
    leftThigh: 74,
    leftShin: 6,
    rightThigh: -72,
    rightShin: -6,
  },
  // Legs wide and straight, torso tipped level over the left leg, left hand down, right hand up.
  'triangle-pose': {
    torso: 112,
    leftUpperArm: 6,
    leftForearm: 2,
    rightUpperArm: 180,
    rightForearm: 184,
    leftThigh: 47,
    leftShin: 47,
    rightThigh: -36,
    rightShin: -36,
    order: ['rightLeg', 'leftLeg', 'rightArm', 'leftArm'],
  },
  // Standing on the right leg, torso level, left leg lifted in line with it, right hand down, left hand up.
  'half-moon': {
    torso: -72,
    leftUpperArm: 178,
    leftForearm: -178,
    rightUpperArm: -4,
    rightForearm: 0,
    leftThigh: 104,
    leftShin: 106,
    rightThigh: 4,
    rightShin: 6,
    order: ['leftLeg', 'rightLeg', 'leftArm', 'rightArm'],
  },
  // Side-on. Standing on the left leg, leaning forward, left arm reaching ahead, right hand holding the right foot behind.
  'dancer-pose': {
    width: 0.16,
    torso: 139,
    leftUpperArm: 106,
    leftForearm: 118,
    rightUpperArm: -128,
    rightForearm: -124,
    leftThigh: 0,
    leftShin: 4,
    rightThigh: -122,
    rightShin: 156,
    order: ['leftLeg', 'leftArm', 'rightLeg', 'rightArm'],
  },
  // Side-on. An upside-down V: hips high, hands and feet on the floor.
  'downward-dog': {
    width: 0.16,
    torso: 38,
    leftUpperArm: 42,
    leftForearm: 48,
    rightUpperArm: 42,
    rightForearm: 48,
    leftThigh: -20,
    leftShin: -18,
    rightThigh: -20,
    rightShin: -18,
  },
  // Sitting, knees out to the sides, soles of the feet together, hands on the feet.
  'bound-angle': {
    leftUpperArm: -7,
    leftForearm: -16,
    rightUpperArm: 7,
    rightForearm: 16,
    leftThigh: [97, 0.72],
    leftShin: [-66, 0.84],
    rightThigh: [-97, 0.72],
    rightShin: [66, 0.84],
    order: ['rightLeg', 'leftLeg', 'rightArm', 'leftArm'],
  },
};

export const REST_VIEW: FigureView = viewForPose(REST_POSE);

/** The picture for a move: its own when it has one, else a front view built from its joint angles. */
export function viewForMove(id: string | null, joints: Partial<Record<JointName, number>>): FigureView {
  return (id !== null && MOVE_VIEWS[id]) || viewForPose(poseForMove({ joints } as Pick<Move, 'joints'>));
}
