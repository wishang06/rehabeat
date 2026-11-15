import { describe, expect, it } from 'vitest';
import { NEW_PROGRESS, PROGRESS_KEY, applyRun, loadProgress, parseProgress, saveProgress, type Progress } from './store';
import { DAILY_BONUS, GRADE_BONUS, XP_PER_PERFECT } from './xp';

/** Twelve Perfects: an S, three stars. */
const perfectRun = { moves: 12, perfect: 12, good: 0, miss: 0, accuracy: 96, points: 1850, maxPoints: 1850 };
const emptyRun = { moves: 0, perfect: 0, good: 0, miss: 0, accuracy: 0, points: 0, maxPoints: 1850 };
const noon = (day: number) => new Date(2026, 10, day, 12);

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe('applyRun', () => {
  it('banks XP, starts the streak and counts the run', () => {
    const { progress, gains } = applyRun(NEW_PROGRESS, perfectRun, noon(14));
    const earned = 12 * XP_PER_PERFECT + GRADE_BONUS.S + DAILY_BONUS;
    expect(progress).toEqual({ xp: earned, streak: { count: 1, lastDay: '2026-11-14' }, runs: 1 });
    expect(gains).toMatchObject({
      grade: 'S',
      stars: 5,
      xpBefore: 0,
      xpAfter: earned,
      levelBefore: 1,
      levelAfter: 2,
      streakBefore: 0,
      streakAfter: 1,
    });
    expect(gains.xp.total).toBe(earned);
  });

  it('gives the daily bonus once a day and keeps the streak for a second run', () => {
    const first = applyRun(NEW_PROGRESS, perfectRun, noon(14));
    const second = applyRun(first.progress, perfectRun, noon(14));
    expect(second.gains.xp.daily).toBe(0);
    expect(second.gains.streakBefore).toBe(1);
    expect(second.gains.streakAfter).toBe(1);
    expect(second.progress.runs).toBe(2);
    expect(second.progress.xp).toBe(first.progress.xp * 2 - DAILY_BONUS);
  });

  it('extends the streak and pays the daily bonus again the next day', () => {
    const first = applyRun(NEW_PROGRESS, perfectRun, noon(14));
    const next = applyRun(first.progress, perfectRun, noon(15));
    expect(next.gains.xp.daily).toBe(DAILY_BONUS);
    expect(next.gains.streakBefore).toBe(1);
    expect(next.gains.streakAfter).toBe(2);
  });

  it('shows a lapsed streak as 0 before the run that restarts it', () => {
    const lapsed: Progress = { xp: 500, streak: { count: 6, lastDay: '2026-11-10' }, runs: 9 };
    const { progress, gains } = applyRun(lapsed, perfectRun, noon(14));
    expect(gains.streakBefore).toBe(0);
    expect(gains.streakAfter).toBe(1);
    expect(progress.streak).toEqual({ count: 1, lastDay: '2026-11-14' });
  });

  it('changes nothing for a run that scored no moves', () => {
    const before: Progress = { xp: 120, streak: { count: 2, lastDay: '2026-11-13' }, runs: 3 };
    const { progress, gains } = applyRun(before, emptyRun, noon(14));
    expect(progress).toBe(before);
    expect(gains.xp.total).toBe(0);
    expect(gains.stars).toBe(0);
    expect(gains.streakBefore).toBe(2);
    expect(gains.streakAfter).toBe(2);
  });

  it('does not change the progress it was given', () => {
    const before: Progress = { xp: 0, streak: { count: 0, lastDay: null }, runs: 0 };
    applyRun(before, perfectRun, noon(14));
    expect(before).toEqual({ xp: 0, streak: { count: 0, lastDay: null }, runs: 0 });
  });
});

describe('parseProgress', () => {
  it('keeps a valid record', () => {
    const stored = { xp: 340, streak: { count: 3, lastDay: '2026-11-14' }, runs: 7 };
    expect(parseProgress(stored)).toEqual(stored);
  });

  it('starts fresh from anything that is not a record', () => {
    for (const raw of [null, undefined, 'xp', 12, []]) expect(parseProgress(raw)).toEqual(NEW_PROGRESS);
  });

  it('drops a streak with a bad date or count and keeps the rest', () => {
    expect(parseProgress({ xp: 50, streak: { count: 3, lastDay: 'yesterday' }, runs: 2 })).toEqual({
      xp: 50,
      streak: { count: 0, lastDay: null },
      runs: 2,
    });
    expect(parseProgress({ xp: 50, streak: { count: -1, lastDay: '2026-11-14' } }).streak).toEqual({
      count: 0,
      lastDay: null,
    });
  });

  it('floors and clamps numbers that were tampered with', () => {
    expect(parseProgress({ xp: -40, runs: 2.9 })).toEqual({ xp: 0, streak: { count: 0, lastDay: null }, runs: 2 });
    expect(parseProgress({ xp: '900', runs: Number.POSITIVE_INFINITY })).toEqual(NEW_PROGRESS);
  });
});

describe('loadProgress and saveProgress', () => {
  it('round-trips through storage', () => {
    const storage = fakeStorage();
    const progress: Progress = { xp: 460, streak: { count: 3, lastDay: '2026-11-14' }, runs: 5 };
    saveProgress(progress, storage);
    expect(storage.data.has(PROGRESS_KEY)).toBe(true);
    expect(loadProgress(storage)).toEqual(progress);
  });

  it('starts fresh when nothing is stored, or what is stored is not JSON', () => {
    expect(loadProgress(fakeStorage())).toEqual(NEW_PROGRESS);
    expect(loadProgress(fakeStorage({ [PROGRESS_KEY]: '{not json' }))).toEqual(NEW_PROGRESS);
  });

  it('carries on without storage, or when storage throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(loadProgress(null)).toEqual(NEW_PROGRESS);
    expect(loadProgress(broken)).toEqual(NEW_PROGRESS);
    expect(() => saveProgress(NEW_PROGRESS, broken)).not.toThrow();
    expect(() => saveProgress(NEW_PROGRESS, null)).not.toThrow();
  });
});
