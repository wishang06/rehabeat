import { expect, it } from 'vitest';
import { newPrescriptionBody } from './prescription';
import { isDuplicate, isMissingTable, prescriptionFromRow, sessionFromRow } from './supabaseClinic';

it('recognises a missing table and a duplicate row', () => {
  expect(isMissingTable({ code: 'PGRST205' })).toBe(true);
  expect(isMissingTable({ code: '42P01' })).toBe(true);
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
