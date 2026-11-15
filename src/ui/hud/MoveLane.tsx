import { useEffect, useRef } from 'react';
import { AnimatePresence, motion, type Variants } from 'motion/react';
import { Figure } from '@/components/Figure';
import { useFeedbackFrame } from '../../engine';
import { phasePips } from '../playProgram';
import { laneGap, laneIndex, movesLeft, upcomingMoves } from './lane';
import type { FeedbackPhase, MoveLaneProps } from './types';
import './lane.css';

const PHASE_LABEL: Record<FeedbackPhase, string> = {
  ready: 'READY',
  reach: 'REACH',
  hold: 'HOLD',
  release: 'RELEASE',
};

const MOVE_PHASES = ['reach', 'hold', 'release'] as const;

/** Cards kept in the queue. The rail shows as many as fit and fades the rest out. */
const QUEUE_LENGTH = 6;

/** The phase word swaps in place. */
const word: Variants = {
  enter: { opacity: 0, y: 8 },
  on: { opacity: 1, y: 0, transition: { duration: 0.12, ease: 'easeOut' } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.1, ease: 'easeIn' } },
};

/** A move docks from the queue below, and leaves to the side once it is done. */
const card: Variants = {
  enter: { opacity: 0, y: 26 },
  on: { opacity: 1, y: 0, transition: { duration: 0.16, ease: 'easeOut' } },
  exit: { opacity: 0, x: 64, transition: { duration: 0.22, ease: 'easeIn' } },
};

/**
 * Everything about the moves, kept in the rail beside the picture so nothing
 * covers the player: the move in play with its phase word, beat pips and
 * grade, and under it the queue of moves to come.
 *
 * The queue scrolls up with the music. The gap between it and the panel is
 * the time left in the move in play (see laneGap), so the next card reaches
 * the panel as its own move starts and docks into it; the move it replaces
 * slides off to the side. The gap changes every frame, so it is written
 * straight to the DOM instead of going through React.
 */
export function MoveLane({ frames, moveNumber, moveCount, round, moves, result }: MoveLaneProps) {
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

  const { beats, lit } = phasePips(moves, playing ? frameMoveId : null, phase, beatsLeft);
  const counting = phase === 'ready' && beatsLeft >= 1 && beatsLeft <= 3;
  const graded = result !== null && phase === 'release';
  const place = `Now · ${shownIndex + 1} of ${moveCount}`;

  return (
    <aside className="lane" data-phase={phase}>
      <div className="lane__now slab slab-edge">
        <span className="lane__tag label">
          {playing ? (round ? `${place} · Round ${round.current} of ${round.total}` : place) : 'First up'}
        </span>

        <div className="lane__cue">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.p
              key={phase}
              className="lane__word display"
              data-testid="phase-label"
              variants={word}
              initial="enter"
              animate="on"
              exit="exit"
            >
              {PHASE_LABEL[phase]}
            </motion.p>
          </AnimatePresence>
          {counting && (
            <span className="lane__count led" aria-hidden="true">
              {beatsLeft}
            </span>
          )}
        </div>

        <ol className="lane__beats" aria-hidden="true">
          {beats &&
            MOVE_PHASES.flatMap((name) =>
              Array.from({ length: beats[name] }, (_, beat) => ({ name, first: beat === 0 })),
            ).map((pip, beat) => (
              <li key={beat} data-phase={pip.name} data-first={pip.first} data-lit={beat === lit} />
            ))}
        </ol>

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
              {/* The grade for the hold that just closed. It leaves with the move. */}
              {graded && (
                <p className="lane__grade" data-label={result.label} aria-hidden="true">
                  <span className="lane__grade-word display">{result.label}</span>
                  <span className="led">{Math.round(result.score)}</span>
                  {result.timing && <span className="lane__grade-timing label">{result.timing}</span>}
                </p>
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
