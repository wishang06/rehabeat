import { describe, expect, it } from 'vitest';
import { LimitWatcher, angleForMovement, movementOf, type JointLimits } from './limits';

describe('movement', () => {
  it('reads a shoulder as its own angle', () => {
    expect(movementOf('rightShoulder', 90)).toBe(90);
    expect(angleForMovement('rightShoulder', 90)).toBe(90);
  });

  it('reads elbows, hips and knees as the bend from straight', () => {
    expect(movementOf('leftKnee', 120)).toBe(60);
    expect(angleForMovement('leftHip', 90)).toBe(90);
    expect(angleForMovement('leftElbow', 30)).toBe(150);
  });
});

describe('LimitWatcher', () => {
  const limits: JointLimits = { rightShoulder: { kind: 'range', maxDeg: 90 }, leftKnee: { kind: 'off' } };

  it('ignores movement inside the limit plus the margin', () => {
    const w = new LimitWatcher(limits);
    expect(w.update(0, { rightShoulder: 100 })).toEqual([]);
    expect(w.update(1, { rightShoulder: 100 })).toEqual([]);
  });

  it('flags a joint past the margin only after it persists', () => {
    const w = new LimitWatcher(limits);
    expect(w.update(0, { rightShoulder: 101 })).toEqual([]);
    expect(w.update(0.5, { rightShoulder: 120 })).toEqual([]);
    expect(w.update(0.51, { rightShoulder: 120 })).toEqual(['rightShoulder']);
  });

  it('starts over when the joint comes back or goes out of view', () => {
    const w = new LimitWatcher(limits);
    w.update(0, { rightShoulder: 120 });
    w.update(0.4, { rightShoulder: 80 });
    expect(w.update(0.8, { rightShoulder: 120 })).toEqual([]);
    w.update(1.0, {});
    expect(w.update(1.4, { rightShoulder: 120 })).toEqual([]);
  });

  it('never flags a joint that is off', () => {
    const w = new LimitWatcher(limits);
    w.update(0, { leftKnee: 40 });
    expect(w.update(2, { leftKnee: 40 })).toEqual([]);
  });

  it('watches a bend limit on a knee', () => {
    const w = new LimitWatcher({ leftKnee: { kind: 'range', maxDeg: 60 } });
    w.update(0, { leftKnee: 100 }); // 80 degrees of bend
    expect(w.update(0.6, { leftKnee: 100 })).toEqual(['leftKnee']);
  });
});
