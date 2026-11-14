import type { Move } from '../types';

export type Phase = 'reach' | 'hold' | 'release';

/** One pass through one move: reach, then hold, then release. Beats are absolute beat indices. */
export interface Cycle {
  /** 0-based count of cycles since the routine began. */
  index: number;
  move: Move;
  startBeat: number;
  holdStartBeat: number;
  holdEndBeat: number;
  endBeat: number;
}

export interface PhaseInfo {
  cycle: Cycle;
  phase: Phase;
  /** 0 to 1 through the current phase. */
  progress: number;
  /** Whole beats left in the current phase, counting the one in progress. */
  beatsLeft: number;
}

const moveBeats = (move: Move) => move.beats.reach + move.beats.hold + move.beats.release;

/** A looping sequence of moves laid onto the beat grid, starting at `startBeat`. */
export class Routine {
  readonly beatsPerLoop: number;
  private readonly offsets: number[];

  constructor(
    readonly moves: readonly Move[],
    readonly startBeat = 0,
  ) {
    if (moves.length === 0) throw new Error('A routine needs at least one move');
    this.offsets = [];
    let offset = 0;
    for (const move of moves) {
      this.offsets.push(offset);
      offset += moveBeats(move);
    }
    this.beatsPerLoop = offset;
  }

  /** The cycle with the given index (0 is the first move of the first loop). */
  cycle(index: number): Cycle {
    const loop = Math.floor(index / this.moves.length);
    const moveIndex = index - loop * this.moves.length;
    const move = this.moves[moveIndex];
    const startBeat = this.startBeat + loop * this.beatsPerLoop + this.offsets[moveIndex];
    const holdStartBeat = startBeat + move.beats.reach;
    const holdEndBeat = holdStartBeat + move.beats.hold;
    return { index, move, startBeat, holdStartBeat, holdEndBeat, endBeat: holdEndBeat + move.beats.release };
  }

  /** The cycle containing a (fractional) beat position, or null before the routine starts. */
  cycleAt(beat: number): Cycle | null {
    if (beat < this.startBeat) return null;
    const sinceStart = beat - this.startBeat;
    const loop = Math.floor(sinceStart / this.beatsPerLoop);
    const inLoop = sinceStart - loop * this.beatsPerLoop;
    let moveIndex = this.moves.length - 1;
    while (moveIndex > 0 && this.offsets[moveIndex] > inLoop) moveIndex--;
    return this.cycle(loop * this.moves.length + moveIndex);
  }

  /** Which phase of which move a beat position falls in, or null before the routine starts. */
  phaseAt(beat: number): PhaseInfo | null {
    const cycle = this.cycleAt(beat);
    if (!cycle) return null;

    let phase: Phase;
    let from: number;
    let to: number;
    if (beat < cycle.holdStartBeat) {
      [phase, from, to] = ['reach', cycle.startBeat, cycle.holdStartBeat];
    } else if (beat < cycle.holdEndBeat) {
      [phase, from, to] = ['hold', cycle.holdStartBeat, cycle.holdEndBeat];
    } else {
      [phase, from, to] = ['release', cycle.holdEndBeat, cycle.endBeat];
    }
    return {
      cycle,
      phase,
      progress: (beat - from) / (to - from),
      beatsLeft: Math.max(1, Math.ceil(to - beat)),
    };
  }
}
