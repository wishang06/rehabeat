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
 * Turns a stream of PoseFrames into one BeatResult per move cycle.
 *
 * Every frame gets a 0-100 score against the current move. A move's score is
 * the mean of those frame scores inside its hold window only.
 */
export class ScoringEngine {
  private readonly routine: Routine;
  private readonly timeOfBeat: (beat: number) => number;
  private readonly offsetSec: number;
  private readonly form: FormMonitor;

  private current: CycleTimes;
  private finalized = false;
  private holdSum = 0;
  private holdFrames = 0;
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
   * frame: usually none, one when a hold window has just closed.
   */
  push(frame: PoseFrame, form: FormMetrics = NO_FORM): BeatResult[] {
    const t = frame.t - this.offsetSec;
    if (t < this.timeOfBeat(this.current.cycle.startBeat)) return [];

    // Close out every hold window this frame has moved past. A long gap in
    // frames can skip whole cycles; those score as a Miss with no frames.
    const results: BeatResult[] = [];
    for (;;) {
      if (!this.finalized && t >= this.current.holdEnd) results.push(this.finalize());
      if (t < this.current.end) break;
      this.advance();
    }

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
    if (phase === 'hold') {
      this.holdSum += score;
      this.holdFrames += 1;
    }

    this.liveState = {
      cycle,
      phase,
      frameScore: score,
      holdScore: phase === 'hold' ? this.holdSum / this.holdFrames : null,
      formNote: this.formNote,
    };
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
    this.holdSum = 0;
    this.holdFrames = 0;
    this.arrivedAt = null;
    this.formNote = null;
    this.form.reset();
  }

  private finalize(): BeatResult {
    const { cycle, holdStart, holdEnd } = this.current;
    const score = this.holdFrames > 0 ? this.holdSum / this.holdFrames : 0;
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
