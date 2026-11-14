import { describe, expect, it } from 'vitest';
import {
  SongLibraryError,
  groupByCatalogue,
  loadLibrary,
  parseIndex,
  parseMeta,
  songUrls,
  type Library,
} from './library';
import type { SongIndex, SongMeta } from './model';

function meta(overrides: Partial<SongMeta> = {}): SongMeta {
  return {
    id: 'past-sadness',
    title: 'Past Sadness',
    artist: 'Kevin MacLeod',
    licence: 'CC-BY-4.0',
    sourceUrl: 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1900007',
    creditLine:
      '"Past Sadness" by Kevin MacLeod (incompetech.com), CC BY 4.0. Separated into drum and melody stems by the Rehabeat team.',
    bpm: 72,
    durationSec: 213.39,
    catalogue: 'steady-flow',
    difficulty: 'steady',
    ...overrides,
  };
}

const INDEX: SongIndex = {
  catalogues: [
    { id: 'calm-stretch', name: 'Calm Stretch', description: 'Slow.', songIds: ['drift'] },
    { id: 'steady-flow', name: 'Steady Flow', description: 'Even.', songIds: ['past-sadness'] },
    { id: 'active-rehab', name: 'Active Rehab', description: 'Brisk.', songIds: [] },
  ],
};

describe('parseIndex', () => {
  it('accepts a well-formed index', () => {
    expect(parseIndex(INDEX)).toEqual(INDEX);
  });

  it.each([
    ['a non-object', [], /catalogues/],
    ['no catalogues', { catalogues: [] }, /at least one catalogue/],
    ['a catalogue without a name', { catalogues: [{ id: 'a', description: '', songIds: [] }] }, /catalogues\[0\] \(a\).*"name"/],
    ['a bad catalogue id', { catalogues: [{ id: 'Calm Stretch', name: 'x', description: '', songIds: [] }] }, /"id"/],
    ['song ids that are not a list', { catalogues: [{ id: 'a', name: 'A', description: '', songIds: 'x' }] }, /"songIds"/],
    [
      'duplicate catalogue ids',
      { catalogues: [INDEX.catalogues[0], { ...INDEX.catalogues[0], songIds: [] }] },
      /duplicate catalogue id "calm-stretch"/,
    ],
    [
      'a song listed twice',
      { catalogues: [INDEX.catalogues[0], { ...INDEX.catalogues[1], songIds: ['drift'] }] },
      /"drift" is listed in both "calm-stretch" and "steady-flow"/,
    ],
  ])('rejects %s', (_label, value, message) => {
    expect(() => parseIndex(value)).toThrow(SongLibraryError);
    expect(() => parseIndex(value)).toThrow(message);
  });
});

describe('parseMeta', () => {
  it('accepts a well-formed meta.json', () => {
    expect(parseMeta(meta())).toEqual(meta());
  });

  it.each([
    ['a missing title', { title: '' }, /"title"/],
    ['an id that is not a slug', { id: 'Past Sadness' }, /"id"/],
    ['an unknown licence', { licence: 'CC-BY-NC-4.0' }, /"licence"/],
    ['a source that is not a web address', { sourceUrl: 'incompetech.com' }, /"sourceUrl"/],
    ['an empty credit line', { creditLine: ' ' }, /"creditLine"/],
    ['a zero BPM', { bpm: 0 }, /"bpm"/],
    ['a negative duration', { durationSec: -1 }, /"durationSec"/],
    ['an unknown difficulty', { difficulty: 'hard' }, /"difficulty"/],
    ['a missing catalogue', { catalogue: '' }, /"catalogue"/],
  ])('rejects %s', (_label, overrides, message) => {
    expect(() => parseMeta({ ...meta(), ...overrides })).toThrow(SongLibraryError);
    expect(() => parseMeta({ ...meta(), ...overrides })).toThrow(message);
  });

  it('names the song in its errors', () => {
    expect(() => parseMeta({ ...meta(), bpm: 'fast' })).toThrow(/past-sadness\/meta\.json/);
  });

  it('checks the id matches the folder it was loaded from', () => {
    expect(() => parseMeta(meta(), 'drift')).toThrow(/"id" is "past-sadness" but the folder is "drift"/);
  });
});

/** A fetch that serves the given JSON documents by path and 404s everything else. */
function serve(files: Record<string, unknown>): typeof fetch {
  return async (input) => {
    const path = String(input);
    if (!(path in files)) return new Response('Not found', { status: 404 });
    return new Response(JSON.stringify(files[path]), { headers: { 'content-type': 'application/json' } });
  };
}

const drift = meta({
  id: 'drift',
  title: 'Drift',
  artist: 'Someone',
  licence: 'CC0-1.0',
  sourceUrl: 'https://example.org/drift',
  creditLine: '"Drift" by Someone (example.org), CC0 1.0. Separated into drum and melody stems by the Rehabeat team.',
  bpm: 64,
  catalogue: 'calm-stretch',
  difficulty: 'gentle',
});

describe('loadLibrary', () => {
  it('loads the index and every song listed in it', async () => {
    const library = await loadLibrary(
      serve({
        '/songs/index.json': INDEX,
        '/songs/drift/meta.json': drift,
        '/songs/past-sadness/meta.json': meta(),
      }),
    );
    expect(library.catalogues).toEqual(INDEX.catalogues);
    expect(library.songs).toEqual({ drift, 'past-sadness': meta() });
    expect(library.problems).toEqual([]);
  });

  it('fails when the index itself cannot be read', async () => {
    await expect(loadLibrary(serve({}))).rejects.toThrow(/songs\/index\.json/);
  });

  it('skips a song it cannot load and reports why, keeping the rest', async () => {
    const library = await loadLibrary(
      serve({ '/songs/index.json': INDEX, '/songs/past-sadness/meta.json': meta() }),
    );
    expect(Object.keys(library.songs)).toEqual(['past-sadness']);
    expect(library.problems).toEqual([expect.stringMatching(/drift.*404/)]);
  });

  it("reports a song whose meta.json names a different catalogue from the one listing it", async () => {
    const library = await loadLibrary(
      serve({
        '/songs/index.json': INDEX,
        '/songs/drift/meta.json': { ...drift, catalogue: 'active-rehab' },
        '/songs/past-sadness/meta.json': meta(),
      }),
    );
    expect(library.songs.drift).toBeUndefined();
    expect(library.problems).toEqual([
      expect.stringMatching(/drift.*"active-rehab".*listed in "calm-stretch"/),
    ]);
  });

  it('serves the files from the base path it is given', async () => {
    const library = await loadLibrary(
      serve({
        '/game/songs/index.json': { catalogues: [{ ...INDEX.catalogues[1] }] },
        '/game/songs/past-sadness/meta.json': meta(),
      }),
      '/game/songs',
    );
    expect(Object.keys(library.songs)).toEqual(['past-sadness']);
  });
});

describe('groupByCatalogue', () => {
  const library: Library = {
    catalogues: [
      { id: 'calm-stretch', name: 'Calm Stretch', description: '', songIds: ['b', 'missing', 'a'] },
      { id: 'active-rehab', name: 'Active Rehab', description: '', songIds: [] },
    ],
    songs: {
      a: meta({ id: 'a', catalogue: 'calm-stretch' }),
      b: meta({ id: 'b', catalogue: 'calm-stretch' }),
    },
    problems: [],
  };

  it('keeps index order for catalogues and songs, skipping songs that did not load', () => {
    const groups = groupByCatalogue(library);
    expect(groups.map((group) => [group.catalogue.id, group.songs.map((song) => song.id)])).toEqual([
      ['calm-stretch', ['b', 'a']],
      ['active-rehab', []],
    ]);
  });

  it('keeps empty catalogues', () => {
    expect(groupByCatalogue(library)[1].songs).toEqual([]);
  });
});

describe('songUrls', () => {
  it('points at the files in the song folder', () => {
    expect(songUrls('drift')).toEqual({
      folder: '/songs/drift',
      beatmap: '/songs/drift/beatmap.json',
      melody: '/songs/drift/melody.mp3',
    });
  });
});
