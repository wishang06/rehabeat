import { describe, expect, it } from 'vitest';
import { OneEuroFilter } from './oneEuro';

const FRAME = 1 / 30;

function variance(values: number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
}

/** Deterministic jitter: three sines well above the filter's cutoff at 30 fps. */
function jitter(i: number): number {
  return Math.sin(i * 2.3) + Math.sin(i * 3.7 + 1) + Math.sin(i * 5.1 + 2);
}

/** Feeds a 300 deg/s ramp for one second and returns how far the output trails. */
function rampLag(beta: number): number {
  const filter = new OneEuroFilter({ minCutoff: 1, beta, dCutoff: 1 });
  let input = 0;
  let output = 0;
  for (let i = 0; i <= 30; i++) {
    input = 300 * i * FRAME;
    output = filter.filter(input, i * FRAME);
  }
  return input - output;
}

describe('OneEuroFilter', () => {
  it('returns the first sample unchanged', () => {
    expect(new OneEuroFilter().filter(42.5, 10)).toBe(42.5);
    expect(new OneEuroFilter({ minCutoff: 0.1, beta: 3 }).filter(-7, 0)).toBe(-7);
  });

  it('keeps a constant signal constant', () => {
    const filter = new OneEuroFilter({ minCutoff: 1.5, beta: 0.02, dCutoff: 1 });
    for (let i = 0; i < 100; i++) {
      expect(filter.filter(90, i * FRAME)).toBe(90);
    }
  });

  it('weights a new sample by 1 / (1 + tau / dt)', () => {
    // With a 1 Hz cutoff tau is 1 / (2 pi); a dt equal to tau gives a weight of 1/2.
    const dt = 1 / (2 * Math.PI);
    const filter = new OneEuroFilter({ minCutoff: 1, beta: 0 });
    filter.filter(0, 0);
    expect(filter.filter(10, dt)).toBeCloseTo(5, 10);
    expect(filter.filter(10, 2 * dt)).toBeCloseTo(7.5, 10);
  });

  it('raises the cutoff by beta times the low-passed derivative', () => {
    // dt = tau at 1 Hz, so the derivative filter also has a weight of 1/2.
    // The raw derivative is 10 / dt = 20 pi; low-passed from 0 it is 10 pi.
    // beta = 1 / (10 pi) then lifts the cutoff from 1 Hz to 2 Hz, which halves
    // tau and makes the weight 1 / (1 + 1/2) = 2/3.
    const dt = 1 / (2 * Math.PI);
    const filter = new OneEuroFilter({ minCutoff: 1, beta: 1 / (10 * Math.PI), dCutoff: 1 });
    filter.filter(0, 0);
    expect(filter.filter(10, dt)).toBeCloseTo(20 / 3, 10);
  });

  it('attenuates jitter on a constant signal', () => {
    const filter = new OneEuroFilter({ minCutoff: 1, beta: 0 });
    const inputs: number[] = [];
    const outputs: number[] = [];
    for (let i = 0; i < 600; i++) {
      const input = 90 + jitter(i);
      const output = filter.filter(input, i * FRAME);
      if (i >= 60) {
        inputs.push(input);
        outputs.push(output);
      }
    }
    expect(variance(inputs)).toBeGreaterThan(1);
    expect(variance(outputs)).toBeLessThan(variance(inputs) * 0.1);
    const meanOutput = outputs.reduce((sum, value) => sum + value, 0) / outputs.length;
    expect(meanOutput).toBeCloseTo(90, 0);
  });

  it('tracks a fast ramp with less lag when beta is above zero', () => {
    const fixedLag = rampLag(0);
    const adaptiveLag = rampLag(0.05);
    expect(fixedLag).toBeGreaterThan(20);
    expect(adaptiveLag).toBeGreaterThan(0);
    expect(adaptiveLag).toBeLessThan(fixedLag / 4);
  });

  it('moves toward a step without overshooting it', () => {
    const filter = new OneEuroFilter({ minCutoff: 1.5, beta: 0.02 });
    filter.filter(0, 0);
    let previous = 0;
    for (let i = 1; i <= 90; i++) {
      const output = filter.filter(100, i * FRAME);
      expect(output).toBeGreaterThan(previous);
      expect(output).toBeLessThanOrEqual(100);
      previous = output;
    }
    expect(previous).toBeGreaterThan(99);
  });

  it('starts over after reset', () => {
    const filter = new OneEuroFilter({ minCutoff: 1, beta: 0 });
    filter.filter(0, 0);
    expect(filter.filter(100, FRAME)).toBeLessThan(50);

    filter.reset();
    expect(filter.filter(100, 2 * FRAME)).toBe(100);
    // The old state is gone: this eases from 100, not from the pre-reset value.
    const next = filter.filter(50, 3 * FRAME);
    expect(next).toBeLessThan(100);
    expect(next).toBeGreaterThan(75);
  });

  it('stays finite when the timestamp repeats or goes backwards', () => {
    const filter = new OneEuroFilter({ minCutoff: 1.5, beta: 0.02 });
    filter.filter(10, 1);
    filter.filter(12, 1 + FRAME);

    const repeated = filter.filter(20, 1 + FRAME);
    expect(Number.isFinite(repeated)).toBe(true);
    expect(repeated).toBeGreaterThan(10);
    expect(repeated).toBeLessThan(20);

    const backwards = filter.filter(20, 0.5);
    expect(Number.isFinite(backwards)).toBe(true);
    expect(backwards).toBeGreaterThan(repeated);
    expect(backwards).toBeLessThan(20);

    // Time then carries on from the earlier timestamp as normal.
    const resumed = filter.filter(20, 0.5 + FRAME);
    expect(Number.isFinite(resumed)).toBe(true);
    expect(resumed).toBeGreaterThan(backwards);
    expect(resumed).toBeLessThanOrEqual(20);
  });

  it('stays finite when the second sample has the same timestamp as the first', () => {
    const filter = new OneEuroFilter({ minCutoff: 1, beta: 0.5 });
    filter.filter(0, 5);
    const output = filter.filter(30, 5);
    expect(Number.isFinite(output)).toBe(true);
    expect(output).toBeGreaterThan(0);
    expect(output).toBeLessThanOrEqual(30);
  });

  it('stays finite when a timestamp is not a number', () => {
    const filter = new OneEuroFilter();
    filter.filter(1, 0);
    expect(Number.isFinite(filter.filter(2, Number.NaN))).toBe(true);
    expect(Number.isFinite(filter.filter(3, FRAME))).toBe(true);
  });

  it('ignores a non-finite sample instead of absorbing it', () => {
    const filter = new OneEuroFilter();
    filter.filter(5, 0);
    expect(filter.filter(Number.NaN, FRAME)).toBe(5);
    expect(filter.filter(Number.POSITIVE_INFINITY, 2 * FRAME)).toBe(5);
    expect(filter.filter(5, 3 * FRAME)).toBe(5);
  });
});
