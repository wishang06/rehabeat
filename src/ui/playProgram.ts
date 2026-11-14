/** The pure parts of playing a plan: which round it is, when the session is over, and the limit prompt. */
import { jointLabel, type PlayPlan } from '../care';
import type { Routine } from '../scoring';
import type { JointName, Move } from '../types';

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

const MOVE_PHASES = ['reach', 'hold', 'release'] as const;

/**
 * The beat pips under the phase word: the beats of the move in play, and
 * which one is lit (counting from 0; -1 for none). The beats come from the
 * moves being played, which a program can have changed, not from moves.json.
 */
export function phasePips(
  moves: readonly Move[],
  moveId: string | null,
  phase: 'ready' | 'reach' | 'hold' | 'release',
  beatsLeft: number,
): { beats: Move['beats'] | null; lit: number } {
  const beats = moves.find((move) => move.id === moveId)?.beats ?? null;
  if (!beats || phase === 'ready') return { beats, lit: -1 };
  // How many beats of the move are behind us, counting the one we are in.
  let lit = beats[phase] - beatsLeft;
  for (const earlier of MOVE_PHASES) {
    if (earlier === phase) break;
    lit += beats[earlier];
  }
  return { beats, lit };
}
