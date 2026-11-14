/**
 * How regularly a patient does their program: sessions done against
 * sessions prescribed, week by week, and one status for the patient list.
 */
import { addDays, daysBetween, localDay } from '../days';
import type { Prescription, SessionRecord } from '../types';

/** Days without a session before the status says so. */
export const QUIET_AFTER_DAYS = 3;

/** Done: a completed session that day. Partial: only sessions that ended early. */
export type DayState = 'done' | 'partial' | 'empty';

export interface DayCell {
  day: string;
  state: DayState;
  today: boolean;
  future: boolean;
}

export interface WeekRow {
  /** 1-based week of the program. */
  index: number;
  days: DayCell[];
  /** Days with a completed session. A day counts once however many sessions it had. */
  done: number;
  prescribed: number;
  /** Past the program's last week. */
  extra: boolean;
}

export type PatientStatus =
  | { kind: 'no-program' }
  | { kind: 'not-started' }
  | { kind: 'on-track' }
  | { kind: 'behind' }
  | { kind: 'quiet'; days: number }
  | { kind: 'finished' };

export interface Consistency {
  /** Week 1 to the current week of the current program; empty with no program. */
  weeks: WeekRow[];
  thisWeek: { done: number; prescribed: number } | null;
  /** 1-based; 0 with no program. */
  programWeek: number;
  programWeeks: number;
  status: PatientStatus;
  statusText: string;
  /** True when the status is one the doctor should look at. */
  warn: boolean;
}

function describe(status: PatientStatus): string {
  switch (status.kind) {
    case 'no-program':
      return 'No program';
    case 'not-started':
      return 'Not started';
    case 'on-track':
      return 'On track';
    case 'behind':
      return 'Behind';
    case 'quiet':
      return `No sessions for ${status.days} days`;
    case 'finished':
      return 'Finished';
  }
}

/**
 * Consistency as of `today` (a local YYYY-MM-DD key). `prescriptions` are a
 * patient's versions, oldest first. The current program is the run of
 * versions that share the newest version's start date; sessions before that
 * date belong to an earlier program and are not counted here.
 */
export function consistency(
  prescriptions: readonly Prescription[],
  sessions: readonly SessionRecord[],
  today: string,
): Consistency {
  const newest = prescriptions.at(-1);
  if (!newest) {
    const status: PatientStatus = { kind: 'no-program' };
    return { weeks: [], thisWeek: null, programWeek: 0, programWeeks: 0, status, statusText: describe(status), warn: false };
  }

  const start = newest.startDate;
  const versions = prescriptions.filter((version) => version.startDate === start);
  const dayState = new Map<string, DayState>();
  let lastDay: string | null = null;
  for (const session of sessions) {
    if (daysBetween(start, session.day) < 0) continue;
    if (session.completed || !dayState.has(session.day)) dayState.set(session.day, session.completed ? 'done' : 'partial');
    if (lastDay === null || daysBetween(lastDay, session.day) > 0) lastDay = session.day;
  }

  /** Sessions a week under the version in force at the end of a week. */
  const prescribedBy = (weekEnd: string): number => {
    let inForce = versions[0];
    for (const version of versions) {
      const saved = localDay(version.createdAt);
      if (saved !== null && daysBetween(saved, weekEnd) >= 0) inForce = version;
    }
    return inForce.sessionsPerWeek;
  };

  const programWeek = Math.max(1, Math.floor(daysBetween(start, today) / 7) + 1);
  const weeks: WeekRow[] = [];
  for (let index = 1; index <= programWeek; index++) {
    const first = addDays(start, 7 * (index - 1));
    const days: DayCell[] = [];
    for (let offset = 0; offset < 7; offset++) {
      const day = addDays(first, offset);
      const fromToday = daysBetween(today, day);
      days.push({ day, state: dayState.get(day) ?? 'empty', today: fromToday === 0, future: fromToday > 0 });
    }
    weeks.push({
      index,
      days,
      done: days.filter((cell) => cell.state === 'done').length,
      prescribed: prescribedBy(addDays(first, 6)),
      extra: index > newest.weeks,
    });
  }

  const current = weeks[weeks.length - 1];
  const todayCell = current.days.find((cell) => cell.today);
  // Days of this week that can still take a session: today, unless it already has one, and the days after it.
  const daysLeft = current.days.filter((cell) => cell.future).length + (todayCell && todayCell.state !== 'done' ? 1 : 0);
  const quietDays = lastDay === null ? 0 : daysBetween(lastDay, today);

  let status: PatientStatus;
  if (programWeek > newest.weeks) status = { kind: 'finished' };
  else if (lastDay === null) status = { kind: 'not-started' };
  else if (quietDays >= QUIET_AFTER_DAYS) status = { kind: 'quiet', days: quietDays };
  else if (current.done + daysLeft < current.prescribed) status = { kind: 'behind' };
  else status = { kind: 'on-track' };

  return {
    weeks,
    thisWeek: { done: current.done, prescribed: current.prescribed },
    programWeek,
    programWeeks: newest.weeks,
    status,
    statusText: describe(status),
    warn: status.kind === 'behind' || status.kind === 'quiet',
  };
}
