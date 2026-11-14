import { describe, expect, it } from 'vitest';
import { JOINT_NAMES } from '../types';
import { MOVES, MoveFormatError, parseMove, parseMoves } from './index';

const valid = {
  id: 'test-move',
  name: 'Test Move',
  joints: { leftShoulder: 90 },
  tolerance: 20,
  beats: { reach: 2, hold: 4, release: 2 },
  formRules: [],
};

describe('moves.json', () => {
  it('holds the three placeholder moves', () => {
    expect(MOVES.map((move) => move.id)).toEqual([
      'overhead-arm-raise',
      'side-arm-raise',
      'standing-knee-raise',
    ]);
  });

  it('only targets known joints, with angles in range', () => {
    for (const move of MOVES) {
      const entries = Object.entries(move.joints);
      expect(entries.length).toBeGreaterThan(0);
      for (const [joint, angle] of entries) {
        expect(JOINT_NAMES).toContain(joint);
        expect(angle).toBeGreaterThanOrEqual(0);
        expect(angle).toBeLessThanOrEqual(180);
      }
    }
  });

  it('matches the placeholder targets from the brief', () => {
    const byId = Object.fromEntries(MOVES.map((move) => [move.id, move]));
    expect(byId['overhead-arm-raise'].joints).toEqual({
      leftShoulder: 170,
      rightShoulder: 170,
      leftElbow: 175,
      rightElbow: 175,
    });
    expect(byId['side-arm-raise'].joints).toMatchObject({ leftShoulder: 90, rightShoulder: 90 });
    expect(byId['standing-knee-raise'].joints).toEqual({ leftHip: 90, leftKnee: 90 });
  });
});

describe('parseMove', () => {
  it('accepts a well-formed move', () => {
    expect(parseMove(valid)).toEqual(valid);
  });

  it.each([
    ['a missing id', { ...valid, id: '' }, /"id"/],
    ['an unknown joint', { ...valid, joints: { leftWrist: 90 } }, /unknown joint "leftWrist"/],
    ['an out-of-range angle', { ...valid, joints: { leftShoulder: 200 } }, /between 0 and 180/],
    ['no joints', { ...valid, joints: {} }, /at least one joint/],
    ['a non-positive tolerance', { ...valid, tolerance: 0 }, /"tolerance"/],
    ['a zero-beat hold', { ...valid, beats: { reach: 2, hold: 0, release: 2 } }, /beats\.hold/],
    ['a fractional beat count', { ...valid, beats: { reach: 1.5, hold: 2, release: 2 } }, /beats\.reach/],
    ['formRules that is not a list', { ...valid, formRules: 'trunk-lean' }, /"formRules"/],
  ])('rejects %s', (_label, move, message) => {
    expect(() => parseMove(move)).toThrow(MoveFormatError);
    expect(() => parseMove(move)).toThrow(message);
  });
});

describe('parseMoves', () => {
  it('rejects an empty list and duplicate ids', () => {
    expect(() => parseMoves([])).toThrow(MoveFormatError);
    expect(() => parseMoves([valid, valid])).toThrow(/duplicate move id "test-move"/);
  });
});
