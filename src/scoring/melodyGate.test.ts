import { describe, expect, it } from 'vitest';
import { MELODY_HOLD_OFF_BEATS, MelodyGate } from './melodyGate';

/** Half a beat at 60 BPM. Times below are binary-exact, so no boundary is lost to rounding. */
const HOLD_OFF = 0.5;

describe('MelodyGate', () => {
  it('holds off for half a beat', () => {
    expect(MELODY_HOLD_OFF_BEATS).toBe(0.5);
  });

  it('starts off and turns on at once', () => {
    const gate = new MelodyGate(HOLD_OFF);
    expect(gate.update(0, false)).toBe(false);
    expect(gate.update(0.016, true)).toBe(true);
  });

  it('stays on through a no shorter than the hold-off', () => {
    const gate = new MelodyGate(HOLD_OFF);
    gate.update(0, true);
    expect(gate.update(0.125, false)).toBe(true);
    expect(gate.update(0.5625, false)).toBe(true);
  });

  it('drops after the hold-off once the rule goes quiet', () => {
    const gate = new MelodyGate(HOLD_OFF);
    gate.update(0, true);
    gate.update(0.125, false);
    expect(gate.update(0.625, false)).toBe(false);
    expect(gate.update(5, false)).toBe(false);
  });

  it('a yes in between restarts the hold-off', () => {
    const gate = new MelodyGate(HOLD_OFF);
    gate.update(0, true);
    gate.update(0.125, false);
    gate.update(0.25, true);
    gate.update(0.375, false);
    expect(gate.update(0.8125, false)).toBe(true);
    expect(gate.update(0.875, false)).toBe(false);
  });

  it('reset turns it off', () => {
    const gate = new MelodyGate(HOLD_OFF);
    gate.update(0, true);
    gate.reset();
    expect(gate.update(0.01, false)).toBe(false);
  });
});
