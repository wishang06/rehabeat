import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMoves } from '../../src/moves/index';
import type { Move } from '../../src/types';
import {
  DERIVE_DEFAULTS,
  LANDMARK_NAMES,
  POSES,
  alignSides,
  deriveMove,
  formatMoves,
  mergeMoves,
  mirror,
  parseCsv,
  sampleAngles,
  type SampleAngles,
} from './dataset';

const here = fileURLToPath(new URL('.', import.meta.url));

/** A CSV row with every landmark at `points` (default: the origin), all fully visible. */
function row(points: Partial<Record<(typeof LANDMARK_NAMES)[number], readonly [number, number]>>, visibility = 1) {
  const out: Record<string, string> = {};
  for (const name of LANDMARK_NAMES) {
    const [x, y] = points[name] ?? [0, 0];
    out[`${name}_x`] = String(x);
    out[`${name}_y`] = String(y);
    out[`${name}_z`] = '0.4';
    out[`${name}_vis`] = String(visibility);
  }
  return out;
}

/** Standing straight, arms out level to the sides (image y grows downward). */
const T_POSE = {
  LEFT_SHOULDER: [0.6, 0.3],
  LEFT_ELBOW: [0.7, 0.3],
  LEFT_WRIST: [0.8, 0.3],
  LEFT_HIP: [0.55, 0.6],
  LEFT_KNEE: [0.55, 0.8],
  LEFT_ANKLE: [0.55, 1.0],
  RIGHT_SHOULDER: [0.4, 0.3],
  RIGHT_ELBOW: [0.3, 0.3],
  RIGHT_WRIST: [0.2, 0.3],
  RIGHT_HIP: [0.45, 0.6],
  RIGHT_KNEE: [0.45, 0.8],
  RIGHT_ANKLE: [0.45, 1.0],
} as const;

describe('parseCsv', () => {
  it('reads a header, a BOM, quoted fields and CRLF line ends', () => {
    const text = '﻿,Label,a\r\n0,"img, (1).jpg",1.5\r\n1,"say ""hi""",2\r\n';
    expect(parseCsv(text)).toEqual([
      { '': '0', Label: 'img, (1).jpg', a: '1.5' },
      { '': '1', Label: 'say "hi"', a: '2' },
    ]);
  });
});

describe('sampleAngles', () => {
  it('measures the game joints in the image plane, ignoring z', () => {
    const angles = sampleAngles(row(T_POSE));
    expect(angles.leftElbow).toBeCloseTo(180);
    expect(angles.rightKnee).toBeCloseTo(180);
    expect(angles.leftHip).toBeCloseTo(180 - (Math.atan(0.05 / 0.3) * 180) / Math.PI);
    // Hip to shoulder is straight up, shoulder to elbow is out to the side.
    expect(angles.leftShoulder).toBeGreaterThan(90);
    expect(angles.leftShoulder).toBeLessThan(100);
  });

  it("leaves out joints whose landmarks are below the game's visibility cut-off", () => {
    expect(sampleAngles(row(T_POSE, 0.59))).toEqual({});
  });
});

describe('alignSides', () => {
  const bentLeft: SampleAngles = { leftKnee: 45, rightKnee: 178, leftHip: 120, rightHip: 178 };

  it('puts photos of either side onto the side most of them show', () => {
    const photos = [bentLeft, bentLeft, mirror(bentLeft), bentLeft, mirror(bentLeft)];
    const { samples, mirrored } = alignSides(photos);
    expect(mirrored).toBe(2);
    expect(samples.every((s) => s.leftKnee === 45 && s.rightKnee === 178)).toBe(true);
  });

  it('does not mirror side-on photos onto the side the camera never saw', () => {
    const sideOn: SampleAngles = { rightShoulder: 170, rightHip: 60 };
    const { samples, mirrored } = alignSides([sideOn, { rightShoulder: 172, rightHip: 55 }]);
    expect(mirrored).toBe(0);
    expect(samples.every((s) => s.leftShoulder === undefined)).toBe(true);
  });
});

describe('deriveMove', () => {
  const spec = { file: 'test.csv', id: 'test', name: 'Test', formRules: ['trunk-lean'] };

  it('scores the joints the photos agree on and sets a tolerance from their spread', () => {
    // Arms out level in every photo; the elbows bend anywhere between straight and 90.
    const rows = [0, 1, 2, 3].map((i) => {
      const bend = i * 0.55;
      return row({
        ...T_POSE,
        LEFT_WRIST: [0.7 + 0.1 * Math.cos(bend), 0.3 - 0.1 * Math.sin(bend)],
        RIGHT_WRIST: [0.3 - 0.1 * Math.cos(bend), 0.3 - 0.1 * Math.sin(bend)],
      });
    });
    const { move, joints } = deriveMove(spec, rows);
    expect(move).toMatchObject({ id: 'test', name: 'Test', formRules: ['trunk-lean'], beats: DERIVE_DEFAULTS.beats });
    expect(move.joints.rightKnee).toBe(180);
    expect(joints.find((j) => j.joint === 'leftElbow')?.dropped).toBe('photos disagree');
    expect(move.joints.leftElbow).toBeUndefined();
    expect(move.tolerance).toBe(DERIVE_DEFAULTS.minToleranceDeg);
  });

  it('gives a move the game loads for every pose in the dataset', () => {
    const moves = POSES.map((pose) => deriveMove(pose, parseCsv(readFileSync(join(here, 'poses', pose.file), 'utf8'))).move);
    expect(() => parseMoves(moves)).not.toThrow();
    for (const move of moves) {
      expect(move.tolerance).toBeGreaterThanOrEqual(DERIVE_DEFAULTS.minToleranceDeg);
      expect(move.tolerance).toBeLessThanOrEqual(DERIVE_DEFAULTS.maxToleranceDeg);
    }
  });
});

describe('mergeMoves and formatMoves', () => {
  const shipped = readFileSync(join(here, '../../src/moves/moves.json'), 'utf8');
  const existing = parseMoves(JSON.parse(shipped));

  it("writes moves.json in the file's own layout", () => {
    expect(formatMoves(existing)).toBe(shipped.replace(/\r\n/g, '\n'));
  });

  it('replaces a move with the same id in place and appends new ones', () => {
    const changed: Move = { ...existing[0], tolerance: 99 };
    const added: Move = { ...existing[0], id: 'new-move' };
    const merged = mergeMoves(existing, [added, changed]);
    expect(merged.map((m) => m.id)).toEqual([...existing.map((m) => m.id), 'new-move']);
    expect(merged[0].tolerance).toBe(99);
  });
});
