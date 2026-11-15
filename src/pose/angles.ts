import { JOINT_NAMES } from '../types';
import type { JointName, Landmark } from '../types';
import { JOINT_TRIPLETS, KEEP_MEASURED_VISIBILITY, MIN_VISIBILITY } from './landmarks';
import { isVisible } from './visibility';

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface JointAngles {
  /** Raw (unsmoothed) angle in degrees for every measurable joint. */
  angles: Partial<Record<JointName, number>>;
  /** The joints present in `angles`, in JOINT_NAMES order. */
  visible: JointName[];
}

const RAD_TO_DEG = 180 / Math.PI;
const MIN_LENGTH = 1e-9;

/**
 * The 3D angle at `vertex` between the rays to `a` and `c`, in degrees (0-180).
 * Returns 0 when either ray has no length, since the angle is then undefined.
 */
export function angleBetween(a: Point3, vertex: Point3, c: Point3): number {
  const ux = a.x - vertex.x;
  const uy = a.y - vertex.y;
  const uz = a.z - vertex.z;
  const vx = c.x - vertex.x;
  const vy = c.y - vertex.y;
  const vz = c.z - vertex.z;

  const uLength = Math.hypot(ux, uy, uz);
  const vLength = Math.hypot(vx, vy, vz);
  // Written as negated comparisons so NaN coordinates also land here.
  if (!(uLength > MIN_LENGTH) || !(vLength > MIN_LENGTH)) return 0;

  const cosine = (ux * vx + uy * vy + uz * vz) / (uLength * vLength);
  // Rounding can push the cosine of parallel rays just outside [-1, 1].
  return Math.acos(Math.min(1, Math.max(-1, cosine))) * RAD_TO_DEG;
}

const NONE_MEASURED: ReadonlySet<JointName> = new Set();

/**
 * Joint angles from WORLD landmarks (3D, metres). A joint is skipped unless
 * all three of its landmarks are at least `minVisibility` visible, or, for a
 * joint in `measuredBefore` (the joints measured in the previous frame), at
 * least KEEP_MEASURED_VISIBILITY.
 */
export function computeJointAngles(
  world: Landmark[],
  minVisibility: number = MIN_VISIBILITY,
  measuredBefore: ReadonlySet<JointName> = NONE_MEASURED,
): JointAngles {
  const angles: Partial<Record<JointName, number>> = {};
  const visible: JointName[] = [];
  const keepVisibility = Math.min(minVisibility, KEEP_MEASURED_VISIBILITY);

  for (const joint of JOINT_NAMES) {
    const [aIndex, vertexIndex, cIndex] = JOINT_TRIPLETS[joint];
    const a = world[aIndex];
    const vertex = world[vertexIndex];
    const c = world[cIndex];
    const threshold = measuredBefore.has(joint) ? keepVisibility : minVisibility;
    if (!isVisible(a, threshold) || !isVisible(vertex, threshold) || !isVisible(c, threshold)) {
      continue;
    }
    angles[joint] = angleBetween(a, vertex, c);
    visible.push(joint);
  }

  return { angles, visible };
}

/**
 * The same joints measured in the camera picture: the angle each one makes
 * on screen, from the IMAGE landmarks with depth left out.
 *
 * The 3D angles lean on the model's depth estimate, its weakest output: on
 * photos of held poses it read straight elbows and knees 10 to 35 degrees
 * bent, while the picture had them within 5. The picture is in turn blind to
 * a limb that points at the camera (a knee raised to the front), which only
 * the 3D reading sees. So a frame carries both and scoring takes whichever
 * is nearer the target.
 *
 * `landmarks` are normalised to the frame (0-1 on each axis); `aspect` is the
 * frame's width over its height, which puts both axes on the same scale.
 * Only `joints` are measured: the joints the 3D reading counted as visible.
 */
export function computeFlatAngles(
  landmarks: Landmark[],
  aspect: number,
  joints: readonly JointName[],
): Partial<Record<JointName, number>> {
  const angles: Partial<Record<JointName, number>> = {};
  const flat = (landmark: Landmark): Point3 => ({ x: landmark.x * aspect, y: landmark.y, z: 0 });
  for (const joint of joints) {
    const [aIndex, vertexIndex, cIndex] = JOINT_TRIPLETS[joint];
    const a = landmarks[aIndex];
    const vertex = landmarks[vertexIndex];
    const c = landmarks[cIndex];
    if (!a || !vertex || !c) continue;
    angles[joint] = angleBetween(flat(a), flat(vertex), flat(c));
  }
  return angles;
}
