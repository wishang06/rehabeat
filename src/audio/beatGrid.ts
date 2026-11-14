import type { Beatmap } from '../types';

export interface BeatGridOptions {
  /** Length in seconds of the audio loop. Beats repeat with this period. */
  loopDuration?: number;
}

/** Largest index whose value is <= target, or -1 when every value is greater. */
function lastIndexAtOrBefore(sorted: readonly number[], target: number): number {
  let low = 0;
  let high = sorted.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (sorted[mid] <= target) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/**
 * Maps between beat index and track time, piecewise-linearly through the
 * beatmap's beat list.
 *
 * Without a loop, indices outside the list extrapolate at 60 / bpm from the
 * first and last beats. With a loop, the beats inside one loop repeat every
 * `loopDuration` seconds, in both directions.
 */
export class BeatGrid {
  readonly bpm: number;
  readonly secondsPerBeat: number;
  /** Never empty: an empty beatmap becomes a single beat at its offset. */
  private readonly beats: readonly number[];
  /** 0 when the track does not loop. */
  private readonly loopDuration: number;

  constructor(beatmap: Beatmap, options: BeatGridOptions = {}) {
    this.bpm = beatmap.bpm;
    this.secondsPerBeat = 60 / beatmap.bpm;

    const loop = options.loopDuration;
    const loops = loop !== undefined && Number.isFinite(loop) && loop > 0;
    const beats = loops
      ? beatmap.beats.filter((time) => time >= 0 && time < loop)
      : [...beatmap.beats];

    // One beat extrapolated at 60 / bpm both ways is exactly an even grid from the offset.
    this.beats = beats.length > 0 ? beats : [beatmap.offset];
    this.loopDuration = loops && beats.length > 0 ? loop : 0;
  }

  /** Seconds from track start for a beat index. Index may be fractional or negative. */
  timeOfBeat(index: number): number {
    return this.loopDuration > 0 ? this.loopedTime(index) : this.unloopedTime(index);
  }

  /** Fractional beat position at a track time: the inverse of timeOfBeat. */
  beatAt(time: number): number {
    return this.loopDuration > 0 ? this.loopedBeat(time) : this.unloopedBeat(time);
  }

  private unloopedTime(index: number): number {
    const last = this.beats.length - 1;
    if (index <= 0) return this.beats[0] + index * this.secondsPerBeat;
    if (index >= last) return this.beats[last] + (index - last) * this.secondsPerBeat;
    const k = Math.floor(index);
    return this.beats[k] + (index - k) * (this.beats[k + 1] - this.beats[k]);
  }

  private unloopedBeat(time: number): number {
    const last = this.beats.length - 1;
    if (time <= this.beats[0]) return (time - this.beats[0]) / this.secondsPerBeat;
    if (time >= this.beats[last]) return last + (time - this.beats[last]) / this.secondsPerBeat;
    const k = lastIndexAtOrBefore(this.beats, time);
    return k + (time - this.beats[k]) / (this.beats[k + 1] - this.beats[k]);
  }

  private loopedTime(index: number): number {
    const count = this.beats.length;
    let loop = Math.floor(index / count);
    let within = index - loop * count;
    // Rounding can push `within` a hair outside [0, count), for example at a tiny negative index.
    if (within < 0) {
      loop -= 1;
      within += count;
    }
    if (within >= count) {
      loop += 1;
      within = 0;
    }
    const k = Math.floor(within);
    const segmentStart = this.beats[k];
    return loop * this.loopDuration + segmentStart + (within - k) * (this.segmentEnd(k) - segmentStart);
  }

  private loopedBeat(time: number): number {
    const loop = Math.floor((time - this.beats[0]) / this.loopDuration);
    const local = time - loop * this.loopDuration;
    // Rounding can leave `local` a hair before the first beat: clamp the segment, not the time.
    const k = Math.max(0, lastIndexAtOrBefore(this.beats, local));
    const segmentStart = this.beats[k];
    const fraction = (local - segmentStart) / (this.segmentEnd(k) - segmentStart);
    return loop * this.beats.length + k + fraction;
  }

  /** Where the segment starting at beat k ends: the next beat, or the first beat of the next loop. */
  private segmentEnd(k: number): number {
    return k + 1 < this.beats.length ? this.beats[k + 1] : this.loopDuration + this.beats[0];
  }
}
