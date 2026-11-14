import { expect, it } from 'vitest';
import { newPrescriptionBody, type PatientFile, type Prescription } from '../care';
import { draftFor, isDirty, moveDown, moveUp, setLimit, sparkPoints, startNewProgram, toggleMove } from './editor';

const body = { ...newPrescriptionBody('2026-11-14'), moveIds: ['a', 'b', 'c'] };
const file = (prescriptions: Prescription[] = []): PatientFile => ({
  patient: { id: 'p', name: 'P', condition: '', joinCode: null, joined: true, sample: false },
  prescriptions,
  sessions: [],
});

it('ticks a move on at the end and off again', () => {
  expect(toggleMove(body, 'd').moveIds).toEqual(['a', 'b', 'c', 'd']);
  expect(toggleMove(body, 'b').moveIds).toEqual(['a', 'c']);
});

it('reorders, and stays put at the ends', () => {
  expect(moveUp(body, 'c').moveIds).toEqual(['a', 'c', 'b']);
  expect(moveUp(body, 'a').moveIds).toEqual(['a', 'b', 'c']);
  expect(moveDown(body, 'a').moveIds).toEqual(['b', 'a', 'c']);
  expect(moveDown(body, 'c').moveIds).toEqual(['a', 'b', 'c']);
});

it('sets and clears a limit without touching the others', () => {
  const one = setLimit(body, 'leftKnee', { kind: 'off' });
  const two = setLimit(one, 'rightShoulder', { kind: 'range', maxDeg: 90 });
  expect(two.limits).toEqual({ leftKnee: { kind: 'off' }, rightShoulder: { kind: 'range', maxDeg: 90 } });
  expect(setLimit(two, 'leftKnee', null).limits).toEqual({ rightShoulder: { kind: 'range', maxDeg: 90 } });
  expect(body.limits).toEqual({});
});

it('drafts from the newest version, or a new program', () => {
  expect(draftFor(file(), '2026-11-14')).toEqual(newPrescriptionBody('2026-11-14'));
  const v1 = { ...body, id: 'rx1', version: 1, createdAt: '2026-11-10T09:00:00', startDate: '2026-11-10' };
  const draft = draftFor(file([v1]), '2026-11-14');
  expect(draft.startDate).toBe('2026-11-10');
  expect('id' in draft).toBe(false);
  expect(isDirty(draft, file([v1]), '2026-11-14')).toBe(false);
  expect(isDirty({ ...draft, note: 'x' }, file([v1]), '2026-11-14')).toBe(true);
  expect(startNewProgram(draft, '2026-11-14').startDate).toBe('2026-11-14');
});

it('scales a trend line to its box', () => {
  expect(sparkPoints([25, 14], 96, 34, 5)).toEqual([
    [5, 5],
    [91, 15.56],
  ]);
  expect(sparkPoints([0, 0], 96, 34, 5)).toEqual([
    [5, 29],
    [91, 29],
  ]);
  expect(sparkPoints([3], 96, 34, 5)).toEqual([[91, 5]]);
  expect(sparkPoints([], 96, 34, 5)).toEqual([]);
});
