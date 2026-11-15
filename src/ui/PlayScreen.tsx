import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { FeedbackTracker, feedbackStore } from '../engine';
import {
  GOOD_SCORE,
  MELODY_HOLD_OFF_BEATS,
  MelodyGate,
  Routine,
  ScoringEngine,
  initialStats,
  melodyShouldPlay,
  pointsFor,
  type Calibration,
  type HoldDetail,
  type Phase,
  type Stats,
} from '../scoring';
import type { BeatEngine } from '../audio';
import { maxPointsFor } from '../progress';
import type { Session } from '../session';
import type { BeatResult, Move } from '../types';
import { prepareCanvas } from './canvas';
import { PlayHud } from './hud/PlayHud';
import type { HudRun } from './hud/types';
import { PlayOverlay } from './overlay';
import { easeOffText, plannedMoveCount, roundOf, sessionOver, type PlayPlan } from './playProgram';

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

/** The run so far, read by the app when the player finishes. */
export interface PlayRun {
  stats: Stats;
  points: number;
  /** performance.now() when the Play screen started. */
  startedAt: number;
  /** Every hold scored so far, in order: what a program session records. */
  details: readonly HoldDetail[];
  /** The most this run can score (see plannedMoveCount): the score tube's full mark and the results' stars. */
  maxPoints: number;
}

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
  /** What to play: the moves, how many rounds (null: until the player finishes) and the player's limits. */
  plan: PlayPlan;
  /** Called once when a program session has played its last round. */
  onComplete: () => void;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  debugRef: RefObject<PlayDebug | null>;
  runRef: RefObject<PlayRun | null>;
}

interface Hud {
  phase: Phase | 'ready';
  /** 1-based position in the routine, or 0 during the count-in. */
  moveNumber: number;
  /** The round of a program session, or null in free play. */
  round: { current: number; total: number } | null;
  moveName: string;
  upNext: string | null;
  phaseBeats: number;
  beatsLeft: number;
  formNote: string | null;
  easeOff: string | null;
  bodyLost: boolean;
  result: BeatResult | null;
  stats: Stats;
  points: number;
}

const initialHud = (plan: PlayPlan): Hud => ({
  phase: 'ready',
  moveNumber: 0,
  round: roundOf(0, plan.moves.length, plan.rounds),
  moveName: plan.moves[0].name,
  upNext: null,
  phaseBeats: COUNT_IN_BEATS,
  beatsLeft: COUNT_IN_BEATS,
  formNote: null,
  easeOff: null,
  bodyLost: false,
  result: null,
  stats: initialStats(),
  points: 0,
});

function hudKey(hud: Hud): string {
  return [
    hud.phase,
    hud.moveNumber,
    hud.round?.current,
    hud.upNext,
    hud.beatsLeft,
    hud.formNote,
    hud.easeOff,
    hud.bodyLost,
    hud.stats.total,
    hud.points,
  ].join('|');
}

function timingNote(result: BeatResult): string | null {
  if (result.label === 'Miss') return null;
  return result.timingOffsetMs > IN_TIME_MS
    ? `${(result.timingOffsetMs / 1000).toFixed(1)} s late`
    : 'In time';
}

export function PlayScreen({
  session,
  engine,
  calibration,
  plan,
  onComplete,
  canvasRef,
  debugRef,
  runRef,
}: PlayScreenProps) {
  const [hud, setHud] = useState<Hud>(() => initialHud(plan));
  const hudRef = useRef<HTMLDivElement>(null);
  // The latest callback, without restarting the song when the parent re-renders.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  // Free play is measured against one pass of the song: its loop, in beats.
  const maxPoints = useMemo(() => {
    const passBeats = engine.loopLength === null ? null : engine.loopLength / engine.grid.secondsPerBeat;
    return maxPointsFor(plannedMoveCount(plan, new Routine(plan.moves, COUNT_IN_BEATS), passBeats));
  }, [engine, plan]);

  useEffect(() => {
    engine.start();

    const moveCount = plan.moves.length;
    const first = initialHud(plan);
    const routine = new Routine(plan.moves, COUNT_IN_BEATS);
    const scoring = new ScoringEngine({
      routine,
      timeOfBeat: (beat) => engine.clockTimeOfBeat(beat),
      offsetMs: calibration.offsetMs,
      shoulderEarBaseline: calibration.shoulderEarBaseline,
      limits: plan.limits,
    });
    const feedback = new FeedbackTracker(routine);
    const overlay = new PlayOverlay();
    const melody = new MelodyGate(MELODY_HOLD_OFF_BEATS * engine.grid.secondsPerBeat);

    const run: PlayRun = { stats: scoring.stats, points: 0, startedAt: performance.now(), details: scoring.details, maxPoints };
    runRef.current = run;
    let over = false;

    let lastSampleAt = performance.now();
    const unsubscribe = session.subscribe((sample) => {
      lastSampleAt = performance.now();
      scoring.push(sample.frame, sample.form);
    });

    let shownKey = hudKey(first);
    let lastSeen = performance.now();
    let frame = requestAnimationFrame(function draw() {
      frame = requestAnimationFrame(draw);

      // Visuals run on what is audible now; scoring runs on offset-corrected frame times.
      const beat = engine.beatPosition();
      const info = routine.phaseAt(beat);
      const now = engine.clock.audibleNow();
      // Results must keep coming even if the camera stops delivering frames.
      scoring.tick(now - TICK_GRACE_SEC);
      const fresh = performance.now() - lastSampleAt < STALE_SAMPLE_MS;
      // The "music follows you" mechanic: the melody plays while you are in the pose,
      // and a stalled camera can't keep it playing.
      engine.setMelodyActive(melody.update(now, melodyShouldPlay(scoring.live, scoring.lastResult, fresh)));

      // Award points once per newly scored move.
      if (scoring.stats.total > run.stats.total && scoring.lastResult) {
        run.points += pointsFor(scoring.lastResult.label, scoring.stats.combo);
      }
      run.stats = scoring.stats;
      run.details = scoring.details;

      // A program session ends itself once its last round has been played and scored.
      if (!over && sessionOver(plan, routine, beat, scoring.details.length)) {
        over = true;
        onCompleteRef.current();
      }

      const live = scoring.live;
      const sample = fresh ? session.latest() : null;
      // "On target" only means something while the player is meant to be in the pose.
      const matched =
        info !== null &&
        info.phase !== 'release' &&
        live.cycle?.index === info.cycle.index &&
        live.frameScore >= GOOD_SCORE;

      const current = feedback.update({
        now,
        beat,
        frame: sample?.frame ?? null,
        world: sample?.worldLandmarks ?? null,
        live,
      });
      feedbackStore.publish(current);

      const canvas = canvasRef.current;
      const surface = canvas && prepareCanvas(canvas);
      if (sample?.landmarks) lastSeen = performance.now();
      if (surface) {
        overlay.draw(surface, current, sample?.landmarks ?? null, sample?.worldLandmarks ?? null, performance.now());
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
            moveNumber: (info.cycle.index % moveCount) + 1,
            round: roundOf(info.cycle.index, moveCount, plan.rounds),
            moveName: info.cycle.move.name,
            upNext: info.phase === 'release' ? routine.cycle(info.cycle.index + 1).move.name : null,
            phaseBeats: info.cycle.move.beats[info.phase],
            beatsLeft: info.beatsLeft,
            formNote: live.formNote,
            easeOff: easeOffText(live.overLimit),
            bodyLost,
            result: scoring.lastResult,
            stats: scoring.stats,
            points: run.points,
          }
        : {
            ...first,
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
      feedbackStore.publish(null);
      engine.setMelodyActive(false);
      engine.stop();
      debugRef.current = null;
    };
  }, [session, engine, calibration, plan, canvasRef, debugRef, runRef, maxPoints]);

  const { stats, result } = hud;
  // The scoring engine's state, in the shape the HUD takes. Per-frame values reach the HUD through feedbackStore.
  const run: HudRun = {
    points: hud.points,
    maxPoints,
    combo: stats.combo,
    perfectStreak: stats.streak,
    accuracy: stats.total > 0 ? stats.accuracy : null,
    moveNumber: hud.moveNumber,
    moveCount: plan.moves.length,
    round: hud.round,
    result: result
      ? { serial: stats.total, label: result.label, score: result.score, timing: timingNote(result) }
      : null,
    formNote: hud.formNote,
    bodyLost: hud.bodyLost,
    easeOff: hud.easeOff,
  };

  return <PlayHud ref={hudRef} frames={feedbackStore} run={run} moves={plan.moves} />;
}
