import { describe, expect, it } from 'vitest';
import type { Move } from '../types';
import { Routine } from './routine';

function move(id: string, reach: number, hold: number, release: number): Move {
  return {
    id,
    name: id,
    joints: { leftShoulder: 90 },
    tolerance: 20,
    beats: { reach, hold, release },
    formRules: [],
  };
}

const a = move('a', 2, 4, 2);
const b = move('b', 2, 2, 4);
const c = move('c', 1, 2, 1);

describe('Routine', () => {
  it('lays moves end to end from the start beat', () => {
    const routine = new Routine([a, b, c], 4);
    expect(routine.beatsPerLoop).toBe(20);
    expect(routine.cycle(0)).toMatchObject({
      move: a,
      startBeat: 4,
      holdStartBeat: 6,
      holdEndBeat: 10,
      endBeat: 12,
    });
    expect(routine.cycle(1)).toMatchObject({ move: b, startBeat: 12, holdStartBeat: 14, holdEndBeat: 16, endBeat: 20 });
    expect(routine.cycle(2)).toMatchObject({ move: c, startBeat: 20, endBeat: 24 });
  });

  it('loops back to the first move', () => {
    const routine = new Routine([a, b, c], 4);
    expect(routine.cycle(3)).toMatchObject({ index: 3, move: a, startBeat: 24, holdStartBeat: 26 });
    expect(routine.cycle(7)).toMatchObject({ move: b, startBeat: 52 });
  });

  it('finds the cycle for a beat position', () => {
    const routine = new Routine([a, b, c], 4);
    expect(routine.cycleAt(3.99)).toBeNull();
    expect(routine.cycleAt(4)?.index).toBe(0);
    expect(routine.cycleAt(11.99)?.index).toBe(0);
    expect(routine.cycleAt(12)?.index).toBe(1);
    expect(routine.cycleAt(23.5)?.index).toBe(2);
    expect(routine.cycleAt(24)?.index).toBe(3);
  });

  it('reports the phase, progress through it and beats left', () => {
    const routine = new Routine([a, b, c], 0);
    expect(routine.phaseAt(-0.1)).toBeNull();
    expect(routine.phaseAt(0)).toMatchObject({ phase: 'reach', progress: 0, beatsLeft: 2 });
    expect(routine.phaseAt(1.5)).toMatchObject({ phase: 'reach', progress: 0.75, beatsLeft: 1 });
    expect(routine.phaseAt(2)).toMatchObject({ phase: 'hold', progress: 0, beatsLeft: 4 });
    expect(routine.phaseAt(5)).toMatchObject({ phase: 'hold', progress: 0.75, beatsLeft: 1 });
    expect(routine.phaseAt(6)).toMatchObject({ phase: 'release', progress: 0, beatsLeft: 2 });
    expect(routine.phaseAt(7.5)).toMatchObject({ phase: 'release', progress: 0.75, beatsLeft: 1 });
  });

  it('handles moves with no reach or release beats', () => {
    const routine = new Routine([move('hold-only', 0, 2, 0), a], 0);
    expect(routine.phaseAt(0)).toMatchObject({ phase: 'hold' });
    expect(routine.phaseAt(1.9)).toMatchObject({ phase: 'hold' });
    expect(routine.phaseAt(2)).toMatchObject({ phase: 'reach', cycle: { move: a } });
  });

  it('refuses an empty move list', () => {
    expect(() => new Routine([])).toThrow();
  });
});
