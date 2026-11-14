/**
 * Turns a pose dataset (one CSV of MediaPipe landmarks per pose, one row per
 * photo) into Move entries for src/moves/moves.json.
 *
 * The CSVs also carry precomputed angle columns, but those are measured
 * differently (0-360, signed, other triplets), so this recomputes each of the
 * game's eight joint angles from the landmark columns with the game's own
 * triplets. The landmarks are image coordinates from photos, not the 3D world
 * landmarks the game scores, so angles are taken in the image plane: the
 * photos' z is a rough depth estimate and bends straight limbs by 30-40°.
 */
import { angleBetween } from '../../src/pose/angles';
import { JOINT_TRIPLETS, MIN_VISIBILITY } from '../../src/pose/landmarks';
import { JOINT_NAMES, type JointName, type Move } from '../../src/types';

/** MediaPipe's 33 pose landmarks in index order, as the CSV column prefixes spell them. */
export const LANDMARK_NAMES = [
  'NOSE', 'LEFT_EYE_INNER', 'LEFT_EYE', 'LEFT_EYE_OUTER', 'RIGHT_EYE_INNER', 'RIGHT_EYE',
  'RIGHT_EYE_OUTER', 'LEFT_EAR', 'RIGHT_EAR', 'MOUTH_LEFT', 'MOUTH_RIGHT', 'LEFT_SHOULDER',
  'RIGHT_SHOULDER', 'LEFT_ELBOW', 'RIGHT_ELBOW', 'LEFT_WRIST', 'RIGHT_WRIST', 'LEFT_PINKY',
  'RIGHT_PINKY', 'LEFT_INDEX', 'RIGHT_INDEX', 'LEFT_THUMB', 'RIGHT_THUMB', 'LEFT_HIP', 'RIGHT_HIP',
  'LEFT_KNEE', 'RIGHT_KNEE', 'LEFT_ANKLE', 'RIGHT_ANKLE', 'LEFT_HEEL', 'RIGHT_HEEL',
  'LEFT_FOOT_INDEX', 'RIGHT_FOOT_INDEX',
] as const;

/** How one dataset file becomes a move. Everything not listed here is derived from the data. */
export interface PoseSpec {
  /** CSV file name inside the dataset folder. */
  file: string;
  id: string;
  name: string;
  formRules: string[];
}

/** Upright poses get the trunk-lean check; poses that lean on purpose don't. */
export const POSES: readonly PoseSpec[] = [
  { file: 'Vrukshana_Combined.csv', id: 'tree-pose', name: 'Tree Pose', formRules: ['trunk-lean'] },
  { file: 'Veerabhadrasana_Combined.csv', id: 'warrior-ii', name: 'Warrior II', formRules: ['trunk-lean'] },
  { file: 'UtkataKonasana_Combined.csv', id: 'goddess-pose', name: 'Goddess Pose', formRules: ['trunk-lean'] },
  { file: 'Triangle_Combined.csv', id: 'triangle-pose', name: 'Triangle Pose', formRules: [] },
  { file: 'ArdhaChandrasana_Combined.csv', id: 'half-moon', name: 'Half Moon', formRules: [] },
  { file: 'Natarajasana_Combined.csv', id: 'dancer-pose', name: 'Dancer Pose', formRules: [] },
  { file: 'DownwardDog_Combined.csv', id: 'downward-dog', name: 'Downward Dog', formRules: [] },
  { file: 'BaddhaKonasana_Combined.csv', id: 'bound-angle', name: 'Bound Angle', formRules: ['trunk-lean'] },
];

export const DERIVE_DEFAULTS = {
  /** A joint is scored only if it was measurable in at least this share of the photos... */
  minCoverage: 0.6,
  /** ...and the middle half of the photos agree on it within this many degrees (IQR). */
  maxSpreadDeg: 40,
  /** Tolerance is set so this share of the photos would hold the pose at Good or better. */
  goodShare: 0.75,
  /**
   * The photos are of practised yogis, so the data alone asks for about 15°.
   * Players in rehab, seen through a webcam, get at least the 20° the
   * hand-written moves use.
   */
  minToleranceDeg: 20,
  maxToleranceDeg: 35,
  beats: { reach: 2, hold: 4, release: 2 },
};

export type DeriveOptions = typeof DERIVE_DEFAULTS;

/** One photo's joint angles; joints whose landmarks weren't visible are absent. */
export type SampleAngles = Partial<Record<JointName, number>>;

export class DatasetError extends Error {}

/** Parses CSV text (RFC 4180 quoting, optional BOM) into rows keyed by the header. */
export function parseCsv(text: string): Record<string, string>[] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i++;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  const [header, ...rows] = records.filter((r) => r.some((cell) => cell.trim() !== ''));
  if (!header) return [];
  return rows.map((row) => Object.fromEntries(header.map((key, i) => [key.trim(), row[i] ?? ''])));
}

/**
 * The game's joint angles for one CSV row, measured in the image plane. A joint
 * is left out when any of its three landmarks is below the game's visibility cut-off.
 */
export function sampleAngles(row: Record<string, string>, minVisibility = MIN_VISIBILITY): SampleAngles {
  const point = (index: number) => {
    const name = LANDMARK_NAMES[index];
    const x = Number(row[`${name}_x`]);
    const y = Number(row[`${name}_y`]);
    const visibility = Number(row[`${name}_vis`]);
    if (![x, y, visibility].every(Number.isFinite) || visibility < minVisibility) return null;
    return { x, y, z: 0 };
  };

  const angles: SampleAngles = {};
  for (const joint of JOINT_NAMES) {
    const [a, vertex, c] = JOINT_TRIPLETS[joint].map(point);
    if (a && vertex && c) angles[joint] = angleBetween(a, vertex, c);
  }
  return angles;
}

const OTHER_SIDE: Record<JointName, JointName> = {
  leftShoulder: 'rightShoulder',
  rightShoulder: 'leftShoulder',
  leftElbow: 'rightElbow',
  rightElbow: 'leftElbow',
  leftHip: 'rightHip',
  rightHip: 'leftHip',
  leftKnee: 'rightKnee',
  rightKnee: 'leftKnee',
};

/** The same pose done on the other side: every left joint swapped with its right. */
export function mirror(sample: SampleAngles): SampleAngles {
  const out: SampleAngles = {};
  for (const [joint, angle] of Object.entries(sample) as [JointName, number][]) {
    out[OTHER_SIDE[joint]] = angle;
  }
  return out;
}

/**
 * Mean absolute difference over the joints both have. Poses that share no
 * joint (a side-on photo against its own mirror) count as the furthest apart.
 */
function distance(a: SampleAngles, b: SampleAngles): number {
  let total = 0;
  let count = 0;
  for (const joint of JOINT_NAMES) {
    const x = a[joint];
    const y = b[joint];
    if (x !== undefined && y !== undefined) {
      total += Math.abs(x - y);
      count++;
    }
  }
  return count === 0 ? 180 : total / count;
}

function quantile(sorted: number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

function medianPose(samples: SampleAngles[]): SampleAngles {
  const out: SampleAngles = {};
  for (const joint of JOINT_NAMES) {
    const values = samples.map((s) => s[joint]).filter((v): v is number => v !== undefined);
    if (values.length > 0) out[joint] = quantile(values.sort((a, b) => a - b), 0.5);
  }
  return out;
}

/**
 * Puts every photo on the same side. One-sided poses (tree, warrior, dancer)
 * appear in the photos on either leg, and averaging both sides gives a pose
 * nobody does. Each photo is mirrored or not, whichever sits closer to the
 * group's median pose, until that settles; every photo is tried as the
 * starting point and the tightest grouping wins. The side most photos were
 * already on is kept, so the result reads like the majority of the photos.
 */
export function alignSides(samples: SampleAngles[]): { samples: SampleAngles[]; mirrored: number } {
  if (samples.length === 0) return { samples: [], mirrored: 0 };
  const mirrors = samples.map(mirror);

  let best: { flips: boolean[]; cost: number } | null = null;
  for (const start of samples) {
    let reference = start;
    let flips: boolean[] = [];
    for (let round = 0; round < 20; round++) {
      const next = samples.map((s, i) => distance(mirrors[i], reference) < distance(s, reference));
      const settled = next.every((flip, i) => flip === flips[i]);
      flips = next;
      reference = medianPose(samples.map((s, i) => (flips[i] ? mirrors[i] : s)));
      if (settled) break;
    }
    const cost = samples.reduce((sum, s, i) => sum + distance(flips[i] ? mirrors[i] : s, reference), 0);
    if (!best || cost < best.cost - 1e-9) best = { flips, cost };
  }

  let flips = best!.flips;
  if (flips.filter(Boolean).length * 2 > flips.length) flips = flips.map((flip) => !flip);
  return {
    samples: samples.map((s, i) => (flips[i] ? mirrors[i] : s)),
    mirrored: flips.filter(Boolean).length,
  };
}

export interface JointReport {
  joint: JointName;
  /** Median angle over the photos where the joint was visible. */
  median: number;
  /** Interquartile range, in degrees. */
  spread: number;
  /** Share of the photos where the joint was visible. */
  coverage: number;
  /** Why the joint isn't scored, or null when it is. */
  dropped: 'not visible enough' | 'photos disagree' | null;
}

export interface DerivedMove {
  move: Move;
  photos: number;
  mirrored: number;
  joints: JointReport[];
  /** Share of the photos whose mean error is within the tolerance (a Good hold or better). */
  goodShare: number;
}

/** Builds one move from a pose's photos. */
export function deriveMove(
  spec: PoseSpec,
  rows: Record<string, string>[],
  options: DeriveOptions = DERIVE_DEFAULTS,
): DerivedMove {
  const raw = rows.map((row) => sampleAngles(row)).filter((s) => Object.keys(s).length > 0);
  if (raw.length === 0) throw new DatasetError(`${spec.file}: no rows with visible joints`);
  const { samples, mirrored } = alignSides(raw);

  const joints: JointReport[] = JOINT_NAMES.map((joint) => {
    const values = samples
      .map((s) => s[joint])
      .filter((v): v is number => v !== undefined)
      .sort((a, b) => a - b);
    const coverage = values.length / samples.length;
    if (values.length === 0) return { joint, median: NaN, spread: NaN, coverage, dropped: 'not visible enough' };
    const spread = quantile(values, 0.75) - quantile(values, 0.25);
    const dropped =
      coverage < options.minCoverage ? 'not visible enough' : spread > options.maxSpreadDeg ? 'photos disagree' : null;
    return { joint, median: quantile(values, 0.5), spread, coverage, dropped };
  });

  const scored = joints.filter((j) => j.dropped === null);
  if (scored.length === 0) {
    throw new DatasetError(`${spec.file}: no joint is both visible and consistent across the photos`);
  }
  const targets: Partial<Record<JointName, number>> = {};
  for (const j of scored) targets[j.joint] = Math.min(180, Math.max(0, Math.round(j.median)));

  // Each photo's mean error against the targets, over the scored joints it shows.
  const errors = samples
    .map((s) => {
      const present = scored.filter((j) => s[j.joint] !== undefined);
      if (present.length === 0) return null;
      return present.reduce((sum, j) => sum + Math.abs(s[j.joint]! - targets[j.joint]!), 0) / present.length;
    })
    .filter((e): e is number => e !== null)
    .sort((a, b) => a - b);
  const wanted = Math.ceil(quantile(errors, options.goodShare) / 5) * 5;
  const tolerance = Math.min(options.maxToleranceDeg, Math.max(options.minToleranceDeg, wanted));

  return {
    move: {
      id: spec.id,
      name: spec.name,
      joints: targets,
      tolerance,
      beats: { ...options.beats },
      formRules: [...spec.formRules],
    },
    photos: samples.length,
    mirrored,
    joints,
    goodShare: errors.filter((e) => e <= tolerance).length / errors.length,
  };
}

/**
 * The moves list with `added` merged in: a move whose id is already there
 * replaces it in place, the rest go on the end.
 */
export function mergeMoves(existing: readonly Move[], added: readonly Move[]): Move[] {
  const byId = new Map(added.map((move) => [move.id, move]));
  const merged = existing.map((move) => byId.get(move.id) ?? move);
  const present = new Set(existing.map((move) => move.id));
  return [...merged, ...added.filter((move) => !present.has(move.id))];
}

/** moves.json text in the file's hand-written layout: joints one per line, beats and rules inline. */
export function formatMoves(moves: readonly Move[]): string {
  const entries = moves.map((move) => {
    const joints = Object.entries(move.joints)
      .map(([joint, angle]) => `      ${JSON.stringify(joint)}: ${angle}`)
      .join(',\n');
    const { reach, hold, release } = move.beats;
    return [
      '  {',
      `    "id": ${JSON.stringify(move.id)},`,
      `    "name": ${JSON.stringify(move.name)},`,
      '    "joints": {',
      joints,
      '    },',
      `    "tolerance": ${move.tolerance},`,
      `    "beats": { "reach": ${reach}, "hold": ${hold}, "release": ${release} },`,
      `    "formRules": [${move.formRules.map((rule) => JSON.stringify(rule)).join(', ')}]`,
      '  }',
    ].join('\n');
  });
  return `[\n${entries.join(',\n')}\n]\n`;
}
