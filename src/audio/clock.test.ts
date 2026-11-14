import { describe, expect, it } from 'vitest';
import { MasterClock, type ClockContext } from './clock';

const PERF_NOW = 50_000;
const perfNow = () => PERF_NOW;

describe('MasterClock', () => {
  it('reports the context time as now()', () => {
    const clock = new MasterClock({ currentTime: 12.5 }, perfNow);
    expect(clock.now()).toBe(12.5);
  });

  it('maps performance time through the output timestamp when it is usable', () => {
    const ctx: ClockContext = {
      currentTime: 10,
      outputLatency: 0.5,
      getOutputTimestamp: () => ({ contextTime: 9.9, performanceTime: 49_900 }),
    };
    const clock = new MasterClock(ctx, perfNow);

    expect(clock.fromPerformanceTime(49_900)).toBeCloseTo(9.9, 9);
    expect(clock.fromPerformanceTime(50_000)).toBeCloseTo(10.0, 9);
    expect(clock.fromPerformanceTime(49_400)).toBeCloseTo(9.4, 9);
  });

  it('falls back to currentTime minus output latency while the timestamp is all zeros', () => {
    const ctx: ClockContext = {
      currentTime: 3,
      outputLatency: 0.04,
      baseLatency: 0.01,
      getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }),
    };
    const clock = new MasterClock(ctx, perfNow);

    expect(clock.fromPerformanceTime(PERF_NOW)).toBeCloseTo(2.96, 9);
    expect(clock.fromPerformanceTime(PERF_NOW - 250)).toBeCloseTo(2.71, 9);
  });

  it('falls back when the timestamp is only half filled in', () => {
    const ctx: ClockContext = {
      currentTime: 3,
      getOutputTimestamp: () => ({ contextTime: 2.9 }),
    };
    expect(new MasterClock(ctx, perfNow).fromPerformanceTime(PERF_NOW)).toBe(3);
  });

  it('falls back when getOutputTimestamp is missing', () => {
    const clock = new MasterClock({ currentTime: 8, outputLatency: 0.1 }, perfNow);
    expect(clock.fromPerformanceTime(PERF_NOW - 100)).toBeCloseTo(7.8, 9);
  });

  it('uses baseLatency when outputLatency is absent, zero or NaN', () => {
    const latencies = [undefined, 0, Number.NaN];
    for (const outputLatency of latencies) {
      const clock = new MasterClock({ currentTime: 5, outputLatency, baseLatency: 0.02 }, perfNow);
      expect(clock.fromPerformanceTime(PERF_NOW)).toBeCloseTo(4.98, 9);
    }
  });

  it('assumes no latency when the context reports none', () => {
    const clock = new MasterClock({ currentTime: 5 }, perfNow);
    expect(clock.fromPerformanceTime(PERF_NOW)).toBe(5);
  });

  it('reports what is audible right now', () => {
    const ctx: ClockContext = {
      currentTime: 10,
      getOutputTimestamp: () => ({ contextTime: 9.95, performanceTime: 49_980 }),
    };
    const clock = new MasterClock(ctx, perfNow);
    expect(clock.audibleNow()).toBeCloseTo(9.97, 9);
    expect(clock.audibleNow()).toBe(clock.fromPerformanceTime(PERF_NOW));
  });

  it('follows the context as its time advances', () => {
    const ctx = { currentTime: 1 };
    const clock = new MasterClock(ctx, perfNow);
    ctx.currentTime = 2;
    expect(clock.now()).toBe(2);
    expect(clock.audibleNow()).toBe(2);
  });

  it('defaults to the real performance clock', () => {
    const clock = new MasterClock({ currentTime: 4 });
    expect(clock.audibleNow()).toBeCloseTo(4, 2);
  });
});
