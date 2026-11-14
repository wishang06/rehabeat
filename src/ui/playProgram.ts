/** The pure parts of playing a plan: which round it is, when the session is over, and the limit prompt. */
import { jointLabel, type PlayPlan } from '../care';
import type { Routine } from '../scoring';
import type { JointName } from '../types';

export type { PlayPlan };

/** The round a cycle belongs to, or null in free play. Cycles past the last round still read as the last. */
export function roundOf(
  cycleIndex: number,
  moveCount: number,
  rounds: number | null,
): { current: number; total: number } | null {
  if (rounds === null || moveCount <= 0) return null;
  return { current: Math.min(rounds, Math.floor(cycleIndex / moveCount) + 1), total: rounds };
}

/**
 * True once a program session has run its course: the last round's last
 * move has ended at `beat`, and its hold has been scored (`scored` is how
 * many holds the scoring engine has closed). Free play never ends by itself.
 */
export function sessionOver(plan: PlayPlan, routine: Routine, beat: number, scored: number): boolean {
  if (plan.rounds === null) return false;
  const total = plan.rounds * plan.moves.length;
  return scored >= total && beat >= routine.cycle(total - 1).endBeat;
}

/** The prompt for a joint that is past its limit. Guidance, worded as such: the angles are estimates. */
export function easeOffText(joints: readonly JointName[]): string | null {
  return joints.length === 0 ? null : `Ease off your ${jointLabel(joints[0])}`;
}
