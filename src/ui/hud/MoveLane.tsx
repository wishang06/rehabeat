import { useEffect, useRef } from 'react';
import { AnimatePresence, motion, type Variants } from 'motion/react';
import { Figure } from '@/components/Figure';
import { useFeedbackFrame } from '../../engine';
import { laneGap, laneIndex, movesLeft, upcomingMoves } from './lane';
import type { MoveLaneProps } from './types';
import './lane.css';

/** Cards kept in the queue. The rail shows as many as fit and fades the rest out. */
const QUEUE_LENGTH = 6;

/** A move docks from the queue below, and leaves to the side once it is done. */
const card: Variants = {
  enter: { opacity: 0, y: 26 },
  on: { opacity: 1, y: 0, transition: { duration: 0.16, ease: 'easeOut' } },
  exit: { opacity: 0, x: 64, transition: { duration: 0.22, ease: 'easeIn' } },
};

/**
 * Everything about the moves, kept in the rail beside the picture so nothing
 * covers the player: the move in play with its name and figure (and the
 * 3-2-1 count before the first one), and under it the queue of moves to
 * come. The phase word, the beat pips and the grade are in the phase tag
 * (PhaseTag.tsx), in the corner of the picture.
 *
 * The queue scrolls up with the music. The gap between it and the panel is
 * the time left in the move in play (see laneGap), so the next card reaches
 * the panel as its own move starts and docks into it; the move it replaces
 * slides off to the side. The gap changes every frame, so it is written
 * straight to the DOM instead of going through React.
 */
export function MoveLane({ frames, moveNumber, round, moves }: MoveLaneProps) {
  const phase = useFeedbackFrame((frame) => frame?.phase ?? 'ready', frames);
  const frameMoveId = useFeedbackFrame((frame) => frame?.move?.id ?? null, frames);
  // Whole beats until the next phase: changes once per beat, not once per frame.
  const beatsLeft = useFeedbackFrame((frame) => (frame ? Math.ceil(frame.beatsToNextPhase) : 0), frames);
  const track = useRef<HTMLOListElement>(null);

  useEffect(() => {
    let shown = '';
    const show = (frame: ReturnType<typeof frames.getSnapshot>) => {
      const gap = laneGap(frame, moves).toFixed(4);
      if (gap === shown || !track.current) return;
      shown = gap;
      track.current.style.setProperty('--gap', gap);
    };
    show(frames.getSnapshot());
    return frames.subscribe(show);
  }, [frames, moves]);

  const index = laneIndex(moves, moveNumber, frameMoveId);
  const playing = index >= 0 && frameMoveId !== null;
  // During the count-in there is no move in play yet: the panel shows the first one, and the queue starts after it.
  const shownIndex = playing ? index : 0;
  const shown = moves[shownIndex] ?? null;
  const queue = upcomingMoves(moves, shownIndex, QUEUE_LENGTH, movesLeft(moves.length, shownIndex, round));

  const counting = phase === 'ready' && beatsLeft >= 1 && beatsLeft <= 3;

  return (
    <aside className="lane" data-phase={phase}>
      <div className="lane__now slab slab-edge">
        {/* A program is played in rounds; free play has no count to show. */}
        {round && (
          <span className="lane__tag label">
            Round {round.current} of {round.total}
          </span>
        )}

        <div className="lane__dock">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={playing ? `move-${shownIndex}` : 'first'}
              className="lane__card"
              variants={card}
              initial="enter"
              animate="on"
              exit="exit"
            >
              <span className="lane__name display" data-testid="move-name">
                {shown?.name}
              </span>
              <Figure joints={shown?.joints} />
              {/* 3, 2, 1 beside the first move's figure, on the beats before it starts. */}
              {counting && (
                <span className="lane__count led" aria-hidden="true">
                  {beatsLeft}
                </span>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* A picture of what is coming; the next move is also given as text below. */}
      <div className="lane__queue" aria-hidden="true">
        <ol className="lane__track" ref={track}>
          {queue.map((move, slot) => (
            <li className="lane__up" key={slot}>
              <Figure joints={move.joints} glow={false} />
              <span className="lane__up-name display">{move.name}</span>
            </li>
          ))}
        </ol>
      </div>
      {queue[0] && <p className="sr-only">Next: {queue[0].name}</p>}
    </aside>
  );
}
