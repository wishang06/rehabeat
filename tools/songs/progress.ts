/** Reading Demucs's progress bar and turning it into a time estimate. Pure functions. */
import { formatDuration } from '../../src/songs/model';

export interface DemucsProgress {
  percent: number;
  /** The first run downloads the model, with a progress bar of its own (in bytes). */
  phase: 'separating' | 'downloading';
}

/**
 * The latest progress in a stretch of Demucs's stderr. tqdm redraws its bar with a
 * carriage return, so a chunk can hold several bars or the end of one: the last
 * "NN%|" wins. Null if the text has none.
 */
export function parseDemucsProgress(text: string): DemucsProgress | null {
  let latest: DemucsProgress | null = null;
  for (const segment of text.split(/[\r\n]+/)) {
    const matches = [...segment.matchAll(/(\d{1,3})%\|/g)];
    const last = matches.at(-1);
    if (!last) continue;
    const percent = Math.min(100, Number(last[1]));
    // The model download counts bytes ("15.0MB/s", "?B/s"); the separation counts "seconds/s".
    latest = { percent, phase: /B\/s/.test(segment) ? 'downloading' : 'separating' };
  }
  return latest;
}

/** Seconds left at a steady pace: elapsed x (100 - p) / p. Null before there is any progress. */
export function remainingSec(elapsedSec: number, percent: number): number | null {
  if (!(percent > 0)) return null;
  return (elapsedSec * (100 - percent)) / percent;
}

/**
 * What to expect before Demucs reports progress, from the song's length. Measured on
 * this project's laptop (CPU only): 62 s for a 20 s song, most of it starting up, and
 * 2.5 to 10 minutes for a 3.5-minute one (tools/README.md).
 */
export function roughStemsSec(durationSec: number): number {
  return 30 + 1.2 * durationSec;
}

export function clock(seconds: number): string {
  return formatDuration(Math.max(0, seconds));
}

/** The spinner line while Demucs runs. */
export function describeStemsProgress(elapsedSec: number, progress: DemucsProgress | null, durationSec: number): string {
  const elapsed = `${clock(elapsedSec)} elapsed`;
  if (progress?.phase === 'downloading') {
    return `Downloading the Demucs model (first run only): ${progress.percent}% · ${elapsed}`;
  }
  const left = progress ? remainingSec(elapsedSec, progress.percent) : null;
  if (progress && left !== null) {
    return `Separating stems: ${progress.percent}% · ${elapsed} · about ${clock(left)} left`;
  }
  return `Separating stems · ${elapsed} · usually about ${clock(roughStemsSec(durationSec))} for a ${clock(durationSec)} song`;
}
