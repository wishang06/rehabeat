import type { BeatResult, FormMetrics, PoseFrame } from '../types';
import { FormMonitor, formNoteFor } from './formRules';
import { GOOD_SCORE, labelFor, scoreFrame } from './frameScore';
import type { Cycle, Phase, Routine } from './routine';
import { applyResult, initialStats, type Stats } from './stats';

export interface ScoringEngineOptions {
  routine: Routine;
  /** Master-clock time (seconds) of a beat index. */
  timeOfBeat: (beat: number) => number;
  /**
   * Calibration offset: how many ms after the beat the camera sees the player
   * arrive. Frames are shifted back by this before being placed on the beat grid.
   */
  offsetMs?: number;
  /** Resting FormMetrics.shoulderEarRatio from calibration; the shrug rule is off without it. */
  shoulderEarBaseline?: number | null;
}

/** What the engine knows as of the latest frame, in the player's (offset-corrected) time. */
export interface LiveState {
  /** null until the routine's first beat. */
  cycle: Cycle | null;
  phase: Phase | null;
  /** Score of the latest frame against the current move. */
  frameScore: number;
  /** Mean frame score over the hold so far; null outside the hold window. */
  holdScore: number | null;
  /** Form guidance flagged during the current cycle, if any. */
  formNote: string | null;
}

interface CycleTimes {
  cycle: Cycle;
  holdStart: number;
  holdEnd: number;
  end: number;
}

const NO_FORM: FormMetrics = { trunkLeanDeg: null, shoulderEarRatio: null };

/**
 * The longest a single frame can stand for in a hold. A frame's score counts
 * from its own time until the next frame arrives, but past this the camera
 * has stalled and nothing is known about the player.
 */
export const MAX_FRAME_SPAN_SEC = 0.2;

/** A frame the engine has seen, at its offset-corrected time. */
interface SeenFrame {
  t: number;
  frame: PoseFrame;
}

/**
 * Turns a stream of PoseFrames into one BeatResult per move cycle.
 *
 * Every frame gets a 0-100 score against the current move. A move's score is
 * the time-weighted mean of those frame scores inside its hold window only:
 * each frame stands from its own time until the next one (at most
 * MAX_FRAME_SPAN_SEC), so the hold is judged by time on the beat grid and a
 * dip in the frame rate does not change the result.
 */
export class ScoringEngine {
  private readonly routine: Routine;
  private readonly timeOfBeat: (beat: number) => number;
  private readonly offsetSec: number;
  private readonly form: FormMonitor;

  private current: CycleTimes;
  private finalized = false;
  /** Time-weighted mean frame score over the part of the hold window covered so far. */
  private holdAverage = 0;
  /** Seconds of the hold window covered by frames so far. */
  private holdCovered = 0;
  private previous: SeenFrame | null = null;
  private arrivedAt: number | null = null;
  private formNote: string | null = null;

  private liveState: LiveState = {
    cycle: null,
    phase: null,
    frameScore: 0,
    holdScore: null,
    formNote: null,
  };
  private statsState: Stats = initialStats();
  private last: BeatResult | null = null;

  constructor(options: ScoringEngineOptions) {
    this.routine = options.routine;
    this.timeOfBeat = options.timeOfBeat;
    this.offsetSec = (options.offsetMs ?? 0) / 1000;
    this.form = new FormMonitor({ shoulderEarBaseline: options.shoulderEarBaseline ?? null });
    this.current = this.timesFor(0);
  }

  get live(): LiveState {
    return this.liveState;
  }

  get stats(): Stats {
    return this.statsState;
  }

  get lastResult(): BeatResult | null {
    return this.last;
  }

  /**
   * Feed every frame, in time order. Returns the results completed by this
   * frame: usually none, one when a hold window has just closed. Results that
   * tick() already returned are not returned again.
   */
  push(frame: PoseFrame, form: FormMetrics = NO_FORM): BeatResult[] {
    const t = frame.t - this.offsetSec;
    const previous = this.previous;
    this.previous = { t, frame };
    if (t < this.timeOfBeat(this.current.cycle.startBeat)) return [];

    const results = this.closeUpTo(t, previous);

    const { cycle, holdStart, holdEnd } = this.current;
    const phase: Phase = t < holdStart ? 'reach' : t < holdEnd ? 'hold' : 'release';
    const score = scoreFrame(frame, cycle.move);

    if (phase !== 'release') {
      if (this.arrivedAt === null && score >= GOOD_SCORE) this.arrivedAt = t;
      const flagged = this.form.update(t, form, cycle.move.formRules);
      if (this.formNote === null && flagged.length > 0) {
        this.formNote = formNoteFor(flagged[0]) ?? null;
      }
    }

    this.liveState = {
      cycle,
      phase,
      frameScore: score,
      holdScore: phase === 'hold' ? this.holdMean(score) : null,
      formNote: this.formNote,
    };
    return results;
  }

  /**
   * Adds the span from `previous` to `t`, at the previous frame's score
   * against the current move, to the current hold window where they overlap.
   */
  private cover(previous: SeenFrame, t: number): void {
    if (this.finalized) return;
    const { cycle, holdStart, holdEnd } = this.current;
    const spanEnd = Math.min(t, previous.t + MAX_FRAME_SPAN_SEC);
    const overlap = Math.min(spanEnd, holdEnd) - Math.max(previous.t, holdStart);
    if (!(overlap > 0)) return;
    this.holdCovered += overlap;
    // A running weighted mean, so a hold at a constant score stays exactly that score.
    const score = scoreFrame(previous.frame, cycle.move);
    this.holdAverage += ((score - this.holdAverage) * overlap) / this.holdCovered;
  }

  /** The hold's time-weighted mean so far; `fallback` until any time is covered. */
  private holdMean(fallback: number): number {
    return this.holdCovered > 0 ? this.holdAverage : fallback;
  }

  /**
   * Tell the engine the time without giving it a frame, so results still arrive
   * if the camera stalls. Closes every hold window that `clockTime` has passed.
   * Pass a time slightly behind the present: frames reach the engine a little
   * after they were captured, and a window closed too eagerly would drop them.
   */
  tick(clockTime: number): BeatResult[] {
    const t = clockTime - this.offsetSec;
    if (t < this.timeOfBeat(this.current.cycle.startBeat)) return [];

    const before = this.current.cycle.index;
    const results = this.closeUpTo(t, null);
    if (this.current.cycle.index !== before) {
      // No frame has been seen in the new cycle yet.
      const { cycle, holdStart, holdEnd } = this.current;
      this.liveState = {
        cycle,
        phase: t < holdStart ? 'reach' : t < holdEnd ? 'hold' : 'release',
        frameScore: 0,
        holdScore: null,
        formNote: null,
      };
    }
    return results;
  }

  /**
   * Closes out every hold window that time `t` has moved past. A long gap can
   * skip whole cycles; those score as a Miss with no frames. The span since
   * `previous` is counted toward each hold it overlaps before that hold
   * closes: the one ending now and, for a move with no reach, the next one.
   */
  private closeUpTo(t: number, previous: SeenFrame | null): BeatResult[] {
    const results: BeatResult[] = [];
    for (;;) {
      if (previous) this.cover(previous, t);
      if (!this.finalized && t >= this.current.holdEnd) results.push(this.finalize());
      if (t < this.current.end) break;
      this.advance();
    }
    return results;
  }

  private timesFor(index: number): CycleTimes {
    const cycle = this.routine.cycle(index);
    return {
      cycle,
      holdStart: this.timeOfBeat(cycle.holdStartBeat),
      holdEnd: this.timeOfBeat(cycle.holdEndBeat),
      end: this.timeOfBeat(cycle.endBeat),
    };
  }

  private advance(): void {
    this.current = this.timesFor(this.current.cycle.index + 1);
    this.finalized = false;
    this.holdAverage = 0;
    this.holdCovered = 0;
    this.arrivedAt = null;
    this.formNote = null;
    this.form.reset();
  }

  private finalize(): BeatResult {
    const { cycle, holdStart, holdEnd } = this.current;
    const score = this.holdMean(0);
    // Never reaching the pose reports the full hold length as the lateness.
    const arrival = this.arrivedAt ?? holdEnd;

    const result: BeatResult = {
      moveId: cycle.move.id,
      score,
      label: labelFor(score),
      timingOffsetMs: (arrival - holdStart) * 1000,
    };
    if (this.formNote !== null) result.formNote = this.formNote;

    this.finalized = true;
    this.last = result;
    this.statsState = applyResult(this.statsState, result);
    return result;
  }
}

/**
 * The "music follows you" rule: the melody plays while the current hold score
 * is Good or better. Between holds it carries the last move's result, so a
 * good hold keeps the melody through the release and the next reach.
 */
export function melodyShouldPlay(live: LiveState, lastResult: BeatResult | null): boolean {
  const score = live.holdScore ?? lastResult?.score ?? 0;
  return score >= GOOD_SCORE;
}
