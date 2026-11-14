import type { BeatGrid } from './beatGrid';

export interface DueBeat {
  index: number;
  /** Track time of the beat in seconds. */
  time: number;
}

/**
 * The bookkeeping of a lookahead scheduler: polled every few milliseconds,
 * it hands out each beat from index 0 upward exactly once, as soon as the
 * beat comes within `lookaheadSec` of the current track time.
 */
export class BeatScheduler {
  private readonly grid: Pick<BeatGrid, 'timeOfBeat' | 'beatAt'>;
  private readonly lookaheadSec: number;
  private nextIndex = 0;

  constructor(grid: Pick<BeatGrid, 'timeOfBeat' | 'beatAt'>, lookaheadSec = 0.15) {
    this.grid = grid;
    this.lookaheadSec = lookaheadSec;
  }

  /** The beats that have newly come within the lookahead window at `trackNow`. */
  due(trackNow: number): DueBeat[] {
    this.skipMissedBeats(trackNow);
    const horizon = trackNow + this.lookaheadSec;
    const beats: DueBeat[] = [];
    for (let time = this.grid.timeOfBeat(this.nextIndex); time <= horizon; ) {
      beats.push({ index: this.nextIndex, time });
      this.nextIndex += 1;
      time = this.grid.timeOfBeat(this.nextIndex);
    }
    return beats;
  }

  /**
   * After a stalled timer (a backgrounded tab, a long task) the beats already
   * behind us are dropped: playing them late would come out as a burst.
   */
  private skipMissedBeats(trackNow: number): void {
    const atOrBeforeNow = Math.floor(this.grid.beatAt(trackNow));
    if (this.nextIndex < atOrBeforeNow) this.nextIndex = atOrBeforeNow;
    while (this.grid.timeOfBeat(this.nextIndex) < trackNow) this.nextIndex += 1;
  }
}
