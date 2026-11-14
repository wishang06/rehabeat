import { describe, expect, it } from 'vitest';
import {
  NO_STREAK,
  advanceStreak,
  currentStreak,
  dayKey,
  daysBetween,
  isDayKey,
  playedToday,
  weekOfStreak,
} from './streak';

describe('day keys', () => {
  it('writes the local calendar day, zero-padded', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(dayKey(new Date(2026, 10, 14, 0, 0))).toBe('2026-11-14');
  });

  it('accepts real dates only', () => {
    expect(isDayKey('2026-11-14')).toBe(true);
    expect(isDayKey('2026-02-30')).toBe(false);
    expect(isDayKey('2026-13-01')).toBe(false);
    expect(isDayKey('14/11/2026')).toBe(false);
    expect(isDayKey(20261114)).toBe(false);
    expect(isDayKey(null)).toBe(false);
  });

  it('counts whole days across month, year and leap-day boundaries', () => {
    expect(daysBetween('2026-11-14', '2026-11-14')).toBe(0);
    expect(daysBetween('2026-11-30', '2026-12-01')).toBe(1);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetween('2026-11-14', '2026-11-10')).toBe(-4);
    expect(daysBetween('nonsense', '2026-11-14')).toBeNull();
  });

  it('is not thrown by a daylight-saving change', () => {
    // US clocks go back on 1 November 2026 and forward on 8 March 2026.
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
  });
});

describe('advanceStreak', () => {
  it('starts at 1 on the first run', () => {
    expect(advanceStreak(NO_STREAK, '2026-11-14')).toEqual({ count: 1, lastDay: '2026-11-14' });
  });

  it('leaves the streak alone for a second run on the same day', () => {
    const streak = { count: 3, lastDay: '2026-11-14' };
    expect(advanceStreak(streak, '2026-11-14')).toBe(streak);
  });

  it('extends by one on the next day', () => {
    expect(advanceStreak({ count: 3, lastDay: '2026-11-14' }, '2026-11-15')).toEqual({
      count: 4,
      lastDay: '2026-11-15',
    });
  });

  it('starts again at 1 after a missed day', () => {
    expect(advanceStreak({ count: 9, lastDay: '2026-11-14' }, '2026-11-16')).toEqual({
      count: 1,
      lastDay: '2026-11-16',
    });
  });

  it('starts again at 1 if the clock went backwards', () => {
    expect(advanceStreak({ count: 9, lastDay: '2026-11-14' }, '2026-11-12')).toEqual({
      count: 1,
      lastDay: '2026-11-12',
    });
  });

  it('builds a week one day at a time', () => {
    let streak = NO_STREAK;
    for (let day = 9; day <= 15; day++) streak = advanceStreak(streak, `2026-11-${String(day).padStart(2, '0')}`);
    expect(streak).toEqual({ count: 7, lastDay: '2026-11-15' });
  });
});

describe('currentStreak', () => {
  const streak = { count: 4, lastDay: '2026-11-14' };

  it('stands on the day it was earned and the day after', () => {
    expect(currentStreak(streak, '2026-11-14')).toBe(4);
    expect(currentStreak(streak, '2026-11-15')).toBe(4);
  });

  it('lapses once a whole day has been missed', () => {
    expect(currentStreak(streak, '2026-11-16')).toBe(0);
  });

  it('is 0 before any run', () => {
    expect(currentStreak(NO_STREAK, '2026-11-14')).toBe(0);
  });
});

describe('playedToday', () => {
  it('is true only on the last day played', () => {
    const streak = { count: 2, lastDay: '2026-11-14' };
    expect(playedToday(streak, '2026-11-14')).toBe(true);
    expect(playedToday(streak, '2026-11-15')).toBe(false);
    expect(playedToday(NO_STREAK, '2026-11-14')).toBe(false);
  });
});

describe('weekOfStreak', () => {
  // 14 November 2026 is a Saturday; its week runs Monday 9 to Sunday 15.
  const saturday = new Date(2026, 10, 14, 12);

  it('lights the days of this week that are in the streak', () => {
    expect(weekOfStreak({ count: 3, lastDay: '2026-11-14' }, saturday)).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
      false,
    ]);
  });

  it('lights nothing later than the last day played', () => {
    const sunday = new Date(2026, 10, 15, 12);
    expect(weekOfStreak({ count: 2, lastDay: '2026-11-14' }, sunday)).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
      false,
    ]);
  });

  it('only shows this week of a longer streak', () => {
    expect(weekOfStreak({ count: 20, lastDay: '2026-11-14' }, saturday)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  it('lights nothing for a lapsed streak or no streak', () => {
    const dark = Array.from({ length: 7 }, () => false);
    expect(weekOfStreak({ count: 5, lastDay: '2026-11-11' }, saturday)).toEqual(dark);
    expect(weekOfStreak(NO_STREAK, saturday)).toEqual(dark);
  });

  it('treats Sunday as the last day of the week, not the first', () => {
    const sunday = new Date(2026, 10, 15, 12);
    expect(weekOfStreak({ count: 1, lastDay: '2026-11-15' }, sunday)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
  });
});
