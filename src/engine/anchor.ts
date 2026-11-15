/**
 * Where the target figure stands, and how big it is.
 *
 * The figure used to be rebuilt on the player's raw shoulders and hips every
 * frame, so it shook with the detector's noise, tilted when the player
 * leaned, and changed limb lengths from one frame to the next. Here it stands
 * upright on the player's hips and stays exactly where it is until the player
 * has really moved: a step aside, or a step toward or away from the camera.
 * Then it glides over, and stops again.
 */
import { LM } from '../pose/landmarks';
import type { Landmark } from '../types';
import { PROPORTION, type BodyFrame, type Point, type SegmentLengths } from './silhouette';

/** Shoulders and hips below this visibility don't place the figure. */
const MIN_VISIBILITY = 0.5;
/** Each measurement is low-passed over this long first, so one noisy frame can't start a move. */
const AIM_MS = 80;
/** The player has to be out of place for this long before the figure follows: a detector glitch is shorter. */
const ENGAGE_AFTER_MS = 200;
const MAX_STEP_MS = 100;

/** How far the player can stand from the figure before it follows, and how close it gets before it stops (shoulder widths). */
const POSITION = { outer: 0.25, inner: 0.03, followMs: 220 };
/** The same for the figure's size, as a ratio in log units: about 12% and 2%. */
const SIZE = { outer: Math.log(1.12), inner: Math.log(1.02), followMs: 350 };

/** The body is only measured for size when upright and facing the camera: a lean or a turn shortens it in the picture. */
const MAX_UPRIGHT_TILT = (20 * Math.PI) / 180;
const SHOULDER_TO_TORSO = { min: 0.5, max: 1.1 };

/** A measured limb length may differ from standard proportions by this much; beyond it the measurement is wrong. */
const LENGTH_RANGE = { min: 0.75, max: 1.3 };
/** Limb lengths are the mean of this many recent measurements. They are the player's bones: they don't change. */
const LENGTH_SAMPLES = 120;

const SEGMENTS = ['upperArm', 'forearm', 'thigh', 'shin'] as const;
type Segment = (typeof SEGMENTS)[number];

const SEGMENT_ENDS: Record<Segment, readonly (readonly [number, number])[]> = {
  upperArm: [
    [LM.leftShoulder, LM.leftElbow],
    [LM.rightShoulder, LM.rightElbow],
  ],
  forearm: [
    [LM.leftElbow, LM.leftWrist],
    [LM.rightElbow, LM.rightWrist],
  ],
  thigh: [
    [LM.leftHip, LM.leftKnee],
    [LM.rightHip, LM.rightKnee],
  ],
  shin: [
    [LM.leftKnee, LM.leftAnkle],
    [LM.rightKnee, LM.rightAnkle],
  ],
};
/** The torso side each of those is measured against: left, then right. */
const TORSO_ENDS = [
  [LM.leftShoulder, LM.leftHip],
  [LM.rightShoulder, LM.rightHip],
] as const;

type Size = { width: number; height: number };

const distance3 = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Follows a target only once it has moved away, and stops once it has caught
 * up. Between those the held value does not change at all.
 */
class Follower {
  /** The target, low-passed. */
  private aim: number[] | null = null;
  private held: number[] | null = null;
  private following = false;
  private beyondSince: number | null = null;

  constructor(
    private readonly range: { outer: number; inner: number; followMs: number },
    /** How far apart two values are, in the units of `range`. */
    private readonly distance: (a: number[], b: number[], unit: number) => number,
  ) {}

  get value(): number[] | null {
    return this.held;
  }

  update(target: number[], unit: number, nowMs: number, dtMs: number): number[] {
    if (!this.aim || !this.held) {
      this.aim = [...target];
      this.held = [...target];
      return this.held;
    }
    const toward = (from: number[], to: number[], ms: number) => {
      const k = 1 - Math.exp(-dtMs / ms);
      return from.map((v, i) => v + (to[i] - v) * k);
    };
    this.aim = toward(this.aim, target, AIM_MS);

    if (!this.following) {
      if (this.distance(this.aim, this.held, unit) > this.range.outer) {
        this.beyondSince ??= nowMs;
        if (nowMs - this.beyondSince >= ENGAGE_AFTER_MS) this.following = true;
      } else {
        this.beyondSince = null;
      }
    }
    if (this.following) {
      this.held = toward(this.held, this.aim, this.range.followMs);
      if (this.distance(this.aim, this.held, unit) < this.range.inner) {
        this.following = false;
        this.beyondSince = null;
      }
    }
    return this.held;
  }

  reset(): void {
    this.aim = this.held = null;
    this.following = false;
    this.beyondSince = null;
  }
}

/** One frame's reading of the player's shoulders and hips, in canvas pixels. */
interface Reading {
  shoulderMid: Point;
  hipMid: Point | null;
  /** Shoulder width and torso length. */
  shoulders: number;
  torso: number | null;
  /** True when the body is upright and facing the camera, so those two are its real size. */
  fit: boolean;
  /** +1 when the player's left shoulder is at the larger x (a camera image), -1 when mirrored. */
  leftward: 1 | -1;
}

function read(landmarks: Landmark[], size: Size): Reading | null {
  const px = (index: number): Point | null => {
    const lm = landmarks[index];
    if (!lm || lm.visibility < MIN_VISIBILITY) return null;
    return { x: lm.x * size.width, y: lm.y * size.height };
  };
  const ls = px(LM.leftShoulder);
  const rs = px(LM.rightShoulder);
  if (!ls || !rs) return null;
  const lh = px(LM.leftHip);
  const rh = px(LM.rightHip);

  const shoulderMid = mid(ls, rs);
  const shoulders = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  const hipMid = lh && rh ? mid(lh, rh) : null;
  const torso = hipMid ? Math.hypot(hipMid.x - shoulderMid.x, hipMid.y - shoulderMid.y) : null;

  let fit = false;
  if (hipMid && torso && torso > 0) {
    const tilt = Math.abs(Math.atan2(hipMid.x - shoulderMid.x, hipMid.y - shoulderMid.y));
    const ratio = shoulders / torso;
    fit = tilt < MAX_UPRIGHT_TILT && ratio >= SHOULDER_TO_TORSO.min && ratio <= SHOULDER_TO_TORSO.max;
  }
  return { shoulderMid, hipMid, shoulders, torso, fit, leftward: ls.x >= rs.x ? 1 : -1 };
}

export class FigureAnchor {
  private readonly center = new Follower(POSITION, (a, b, unit) => Math.hypot(a[0] - b[0], a[1] - b[1]) / unit);
  /** [ln shoulder width, ln torso length] */
  private readonly extent = new Follower(SIZE, (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])));
  /** True once the size has come from an upright, facing frame rather than a guess. */
  private sized = false;
  private leftward: 1 | -1 = 1;

  /** Each limb's length as a fraction of the torso, and how many measurements that is the mean of. */
  private readonly ratios: Record<Segment, number> = {
    upperArm: PROPORTION.segments.upperArm / PROPORTION.torso,
    forearm: PROPORTION.segments.forearm / PROPORTION.torso,
    thigh: PROPORTION.segments.thigh / PROPORTION.torso,
    shin: PROPORTION.segments.shin / PROPORTION.torso,
  };
  private readonly counts: Record<Segment, number> = { upperArm: 0, forearm: 0, thigh: 0, shin: 0 };

  private canvas: Size | null = null;
  private lastMs: number | null = null;
  private lastSample: Landmark[] | null = null;

  /**
   * The body to draw the figure on this display frame, in canvas pixels of the
   * camera image. `landmarks` and `world` are the latest pose sample's (the
   * same arrays until the camera delivers a new one), or null when there is
   * none: the figure then stays where it was. Null until the first pose.
   */
  update(landmarks: Landmark[] | null, world: Landmark[] | null, size: Size, nowMs: number): BodyFrame | null {
    if (this.canvas && (this.canvas.width !== size.width || this.canvas.height !== size.height)) {
      // Everything held is in the old canvas's pixels.
      this.center.reset();
      this.extent.reset();
      this.sized = false;
    }
    this.canvas = { width: size.width, height: size.height };
    const dtMs = this.lastMs === null ? 0 : Math.min(MAX_STEP_MS, Math.max(0, nowMs - this.lastMs));
    this.lastMs = nowMs;

    const fresh = landmarks !== null && landmarks !== this.lastSample;
    this.lastSample = landmarks;
    if (fresh && landmarks && world) this.measureLimbs(landmarks, world);

    const reading = landmarks && read(landmarks, size);
    if (reading) {
      this.resize(reading, nowMs, dtMs);
      const extent = this.extent.value;
      if (extent) {
        const [shoulders, torso] = extent.map(Math.exp);
        // On the hips when they are in view: they move least through a move. Else hung from the shoulders.
        const target = reading.hipMid
          ? [reading.hipMid.x, reading.hipMid.y - torso]
          : [reading.shoulderMid.x, reading.shoulderMid.y];
        this.center.update(target, shoulders, nowMs, dtMs);
      }
    }
    return this.body();
  }

  private resize(reading: Reading, nowMs: number, dtMs: number): void {
    const measured = [reading.shoulders, reading.torso ?? PROPORTION.torso * reading.shoulders].map(Math.log);
    if (reading.fit) {
      if (!this.sized) this.extent.reset();
      this.sized = true;
      this.leftward = reading.leftward;
      this.extent.update(measured, 1, nowMs, dtMs);
    } else if (!this.sized) {
      // Nothing better yet: a leaning or half-seen body still says roughly how big the player is.
      this.leftward = reading.leftward;
      this.extent.update(measured, 1, nowMs, dtMs);
    }
  }

  private measureLimbs(landmarks: Landmark[], world: Landmark[]): void {
    const seen = (index: number) => (landmarks[index]?.visibility ?? 0) >= MIN_VISIBILITY && world[index] !== undefined;
    for (const segment of SEGMENTS) {
      const standard = PROPORTION.segments[segment] / PROPORTION.torso;
      let sum = 0;
      let sides = 0;
      SEGMENT_ENDS[segment].forEach(([from, to], side) => {
        const [shoulder, hip] = TORSO_ENDS[side];
        if (!seen(from) || !seen(to) || !seen(shoulder) || !seen(hip)) return;
        const torso = distance3(world[shoulder], world[hip]);
        if (torso < 0.05) return;
        const ratio = distance3(world[from], world[to]) / torso;
        sum += Math.min(LENGTH_RANGE.max * standard, Math.max(LENGTH_RANGE.min * standard, ratio));
        sides++;
      });
      if (sides === 0) continue;
      const count = Math.min(LENGTH_SAMPLES, this.counts[segment] + 1);
      this.counts[segment] = count;
      this.ratios[segment] += (sum / sides - this.ratios[segment]) / count;
    }
  }

  private body(): BodyFrame | null {
    const center = this.center.value;
    const extent = this.extent.value;
    if (!center || !extent) return null;
    const [x, y] = center;
    const [shoulders, torso] = extent.map(Math.exp);
    const half = (this.leftward * shoulders) / 2;
    const hipHalf = (this.leftward * PROPORTION.hipWidth * shoulders) / 2;
    const lengths = (): SegmentLengths => ({
      upperArm: this.ratios.upperArm * torso,
      forearm: this.ratios.forearm * torso,
      thigh: this.ratios.thigh * torso,
      shin: this.ratios.shin * torso,
    });
    return {
      leftShoulder: { x: x + half, y },
      rightShoulder: { x: x - half, y },
      leftHip: { x: x + hipHalf, y: y + torso },
      rightHip: { x: x - hipHalf, y: y + torso },
      left: lengths(),
      right: lengths(),
    };
  }
}
