import { useEffect, useRef, useState, type RefObject } from 'react';
import { MOVES, computeGhost, drawGhost } from '../moves';
import { drawSkeleton } from '../pose';
import {
  GOOD_SCORE,
  Routine,
  ScoringEngine,
  initialStats,
  melodyShouldPlay,
  type Calibration,
  type Phase,
  type Stats,
} from '../scoring';
import type { Session } from '../session';
import type { BeatResult, Move } from '../types';
import { CANVAS_COLORS, prepareCanvas } from './canvas';

/** Beats of lead-in before the first move starts. */
const COUNT_IN_BEATS = 4;

/** Live values the debug panel reads while the Play screen is up. */
export interface PlayDebug {
  move: Move | null;
  frameScore: number;
  holdScore: number | null;
  beat: number;
}

interface PlayScreenProps {
  session: Session;
  calibration: Calibration;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  debugRef: RefObject<PlayDebug | null>;
}

interface Hud {
  phase: Phase | 'ready';
  moveName: string;
  upNext: string | null;
  beatsLeft: number;
  formNote: string | null;
  result: BeatResult | null;
  stats: Stats;
}

const PHASE_LABEL: Record<Hud['phase'], string> = {
  ready: 'READY',
  reach: 'REACH',
  hold: 'HOLD',
  release: 'RELEASE',
};

const INITIAL_HUD: Hud = {
  phase: 'ready',
  moveName: MOVES[0].name,
  upNext: null,
  beatsLeft: COUNT_IN_BEATS,
  formNote: null,
  result: null,
  stats: initialStats(),
};

function hudKey(hud: Hud): string {
  return [hud.phase, hud.moveName, hud.upNext, hud.beatsLeft, hud.formNote, hud.stats.total].join('|');
}

export function PlayScreen({ session, calibration, canvasRef, debugRef }: PlayScreenProps) {
  const [hud, setHud] = useState<Hud>(INITIAL_HUD);
  const hudRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const { engine } = session;
    engine.start();

    const routine = new Routine(MOVES, COUNT_IN_BEATS);
    const scoring = new ScoringEngine({
      routine,
      timeOfBeat: (beat) => engine.clockTimeOfBeat(beat),
      offsetMs: calibration.offsetMs,
      shoulderEarBaseline: calibration.shoulderEarBaseline,
    });

    const unsubscribe = session.subscribe((sample) => {
      scoring.push(sample.frame, sample.form);
      // The "music follows you" mechanic: the melody stays in while the hold score is Good or better.
      engine.setMelodyActive(melodyShouldPlay(scoring.live, scoring.lastResult));
    });

    let shownKey = hudKey(INITIAL_HUD);
    let frame = requestAnimationFrame(function draw() {
      frame = requestAnimationFrame(draw);

      // Visuals run on what is audible now; scoring runs on offset-corrected frame times.
      const beat = engine.beatPosition();
      const info = routine.phaseAt(beat);
      const live = scoring.live;
      const sample = session.latest();

      const canvas = canvasRef.current;
      const surface = canvas && prepareCanvas(canvas);
      if (surface && sample?.landmarks) {
        const { ctx, width, height } = surface;
        if (info) {
          const fade =
            info.phase === 'reach'
              ? 0.5 + 0.5 * info.progress
              : info.phase === 'hold'
                ? 1
                : 1 - info.progress;
          const matched = live.cycle?.index === info.cycle.index && live.frameScore >= GOOD_SCORE;
          drawGhost(
            ctx,
            computeGhost(info.cycle.move, sample.landmarks, { width, height }, sample.worldLandmarks),
            {
              color: matched ? CANVAS_COLORS.ghostMatched : CANVAS_COLORS.ghost,
              alpha: fade,
              lineWidth: width / 64,
            },
          );
        }
        drawSkeleton(ctx, sample.landmarks, {
          width,
          height,
          lineColor: CANVAS_COLORS.skeletonLine,
          jointColor: CANVAS_COLORS.skeletonJoint,
          lineWidth: width / 160,
        });
      }

      const sinceBeat = beat - Math.floor(beat);
      const style = hudRef.current?.style;
      style?.setProperty('--pulse', ((1 - sinceBeat) ** 2).toFixed(3));
      style?.setProperty('--progress', (info ? info.progress : beat / COUNT_IN_BEATS).toFixed(4));
      style?.setProperty('--match', (live.frameScore / 100).toFixed(3));

      debugRef.current = {
        move: info?.cycle.move ?? null,
        frameScore: live.frameScore,
        holdScore: live.holdScore,
        beat,
      };

      const next: Hud = info
        ? {
            phase: info.phase,
            moveName: info.cycle.move.name,
            upNext: info.phase === 'release' ? routine.cycle(info.cycle.index + 1).move.name : null,
            beatsLeft: info.beatsLeft,
            formNote: live.formNote,
            result: scoring.lastResult,
            stats: scoring.stats,
          }
        : {
            ...INITIAL_HUD,
            beatsLeft: Math.max(1, Math.ceil(COUNT_IN_BEATS - beat)),
          };
      const key = hudKey(next);
      if (key !== shownKey) {
        shownKey = key;
        setHud(next);
      }
    });

    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
      engine.setMelodyActive(false);
      engine.stop();
      debugRef.current = null;
    };
  }, [session, calibration, canvasRef, debugRef]);

  const { stats, result } = hud;

  return (
    <div className="hud" ref={hudRef} data-phase={hud.phase} data-testid="play-screen">
      <div className="hud__move">
        <p className="hud__eyebrow">{hud.phase === 'ready' ? 'First up' : 'Now'}</p>
        <p className="hud__move-name" data-testid="move-name">
          {hud.moveName}
        </p>
        {hud.upNext && <p className="hud__next">Next: {hud.upNext}</p>}
        <div className="hud__match" aria-hidden="true">
          <span className="hud__match-fill" />
        </div>
      </div>

      <dl className="hud__stats">
        <div>
          <dt>Combo</dt>
          <dd data-testid="combo">{stats.combo}</dd>
        </div>
        <div>
          <dt>Accuracy</dt>
          <dd data-testid="accuracy">{stats.total > 0 ? `${Math.round(stats.accuracy)}%` : '–'}</dd>
        </div>
        <div>
          <dt>Perfect streak</dt>
          <dd data-testid="streak">{stats.streak}</dd>
        </div>
      </dl>

      {result && (
        <p
          key={stats.total}
          className="hud__result"
          data-label={result.label}
          data-testid="result-label"
          role="status"
        >
          {result.label}
          <span className="hud__result-score">{Math.round(result.score)}</span>
        </p>
      )}

      <div className="ring">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle className="ring__pulse" cx="60" cy="60" r="50" />
          <circle className="ring__track" cx="60" cy="60" r="50" />
          <circle className="ring__progress" cx="60" cy="60" r="50" pathLength={1} />
        </svg>
        <div className="ring__text">
          <span className="ring__phase" data-testid="phase-label">
            {PHASE_LABEL[hud.phase]}
          </span>
          <span className="ring__count">{hud.beatsLeft}</span>
        </div>
      </div>

      {hud.formNote && (
        <p className="hud__form" role="status" data-testid="form-note">
          <span className="hud__form-tag">Form guidance</span>
          {hud.formNote}
        </p>
      )}
    </div>
  );
}
