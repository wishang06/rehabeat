import { useEffect, useRef } from 'react';
import { ChevronsDown, MoveUp } from 'lucide-react';
import { MotionConfig, motion } from 'motion/react';
import { useFeedbackFrame } from '../../engine';
import { MOVES } from '../../moves';
import { GOOD_SCORE, PERFECT_SCORE } from '../../scoring';
import type {
  ComboCounterProps,
  FormNoteProps,
  HoldRingProps,
  PlayHudProps,
  ResultLabelProps,
  RunStatsProps,
  StepBackBannerProps,
} from './types';
import { HudSounds } from './HudSounds';
import { MoveLane } from './MoveLane';
import { PhaseTag } from './PhaseTag';
import { ScoreTube } from './ScoreTube';
import './hud.css';
import './rails.css';

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

/** The last move's grade as plain text, for screen readers and the smoke check. The phase tag shows it. */
function ResultLabel({ result }: ResultLabelProps) {
  if (!result) return null;
  return (
    <p className="sr-only" role="status" data-testid="result-label" data-label={result.label}>
      {result.label}
      <span>{Math.round(result.score)}</span>
    </p>
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

/** One message at a time, on the bottom edge of the picture: "step back" outranks a form cue. */
function StepBackBanner({ frames, bodyLost, easeOff, formNote }: StepBackBannerProps) {
  const lowVisibility = useFeedbackFrame((frame) => frame?.lowVisibility ?? false, frames);
  if (!lowVisibility && !bodyLost && easeOff) {
    // Guidance, not a safety warning: the angle is an estimate from the camera.
    return (
      <p className="hud-banner slab" role="status" data-testid="ease-off">
        <ChevronsDown aria-hidden="true" strokeWidth={3} />
        <span className="hud-banner__word display">Ease off</span>
        <span className="hud-banner__detail label">
          {easeOff.replace(/^Ease off your /, '')}: past the range your doctor set
        </span>
      </p>
    );
  }
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
 * The play HUD: DOM laid over the stage, never drawn on the camera's canvas.
 * The picture is left clear but for a small tag in its corner (the phase and
 * the grade): the moves are in the move lane, the numbers in the left rail. Per-frame values (the beat pulse,
 * the match bar) arrive as custom properties the Play screen writes on the
 * root from the audio clock; the rest are read from the feedback store and
 * the run stats.
 */
export function PlayHud({ frames, run, moves = MOVES, ref }: PlayHudProps) {
  return (
    <MotionConfig reducedMotion="user">
      <div className="hud" ref={ref} data-testid="play-screen">
        <RunStats points={run.points} accuracy={run.accuracy} perfectStreak={run.perfectStreak} />
        <ScoreTube points={run.points} maxPoints={run.maxPoints} result={run.result} />
        <HoldRing frames={frames} />
        <MoveLane
          frames={frames}
          moveNumber={run.moveNumber}
          moveCount={run.moveCount}
          round={run.round}
          moves={moves}
        />
        <PhaseTag frames={frames} moves={moves} moveNumber={run.moveNumber} result={run.result} />
        <ComboCounter combo={run.combo} />
        <ResultLabel result={run.result} />
        <StepBackBanner frames={frames} bodyLost={run.bodyLost} easeOff={run.easeOff} formNote={run.formNote} />
        <div className="hud-pulse" aria-hidden="true" />
        <HudSounds frames={frames} run={run} />
      </div>
    </MotionConfig>
  );
}
