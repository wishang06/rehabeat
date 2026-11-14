import { describe, expect, it } from 'vitest';
import {
  PREVIEW_SEC,
  applySteps,
  choosePreviewStart,
  envelopeEnd,
  fadeOutSteps,
  gainAt,
  previewEnvelope,
} from './previewTiming';

// Past Sadness: 213.39 s, a downbeat every four beats at 72 BPM (3.333 s), the first at 2.5303 s.
const PAST_SADNESS_SEC = 213.39;
const downbeats = Array.from({ length: 64 }, (_, bar) => 2.5303 + bar * (240 / 72));

describe('choosePreviewStart', () => {
  it('starts on the downbeat nearest 30% of the song', () => {
    const target = PAST_SADNESS_SEC * 0.3; // 64.02 s
    const start = choosePreviewStart(PAST_SADNESS_SEC, downbeats);
    expect(downbeats).toContain(start);
    for (const time of downbeats) expect(Math.abs(start - target)).toBeLessThanOrEqual(Math.abs(time - target));
    expect(start).toBeCloseTo(62.53, 2);
  });

  it('falls back to 30% of the song without downbeats', () => {
    expect(choosePreviewStart(200, null)).toBeCloseTo(60);
    expect(choosePreviewStart(200, undefined)).toBeCloseTo(60);
    expect(choosePreviewStart(200, [])).toBeCloseTo(60);
  });

  it('ignores times that are not usable', () => {
    expect(choosePreviewStart(200, [Number.NaN, -4, Number.POSITIVE_INFINITY])).toBeCloseTo(60);
  });

  it('never starts so late that the preview runs off the end', () => {
    // 12 s song: 30% is 3.6 s, but a 10 s preview must start by 2 s.
    expect(choosePreviewStart(12, [0.5, 1.9, 3.5, 6])).toBe(1.9);
    expect(choosePreviewStart(12, null)).toBe(2);
    expect(choosePreviewStart(12, [3.5, 6])).toBe(2);
  });

  it('starts at 0 for a song shorter than a preview, or with no length', () => {
    expect(choosePreviewStart(6, [1, 2])).toBe(0);
    expect(choosePreviewStart(0, [1, 2])).toBe(0);
    expect(choosePreviewStart(Number.NaN, null)).toBe(0);
  });

  it('takes a custom length and aim', () => {
    expect(choosePreviewStart(100, null, 5, 0.5)).toBe(50);
  });
});

describe('previewEnvelope', () => {
  it('fades in over 0.5 s, holds and fades out over the last 1 s of 10 s', () => {
    expect(previewEnvelope(3, 2.5)).toEqual([
      { at: 3, value: 0 },
      { at: 3.5, value: 2.5 },
      { at: 12, value: 2.5 },
      { at: 13, value: 0 },
    ]);
  });

  it('keeps the fades inside a short preview', () => {
    const steps = previewEnvelope(0, 1, { lengthSec: 1, fadeInSec: 0.8, fadeOutSec: 0.8 });
    expect(steps.map((step) => step.at)).toEqual([0, 0.5, 0.5, 1]);
  });

  it('ends PREVIEW_SEC after it starts', () => {
    expect(envelopeEnd(previewEnvelope(7, 1))).toBe(7 + PREVIEW_SEC);
    expect(envelopeEnd([])).toBe(0);
  });
});

describe('gainAt', () => {
  const steps = previewEnvelope(0, 2);

  it('follows the ramps between points', () => {
    expect(gainAt(steps, 0)).toBe(0);
    expect(gainAt(steps, 0.25)).toBeCloseTo(1);
    expect(gainAt(steps, 5)).toBe(2);
    expect(gainAt(steps, 9.5)).toBeCloseTo(1);
  });

  it('holds the first value before and the last value after', () => {
    expect(gainAt(steps, -1)).toBe(0);
    expect(gainAt(steps, 99)).toBe(0);
    expect(gainAt([{ at: 0, value: 0.7 }], 5)).toBe(0.7);
  });

  it('is silent with no envelope', () => {
    expect(gainAt([], 3)).toBe(0);
  });

  it('jumps at a zero-length ramp', () => {
    expect(gainAt([{ at: 0, value: 0 }, { at: 1, value: 1 }, { at: 1, value: 0.5 }], 1)).toBe(0.5);
  });
});

describe('fadeOutSteps', () => {
  it('fades from the gain at that moment to silence', () => {
    const playing = previewEnvelope(0, 2);
    expect(fadeOutSteps(playing, 0.25, 0.2)).toEqual([
      { at: 0.25, value: 1 },
      { at: 0.45, value: 0 },
    ]);
    expect(fadeOutSteps(playing, 4, 0.2)[0].value).toBe(2);
  });

  it('starts from silence when nothing plays', () => {
    const [from, to] = fadeOutSteps([], 5, 0.2);
    expect(from).toEqual({ at: 5, value: 0 });
    expect(to.at).toBeCloseTo(5.2);
    expect(to.value).toBe(0);
  });
});

describe('applySteps', () => {
  it('cancels what was scheduled, sets the first point and ramps to the rest', () => {
    const calls: string[] = [];
    const param = {
      cancelScheduledValues: (time: number) => calls.push(`cancel ${time}`),
      setValueAtTime: (value: number, time: number) => calls.push(`set ${value} @ ${time}`),
      linearRampToValueAtTime: (value: number, time: number) => calls.push(`ramp ${value} @ ${time}`),
    };
    applySteps(param, previewEnvelope(1, 2.5));
    expect(calls).toEqual(['cancel 1', 'set 0 @ 1', 'ramp 2.5 @ 1.5', 'ramp 2.5 @ 10', 'ramp 0 @ 11']);
  });

  it('does nothing with no steps', () => {
    const calls: string[] = [];
    applySteps(
      {
        cancelScheduledValues: () => calls.push('cancel'),
        setValueAtTime: () => calls.push('set'),
        linearRampToValueAtTime: () => calls.push('ramp'),
      },
      [],
    );
    expect(calls).toEqual([]);
  });
});
