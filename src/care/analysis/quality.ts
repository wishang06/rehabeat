/** How well a patient scores: this week against last, and each move over time. */
import { daysBetween } from '../days';
import type { HoldRecord, SessionRecord } from '../types';

export interface MoveTrend {
  moveId: string;
  /** One point per session that held the move: its mean score there. Oldest first. */
  points: { day: string; score: number }[];
}

export interface Quality {
  /** Mean hold score over the seven days ending today, or null with no holds in them. */
  average: number | null;
  /** The same over the seven days before those. */
  previous: number | null;
  /** average - previous, or null when either is missing. */
  change: number | null;
  byMove: MoveTrend[];
}

const mean = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

/** Quality as of `today` (a local YYYY-MM-DD key). Partial sessions count: a hold is a hold. */
export function quality(sessions: readonly SessionRecord[], today: string): Quality {
  const scoresAged = (from: number, to: number): number[] =>
    sessions
      .filter((session) => {
        const age = daysBetween(session.day, today);
        return age >= from && age <= to;
      })
      .flatMap((session) => session.holds.map((hold) => hold.score));

  const average = mean(scoresAged(0, 6));
  const previous = mean(scoresAged(7, 13));

  const byMove: MoveTrend[] = [];
  for (const session of sessions) {
    const perMove = new Map<string, HoldRecord[]>();
    for (const hold of session.holds) perMove.set(hold.moveId, [...(perMove.get(hold.moveId) ?? []), hold]);
    for (const [moveId, holds] of perMove) {
      let trend = byMove.find((entry) => entry.moveId === moveId);
      if (!trend) byMove.push((trend = { moveId, points: [] }));
      trend.points.push({ day: session.day, score: mean(holds.map((hold) => hold.score)) ?? 0 });
    }
  }

  return { average, previous, change: average !== null && previous !== null ? average - previous : null, byMove };
}
