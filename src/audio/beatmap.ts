import type { Beatmap } from '../types';

export const DEFAULT_BPM = 72;
export const DEFAULT_BEAT_COUNT = 64;

export type BeatmapSource = 'file' | 'generated';

export interface LoadedBeatmap {
  beatmap: Beatmap;
  source: BeatmapSource;
}

/** An evenly spaced beatmap starting at track time 0. */
export function generateBeatmap(bpm = DEFAULT_BPM, beatCount = DEFAULT_BEAT_COUNT): Beatmap {
  const secondsPerBeat = 60 / bpm;
  const beats = Array.from({ length: beatCount }, (_, index) => index * secondsPerBeat);
  return { bpm, offset: 0, beats };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Returns a clean Beatmap when `value` has the right shape, else null. */
export function parseBeatmap(value: unknown): Beatmap | null {
  if (typeof value !== 'object' || value === null) return null;
  const { bpm, offset, beats } = value as Record<string, unknown>;
  if (!isFiniteNumber(bpm) || bpm <= 0) return null;
  if (!isFiniteNumber(offset)) return null;
  if (!Array.isArray(beats) || !beats.every(isFiniteNumber)) return null;
  // Strictly ascending: two beats at the same instant would make the beat grid non-invertible.
  if (beats.some((time, index) => index > 0 && time <= beats[index - 1])) return null;
  return { bpm, offset, beats: [...beats] };
}

/**
 * Loads the beatmap file, falling back to a generated 72 BPM grid when it is
 * missing or unusable. Never throws.
 */
export async function loadBeatmap(
  url = '/beatmap.json',
  fetchImpl: typeof fetch = fetch,
): Promise<LoadedBeatmap> {
  try {
    const response = await fetchImpl(url);
    if (response.ok) {
      const beatmap = parseBeatmap(await response.json());
      if (beatmap) return { beatmap, source: 'file' };
    }
  } catch {
    // Network failure, or a body that is not JSON: the dev server answers a
    // missing file with index.html and status 200.
  }
  return { beatmap: generateBeatmap(DEFAULT_BPM), source: 'generated' };
}
