import { describe, expect, it } from 'vitest';
import type { Library } from '../../songs/library';
import type { SongMeta } from '../../songs/model';
import { LAST_SONG_KEY, loadLastSong, saveLastSong } from './lastSong';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

const refusing = {
  getItem: (): string | null => {
    throw new DOMException('denied', 'SecurityError');
  },
  setItem: (): void => {
    throw new DOMException('full', 'QuotaExceededError');
  },
};

const meta = (id: string, catalogue: string) => ({ id, catalogue }) as SongMeta;

const library: Library = {
  catalogues: [
    { id: 'calm-stretch', name: 'Calm Stretch', description: '', songIds: ['drift'] },
    { id: 'steady-flow', name: 'Steady Flow', description: '', songIds: ['past-sadness', 'tide'] },
  ],
  songs: { drift: meta('drift', 'calm-stretch'), 'past-sadness': meta('past-sadness', 'steady-flow') },
  problems: ['song "tide": failed'],
};

describe('loadLastSong', () => {
  it('returns the stored song when it can still be picked', () => {
    expect(loadLastSong(['past-sadness', 'drift'], memoryStorage({ [LAST_SONG_KEY]: 'drift' }))).toBe('drift');
    expect(loadLastSong(library, memoryStorage({ [LAST_SONG_KEY]: 'drift' }))).toBe('drift');
  });

  it('defaults to Past Sadness when nothing is stored', () => {
    expect(loadLastSong(['drift', 'past-sadness'], memoryStorage())).toBe('past-sadness');
  });

  it('defaults to Past Sadness when the stored song is not in the library', () => {
    expect(loadLastSong(['drift', 'past-sadness'], memoryStorage({ [LAST_SONG_KEY]: 'removed' }))).toBe('past-sadness');
    // Listed in the index but failed to load.
    expect(loadLastSong(library, memoryStorage({ [LAST_SONG_KEY]: 'tide' }))).toBe('past-sadness');
  });

  it('falls back to the first song shown when Past Sadness itself did not load', () => {
    expect(loadLastSong(['tide', 'drift'], memoryStorage())).toBe('tide');
    const withoutDefault: Library = { ...library, songs: { drift: library.songs.drift } };
    expect(loadLastSong(withoutDefault, memoryStorage({ [LAST_SONG_KEY]: 'gone' }))).toBe('drift');
  });

  it('returns Past Sadness with no valid songs at all', () => {
    expect(loadLastSong([], memoryStorage({ [LAST_SONG_KEY]: 'drift' }))).toBe('past-sadness');
  });

  it('survives storage that throws, or no storage', () => {
    expect(loadLastSong(['drift', 'past-sadness'], refusing)).toBe('past-sadness');
    expect(loadLastSong(['drift', 'past-sadness'], undefined)).toBe('past-sadness');
  });

  it('works without being handed a storage (node has no localStorage)', () => {
    expect(loadLastSong(['past-sadness'])).toBe('past-sadness');
  });
});

describe('saveLastSong', () => {
  it('stores the id under rehabeat.lastSong', () => {
    const storage = memoryStorage();
    saveLastSong('drift', storage);
    expect(storage.values.get('rehabeat.lastSong')).toBe('drift');
    expect(loadLastSong(['drift', 'past-sadness'], storage)).toBe('drift');
  });

  it('survives storage that refuses writes, or no storage', () => {
    expect(() => saveLastSong('drift', refusing)).not.toThrow();
    expect(() => saveLastSong('drift', undefined)).not.toThrow();
    expect(() => saveLastSong('drift')).not.toThrow();
  });
});
