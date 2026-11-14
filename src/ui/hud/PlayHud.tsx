import { useEffect, useRef } from 'react';
import { MoveUp } from 'lucide-react';
import { AnimatePresence, MotionConfig, motion, type Variants } from 'motion/react';
import { Figure } from '@/components/Figure';
import { useFeedbackFrame } from '../../engine';
import { MOVES } from '../../moves';
import { GOOD_SCORE, PERFECT_SCORE } from '../../scoring';
import type {
  ComboCounterProps,
  FeedbackPhase,
  FormNoteProps,
  HoldRingProps,
  MoveCardsProps,
  PhaseCueProps,
  PlayHudProps,
  ResultPopProps,
  RunStatsProps,
  StepBackBannerProps,
} from './types';
import './hud.css';

const PHASE_LABEL: Record<FeedbackPhase, string> = {
  ready: 'READY',
  reach: 'REACH',
  hold: 'HOLD',
  release: 'RELEASE',
};

const MOVE_PHASES = ['reach', 'hold', 'release'] as const;

/** The lane: ride in along the slant, leave the other way. Reduced motion keeps only the fade. */
const lane: Variants = {
  enter: { opacity: 0, x: 70, skewX: -22 },
  on: { opacity: 1, x: 0, skewX: 0, transition: { duration: 0.12, ease: 'easeOut' } },
  exit: { opacity: 0, x: -70, skewX: -22, transition: { duration: 0.1, ease: 'easeIn' } },
};

/** The phase word, the beat pips of the current move, and 3-2-1 before the first one. */
function PhaseCue({ frames }: PhaseCueProps) {
  const phase = useFeedbackFrame((frame) => frame?.phase ?? 'ready', frames);
  const moveId = useFeedbackFrame((frame) => frame?.move?.id ?? null, frames);
  // Whole beats until the next phase: changes once per beat, not once per frame.
  const beatsLeft = useFeedbackFrame((frame) => (frame ? Math.ceil(frame.beatsToNextPhase) : 0), frames);

  const beats = MOVES.find((move) => move.id === moveId)?.beats;
  // How many beats of the move are behind us, counting the one we are in.
  let lit = -1;
  if (beats && phase !== 'ready') {
    lit = beats[phase] - beatsLeft;
    for (const earlier of MOVE_PHASES) {
      if (earlier === phase) break;
      lit += beats[earlier];
    }
  }
  const counting = phase === 'ready' && beatsLeft >= 1 && beatsLeft <= 3;

  return (
    <>
      <div className="hud-phase" data-phase={phase}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.p
            key={phase}
            className="hud-phase__word display"
            data-testid="phase-label"
            variants={lane}
            initial="enter"
            animate="on"
            exit="exit"
          >
            {PHASE_LABEL[phase]}
          </motion.p>
        </AnimatePresence>
        {beats && (
          <ol className="hud-beats" aria-hidden="true">
            {MOVE_PHASES.flatMap((name) =>
              Array.from({ length: beats[name] }, (_, index) => ({ name, first: index === 0 })),
            ).map((pip, index) => (
              <li key={index} data-phase={pip.name} data-first={pip.first} data-lit={index === lit} />
            ))}
          </ol>
        )}
      </div>

      <div className="hud-count" aria-hidden="true">
        <AnimatePresence initial={false}>
          {counting && (
            <motion.span key={beatsLeft} className="led" variants={lane} initial="enter" animate="on" exit="exit">
              {beatsLeft}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}

/** The side cards: the move in play, and the one after it. */
function MoveCards({ frames, moveNumber, moveCount }: MoveCardsProps) {
  const moveId = useFeedbackFrame((frame) => frame?.move?.id ?? null, frames);
  const moveName = useFeedbackFrame((frame) => frame?.move?.name ?? null, frames);
  const nextId = useFeedbackFrame((frame) => frame?.nextMove.id ?? null, frames);
  const nextName = useFeedbackFrame((frame) => frame?.nextMove.name ?? null, frames);
  // During the count-in there is no current move: the first one is "up first".
  const now = moveName ?? nextName;
  const nowId = moveId ?? nextId;
  const jointsOf = (id: string | null) => MOVES.find((move) => move.id === id)?.joints;

  return (
    <aside className="hud-moves">
      <div className="hud-move slab slab-edge">
        <span className="hud-move__tag label">
          {moveName ? `Now · ${Math.max(1, moveNumber)} of ${moveCount}` : 'First up'}
        </span>
        <span className="hud-move__name display" data-testid="move-name">
          {now}
        </span>
        <Figure joints={jointsOf(nowId)} />
      </div>
      {moveName && nextName && (
        <div className="hud-move hud-move--next slab slab-edge">
          <span className="hud-move__tag label">Next</span>
          <span className="hud-move__name display">{nextName}</span>
          <Figure joints={jointsOf(nextId)} glow={false} />
        </div>
      )}
    </aside>
  );
}

const MARKS = [GOOD_SCORE, PERFECT_SCORE];

/** A point on the ring at `value` percent of the way round from 12 o'clock, `radius` from the centre. */
function ringPoint(value: number, radius: number): [number, number] {
  const angle = ((value / 100) * 360 - 90) * (Math.PI / 180);
  return [100 + radius * Math.cos(angle), 100 + radius * Math.sin(angle)];
}

/**
 * How close the player is to the pose, as a ring with marks at Good (60) and
 * Perfect (85). It changes every frame, so it is written straight to the DOM
 * instead of going through React.
 */
function HoldRing({ frames }: HoldRingProps) {
  const root = useRef<HTMLDivElement>(null);
  const value = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let shownFill = -1;
    let shownValue = -1;
    let shownBand = '';
    const show = (frame: ReturnType<typeof frames.getSnapshot>) => {
      const element = root.current;
      if (!element) return;
      const fill = Math.round(frame?.score ?? 0);
      // In the hold the number is the mean so far, which is what the move will be scored on.
      const number = Math.round(frame?.holdScore ?? frame?.score ?? 0);
      const band = fill >= PERFECT_SCORE ? 'perfect' : fill >= GOOD_SCORE ? 'good' : 'low';
      if (fill !== shownFill) {
        shownFill = fill;
        element.style.setProperty('--ring', String(fill));
      }
      if (number !== shownValue && value.current) {
        shownValue = number;
        value.current.textContent = String(number);
      }
      if (band !== shownBand) {
        shownBand = band;
        element.dataset.band = band;
      }
    };
    show(frames.getSnapshot());
    return frames.subscribe(show);
  }, [frames]);

  return (
    <div className="hud-ring" ref={root} data-band="low" role="img" aria-label="Match score. Good from 60, Perfect from 85.">
      <svg viewBox="-40 -40 280 280" aria-hidden="true">
        <circle className="hud-ring__track" cx="100" cy="100" r="84" />
        <circle className="hud-ring__fill" cx="100" cy="100" r="84" pathLength="100" transform="rotate(-90 100 100)" />
        {MARKS.map((mark) => {
          const [x1, y1] = ringPoint(mark, 74);
          const [x2, y2] = ringPoint(mark, 104);
          const [tx, ty] = ringPoint(mark, 126);
          return (
            <g key={mark}>
              <line className="hud-ring__tick" x1={x1} y1={y1} x2={x2} y2={y2} />
              <text className="hud-ring__mark" x={tx} y={ty} textAnchor="middle" dominantBaseline="central">
                {mark}
              </text>
            </g>
          );
        })}
      </svg>
      <span className="hud-ring__value led" ref={value}>
        0
      </span>
      <span className="hud-ring__label label">Match</span>
    </div>
  );
}

/**
 * PERFECT, GOOD or MISS, big, as the hold closes. It stays up through the
 * release that follows and leaves when the next move starts. A plain-text
 * copy stays in the page for screen readers and the smoke check.
 */
function ResultPop({ result, frames }: ResultPopProps) {
  const releasing = useFeedbackFrame((frame) => frame?.phase === 'release', frames);

  return (
    <>
      <div className="hud-pop" aria-hidden="true">
        <AnimatePresence initial={false}>
          {result && releasing && (
            <motion.div
              key={result.serial}
              className="hud-pop__body"
              data-label={result.label}
              variants={lane}
              initial="enter"
              animate="on"
              exit="exit"
            >
              <span className="hud-pop__word display">{result.label}</span>
              <span className="hud-pop__detail">
                <span className="led">{Math.round(result.score)}</span>
                {result.timing && <span className="label">{result.timing}</span>}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {result && (
        <p className="sr-only" role="status" data-testid="result-label" data-label={result.label}>
          {result.label}
          <span>{Math.round(result.score)}</span>
        </p>
      )}
    </>
  );
}

function ComboCounter({ combo }: ComboCounterProps) {
  return (
    <div className="hud-combo" data-live={combo > 1}>
      <motion.span
        key={combo}
        className="hud-combo__n led"
        data-testid="combo"
        initial={combo > 0 ? { y: '-14%', filter: 'brightness(3)' } : false}
        animate={{ y: '0%', filter: 'brightness(1)' }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
      >
        {combo}
      </motion.span>
      <span className="hud-combo__label display">Combo</span>
    </div>
  );
}

function RunStats({ points, accuracy, perfectStreak }: RunStatsProps) {
  return (
    <dl className="hud-stats">
      <div data-lead="true">
        <dt className="label">Points</dt>
        <dd className="led" data-testid="points">
          {points.toLocaleString()}
        </dd>
      </div>
      <div>
        <dt className="label">Accuracy</dt>
        <dd className="led" data-testid="accuracy">
          {accuracy === null ? '–' : `${Math.round(accuracy)}%`}
        </dd>
      </div>
      <div>
        <dt className="label">Perfect streak</dt>
        <dd className="led" data-testid="streak">
          {perfectStreak}
        </dd>
      </div>
    </dl>
  );
}

/** One message at a time along the bottom: "step back" outranks a form cue. */
function StepBackBanner({ frames, bodyLost, formNote }: StepBackBannerProps) {
  const lowVisibility = useFeedbackFrame((frame) => frame?.lowVisibility ?? false, frames);
  if (!lowVisibility && !bodyLost) return <FormNote note={formNote} />;
  return (
    <p className="hud-banner slab" role="status" data-testid={bodyLost ? 'body-lost' : 'step-back'}>
      <MoveUp aria-hidden="true" strokeWidth={3} />
      <span className="hud-banner__word display">Step back</span>
      <span className="hud-banner__detail label">
        {bodyLost ? 'We cannot see you' : 'Get your whole body in frame'}
      </span>
    </p>
  );
}

function FormNote({ note }: FormNoteProps) {
  if (!note) return null;
  return (
    <p className="hud-note slab slab-edge" role="status" data-testid="form-note">
      <span className="label">Form</span>
      {note}
    </p>
  );
}

/**
 * The play HUD: DOM laid over the camera and its canvas, never drawn on them.
 * Per-frame values (the beat pulse, the match bar) arrive as custom
 * properties the Play screen writes on the root from the audio clock; the
 * rest are read from the feedback store and the run stats.
 */
export function PlayHud({ frames, run, ref }: PlayHudProps) {
  return (
    <MotionConfig reducedMotion="user">
      <div className="hud" ref={ref} data-testid="play-screen">
        <RunStats points={run.points} accuracy={run.accuracy} perfectStreak={run.perfectStreak} />
        <PhaseCue frames={frames} />
        <MoveCards frames={frames} moveNumber={run.moveNumber} moveCount={run.moveCount} />
        <HoldRing frames={frames} />
        <ComboCounter combo={run.combo} />
        <ResultPop result={run.result} frames={frames} />
        <StepBackBanner frames={frames} bodyLost={run.bodyLost} formNote={run.formNote} />
        <div className="hud-pulse" aria-hidden="true" />
      </div>
    </MotionConfig>
  );
}
