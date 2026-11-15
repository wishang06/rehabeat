import { describe, expect, it } from 'vitest';
import type { Move } from '../../types';
import { laneGap, laneIndex, movesLeft, upcomingMoves } from './lane';

const move = (id: string, beats = { reach: 2, hold: 4, release: 2 }): Move => ({
  id,
  name: id,
  joints: {},
  tolerance: 20,
  beats,
  formRules: [],
});
const moves = [move('a'), move('b'), move('c')];
const ref = (id: string) => ({ id, name: id });

describe('laneGap', () => {
  it('is a whole card before anything is known', () => {
    expect(laneGap(null, moves)).toBe(1);
  });

  it('waits a whole card below the panel through the count-in, where the first move already is', () => {
    expect(laneGap({ phase: 'ready', phaseProgress: 0, move: null }, moves)).toBe(1);
    expect(laneGap({ phase: 'ready', phaseProgress: 0.6, move: null }, moves)).toBe(1);
    expect(laneGap({ phase: 'ready', phaseProgress: 1, move: null }, moves)).toBe(1);
  });

  it('falls from 1 to 0 across a whole move, by beats', () => {
    // reach 2, hold 4, release 2: eight beats.
    expect(laneGap({ phase: 'reach', phaseProgress: 0, move: ref('a') }, moves)).toBe(1);
    expect(laneGap({ phase: 'reach', phaseProgress: 0.5, move: ref('a') }, moves)).toBeCloseTo(7 / 8, 9);
    expect(laneGap({ phase: 'hold', phaseProgress: 0, move: ref('a') }, moves)).toBeCloseTo(6 / 8, 9);
    expect(laneGap({ phase: 'hold', phaseProgress: 0.5, move: ref('a') }, moves)).toBeCloseTo(4 / 8, 9);
    expect(laneGap({ phase: 'release', phaseProgress: 0, move: ref('a') }, moves)).toBeCloseTo(2 / 8, 9);
    expect(laneGap({ phase: 'release', phaseProgress: 1, move: ref('a') }, moves)).toBe(0);
  });

  it("uses the move's own beats, which a program can change", () => {
    const long = [move('slow', { reach: 4, hold: 8, release: 4 }), move('no-reach', { reach: 0, hold: 4, release: 4 })];
    expect(laneGap({ phase: 'hold', phaseProgress: 0.5, move: ref('slow') }, long)).toBeCloseTo(8 / 16, 9);
    expect(laneGap({ phase: 'hold', phaseProgress: 0, move: ref('no-reach') }, long)).toBe(1);
  });

  it('never leaves 0 to 1, and copes with a move it does not know', () => {
    expect(laneGap({ phase: 'hold', phaseProgress: 7, move: ref('a') }, moves)).toBeCloseTo(2 / 8, 9);
    expect(laneGap({ phase: 'reach', phaseProgress: -3, move: ref('a') }, moves)).toBe(1);
    expect(laneGap({ phase: 'hold', phaseProgress: 0.25, move: ref('zzz') }, moves)).toBe(0.75);
  });
});

describe('laneIndex', () => {
  it('is the move number less one, and -1 in the count-in', () => {
    expect(laneIndex(moves, 0, null)).toBe(-1);
    expect(laneIndex(moves, 1, 'a')).toBe(0);
    expect(laneIndex(moves, 3, 'c')).toBe(2);
  });

  it('follows the frame when it is a move ahead of the run', () => {
    expect(laneIndex(moves, 0, 'a')).toBe(0);
    expect(laneIndex(moves, 1, 'b')).toBe(1);
    // The last move hands over to the first.
    expect(laneIndex(moves, 3, 'a')).toBe(0);
  });

  it('keeps the run position when the frame names some other move', () => {
    expect(laneIndex(moves, 1, 'c')).toBe(0);
    expect(laneIndex([], 1, 'a')).toBe(0);
  });
});

describe('movesLeft', () => {
  it('is null in free play, which never ends by itself', () => {
    expect(movesLeft(3, 0, null)).toBeNull();
  });

  it('counts the rest of this round and the rounds after it', () => {
    expect(movesLeft(3, -1, { current: 1, total: 2 })).toBe(6);
    expect(movesLeft(3, 0, { current: 1, total: 2 })).toBe(5);
    expect(movesLeft(3, 2, { current: 1, total: 2 })).toBe(3);
    expect(movesLeft(3, 1, { current: 2, total: 2 })).toBe(1);
    expect(movesLeft(3, 2, { current: 2, total: 2 })).toBe(0);
  });
});

describe('upcomingMoves', () => {
  const ids = (list: Move[]) => list.map((item) => item.id);

  it('lists the moves after the one in play, looping', () => {
    expect(ids(upcomingMoves(moves, -1, 4, null))).toEqual(['a', 'b', 'c', 'a']);
    expect(ids(upcomingMoves(moves, 0, 4, null))).toEqual(['b', 'c', 'a', 'b']);
    expect(ids(upcomingMoves(moves, 2, 2, null))).toEqual(['a', 'b']);
  });

  it('stops where a program session ends', () => {
    expect(ids(upcomingMoves(moves, 1, 4, 1))).toEqual(['c']);
    expect(upcomingMoves(moves, 2, 4, 0)).toEqual([]);
  });

  it('is empty with no moves', () => {
    expect(upcomingMoves([], 0, 4, null)).toEqual([]);
  });
});
