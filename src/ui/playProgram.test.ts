import { expect, it } from 'vitest';
import { Routine } from '../scoring';
import type { Move } from '../types';
import { easeOffText, phasePips, roundOf, sessionOver, type PlayPlan } from './playProgram';

const move = (id: string): Move => ({
  id,
  name: id,
  joints: { leftShoulder: 90 },
  tolerance: 20,
  beats: { reach: 2, hold: 4, release: 2 },
  formRules: [],
});
const plan: PlayPlan = { moves: [move('a'), move('b')], rounds: 2, limits: {} };
const routine = new Routine(plan.moves, 4); // 8 beats a move; the fourth cycle ends at beat 36

it('numbers rounds from 1 and stops at the last', () => {
  expect(roundOf(0, 2, 2)).toEqual({ current: 1, total: 2 });
  expect(roundOf(3, 2, 2)).toEqual({ current: 2, total: 2 });
  expect(roundOf(9, 2, 2)).toEqual({ current: 2, total: 2 });
  expect(roundOf(3, 2, null)).toBeNull();
});

it('ends only when the last cycle is over and scored', () => {
  expect(sessionOver(plan, routine, 35.9, 4)).toBe(false);
  expect(sessionOver(plan, routine, 36, 3)).toBe(false);
  expect(sessionOver(plan, routine, 36, 4)).toBe(true);
  expect(sessionOver({ ...plan, rounds: null }, routine, 999, 99)).toBe(false);
});

it('names the first joint to ease off', () => {
  expect(easeOffText([])).toBeNull();
  expect(easeOffText(['rightShoulder', 'leftKnee'])).toBe('Ease off your right shoulder');
});

it("draws the beat pips from the plan's own moves, not from moves.json", () => {
  // A program with a hold of 8 beats on a move whose own hold is 4.
  const long: Move = { ...move('side-arm-raise'), beats: { reach: 2, hold: 8, release: 2 } };
  expect(phasePips([long], 'side-arm-raise', 'hold', 8)).toEqual({ beats: long.beats, lit: 2 });
  expect(phasePips([long], 'side-arm-raise', 'hold', 1)).toEqual({ beats: long.beats, lit: 9 });
  expect(phasePips([long], 'side-arm-raise', 'release', 2)).toEqual({ beats: long.beats, lit: 10 });
  expect(phasePips([long], 'side-arm-raise', 'ready', 3)).toEqual({ beats: long.beats, lit: -1 });
  expect(phasePips([long], 'gone', 'hold', 1)).toEqual({ beats: null, lit: -1 });
});
