import type { HoldDetail, RunSummary } from '../scoring';
import { dayKey } from './days';
import type { Prescription, SessionRecord } from './types';

interface SessionInput {
  /** The version the session was started under. */
  prescription: Prescription;
  /** Moves in one round, after the limits were applied. */
  moveCount: number;
  /** The scoring engine's details for the run, in order. */
  details: readonly HoldDetail[];
  summary: RunSummary;
  songId: string;
  startedAt: Date;
  /** Makes the session's id. Tests pass their own. */
  newId?: () => string;
}

/**
 * The record of a program session, or null when no hold was scored and
 * there is nothing to send. Holds past the last prescribed round are left
 * out: the routine loops, and the session ended there.
 */
export function buildSession(input: SessionInput): SessionRecord | null {
  const { prescription, moveCount, details, summary, songId, startedAt } = input;
  if (moveCount <= 0 || details.length === 0) return null;

  const holds = details.slice(0, prescription.rounds * moveCount).map((detail, index) => ({
    ...detail,
    round: Math.floor(index / moveCount) + 1,
  }));
  const roundsDone = Math.floor(holds.length / moveCount);

  return {
    id: (input.newId ?? (() => crypto.randomUUID()))(),
    prescriptionId: prescription.id,
    startedAt: startedAt.toISOString(),
    day: dayKey(startedAt),
    songId,
    durationSec: summary.durationSec,
    roundsPrescribed: prescription.rounds,
    roundsDone,
    completed: roundsDone >= prescription.rounds,
    summary,
    holds,
  };
}
