/**
 * Arithmetic on calendar days written as YYYY-MM-DD keys. Everything is done
 * on the key's own numbers, never on local midnights, so a 23- or 25-hour
 * day at a clock change is still exactly one day.
 */
import { dayKey } from '../progress/streak';

export { dayKey };

const DAY_MS = 86_400_000;
const KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real date written as YYYY-MM-DD. */
export function isDay(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(dayNumber(value));
}

/** Days since 1970 for a day key; NaN for anything that is not a real date. */
function dayNumber(key: string): number {
  const match = KEY.exec(key);
  if (!match) return Number.NaN;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utc = Date.UTC(year, month - 1, day);
  const back = new Date(utc);
  const real = back.getUTCFullYear() === year && back.getUTCMonth() === month - 1 && back.getUTCDate() === day;
  return real ? utc / DAY_MS : Number.NaN;
}

/** The day `n` days after `day` (before it, for a negative `n`). */
export function addDays(day: string, n: number): string {
  return new Date((dayNumber(day) + n) * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`: positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** The local calendar day of an ISO time, or null if it is not a time. */
export function localDay(iso: string): string | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : dayKey(date);
}
