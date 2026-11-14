import { expect, it } from 'vitest';
import { MOVES } from '../moves';
import { newPrescriptionBody } from './prescription';
import { freePlan, programView, sentView } from './programView';
import type { HoldRecord, MyProgram, Prescription, SessionRecord } from './types';

const rx: Prescription = {
  ...newPrescriptionBody('2026-11-09'),
  moveIds: ['side-arm-raise', 'overhead-arm-raise', 'standing-knee-raise'],
  rounds: 3,
  limits: { rightShoulder: { kind: 'range', maxDeg: 90 }, leftKnee: { kind: 'off' } },
  note: 'Keep your trunk tall.',
  id: 'rx1',
  version: 1,
  createdAt: '2026-11-09T09:00:00',
};
const program = (sessions: SessionRecord[] = []): MyProgram => ({ doctorName: 'Dr. Okafor', prescription: rx, sessions });

it("describes the program in the patient's words", () => {
  const v = programView(program(), MOVES, '2026-11-14');
  expect(v).toMatchObject({
    doctorName: 'Dr. Okafor',
    moveNames: ['Side Arm Raise', 'Overhead Arm Raise'],
    rounds: 3,
    limits: ['Right shoulder: raise up to 90°', 'Left knee: off'],
    week: { done: 0, prescribed: 5 },
    doneToday: false,
    finished: false,
    note: 'Keep your trunk tall.',
    playable: true,
  });
  expect(v.plan.rounds).toBe(3);
  expect(v.plan.moves.map((m) => m.id)).toEqual(['side-arm-raise', 'overhead-arm-raise']);
  expect(v.plan.moves[1].joints.rightShoulder).toBe(90);
  expect(v.plan.limits).toEqual(rx.limits);
});

it('is not playable when the limits leave nothing', () => {
  const none = { ...program(), prescription: { ...rx, moveIds: ['standing-knee-raise'] } };
  expect(programView(none, MOVES, '2026-11-14').playable).toBe(false);
});

it('runs free play through the limits, and unchanged with no program', () => {
  expect(freePlan(null, MOVES)).toEqual({ moves: MOVES, rounds: null, limits: {} });
  const plan = freePlan(program(), MOVES);
  expect(plan.moves.some((m) => m.id === 'standing-knee-raise')).toBe(false);
  expect(plan.moves.find((m) => m.id === 'overhead-arm-raise')!.joints.rightShoulder).toBe(90);
});

it('says what was sent', () => {
  const hold: HoldRecord = {
    cycleIndex: 0,
    round: 1,
    moveId: 'side-arm-raise',
    score: 78,
    label: 'Good',
    timingOffsetMs: 0,
    joints: { rightShoulder: { target: 90, meanError: -12, seen: 1 } },
    formFlags: [],
    overLimit: [],
  };
  const session: SessionRecord = {
    id: 's1',
    prescriptionId: 'rx1',
    startedAt: '2026-11-14T18:00:00',
    day: '2026-11-14',
    songId: 's',
    durationSec: 60,
    roundsPrescribed: 3,
    roundsDone: 3,
    completed: true,
    summary: { points: 0, moves: 1, perfect: 0, good: 1, miss: 0, bestCombo: 1, accuracy: 78, durationSec: 60 },
    holds: [hold],
  };
  expect(sentView(program(), session, MOVES, '2026-11-14')).toEqual({
    average: 78,
    holds: 1,
    week: { done: 1, prescribed: 5 },
    workOn: 'Side Arm Raise: right shoulder stops 12° short.',
    partial: false,
  });
  expect(sentView(program(), { ...session, completed: false }, MOVES, '2026-11-14')).toMatchObject({
    week: { done: 0, prescribed: 5 },
    partial: true,
  });
});
