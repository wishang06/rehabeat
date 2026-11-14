import { expect, it } from 'vitest';
import { newPrescriptionBody } from '../prescription';
import type { Prescription, SessionRecord } from '../types';
import { consistency } from './consistency';

const rx = (over: Partial<Prescription> = {}): Prescription => ({
  ...newPrescriptionBody('2026-10-26'),
  moveIds: ['a'],
  id: 'rx1',
  version: 1,
  createdAt: '2026-10-26T10:00:00',
  ...over,
});
const sess = (day: string, completed = true): SessionRecord => ({
  id: day + completed,
  prescriptionId: 'rx1',
  startedAt: day + 'T18:00:00',
  day,
  songId: 's',
  durationSec: 60,
  roundsPrescribed: 3,
  roundsDone: completed ? 3 : 1,
  completed,
  summary: { points: 0, moves: 3, perfect: 0, good: 3, miss: 0, bestCombo: 3, accuracy: 70, durationSec: 60 },
  holds: [],
});

it('has nothing to show without a program', () => {
  expect(consistency([], [], '2026-11-14')).toMatchObject({
    weeks: [],
    thisWeek: null,
    programWeek: 0,
    statusText: 'No program',
  });
});

it('lays weeks out from the start date, across the clock change', () => {
  // start Mon 2026-10-26; today Sat 2026-11-14 is day 19, so week 3
  const c = consistency([rx()], [sess('2026-10-26'), sess('2026-11-01'), sess('2026-11-02')], '2026-11-14');
  expect(c.programWeek).toBe(3);
  expect(c.weeks.map((w) => w.done)).toEqual([2, 1, 0]);
  expect(c.weeks[0].days[6]).toMatchObject({ day: '2026-11-01', state: 'done' });
  expect(c.weeks[1].days[0]).toMatchObject({ day: '2026-11-02', state: 'done' });
  expect(c.weeks[2].days[5]).toMatchObject({ day: '2026-11-14', today: true, future: false });
  expect(c.weeks[2].days[6].future).toBe(true);
});

it('counts a day once, and a partial session not at all', () => {
  const c = consistency([rx()], [sess('2026-11-09'), sess('2026-11-09'), sess('2026-11-10', false)], '2026-11-10');
  expect(c.thisWeek).toEqual({ done: 1, prescribed: 5 });
  expect(c.weeks[2].days[1].state).toBe('partial');
});

it('is on track while the week can still be reached', () => {
  // week 3 is Nov 9-15; 3 done by Fri 13th, today + Sat + Sun = 3 left, target 5
  const c = consistency([rx()], [sess('2026-11-09'), sess('2026-11-10'), sess('2026-11-11')], '2026-11-13');
  expect(c.statusText).toBe('On track');
  expect(c.warn).toBe(false);
});

it('is behind once the week cannot be reached', () => {
  const c = consistency([rx()], [sess('2026-11-09'), sess('2026-11-13')], '2026-11-14');
  expect(c.statusText).toBe('Behind'); // 2 done + 2 days left < 5
  expect(c.warn).toBe(true);
});

it('says how long it has been quiet', () => {
  expect(consistency([rx()], [sess('2026-11-10')], '2026-11-14').statusText).toBe('No sessions for 4 days');
});

it('is not started before the first session and finished after the last week', () => {
  expect(consistency([rx()], [], '2026-10-27').statusText).toBe('Not started');
  expect(consistency([rx({ weeks: 2 })], [sess('2026-10-27')], '2026-11-14')).toMatchObject({
    statusText: 'Finished',
    programWeek: 3,
  });
  expect(consistency([rx({ weeks: 2 })], [sess('2026-10-27')], '2026-11-14').weeks[2].extra).toBe(true);
});

it('judges each week by the version in force at its end', () => {
  const v2 = rx({ id: 'rx2', version: 2, sessionsPerWeek: 3, createdAt: '2026-11-05T10:00:00' });
  expect(consistency([rx(), v2], [sess('2026-10-26')], '2026-11-14').weeks.map((w) => w.prescribed)).toEqual([5, 3, 3]);
});

it('starts over when a new program starts', () => {
  const next = rx({ id: 'rx2', version: 2, startDate: '2026-11-12', createdAt: '2026-11-12T10:00:00' });
  const c = consistency([rx(), next], [sess('2026-11-01'), sess('2026-11-13')], '2026-11-14');
  expect(c.programWeek).toBe(1);
  expect(c.weeks[0].done).toBe(1);
});
