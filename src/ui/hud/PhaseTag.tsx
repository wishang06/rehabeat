import { AnimatePresence, motion, type Variants } from 'motion/react';
import { useFeedbackFrame } from '../../engine';
import { phasePips } from '../playProgram';
import { laneIndex } from './lane';
import type { FeedbackPhase, PhaseTagProps } from './types';
import './tag.css';

const PHASE_LABEL: Record<FeedbackPhase, string> = {
  ready: 'READY',
  reach: 'REACH',
  hold: 'HOLD',
  release: 'RELEASE',
};

const MOVE_PHASES = ['reach', 'hold', 'release'] as const;
/** The longest phase word. The tag keeps room for it, so the pips beside the word never shift. */
const WIDEST_LABEL = Object.values(PHASE_LABEL).reduce((widest, label) => (label.length > widest.length ? label : widest));

/** The phase word swaps in place. */
const word: Variants = {
  enter: { opacity: 0, y: 6 },
  on: { opacity: 1, y: 0, transition: { duration: 0.12, ease: 'easeOut' } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.1, ease: 'easeIn' } },
};

/** The grade lands with a small push, then sits still. */
const chip: Variants = {
  enter: { opacity: 0, scale: 1.25 },
  on: { opacity: 1, scale: 1, transition: { duration: 0.14, ease: 'easeOut' } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

/**
 * What to do right now, as a small tag in the top-left corner of the picture:
 * the phase word in its colour, a pip per beat of the move, and the grade of
 * the hold that just closed, up through its release. It is the one piece of
 * text on the picture, kept in the corner so it never covers the player.
 */
export function PhaseTag({ frames, moves, moveNumber, result }: PhaseTagProps) {
  const phase = useFeedbackFrame((frame) => frame?.phase ?? 'ready', frames);
  const frameMoveId = useFeedbackFrame((frame) => frame?.move?.id ?? null, frames);
  // Whole beats until the next phase: changes once per beat, not once per frame.
  const beatsLeft = useFeedbackFrame((frame) => (frame ? Math.ceil(frame.beatsToNextPhase) : 0), frames);

  const playing = frameMoveId !== null && laneIndex(moves, moveNumber, frameMoveId) >= 0;
  const { beats, lit } = phasePips(moves, playing ? frameMoveId : null, phase, beatsLeft);
  const graded = result !== null && phase === 'release';

  return (
    <div className="hud-tag" data-phase={phase}>
      <div className="hud-tag__slot">
        <span className="hud-tag__sizer display" aria-hidden="true">
          {WIDEST_LABEL}
        </span>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.p
            key={phase}
            className="hud-tag__word display"
            data-testid="phase-label"
            variants={word}
            initial="enter"
            animate="on"
            exit="exit"
          >
            {PHASE_LABEL[phase]}
          </motion.p>
        </AnimatePresence>
      </div>

      {beats && (
        <ol className="hud-tag__beats" aria-hidden="true">
          {MOVE_PHASES.flatMap((name) =>
            Array.from({ length: beats[name] }, (_, beat) => ({ name, first: beat === 0 })),
          ).map((pip, beat) => (
            <li key={beat} data-phase={pip.name} data-first={pip.first} data-lit={beat === lit} />
          ))}
        </ol>
      )}

      {/* Read out by ResultLabel; this is the picture of it. */}
      <AnimatePresence initial={false}>
        {graded && (
          <motion.p
            key={result.serial}
            className="hud-tag__grade"
            data-label={result.label}
            aria-hidden="true"
            variants={chip}
            initial="enter"
            animate="on"
            exit="exit"
          >
            <span className="hud-tag__chip">
              <span className="display">{result.label}</span>
              <span className="led">{Math.round(result.score)}</span>
            </span>
            {result.timing && <span className="hud-tag__timing label">{result.timing}</span>}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
