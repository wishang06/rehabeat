import { describe, expect, it } from 'vitest';
import { FigureEaser, POSE_EASE_MS, easeOutCubic, type FigureState } from './ease';
import { REST_POSE } from './silhouette';

const raised: FigureState = { pose: { ...REST_POSE, leftShoulder: 170, rightShoulder: 170 }, offset: 0 };
const resting: FigureState = { pose: REST_POSE, offset: 1 };

describe('easeOutCubic', () => {
  it('runs from 0 to 1, fast at first', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875);
    expect(easeOutCubic(2)).toBe(1);
  });
});

describe('FigureEaser', () => {
  it('shows the first target straight away', () => {
    expect(new FigureEaser().update(raised, 1000)).toEqual(raised);
  });

  it(`eases to a new target over ${POSE_EASE_MS} ms`, () => {
    const easer = new FigureEaser();
    easer.update(resting, 0);
    easer.update(raised, 1000);
    const halfway = easer.update(raised, 1000 + POSE_EASE_MS / 2);
    expect(halfway.pose.leftShoulder).toBeGreaterThan(8 + (170 - 8) / 2);
    expect(halfway.pose.leftShoulder).toBeLessThan(170);
    expect(halfway.offset).toBeGreaterThan(0);
    expect(halfway.offset).toBeLessThan(0.5);
    expect(easer.update(raised, 1000 + POSE_EASE_MS)).toEqual(raised);
  });

  it('does not restart the ease when it is handed the same target again', () => {
    const easer = new FigureEaser();
    easer.update(resting, 0);
    easer.update(raised, 1000);
    easer.update({ pose: { ...raised.pose }, offset: 0 }, 1050);
    expect(easer.update({ pose: { ...raised.pose }, offset: 0 }, 1000 + POSE_EASE_MS)).toEqual(raised);
  });

  it('turns around from wherever it is when the target changes mid-ease', () => {
    const easer = new FigureEaser();
    easer.update(resting, 0);
    easer.update(raised, 1000);
    const before = easer.update(raised, 1060);
    const after = easer.update(resting, 1060);
    expect(after.pose.leftShoulder).toBeCloseTo(before.pose.leftShoulder);
    expect(after.offset).toBeCloseTo(before.offset);
    expect(easer.update(resting, 1060 + POSE_EASE_MS)).toEqual(resting);
  });
});
