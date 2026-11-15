import { expect, it } from 'vitest';
import { newPrescriptionBody } from './prescription';
import { isDuplicate, isMissingTable, namedRefusal, prescriptionFromRow, sessionFromRow } from './supabaseClinic';

it('names the doctor when a join is refused because the player already has one', () => {
  expect(namedRefusal('You already have a doctor', 'Dr. Okafor')).toBe('You already have a doctor: Dr. Okafor');
  // Without a name to give, and for any other refusal, the message is left as it is.
  expect(namedRefusal('You already have a doctor', null)).toBe('You already have a doctor');
  expect(namedRefusal('That code was not found', 'Dr. Okafor')).toBe('That code was not found');
});

it('recognises a missing table and a duplicate row', () => {
  expect(isMissingTable({ code: 'PGRST205' })).toBe(true);
  expect(isMissingTable({ code: '42P01' })).toBe(true);
  // The join function is part of the same migration: without it the clinic is not set up either.
  expect(isMissingTable({ code: 'PGRST202' })).toBe(true);
  expect(isMissingTable({ code: '23505' })).toBe(false);
  expect(isMissingTable(null)).toBe(false);
  expect(isDuplicate({ code: '23505' })).toBe(true);
  expect(isDuplicate({})).toBe(false);
});

it('reads a prescription row, taking id, version and date from the columns', () => {
  const body = { ...newPrescriptionBody('2026-11-14'), moveIds: ['side-arm-raise'], id: 'wrong', version: 99 };
  expect(prescriptionFromRow({ id: 'rx1', version: 2, created_at: '2026-11-14T09:00:00Z', body })).toMatchObject({
    id: 'rx1',
    version: 2,
    createdAt: '2026-11-14T09:00:00Z',
    moveIds: ['side-arm-raise'],
    rounds: 3,
  });
});

it('skips rows it cannot read', () => {
  expect(prescriptionFromRow({ id: 'rx1', version: 1, created_at: 'x', body: null })).toBeNull();
  expect(prescriptionFromRow({ id: 'rx1', version: 1, created_at: 'x', body: { moveIds: 'no' } })).toBeNull();
  expect(sessionFromRow({ id: 's1', body: { holds: 'no' } })).toBeNull();
});
