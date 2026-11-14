import { describe, expect, it } from 'vitest';
import type { BeatResult, FormMetrics, PoseFrame } from '../types';
import {
  DEFAULT_CALIBRATION,
  ShrugBaselineCollector,
  loadCalibration,
  saveCalibration,
} from './calibrationStore';
import { FORM_RULES, FormMonitor } from './formRules';
import { applyResult, initialStats } from './stats';

describe('FormMonitor', () => {
  const leaning: FormMetrics = { trunkLeanDeg: 20, shoulderEarRatio: null };
  const upright: FormMetrics = { trunkLeanDeg: 5, shoulderEarRatio: null };

  it('flags a rule only after it has applied for more than 500 ms', () => {
    const monitor = new FormMonitor({ shoulderEarBaseline: null });
    expect(monitor.update(0, leaning, ['trunk-lean'])).toEqual([]);
    expect(monitor.update(0.5, leaning, ['trunk-lean'])).toEqual([]);
    expect(monitor.update(0.51, leaning, ['trunk-lean'])).toEqual(['trunk-lean']);
  });

  it('starts over when the rule stops applying, even briefly', () => {
    const monitor = new FormMonitor({ shoulderEarBaseline: null });
    monitor.update(0, leaning, ['trunk-lean']);
    monitor.update(0.4, upright, ['trunk-lean']);
    expect(monitor.update(0.6, leaning, ['trunk-lean'])).toEqual([]);
    expect(monitor.update(1.0, leaning, ['trunk-lean'])).toEqual([]);
    expect(monitor.update(1.2, leaning, ['trunk-lean'])).toEqual(['trunk-lean']);
  });

  it('treats exactly 15 degrees of lean as within bounds', () => {
    expect(FORM_RULES['trunk-lean'].applies({ trunkLeanDeg: 15, shoulderEarRatio: null }, { shoulderEarBaseline: null })).toBe(false);
    expect(FORM_RULES['trunk-lean'].applies({ trunkLeanDeg: 15.1, shoulderEarRatio: null }, { shoulderEarBaseline: null })).toBe(true);
  });

  it('measures a shrug as a 20% drop from the calibration baseline', () => {
    const context = { shoulderEarBaseline: 0.3 };
    const shrug = FORM_RULES['shoulder-shrug'];
    expect(shrug.applies({ trunkLeanDeg: null, shoulderEarRatio: 0.25 }, context)).toBe(false);
    expect(shrug.applies({ trunkLeanDeg: null, shoulderEarRatio: 0.23 }, context)).toBe(true);
    expect(shrug.applies({ trunkLeanDeg: null, shoulderEarRatio: null }, context)).toBe(false);
  });

  it('ignores rule ids it does not know', () => {
    const monitor = new FormMonitor({ shoulderEarBaseline: null });
    monitor.update(0, leaning, ['knees-over-toes']);
    expect(monitor.update(2, leaning, ['knees-over-toes'])).toEqual([]);
  });
});

describe('stats', () => {
  const result = (label: BeatResult['label'], score: number): BeatResult => ({
    moveId: 'm',
    score,
    label,
    timingOffsetMs: 0,
  });

  it('counts combo as a run of non-misses and streak as a run of Perfects', () => {
    let stats = initialStats();
    stats = applyResult(stats, result('Perfect', 90));
    stats = applyResult(stats, result('Perfect', 95));
    stats = applyResult(stats, result('Good', 70));
    expect(stats).toMatchObject({ combo: 3, streak: 0, bestStreak: 2, perfect: 2, good: 1 });

    stats = applyResult(stats, result('Miss', 20));
    expect(stats).toMatchObject({ combo: 0, bestCombo: 3, streak: 0, miss: 1, total: 4 });

    stats = applyResult(stats, result('Perfect', 100));
    expect(stats).toMatchObject({ combo: 1, bestCombo: 3, streak: 1 });
  });

  it('reports accuracy as the mean move score', () => {
    let stats = initialStats();
    expect(stats.accuracy).toBe(0);
    stats = applyResult(stats, result('Perfect', 90));
    stats = applyResult(stats, result('Miss', 30));
    expect(stats.accuracy).toBeCloseTo(60, 10);
  });
});

describe('calibration storage', () => {
  function fakeStorage(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
  }

  it('round-trips a calibration', () => {
    const storage = fakeStorage();
    expect(loadCalibration(storage)).toBeNull();
    saveCalibration({ offsetMs: 142, shoulderEarBaseline: 0.31 }, storage);
    expect(loadCalibration(storage)).toEqual({ offsetMs: 142, shoulderEarBaseline: 0.31 });
  });

  it('returns null for corrupt or incomplete data', () => {
    expect(loadCalibration(fakeStorage({ 'rehabeat.calibration': 'not json' }))).toBeNull();
    expect(loadCalibration(fakeStorage({ 'rehabeat.calibration': '{"offsetMs":"fast"}' }))).toBeNull();
    expect(loadCalibration(fakeStorage({ 'rehabeat.calibration': '{"offsetMs":80}' }))).toEqual({
      offsetMs: 80,
      shoulderEarBaseline: null,
    });
  });

  it('defaults to no offset and no baseline', () => {
    expect(DEFAULT_CALIBRATION).toEqual({ offsetMs: 0, shoulderEarBaseline: null });
  });
});

describe('ShrugBaselineCollector', () => {
  const frame = (left: number, right: number): PoseFrame => ({
    t: 0,
    angles: { leftShoulder: left, rightShoulder: right },
    visible: ['leftShoulder', 'rightShoulder'],
  });
  const ratio = (value: number | null): FormMetrics => ({ trunkLeanDeg: 0, shoulderEarRatio: value });

  it('takes the median ratio from frames with both arms at rest', () => {
    const collector = new ShrugBaselineCollector();
    for (let i = 0; i < 20; i++) collector.push(frame(12, 15), ratio(0.3));
    // Arm-raise frames and unmeasurable frames must not pull the baseline.
    for (let i = 0; i < 30; i++) collector.push(frame(120, 15), ratio(0.18));
    for (let i = 0; i < 5; i++) collector.push(frame(12, 15), ratio(null));
    expect(collector.result()).toBe(0.3);
  });

  it('returns null without enough resting frames', () => {
    const collector = new ShrugBaselineCollector();
    for (let i = 0; i < 5; i++) collector.push(frame(10, 10), ratio(0.3));
    expect(collector.result()).toBeNull();
  });
});
