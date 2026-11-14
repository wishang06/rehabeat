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
import type { BeatEngine } from '../audio';
import type { Session } from '../session';
import type { BeatResult, Move } from '../types';
import { BeatDial } from './BeatDial';
import { CANVAS_COLORS, prepareCanvas } from './canvas';

/** Beats of lead-in before the first move starts. */
const COUNT_IN_BEATS = 4;
/** How long the player can be out of view before the HUD says so. */
const BODY_LOST_MS = 1200;
/** A camera sample older than this is not drawn: the camera has stalled. */
const STALE_SAMPLE_MS = 500;
/**
 * How far behind the present the scoring engine is ticked. Frames reach it a
 * little after they were captured; this keeps a hold window open for them.
 */
const TICK_GRACE_SEC = 0.3;
/** Arriving within this of the first hold beat counts as in time. */
const IN_TIME_MS = 150;

/** Live values the debug panel reads while the Play screen is up. */
export interface PlayDebug {
  move: Move | null;
  frameScore: number;
  holdScore: number | null;
  beat: number;
}

interface PlayScreenProps {
  session: Session;
  /** The picked song, loaded and ready to start. */
  engine: BeatEngine;
  calibration: Calibration;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  debugRef: RefObject<PlayDebug | null>;
}

interface Hud {
  phase: Phase | 'ready';
  /** 1-based position in the routine, or 0 during the count-in. */
  moveNumber: number;
  moveName: string;
  upNext: string | null;
  phaseBeats: number;
  beatsLeft: number;
  formNote: string | null;
  bodyLost: boolean;
  result: BeatResult | null;
  stats: Stats;
}

const PHASE_LABEL: Record<Hud['phase'], string> = {
  ready: 'READY',
  reach: 'REACH',
  hold: 'HOLD',
  release: 'RELEASE',
};

const PHASE_CUE: Record<Hud['phase'], string> = {
  ready: 'Listen for the beat',
  reach: 'Move into the pose',
  hold: 'Stay with it',
  release: 'Ease back to rest',
};

const INITIAL_HUD: Hud = {
  phase: 'ready',
  moveNumber: 0,
  moveName: MOVES[0].name,
  upNext: null,
  phaseBeats: COUNT_IN_BEATS,
  beatsLeft: COUNT_IN_BEATS,
  formNote: null,
  bodyLost: false,
  result: null,
  stats: initialStats(),
};

function hudKey(hud: Hud): string {
  return [
    hud.phase,
    hud.moveNumber,
    hud.upNext,
    hud.beatsLeft,
    hud.formNote,
    hud.bodyLost,
    hud.stats.total,
  ].join('|');
}

function timingNote(result: BeatResult): string | null {
  if (result.label === 'Miss') return null;
  return result.timingOffsetMs > IN_TIME_MS
    ? `${(result.timingOffsetMs / 1000).toFixed(1)} s late`
    : 'In time';
}

export function PlayScreen({ session, engine, calibration, canvasRef, debugRef }: PlayScreenProps) {
  const [hud, setHud] = useState<Hud>(INITIAL_HUD);
  const hudRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    engine.start();

    const routine = new Routine(MOVES, COUNT_IN_BEATS);
    const scoring = new ScoringEngine({
      routine,
      timeOfBeat: (beat) => engine.clockTimeOfBeat(beat),
      offsetMs: calibration.offsetMs,
      shoulderEarBaseline: calibration.shoulderEarBaseline,
    });

    let lastSampleAt = performance.now();
    const unsubscribe = session.subscribe((sample) => {
      lastSampleAt = performance.now();
      scoring.push(sample.frame, sample.form);
    });

    let shownKey = hudKey(INITIAL_HUD);
    let lastSeen = performance.now();
    let frame = requestAnimationFrame(function draw() {
      frame = requestAnimationFrame(draw);

      // Visuals run on what is audible now; scoring runs on offset-corrected frame times.
      const beat = engine.beatPosition();
      const info = routine.phaseAt(beat);
      // Results must keep coming even if the camera stops delivering frames.
      scoring.tick(engine.clock.audibleNow() - TICK_GRACE_SEC);
      // The "music follows you" mechanic: the melody stays in while the hold score is Good or better.
      engine.setMelodyActive(melodyShouldPlay(scoring.live, scoring.lastResult));

      const live = scoring.live;
      const fresh = performance.now() - lastSampleAt < STALE_SAMPLE_MS;
      const sample = fresh ? session.latest() : null;
      // "On target" only means something while the player is meant to be in the pose.
      const matched =
        info !== null &&
        info.phase !== 'release' &&
        live.cycle?.index === info.cycle.index &&
        live.frameScore >= GOOD_SCORE;

      const canvas = canvasRef.current;
      const surface = canvas && prepareCanvas(canvas);
      if (sample?.landmarks) lastSeen = performance.now();
      if (surface && sample?.landmarks) {
        const { ctx, width, height } = surface;
        if (info) {
          const fade =
            info.phase === 'reach'
              ? 0.5 + 0.5 * info.progress
              : info.phase === 'hold'
                ? 1
                : 1 - info.progress;
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
          lineWidth: width / 200,
        });
      }

      const element = hudRef.current;
      if (element) {
        const sinceBeat = beat - Math.floor(beat);
        element.style.setProperty('--pulse', ((1 - sinceBeat) ** 2).toFixed(3));
        element.style.setProperty(
          '--progress',
          Math.min(1, Math.max(0, info ? info.progress : beat / COUNT_IN_BEATS)).toFixed(4),
        );
        element.style.setProperty('--match', (live.frameScore / 100).toFixed(3));
        if (element.dataset.matched !== String(matched)) element.dataset.matched = String(matched);
      }

      debugRef.current = {
        move: info?.cycle.move ?? null,
        frameScore: live.frameScore,
        holdScore: live.holdScore,
        beat,
      };

      const bodyLost = performance.now() - lastSeen > BODY_LOST_MS;
      const next: Hud = info
        ? {
            phase: info.phase,
            moveNumber: (info.cycle.index % MOVES.length) + 1,
            moveName: info.cycle.move.name,
            upNext: info.phase === 'release' ? routine.cycle(info.cycle.index + 1).move.name : null,
            phaseBeats: info.cycle.move.beats[info.phase],
            beatsLeft: info.beatsLeft,
            formNote: live.formNote,
            bodyLost,
            result: scoring.lastResult,
            stats: scoring.stats,
          }
        : {
            ...INITIAL_HUD,
            beatsLeft: Math.min(COUNT_IN_BEATS, Math.max(1, Math.ceil(COUNT_IN_BEATS - beat))),
            bodyLost,
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
  }, [session, engine, calibration, canvasRef, debugRef]);

  const { stats, result } = hud;
  const timing = result && timingNote(result);

  return (
    <div className="hud" ref={hudRef} data-phase={hud.phase} data-testid="play-screen">
      <div className="hud__move">
        <p className="hud__eyebrow">
          {hud.moveNumber > 0 ? `Move ${hud.moveNumber} of ${MOVES.length}` : 'First up'}
        </p>
        <p className="hud__move-name" data-testid="move-name">
          {hud.moveName}
        </p>
        <div className="hud__match" aria-hidden="true">
          <span className="hud__match-fill" />
        </div>
        {hud.upNext && <p className="hud__next">Next: {hud.upNext}</p>}
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
        <p key={stats.total} className="hud__result" data-label={result.label} role="status">
          <span className="hud__result-label" data-testid="result-label">
            {result.label}
            <span className="hud__result-score">{Math.round(result.score)}</span>
          </span>
          {timing && <span className="hud__result-timing">{timing}</span>}
        </p>
      )}

      <div className="hud__now">
        <BeatDial ticks={hud.phaseBeats} lit={hud.phaseBeats - hud.beatsLeft + 1}>
          <span className="dial__count">{hud.beatsLeft}</span>
        </BeatDial>
        <div>
          <p className="hud__phase" data-testid="phase-label">
            {PHASE_LABEL[hud.phase]}
          </p>
          <p className="hud__cue">{PHASE_CUE[hud.phase]}</p>
        </div>
      </div>

      {hud.bodyLost ? (
        <p className="hud__note" role="status" data-testid="body-lost">
          <span className="hud__note-tag">Can't see you</span>
          Step back until your head and knees are in the picture.
        </p>
      ) : (
        hud.formNote && (
          <p className="hud__note" role="status" data-testid="form-note">
            <span className="hud__note-tag">Form guidance</span>
            {hud.formNote}
          </p>
        )
      )}
    </div>
  );
}
