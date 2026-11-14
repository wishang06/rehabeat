import { songUrls } from '../../songs/library';

function isAscendingTimes(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((time, index) => typeof time === 'number' && Number.isFinite(time) && (index === 0 || time > value[index - 1]))
  );
}

/**
 * The times a preview may start on, from a song's beatmap.json: its
 * `downbeats`, or its `beats` for an older beatmap without them. Null when it
 * has neither.
 */
export function parseDownbeats(value: unknown): number[] | null {
  if (typeof value !== 'object' || value === null) return null;
  const { downbeats, beats } = value as Record<string, unknown>;
  if (isAscendingTimes(downbeats)) return [...downbeats];
  if (isAscendingTimes(beats)) return [...beats];
  return null;
}

export type DownbeatLoader = (songId: string) => Promise<number[] | null>;

/**
 * Fetches each song's beatmap at most once. Never rejects: a missing or broken
 * beatmap gives null, and the preview starts at 30% of the song instead.
 */
export function createDownbeatLoader(
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  urlFor: (songId: string) => string = (songId) => songUrls(songId).beatmap,
): DownbeatLoader {
  const cache = new Map<string, Promise<number[] | null>>();
  return (songId) => {
    let loading = cache.get(songId);
    if (!loading) {
      loading = (async () => {
        try {
          const response = await fetchImpl(urlFor(songId));
          if (!response.ok) return null;
          // The dev server answers a missing file with index.html, which is not JSON.
          return parseDownbeats(await response.json());
        } catch {
          return null;
        }
      })();
      cache.set(songId, loading);
    }
    return loading;
  };
}

/** The loader the menu shares across mounts, so a beatmap is fetched once per page load. */
export const loadDownbeats: DownbeatLoader = createDownbeatLoader();
