import { expect, it } from 'vitest';
import { addDays, daysBetween } from './days';

it('counts whole days across a month end and the clock change', () => {
  expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
  expect(daysBetween('2026-10-30', '2026-11-02')).toBe(3); // US clocks go back on 2026-11-01
  expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2); // and forward on 2026-03-08
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
});
