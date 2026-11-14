/**
 * The daily streak: how many days in a row a run was finished. Days are the
 * player's own calendar days, written as local YYYY-MM-DD keys.
 */

export interface Streak {
  /** Days in a row, counted up to and including `lastDay`. */
  count: number;
  /** The last day a run was finished, or null if none has been. */
  lastDay: string | null;
}

export const NO_STREAK: Streak = { count: 0, lastDay: null };

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The local calendar day of `date` as YYYY-MM-DD. */
export function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** A day key as a day number (days since 1970, ignoring time zones), or null if it is not a real date. */
function dayNumber(key: string): number | null {
  const match = DAY_KEY.exec(key);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utc = Date.UTC(year, month - 1, day);
  const back = new Date(utc);
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null;
  return Math.round(utc / 86_400_000);
}

export function isDayKey(key: unknown): key is string {
  return typeof key === 'string' && dayNumber(key) !== null;
}

/** Whole days from `from` to `to` (negative if `to` is earlier). Null if either is not a day key. */
export function daysBetween(from: string, to: string): number | null {
  const a = dayNumber(from);
  const b = dayNumber(to);
  return a === null || b === null ? null : b - a;
}

/**
 * The streak after finishing a run on `today`. The same day leaves it as it
 * is, the day after extends it, and anything else (a gap, or a clock that
 * went backwards) starts again at 1.
 */
export function advanceStreak(streak: Streak, today: string): Streak {
  const gap = streak.lastDay === null ? null : daysBetween(streak.lastDay, today);
  if (gap === 0 && streak.count > 0) return streak;
  if (gap === 1 && streak.count > 0) return { count: streak.count + 1, lastDay: today };
  return { count: 1, lastDay: today };
}

/** The streak as it stands on `today`: it lapses to 0 once a whole day has been missed. */
export function currentStreak(streak: Streak, today: string): number {
  if (streak.lastDay === null || streak.count <= 0) return 0;
  const gap = daysBetween(streak.lastDay, today);
  return gap === 0 || gap === 1 ? streak.count : 0;
}

/** Whether a run has already been finished on `today`. */
export function playedToday(streak: Streak, today: string): boolean {
  return streak.lastDay === today && streak.count > 0;
}

/**
 * Monday to Sunday of the week `today` is in: true for each day that is part
 * of the live streak.
 */
export function weekOfStreak(streak: Streak, today: Date): boolean[] {
  const todayKey = dayKey(today);
  const live = currentStreak(streak, todayKey);
  const last = streak.lastDay === null ? null : dayNumber(streak.lastDay);
  const todayNumber = dayNumber(todayKey);
  if (live === 0 || last === null || todayNumber === null) return Array.from({ length: 7 }, () => false);
  // getDay() is 0 for Sunday; shift so Monday is 0.
  const monday = todayNumber - ((today.getDay() + 6) % 7);
  return Array.from({ length: 7 }, (_, index) => {
    const day = monday + index;
    return day <= last && day > last - live;
  });
}
