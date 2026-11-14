import { describe, expect, it } from 'vitest';
import { estimateKcal, isWeightKg, readWeight, showWeight } from './calories';

describe('estimateKcal', () => {
  it('estimates 2.3 MET for the time played', () => {
    expect(estimateKcal(180, 70)).toBeCloseTo(8.05, 5);
    expect(estimateKcal(3600, 100)).toBeCloseTo(230, 5);
  });

  it('uses 70 kg when no weight is set', () => {
    expect(estimateKcal(180, null)).toBeCloseTo(8.05, 5);
  });

  it('is zero for no time or a bad duration', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(estimateKcal(bad, 70)).toBe(0);
  });
});

describe('readWeight', () => {
  it('reads a weight in kg', () => {
    expect(readWeight('72.5', 'kg')).toEqual({ ok: true, kg: 72.5 });
  });

  it('takes a comma as the decimal point and ignores spaces around the number', () => {
    expect(readWeight(' 72,5 ', 'kg')).toEqual({ ok: true, kg: 72.5 });
  });

  it('reads a weight in lb as kg', () => {
    const read = readWeight('154', 'lb');
    expect(read.ok && read.kg).toBeCloseTo(69.85, 1);
  });

  it('treats an empty field as no weight', () => {
    expect(readWeight('  ', 'kg')).toEqual({ ok: true, kg: null });
  });

  it('refuses text and weights outside 30 to 200 kg', () => {
    for (const bad of ['abc', '7o', '29', '201', '-70', '1e3']) expect(readWeight(bad, 'kg')).toEqual({ ok: false });
    // 60 lb is 27 kg.
    expect(readWeight('60', 'lb')).toEqual({ ok: false });
  });
});

describe('showWeight', () => {
  it('shows a saved weight back in the unit it was typed in', () => {
    const read = readWeight('154', 'lb');
    expect(read.ok && read.kg !== null && showWeight(read.kg, 'lb')).toBe('154');
  });

  it('keeps one decimal and drops a trailing zero', () => {
    expect(showWeight(72.5, 'kg')).toBe('72.5');
    expect(showWeight(70, 'kg')).toBe('70');
  });
});

describe('isWeightKg', () => {
  it('accepts 30 to 200 kg and nothing else', () => {
    expect([30, 70, 200].every(isWeightKg)).toBe(true);
    expect([29.9, 200.1, Number.NaN, '70', null, undefined].some(isWeightKg)).toBe(false);
  });
});
