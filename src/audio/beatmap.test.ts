import { describe, expect, it } from 'vitest';
import { generateBeatmap, loadBeatmap, parseBeatmap } from './beatmap';

const VALID = { bpm: 96, offset: 0.25, beats: [0.25, 0.875, 1.5, 2.125] };

function respondWith(body: string, init: ResponseInit = {}): typeof fetch {
  return async () => new Response(body, init);
}

const jsonHeaders = { 'content-type': 'application/json' };
const htmlHeaders = { 'content-type': 'text/html' };

describe('generateBeatmap', () => {
  it('defaults to 64 beats at 72 BPM starting at 0', () => {
    const beatmap = generateBeatmap();
    expect(beatmap.bpm).toBe(72);
    expect(beatmap.offset).toBe(0);
    expect(beatmap.beats).toHaveLength(64);
    expect(beatmap.beats[0]).toBe(0);
    expect(beatmap.beats[1]).toBeCloseTo(60 / 72, 12);
    expect(beatmap.beats[63]).toBeCloseTo((63 * 60) / 72, 9);
  });

  it('spaces beats evenly at the requested tempo', () => {
    expect(generateBeatmap(120, 4)).toEqual({ bpm: 120, offset: 0, beats: [0, 0.5, 1, 1.5] });
  });

  it('produces something parseBeatmap accepts', () => {
    expect(parseBeatmap(generateBeatmap())).toEqual(generateBeatmap());
  });
});

describe('parseBeatmap', () => {
  it('accepts a well-formed beatmap', () => {
    expect(parseBeatmap(VALID)).toEqual(VALID);
  });

  it('accepts an empty beat list', () => {
    expect(parseBeatmap({ bpm: 72, offset: 0, beats: [] })).toEqual({ bpm: 72, offset: 0, beats: [] });
  });

  it('returns a copy holding only the contract fields', () => {
    const input = { ...VALID, beats: [...VALID.beats], title: 'extra' };
    const parsed = parseBeatmap(input);
    expect(parsed).toEqual(VALID);
    expect(parsed?.beats).not.toBe(input.beats);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', '{"bpm":72}'],
    ['a number', 72],
    ['an array', [0, 1, 2]],
    ['an empty object', {}],
    ['a missing bpm', { offset: 0, beats: [0, 1] }],
    ['a zero bpm', { ...VALID, bpm: 0 }],
    ['a negative bpm', { ...VALID, bpm: -72 }],
    ['a NaN bpm', { ...VALID, bpm: Number.NaN }],
    ['an infinite bpm', { ...VALID, bpm: Number.POSITIVE_INFINITY }],
    ['a string bpm', { ...VALID, bpm: '72' }],
    ['a missing offset', { bpm: 72, beats: [0, 1] }],
    ['an infinite offset', { ...VALID, offset: Number.NEGATIVE_INFINITY }],
    ['missing beats', { bpm: 72, offset: 0 }],
    ['beats that are not an array', { ...VALID, beats: '0,1,2' }],
    ['a non-numeric beat', { ...VALID, beats: [0, '1', 2] }],
    ['a NaN beat', { ...VALID, beats: [0, Number.NaN, 2] }],
    ['descending beats', { ...VALID, beats: [0, 2, 1] }],
    ['repeated beats', { ...VALID, beats: [0, 1, 1, 2] }],
  ])('rejects %s', (_label, value) => {
    expect(parseBeatmap(value)).toBeNull();
  });
});

describe('loadBeatmap', () => {
  it('returns the file when it is valid', async () => {
    const loaded = await loadBeatmap('/beatmap.json', respondWith(JSON.stringify(VALID), { headers: jsonHeaders }));
    expect(loaded).toEqual({ beatmap: VALID, source: 'file' });
  });

  it('requests the given url, defaulting to /beatmap.json', async () => {
    const requested: unknown[] = [];
    const recordingFetch: typeof fetch = async (input) => {
      requested.push(input);
      return new Response(JSON.stringify(VALID));
    };
    await loadBeatmap(undefined, recordingFetch);
    await loadBeatmap('/songs/other.json', recordingFetch);
    expect(requested).toEqual(['/beatmap.json', '/songs/other.json']);
  });

  it('falls back to a generated beatmap on a network error', async () => {
    const failingFetch: typeof fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    const loaded = await loadBeatmap('/beatmap.json', failingFetch);
    expect(loaded).toEqual({ beatmap: generateBeatmap(72), source: 'generated' });
  });

  it('falls back on a non-OK status even when the body is a valid beatmap', async () => {
    const loaded = await loadBeatmap('/beatmap.json', respondWith(JSON.stringify(VALID), { status: 404 }));
    expect(loaded.source).toBe('generated');
    expect(loaded.beatmap.bpm).toBe(72);
  });

  it('falls back when a 200 response carries the dev server index.html', async () => {
    const html = '<!doctype html><html><body><div id="root"></div></body></html>';
    const loaded = await loadBeatmap('/beatmap.json', respondWith(html, { status: 200, headers: htmlHeaders }));
    expect(loaded).toEqual({ beatmap: generateBeatmap(72), source: 'generated' });
  });

  it('falls back when the JSON has the wrong shape', async () => {
    const loaded = await loadBeatmap('/beatmap.json', respondWith('{"bpm":"fast"}', { headers: jsonHeaders }));
    expect(loaded.source).toBe('generated');
  });

  it('falls back on an empty body', async () => {
    const loaded = await loadBeatmap('/beatmap.json', respondWith(''));
    expect(loaded.source).toBe('generated');
  });
});
