import { expect, it } from 'vitest';
import type { HoldDetail } from '../scoring';
import { newPrescriptionBody } from './prescription';
import { buildSession } from './session';

const rx = {
  ...newPrescriptionBody('2026-11-10'),
  moveIds: ['a', 'b'],
  rounds: 2,
  id: 'rx1',
  version: 1,
  createdAt: '2026-11-10T09:00:00.000Z',
};
const detail = (i: number): HoldDetail => ({
  cycleIndex: i,
  moveId: i % 2 ? 'b' : 'a',
  score: 70,
  label: 'Good',
  timingOffsetMs: 0,
  joints: {},
  formFlags: [],
  overLimit: [],
});
const summary = { points: 0, moves: 0, perfect: 0, good: 0, miss: 0, bestCombo: 0, accuracy: 70, durationSec: 42 };
const at = new Date(2026, 10, 14, 23, 59);
const build = (n: number) =>
  buildSession({
    prescription: rx,
    moveCount: 2,
    details: Array.from({ length: n }, (_, i) => detail(i)),
    summary,
    songId: 'past-sadness',
    startedAt: at,
    newId: () => 'id1',
  });

it('saves nothing when no hold was scored', () => expect(build(0)).toBeNull());

it('marks a full session completed and numbers the rounds', () => {
  const s = build(4)!;
  expect(s).toMatchObject({
    id: 'id1',
    prescriptionId: 'rx1',
    day: '2026-11-14',
    songId: 'past-sadness',
    durationSec: 42,
    roundsPrescribed: 2,
    roundsDone: 2,
    completed: true,
  });
  expect(s.holds.map((h) => h.round)).toEqual([1, 1, 2, 2]);
});

it('marks an early finish partial', () => expect(build(3)).toMatchObject({ roundsDone: 1, completed: false }));

it('drops holds scored after the last round', () => expect(build(6)!.holds).toHaveLength(4));
