import type { RampParam } from '../../audio';

/*
 * Timing for the song previews in the menu: where in the song a preview
 * starts, and the gain envelope it plays under. Pure functions only.
 */

/** How long a preview lasts, fades included. */
export const PREVIEW_SEC = 10;
export const PREVIEW_FADE_IN_SEC = 0.5;
export const PREVIEW_FADE_OUT_SEC = 1;
/** The quick fade used when the player moves to another card, picks a song or leaves the menu. */
export const PREVIEW_STOP_SEC = 0.2;
/**
 * How long the pointer or focus must rest on a card before its preview
 * starts, so sweeping across the grid does not set off a burst of previews.
 */
export const PREVIEW_DELAY_MS = 250;
/** Where a preview aims to start, as a fraction of the song. */
export const PREVIEW_AT = 0.3;

/**
 * The second a preview starts at: the downbeat nearest `at` (30%) of the song,
 * or exactly 30% when there are no downbeats. Never so late that the preview
 * would run past the end of the song.
 */
export function choosePreviewStart(
  durationSec: number,
  downbeats: readonly number[] | null | undefined,
  lengthSec = PREVIEW_SEC,
  at = PREVIEW_AT,
): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  const latest = Math.max(0, durationSec - lengthSec);
  const target = Math.min(durationSec * at, latest);

  let best: number | null = null;
  for (const time of downbeats ?? []) {
    if (!Number.isFinite(time) || time < 0 || time > latest) continue;
    if (best === null || Math.abs(time - target) < Math.abs(best - target)) best = time;
  }
  return best ?? target;
}

/** One point of a gain envelope. The first point is set; each later one is ramped to linearly. */
export interface GainStep {
  /** AudioContext time, in seconds. */
  at: number;
  value: number;
}

export interface EnvelopeOptions {
  lengthSec?: number;
  fadeInSec?: number;
  fadeOutSec?: number;
}

/** The envelope of a whole preview starting at `start`: fade in, hold at `level`, fade out. */
export function previewEnvelope(start: number, level: number, options: EnvelopeOptions = {}): GainStep[] {
  const length = Math.max(0, options.lengthSec ?? PREVIEW_SEC);
  const fadeIn = Math.min(options.fadeInSec ?? PREVIEW_FADE_IN_SEC, length / 2);
  const fadeOut = Math.min(options.fadeOutSec ?? PREVIEW_FADE_OUT_SEC, length - fadeIn);
  return [
    { at: start, value: 0 },
    { at: start + fadeIn, value: level },
    { at: start + length - fadeOut, value: level },
    { at: start + length, value: 0 },
  ];
}

/**
 * The gain an envelope gives at `time`. Worked out from the envelope rather
 * than read back from AudioParam.value, which browsers update late.
 */
export function gainAt(steps: readonly GainStep[], time: number): number {
  if (steps.length === 0) return 0;
  if (time <= steps[0].at) return steps[0].value;
  for (let i = 1; i < steps.length; i += 1) {
    const from = steps[i - 1];
    const to = steps[i];
    if (time < to.at) {
      const span = to.at - from.at;
      return span <= 0 ? to.value : from.value + ((to.value - from.value) * (time - from.at)) / span;
    }
  }
  return steps[steps.length - 1].value;
}

/** A fade from wherever `steps` has the gain at `now` down to silence over `fadeSec`. */
export function fadeOutSteps(steps: readonly GainStep[], now: number, fadeSec = PREVIEW_STOP_SEC): GainStep[] {
  return [
    { at: now, value: gainAt(steps, now) },
    { at: now + Math.max(0, fadeSec), value: 0 },
  ];
}

/** When an envelope ends: the time of its last point. */
export function envelopeEnd(steps: readonly GainStep[]): number {
  return steps.length === 0 ? 0 : steps[steps.length - 1].at;
}

/** Replaces whatever `param` had scheduled from the first step on with `steps`. */
export function applySteps(param: RampParam, steps: readonly GainStep[]): void {
  if (steps.length === 0) return;
  const [first, ...rest] = steps;
  param.cancelScheduledValues(first.at);
  param.setValueAtTime(first.value, first.at);
  for (const step of rest) param.linearRampToValueAtTime(step.value, step.at);
}
