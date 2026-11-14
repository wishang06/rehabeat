import { expect, it } from 'vitest';
import { MOVES } from '../moves';
import { consistency, findings } from './analysis';
import { daysBetween } from './days';
import { CARE_KEY, createDemoClinic } from './demoClinic';
import { newPrescriptionBody } from './prescription';
import { samplePatients } from './sampleClinic';
import { buildSession } from './session';

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}
const now = () => new Date(2026, 10, 14, 12, 0);
const body = { ...newPrescriptionBody('2026-11-14'), moveIds: ['side-arm-raise'] };

it('opens with You and four sample patients', async () => {
  const files = await createDemoClinic(memory(), now).listPatients();
  expect(files.map((f) => f.patient.name)).toEqual(['You', 'Maya Chen', 'Sam Ortiz', 'Priya Nair', 'Jonah Reed']);
  expect(files[0].prescriptions).toEqual([]);
  expect(files.slice(1).every((f) => f.patient.sample && f.sessions.length > 0)).toBe(true);
});

it('gives the samples the stories the page shows', async () => {
  const files = await createDemoClinic(memory(), now).listPatients();
  const status = (name: string) => {
    const f = files.find((x) => x.patient.name === name)!;
    return consistency(f.prescriptions, f.sessions, '2026-11-14').statusText;
  };
  expect(status('Maya Chen')).toBe('On track');
  expect(status('Sam Ortiz')).toBe('No sessions for 4 days');
  expect(status('Jonah Reed')).toBe('Behind');
  const maya = files[1];
  const spots = findings(maya.sessions, MOVES);
  expect(spots[0].kind).toBe('breach');
  expect(spots.find((f) => f.kind === 'joint')).toMatchObject({ joint: 'rightShoulder', trend: 'better' });
  expect(spots.some((f) => f.kind === 'form' && f.ruleId === 'trunk-lean')).toBe(true);
});

it('keeps sample history current and repeatable', () => {
  expect(samplePatients('2026-11-14')).toEqual(samplePatients('2026-11-14'));
  const last = (day: string) => samplePatients(day)[0].sessions.at(-1)!.day;
  expect(daysBetween(last('2026-11-14'), '2026-11-14')).toBe(daysBetween(last('2027-02-01'), '2027-02-01'));
});

it('carries a program from the doctor to the patient and a session back', async () => {
  const store = createDemoClinic(memory(), now);
  expect(await store.myProgram()).toBeNull();
  const rx = await store.savePrescription('you', body);
  expect(rx.version).toBe(1);
  const mine = await store.myProgram();
  expect(mine).toMatchObject({ doctorName: 'Dr. Okafor', prescription: { id: rx.id }, sessions: [] });
  const session = buildSession({
    prescription: rx,
    moveCount: 1,
    details: [
      { cycleIndex: 0, moveId: 'side-arm-raise', score: 70, label: 'Good', timingOffsetMs: 0, joints: {}, formFlags: [], overLimit: [] },
    ],
    summary: { points: 50, moves: 1, perfect: 0, good: 1, miss: 0, bestCombo: 1, accuracy: 70, durationSec: 20 },
    songId: 's',
    startedAt: now(),
  })!;
  await store.saveSession(session);
  await store.saveSession(session); // a retry
  expect((await store.listPatients())[0].sessions).toHaveLength(1);
});

it('versions an edit to a sample patient and survives a reload', async () => {
  const storage = memory();
  const first = createDemoClinic(storage, now);
  const maya = (await first.listPatients())[1];
  const saved = await first.savePrescription(maya.patient.id, {
    ...maya.prescriptions.at(-1)!,
    note: 'Stop at shoulder height.',
  });
  expect(saved.version).toBe(maya.prescriptions.length + 1);
  const again = (await createDemoClinic(storage, now).listPatients())[1];
  expect(again.prescriptions.at(-1)!.note).toBe('Stop at shoulder height.');
});

it('adds a patient', async () => {
  const store = createDemoClinic(memory(), now);
  const p = await store.addPatient({ name: 'Ada', condition: 'Left elbow' });
  expect(p).toMatchObject({ name: 'Ada', condition: 'Left elbow', sample: false, joinCode: null });
  expect((await store.listPatients()).at(-1)!.patient.id).toBe(p.id);
});

it('falls back to the default clinic when stored data is unreadable', async () => {
  for (const bad of ['{not json', '[]', '{"prescriptions":7,"sessions":"x","patients":null}']) {
    const files = await createDemoClinic(memory({ [CARE_KEY]: bad }), now).listPatients();
    expect(files).toHaveLength(5);
    expect(files[0].prescriptions).toEqual([]);
  }
});

it('works with no storage, and says so when a write is refused', async () => {
  expect(await createDemoClinic(undefined, now).listPatients()).toHaveLength(5);
  const full = {
    getItem: () => null,
    setItem: () => {
      throw new Error('quota');
    },
    removeItem: () => undefined,
  };
  await expect(createDemoClinic(full, now).savePrescription('you', body)).rejects.toThrow(
    'This browser would not save the change.',
  );
});

it('resets', async () => {
  const store = createDemoClinic(memory(), now);
  await store.savePrescription('you', body);
  store.reset!();
  expect(await store.myProgram()).toBeNull();
});
