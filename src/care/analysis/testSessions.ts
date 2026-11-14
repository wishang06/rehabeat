/** Session builders shared by the analysis tests. Not used by the app. */
import type { HoldRecord, SessionRecord } from '../types';

export const hold = (over: Partial<HoldRecord> = {}): HoldRecord => ({
  cycleIndex: 0,
  round: 1,
  moveId: 'side-arm-raise',
  score: 70,
  label: 'Good',
  timingOffsetMs: 0,
  joints: {},
  formFlags: [],
  overLimit: [],
  ...over,
});

export const session = (day: string, holds: HoldRecord[]): SessionRecord => ({
  id: day,
  prescriptionId: 'rx1',
  startedAt: day + 'T18:00:00',
  day,
  songId: 's',
  durationSec: 60,
  roundsPrescribed: 1,
  roundsDone: 1,
  completed: true,
  summary: { points: 0, moves: holds.length, perfect: 0, good: holds.length, miss: 0, bestCombo: 0, accuracy: 70, durationSec: 60 },
  holds,
});

/** A side-arm-raise hold whose right shoulder stopped `deg` short of 90. */
export const short = (deg: number) => hold({ joints: { rightShoulder: { target: 90, meanError: -deg, seen: 1 } } });
