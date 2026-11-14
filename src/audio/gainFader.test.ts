import { describe, expect, it } from 'vitest';
import { GainFader, type RampParam } from './gainFader';

interface AutomationEvent {
  kind: 'set' | 'ramp';
  value: number;
  time: number;
}

/**
 * A stand-in for AudioParam that keeps the automation timeline and can
 * evaluate it the way Web Audio does: a set event holds its value, a ramp
 * event interpolates from the event before it.
 */
class FakeParam implements RampParam {
  readonly calls: string[] = [];
  private events: AutomationEvent[] = [];
  private readonly initial: number;

  constructor(initial = 0) {
    this.initial = initial;
  }

  cancelScheduledValues(cancelTime: number): void {
    this.calls.push(`cancel@${cancelTime}`);
    this.events = this.events.filter((event) => event.time < cancelTime);
  }

  setValueAtTime(value: number, startTime: number): void {
    this.calls.push(`set ${value}@${startTime}`);
    this.insert({ kind: 'set', value, time: startTime });
  }

  linearRampToValueAtTime(value: number, endTime: number): void {
    this.calls.push(`ramp ${value}@${endTime}`);
    this.insert({ kind: 'ramp', value, time: endTime });
  }

  valueAt(time: number): number {
    let value = this.initial;
    let since = 0;
    for (const event of this.events) {
      if (event.time <= time) {
        value = event.value;
        since = event.time;
      } else {
        if (event.kind === 'ramp') {
          value += ((event.value - value) * (time - since)) / (event.time - since);
        }
        break;
      }
    }
    return value;
  }

  private insert(event: AutomationEvent): void {
    this.events.push(event);
    this.events.sort((a, b) => a.time - b.time);
  }
}

describe('GainFader', () => {
  it('starts inactive and silent without touching the param', () => {
    const param = new FakeParam();
    const fader = new GainFader(param);
    expect(fader.active).toBe(false);
    expect(fader.valueAt(0)).toBe(0);
    expect(fader.valueAt(100)).toBe(0);
    expect(param.calls).toEqual([]);
  });

  it('ramps from 0 to 1 over 300 ms when activated', () => {
    const param = new FakeParam();
    const fader = new GainFader(param);

    expect(fader.setActive(true, 10)).toBe(true);

    expect(fader.active).toBe(true);
    expect(param.calls).toEqual(['cancel@10', 'set 0@10', 'ramp 1@10.3']);
    expect(param.valueAt(10)).toBe(0);
    expect(param.valueAt(10.15)).toBeCloseTo(0.5, 9);
    expect(param.valueAt(10.3)).toBe(1);
    expect(param.valueAt(60)).toBe(1);
  });

  it('schedules nothing when the state does not change', () => {
    const param = new FakeParam();
    const fader = new GainFader(param);

    expect(fader.setActive(false, 1)).toBe(false);
    expect(param.calls).toEqual([]);

    fader.setActive(true, 2);
    const callsAfterFirstRamp = param.calls.length;
    for (let frame = 1; frame <= 120; frame += 1) {
      expect(fader.setActive(true, 2 + frame / 60)).toBe(false);
    }
    expect(param.calls).toHaveLength(callsAfterFirstRamp);
  });

  it('ramps from 1 back to 0 after a completed fade-in', () => {
    const param = new FakeParam();
    const fader = new GainFader(param);
    fader.setActive(true, 10);

    expect(fader.setActive(false, 12)).toBe(true);

    expect(fader.active).toBe(false);
    expect(param.calls.slice(3)).toEqual(['cancel@12', 'set 1@12', 'ramp 0@12.3']);
    expect(param.valueAt(12.15)).toBeCloseTo(0.5, 9);
    expect(param.valueAt(12.3)).toBe(0);
  });

  it('reverses mid-ramp from the current value without a jump', () => {
    const param = new FakeParam();
    const fader = new GainFader(param);
    fader.setActive(true, 10);
    const justBeforeReversal = param.valueAt(10.1 - 1e-9);

    fader.setActive(false, 10.1);

    expect(justBeforeReversal).toBeCloseTo(1 / 3, 6);
    expect(param.valueAt(10.1)).toBeCloseTo(1 / 3, 9);
    expect(param.valueAt(10.25)).toBeCloseTo(1 / 6, 9);
    expect(param.valueAt(10.4)).toBe(0);
    expect(param.valueAt(11)).toBe(0);
  });

  it('stays continuous through several quick reversals', () => {
    const param = new FakeParam();
    const fader = new GainFader(param);
    const toggles: Array<[number, boolean]> = [
      [1, true],
      [1.2, false],
      [1.25, true],
      [1.26, false],
      [1.5, true],
    ];
    for (const [time, active] of toggles) {
      const before = param.valueAt(time - 1e-9);
      fader.setActive(active, time);
      expect(param.valueAt(time)).toBeCloseTo(before, 6);
      expect(fader.valueAt(time)).toBeCloseTo(before, 6);
    }
    expect(param.valueAt(1.8)).toBe(1);
  });

  it('tracks the value it scheduled', () => {
    const param = new FakeParam();
    const fader = new GainFader(param, 0.5);
    fader.setActive(true, 4);
    for (const time of [3, 4, 4.1, 4.25, 4.5, 9]) {
      expect(fader.valueAt(time)).toBeCloseTo(param.valueAt(time), 9);
    }
  });

  it('honours a custom ramp length', () => {
    const param = new FakeParam();
    new GainFader(param, 1).setActive(true, 0);
    expect(param.calls).toEqual(['cancel@0', 'set 0@0', 'ramp 1@1']);
  });
});
