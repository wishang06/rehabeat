import { describe, expect, it } from 'vitest';
import { LM } from '../pose/landmarks';
import { hiddenPose, point, standingPose, withLandmarks } from '../pose/poseFixtures';
import type { Move } from '../types';
import {
  REST_POSE,
  bodyFromLandmarks,
  buildSilhouette,
  capsuleOutline,
  inflateSilhouette,
  poseForMove,
  silhouetteBounds,
  standardBody,
  steadyBody,
  translateSilhouette,
  type Capsule,
  type Silhouette,
} from './silhouette';

const sideRaise: Move = {
  id: 'side-arm-raise',
  name: 'Side Arm Raise',
  joints: { leftShoulder: 90, rightShoulder: 90, leftElbow: 180, rightElbow: 180 },
  tolerance: 20,
  beats: { reach: 2, hold: 4, release: 2 },
  formRules: [],
};

const capsule = (s: Silhouette, part: Capsule['part']) => {
  const found = s.capsules.find((c) => c.part === part);
  if (!found) throw new Error(`no ${part} capsule`);
  return found;
};

/** Twice the signed area by the shoelace formula; positive is clockwise on a y-down canvas. */
function signedArea(points: { x: number; y: number }[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

const BODY = standardBody({ center: { x: 500, y: 300 }, shoulderWidth: 100 });

describe('poseForMove', () => {
  it("uses the move's targets and the rest pose for every joint it leaves out", () => {
    const pose = poseForMove(sideRaise);
    expect(pose.leftShoulder).toBe(90);
    expect(pose.rightElbow).toBe(180);
    expect(pose.leftHip).toBe(REST_POSE.leftHip);
    expect(pose.rightKnee).toBe(REST_POSE.rightKnee);
  });

  it('is the rest pose without a move', () => {
    expect(poseForMove(null)).toEqual(REST_POSE);
  });
});

describe('standardBody', () => {
  it('places the shoulders shoulderWidth apart around the centre, hips below', () => {
    expect(BODY.rightShoulder.x - BODY.leftShoulder.x).toBeCloseTo(100);
    expect((BODY.leftShoulder.x + BODY.rightShoulder.x) / 2).toBeCloseTo(500);
    expect(BODY.leftShoulder.y).toBeCloseTo(300);
    expect(BODY.leftHip.y).toBeGreaterThan(BODY.leftShoulder.y);
  });

  it("is mirrored by default, like the stage: the player's left on the viewer's left", () => {
    expect(BODY.leftShoulder.x).toBeLessThan(BODY.rightShoulder.x);
    const camera = standardBody({ center: { x: 500, y: 300 }, shoulderWidth: 100, mirrored: false });
    expect(camera.leftShoulder.x).toBeGreaterThan(camera.rightShoulder.x);
  });
});

describe('buildSilhouette', () => {
  it('returns a capsule for every limb and the neck, a torso polygon and a head', () => {
    const s = buildSilhouette(REST_POSE, BODY);
    expect(s.capsules.map((c) => c.part).sort()).toEqual(
      ['leftForearm', 'leftShin', 'leftThigh', 'leftUpperArm', 'neck', 'rightForearm', 'rightShin', 'rightThigh', 'rightUpperArm'].sort(),
    );
    expect(s.torso.length).toBeGreaterThanOrEqual(4);
    expect(s.head.center.y).toBeLessThan(BODY.leftShoulder.y - s.head.radius);
  });

  /** The angle at `vertex` between the rays to `a` and `c`, in degrees, as scoring measures joints. */
  const angleAt = (a: { x: number; y: number }, vertex: { x: number; y: number }, c: { x: number; y: number }) => {
    const u = { x: a.x - vertex.x, y: a.y - vertex.y };
    const v = { x: c.x - vertex.x, y: c.y - vertex.y };
    const cos = (u.x * v.x + u.y * v.y) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y));
    return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
  };

  it('draws arms at the angles scoring would measure: hip-shoulder-elbow and shoulder-elbow-wrist', () => {
    for (const mirrored of [true, false]) {
      const body = standardBody({ center: { x: 500, y: 300 }, shoulderWidth: 100, mirrored });
      for (const [shoulder, elbow] of [
        [90, 180],
        [170, 175],
        [45, 90],
        [0, 180],
      ]) {
        const pose = { ...REST_POSE, leftShoulder: shoulder, rightShoulder: shoulder, leftElbow: elbow, rightElbow: elbow };
        const s = buildSilhouette(pose, body);
        for (const side of ['left', 'right'] as const) {
          const upper = capsule(s, `${side}UpperArm`);
          const fore = capsule(s, `${side}Forearm`);
          const hip = side === 'left' ? body.leftHip : body.rightHip;
          expect(upper.a).toEqual(side === 'left' ? body.leftShoulder : body.rightShoulder);
          expect(angleAt(hip, upper.a, upper.b)).toBeCloseTo(shoulder, 5);
          expect(angleAt(upper.a, fore.a, fore.b)).toBeCloseTo(elbow, 5);
        }
      }
    }
  });

  it('swings a raised arm away from the body, never across it', () => {
    for (const mirrored of [true, false]) {
      const body = standardBody({ center: { x: 500, y: 300 }, shoulderWidth: 100, mirrored });
      const s = buildSilhouette(poseForMove(sideRaise), body);
      for (const side of ['left', 'right'] as const) {
        const upper = capsule(s, `${side}UpperArm`);
        const other = side === 'left' ? body.rightShoulder : body.leftShoulder;
        expect(Math.sign(upper.b.x - upper.a.x)).toBe(Math.sign(upper.a.x - other.x));
      }
    }
  });

  it('raises a 170 degree shoulder above the head, and bends a 90 degree elbow up from a side raise', () => {
    const up = buildSilhouette({ ...REST_POSE, leftShoulder: 170 }, BODY);
    expect(capsule(up, 'leftUpperArm').b.y).toBeLessThan(BODY.leftShoulder.y - 50);

    const bent = buildSilhouette({ ...poseForMove(sideRaise), leftElbow: 90 }, BODY);
    const bentFore = capsule(bent, 'leftForearm');
    expect(bentFore.b.y).toBeLessThan(bentFore.a.y - 30);
  });

  it('brings a 90 degree hip up to hip height, and hangs a 180 degree one straight down', () => {
    const raised = buildSilhouette({ ...REST_POSE, leftHip: 90, leftKnee: 90 }, BODY);
    expect(capsule(raised, 'leftThigh').b.y).toBeCloseTo(BODY.leftHip.y, 5);
    const standing = buildSilhouette(REST_POSE, BODY);
    const thigh = capsule(standing, 'leftThigh');
    expect(thigh.b.x).toBeCloseTo(BODY.leftHip.x, 5);
    expect(thigh.b.y).toBeGreaterThan(BODY.leftHip.y);
  });

  it('rests the arms far enough off the sides that a gap shows between hand and hip', () => {
    const s = buildSilhouette(REST_POSE, BODY);
    // Widest point of the torso outline below the waist (the outer hips), from the midline at x 500.
    const hipHalfWidth = Math.max(...s.torso.filter((p) => p.y > 380).map((p) => Math.abs(p.x - 500)));
    for (const side of ['left', 'right'] as const) {
      const fore = capsule(s, `${side}Forearm`);
      const handInner = Math.abs(fore.b.x - 500) - fore.rb;
      expect(handInner - hipHalfWidth).toBeGreaterThan(3);
    }
  });

  it('cants a lifted thigh clearly outward and swells its knee end, so a knee raise reads from the front', () => {
    const raised = buildSilhouette({ ...REST_POSE, leftHip: 90, leftKnee: 90 }, BODY);
    const standing = buildSilhouette(REST_POSE, BODY);
    const thigh = capsule(raised, 'leftThigh');
    const outward = Math.sign(BODY.leftHip.x - BODY.rightHip.x);
    expect((thigh.b.x - thigh.a.x) * outward).toBeGreaterThan(0.4 * BODY.left.thigh);
    expect(thigh.rb).toBeGreaterThan(1.2 * capsule(standing, 'leftThigh').rb);
    // The shin starts as wide as the knee it hangs from.
    expect(capsule(raised, 'leftShin').ra).toBeCloseTo(thigh.rb * (capsule(standing, 'leftShin').ra / capsule(standing, 'leftThigh').rb), 5);
  });

  it('reports the body scale it was built at, for anything drawn alongside it', () => {
    expect(buildSilhouette(REST_POSE, BODY).scale).toBeCloseTo(100);
  });

  it('scales limb widths with shoulder width', () => {
    const wide = buildSilhouette(REST_POSE, standardBody({ center: { x: 500, y: 300 }, shoulderWidth: 200 }));
    const narrow = buildSilhouette(REST_POSE, BODY);
    for (const part of ['leftUpperArm', 'rightThigh', 'neck'] as const) {
      expect(capsule(wide, part).ra).toBeCloseTo(2 * capsule(narrow, part).ra, 5);
      expect(capsule(wide, part).rb).toBeCloseTo(2 * capsule(narrow, part).rb, 5);
    }
    expect(wide.head.radius).toBeCloseTo(2 * narrow.head.radius, 5);
  });

  it('tapers limbs like a body: upper arms narrower than thighs, each narrowing toward its end', () => {
    const s = buildSilhouette(REST_POSE, BODY);
    expect(capsule(s, 'leftUpperArm').ra).toBeLessThan(capsule(s, 'leftThigh').ra);
    expect(capsule(s, 'leftForearm').rb).toBeLessThan(capsule(s, 'leftForearm').ra);
  });

  it('winds the torso clockwise whichever way the body faces, so filled shapes union', () => {
    for (const mirrored of [true, false]) {
      const body = standardBody({ center: { x: 500, y: 300 }, shoulderWidth: 100, mirrored });
      expect(signedArea(buildSilhouette(REST_POSE, body).torso)).toBeGreaterThan(0);
    }
  });
});

describe('capsuleOutline', () => {
  it('meets each end circle at a tangent point on that circle', () => {
    const c: Capsule = { part: 'leftThigh', a: { x: 0, y: 0 }, b: { x: 0, y: 100 }, ra: 20, rb: 10 };
    const outline = capsuleOutline(c);
    if (outline.kind !== 'capsule') throw new Error('expected a capsule');
    for (const angle of [outline.aStart, outline.aEnd]) {
      expect(Math.hypot(Math.cos(angle) * c.ra, Math.sin(angle) * c.ra)).toBeCloseTo(c.ra);
    }
    // The straight sides are tangent: perpendicular to the radius at both ends.
    const pa = { x: c.a.x + c.ra * Math.cos(outline.aEnd), y: c.a.y + c.ra * Math.sin(outline.aEnd) };
    const pb = { x: c.b.x + c.rb * Math.cos(outline.bStart), y: c.b.y + c.rb * Math.sin(outline.bStart) };
    const side = { x: pb.x - pa.x, y: pb.y - pa.y };
    expect(side.x * Math.cos(outline.aEnd) + side.y * Math.sin(outline.aEnd)).toBeCloseTo(0, 6);
    expect(side.x * Math.cos(outline.bStart) + side.y * Math.sin(outline.bStart)).toBeCloseTo(0, 6);
  });

  it('collapses to the larger circle when one end sits inside the other', () => {
    const c: Capsule = { part: 'leftThigh', a: { x: 0, y: 0 }, b: { x: 3, y: 0 }, ra: 20, rb: 10 };
    expect(capsuleOutline(c)).toEqual({ kind: 'circle', center: { x: 0, y: 0 }, radius: 20 });
  });
});

describe('bodyFromLandmarks', () => {
  const SIZE = { width: 640, height: 480 };
  /** Image landmarks: shoulders at y 0.3, hips at 0.6, 0.2 of the width apart. */
  const image = () =>
    withLandmarks(hiddenPose(), {
      leftShoulder: point(0.6, 0.3),
      rightShoulder: point(0.4, 0.3),
      leftHip: point(0.58, 0.6),
      rightHip: point(0.42, 0.6),
    });

  it('anchors on the live shoulders and hips in canvas pixels', () => {
    const body = bodyFromLandmarks(image(), SIZE);
    expect(body?.leftShoulder).toEqual({ x: 384, y: 144 });
    expect(body?.rightHip).toEqual({ x: 0.42 * 640, y: 288 });
  });

  it("uses the player's own segment lengths from world landmarks, relative to the torso", () => {
    // standingPose: torso 0.5 m, upper arm 0.3 m, so the upper arm is 0.6 torsos.
    const body = bodyFromLandmarks(image(), SIZE, standingPose());
    const torsoPx = Math.hypot(384 - 0.58 * 640, 144 - 288);
    expect(body?.left.upperArm).toBeCloseTo(0.6 * torsoPx, 5);
    expect(body?.left.shin).toBeCloseTo(0.9 * torsoPx, 5);
  });

  it('is null until both shoulders and both hips are visible', () => {
    const hidden = withLandmarks(image(), { rightHip: point(0.42, 0.6, 0, 0.1) });
    expect(bodyFromLandmarks(hidden, SIZE)).toBeNull();
    expect(bodyFromLandmarks(image().slice(0, LM.leftHip), SIZE)).toBeNull();
  });

  it('accepts less certain anchors when given a lower visibility floor', () => {
    const unsure = withLandmarks(image(), { rightHip: point(0.42, 0.6, 0, 0.3) });
    expect(bodyFromLandmarks(unsure, SIZE)).toBeNull();
    expect(bodyFromLandmarks(unsure, SIZE, null, 0.2)?.rightHip).toEqual({ x: 0.42 * 640, y: 288 });
  });
});

describe('silhouetteBounds and translateSilhouette', () => {
  it('bounds every shape including its width, and moves with a translation', () => {
    const s = buildSilhouette(poseForMove(sideRaise), BODY);
    const bounds = silhouetteBounds(s);
    const hand = capsule(s, 'rightForearm');
    expect(bounds.right).toBeCloseTo(hand.b.x + hand.rb, 5);
    expect(bounds.top).toBeCloseTo(s.head.center.y - s.head.radius, 5);

    const moved = silhouetteBounds(translateSilhouette(s, 40, -10));
    expect(moved.left).toBeCloseTo(bounds.left + 40, 5);
    expect(moved.bottom).toBeCloseTo(bounds.bottom - 10, 5);
  });
});

describe('steadyBody', () => {
  it('leaves a plausible body alone', () => {
    expect(steadyBody(BODY)).toBe(BODY);
  });

  it('rebuilds a body whose shoulders have collapsed, at the same place and height', () => {
    const squeezed = { ...BODY, rightShoulder: { x: 510, y: 300 }, rightHip: { x: 505, y: 420 } };
    const steady = steadyBody(squeezed);
    const shoulderWidth = Math.abs(steady.leftShoulder.x - steady.rightShoulder.x);
    const torso = steady.leftHip.y - steady.leftShoulder.y;
    expect(shoulderWidth).toBeGreaterThan(0.6 * torso);
    expect((steady.leftShoulder.x + steady.rightShoulder.x) / 2).toBeCloseTo((BODY.leftShoulder.x + 510) / 2, 5);
    // Still in camera-image convention: the player's left at the larger x.
    expect(steady.leftShoulder.x).toBeGreaterThan(steady.rightShoulder.x);
  });
});

describe('inflateSilhouette', () => {
  const square: Silhouette = {
    capsules: [{ part: 'leftUpperArm', a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, ra: 3, rb: 2 }],
    torso: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
    head: { center: { x: 5, y: -5 }, radius: 4 },
    scale: 10,
  };

  it('grows every capsule and the head by the same distance, leaving their centres put', () => {
    const grown = inflateSilhouette(square, 2);
    expect(grown.capsules[0]).toMatchObject({ a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, ra: 5, rb: 4 });
    expect(grown.head).toEqual({ center: { x: 5, y: -5 }, radius: 6 });
  });

  it('pushes each torso edge straight out by that distance', () => {
    expect(inflateSilhouette(square, 2).torso).toEqual([
      { x: -2, y: -2 },
      { x: 12, y: -2 },
      { x: 12, y: 12 },
      { x: -2, y: 12 },
    ]);
  });

  it('keeps a real torso wound clockwise and grows it outward on every side', () => {
    const s = buildSilhouette(REST_POSE, BODY);
    const grown = inflateSilhouette(s, 5);
    expect(signedArea(grown.torso)).toBeGreaterThan(signedArea(s.torso));
    const cx = s.torso.reduce((sum, p) => sum + p.x, 0) / s.torso.length;
    const cy = s.torso.reduce((sum, p) => sum + p.y, 0) / s.torso.length;
    s.torso.forEach((p, i) => {
      const q = grown.torso[i];
      expect(Math.hypot(q.x - cx, q.y - cy)).toBeGreaterThan(Math.hypot(p.x - cx, p.y - cy));
    });
  });
});
