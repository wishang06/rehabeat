import { describe, expect, it } from 'vitest';
import { MOVES } from '../moves';
import { limitText } from './labels';
import { applyPrescription, newPrescriptionBody, validatePrescription } from './prescription';

const pick = (id: string) => MOVES.find((m) => m.id === id)!;

describe('applyPrescription', () => {
  it('plays the listed moves in the listed order and skips unknown ids', () => {
    const { moves, changes } = applyPrescription(MOVES, {
      moveIds: ['side-arm-raise', 'gone', 'overhead-arm-raise'],
      holdBeats: null,
      limits: {},
    });
    expect(moves.map((m) => m.id)).toEqual(['side-arm-raise', 'overhead-arm-raise']);
    expect(changes).toEqual([]);
    expect(moves[0]).toEqual(pick('side-arm-raise'));
  });

  it('scales a target past a range limit down to the limit', () => {
    const { moves, changes } = applyPrescription(MOVES, {
      moveIds: ['overhead-arm-raise'],
      holdBeats: null,
      limits: { rightShoulder: { kind: 'range', maxDeg: 90 } },
    });
    expect(moves[0].joints.rightShoulder).toBe(90);
    expect(moves[0].joints.leftShoulder).toBe(170);
    expect(changes).toEqual([
      {
        moveId: 'overhead-arm-raise',
        name: 'Overhead Arm Raise',
        kind: 'scaled',
        joint: 'rightShoulder',
        text: 'Overhead Arm Raise plays as a raise to 90°',
      },
    ]);
    expect(pick('overhead-arm-raise').joints.rightShoulder).toBe(170); // the source move is untouched
  });

  it('leaves a target inside the limit alone', () => {
    const { moves, changes } = applyPrescription(MOVES, {
      moveIds: ['side-arm-raise'],
      holdBeats: null,
      limits: { rightShoulder: { kind: 'range', maxDeg: 120 } },
    });
    expect(moves[0].joints.rightShoulder).toBe(90);
    expect(changes).toEqual([]);
  });

  it('scales a bend limit on a knee', () => {
    const { moves } = applyPrescription(MOVES, {
      moveIds: ['standing-knee-raise'],
      holdBeats: null,
      limits: { leftKnee: { kind: 'range', maxDeg: 60 } },
    });
    expect(moves[0].joints.leftKnee).toBe(120);
  });

  it('removes a move that scores a joint that is off', () => {
    const { moves, changes } = applyPrescription(MOVES, {
      moveIds: ['side-arm-raise', 'standing-knee-raise'],
      holdBeats: null,
      limits: { leftKnee: { kind: 'off' } },
    });
    expect(moves.map((m) => m.id)).toEqual(['side-arm-raise']);
    expect(changes[0]).toMatchObject({
      kind: 'removed',
      joint: 'leftKnee',
      text: 'Standing Knee Raise removed: left knee is off',
    });
  });

  it('sets every hold to holdBeats', () => {
    const { moves } = applyPrescription(MOVES, { moveIds: ['standing-knee-raise'], holdBeats: 6, limits: {} });
    expect(moves[0].beats).toEqual({ reach: 2, hold: 6, release: 4 });
  });
});

describe('validatePrescription', () => {
  const ok = { ...newPrescriptionBody('2026-11-14'), moveIds: ['side-arm-raise'] };

  it('accepts a playable program', () => expect(validatePrescription(ok, MOVES)).toBeNull());

  it('needs a move', () => expect(validatePrescription({ ...ok, moveIds: [] }, MOVES)).toBe('Pick at least one move.'));

  it('refuses a program the limits empty out', () =>
    expect(validatePrescription({ ...ok, limits: { leftShoulder: { kind: 'off' } } }, MOVES)).toBe(
      'The limits remove every move. Loosen a limit or pick other moves.',
    ));

  it('refuses a program whose moves no longer exist', () =>
    expect(validatePrescription({ ...ok, moveIds: ['gone'] }, MOVES)).toBe('Pick at least one move.'));

  it('keeps numbers inside their bounds', () => {
    expect(validatePrescription({ ...ok, rounds: 0 }, MOVES)).toBe('Rounds must be between 1 and 10.');
    expect(validatePrescription({ ...ok, sessionsPerWeek: 8 }, MOVES)).toBe('Sessions a week must be between 1 and 7.');
    expect(validatePrescription({ ...ok, note: 'x'.repeat(501) }, MOVES)).toBe('The note is longer than 500 characters.');
  });
});

describe('limitText', () => {
  it('says limits the way a doctor does', () => {
    expect(limitText('rightShoulder', { kind: 'range', maxDeg: 90 })).toBe('Right shoulder: raise up to 90°');
    expect(limitText('leftKnee', { kind: 'range', maxDeg: 60 })).toBe('Left knee: bend up to 60°');
    expect(limitText('leftKnee', { kind: 'off' })).toBe('Left knee: off');
  });
});
