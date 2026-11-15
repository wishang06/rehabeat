/**
 * The pure parts of the move lane (MoveLane.tsx): where the queue of
 * upcoming moves sits at any moment, and which moves are in it.
 */
import type { Move } from '../../types';
import type { FeedbackFrame } from '../../types/ui';

const MOVE_PHASES = ['reach', 'hold', 'release'] as const;

/**
 * How far the queue of upcoming moves sits below the "now" panel, in cards.
 * It is 1 as a move starts and falls to 0 as the move ends, so the gap under
 * the panel is the time left in the move and the next card arrives at the
 * panel exactly as its own move starts. During the count-in the first move
 * is already in the panel, so the queue waits a whole card below it.
 */
export function laneGap(
  frame: Pick<FeedbackFrame, 'phase' | 'phaseProgress' | 'move'> | null,
  moves: readonly Move[],
): number {
  if (!frame || frame.phase === 'ready') return 1;
  const within = Math.min(1, Math.max(0, frame.phaseProgress));
  const beats = moves.find((move) => move.id === frame.move?.id)?.beats;
  // An unknown move has no beats to place the phase in: treat the phase as the whole move.
  if (!beats) return 1 - within;
  const total = beats.reach + beats.hold + beats.release;
  if (!(total > 0)) return 1;
  let done = within * beats[frame.phase];
  for (const earlier of MOVE_PHASES) {
    if (earlier === frame.phase) break;
    done += beats[earlier];
  }
  return Math.min(1, Math.max(0, 1 - done / total));
}

/**
 * The position in `moves` of the move in play: `moveNumber - 1`, or -1 during
 * the count-in. The run's move number reaches the HUD a moment after the
 * frame that starts a move, so when the frame already names the move after
 * that one, the frame wins. This keeps the queue and its gap in step.
 */
export function laneIndex(moves: readonly Move[], moveNumber: number, frameMoveId: string | null): number {
  const index = moveNumber - 1;
  if (frameMoveId === null || moves.length === 0 || moves[index]?.id === frameMoveId) return index;
  const next = (index + 1) % moves.length;
  return moves[next]?.id === frameMoveId ? next : index;
}

/**
 * How many moves are still to come after position `index` (-1 during the
 * count-in): null in free play, which loops until the player stops.
 */
export function movesLeft(
  moveCount: number,
  index: number,
  round: { current: number; total: number } | null,
): number | null {
  if (round === null) return null;
  return Math.max(0, (round.total - round.current) * moveCount + (moveCount - 1 - index));
}

/**
 * The next `count` moves after position `index`, in play order, looping
 * through `moves`. `left` caps them when a program session is about to end.
 */
export function upcomingMoves(moves: readonly Move[], index: number, count: number, left: number | null): Move[] {
  if (moves.length === 0) return [];
  const shown = left === null ? count : Math.min(count, left);
  return Array.from({ length: Math.max(0, shown) }, (_, slot) => moves[(index + 1 + slot) % moves.length]);
}
