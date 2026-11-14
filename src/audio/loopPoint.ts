import type { Beatmap } from '../types';

/** Slack for floating-point sums when deciding whether a beat fits inside the audio. */
const EPSILON = 1e-9;

/**
 * How long a looping track should play before wrapping back to its start, so
 * that the beat grid carries straight on across the seam.
 *
 * A track is rarely a whole number of beats long. Looping the whole file makes
 * the gap from the last beat of one pass to the first beat of the next longer
 * (or shorter) than a beat, and every pass after that is off the grid's count.
 *
 * Instead the loop ends where the last full beat in the beatmap ends, pulled
 * in by the first beat's offset. Wrapping to the start of the file then puts
 * the first beat exactly one beat after the last one, and the opening of the
 * file, which holds the attack of that first beat, is kept.
 *
 * A beat counts as full when the audio holds all of it. Returns
 * `audioDuration` unchanged when the beatmap has no beat to align to.
 */
export function beatAlignedLoopLength(beatmap: Beatmap, audioDuration: number): number {
  const beats = beatmap.beats.filter((time) => time >= 0 && time < audioDuration);
  if (beats.length === 0 || !(beatmap.bpm > 0)) return audioDuration;

  const first = beats[0];
  const last = beats[beats.length - 1];
  const beatLength = 60 / beatmap.bpm;
  // If the file cuts the last listed beat short, the loop ends where that beat starts.
  const end = last + beatLength <= audioDuration + EPSILON ? last + beatLength : last;

  const length = end - first;
  return length > 0 ? Math.min(length, audioDuration) : audioDuration;
}
