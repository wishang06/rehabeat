import { describe, expect, it } from 'vitest';
import { easeOutCubic } from './ease';

describe('easeOutCubic', () => {
  it('runs from 0 to 1, fast at first', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875);
    expect(easeOutCubic(2)).toBe(1);
  });
});
