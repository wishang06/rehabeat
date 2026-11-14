import { describe, expect, it, vi } from 'vitest';
import { createDownbeatLoader, parseDownbeats } from './downbeats';

const json = (body: unknown, ok = true) =>
  Promise.resolve({ ok, json: () => Promise.resolve(body) } as unknown as Response);

describe('parseDownbeats', () => {
  it('reads the downbeats of a beatmap', () => {
    expect(parseDownbeats({ bpm: 72, beats: [0, 1, 2, 3, 4], downbeats: [1, 4] })).toEqual([1, 4]);
  });

  it('falls back to the beats when there are no usable downbeats', () => {
    expect(parseDownbeats({ beats: [0.5, 1.3] })).toEqual([0.5, 1.3]);
    expect(parseDownbeats({ beats: [0.5, 1.3], downbeats: [] })).toEqual([0.5, 1.3]);
    expect(parseDownbeats({ beats: [0.5, 1.3], downbeats: [4, 2] })).toEqual([0.5, 1.3]);
  });

  it('is null for anything else', () => {
    expect(parseDownbeats(null)).toBeNull();
    expect(parseDownbeats('beats')).toBeNull();
    expect(parseDownbeats({ beats: ['1', 2] })).toBeNull();
    expect(parseDownbeats({ downbeats: [1, Number.NaN] })).toBeNull();
  });
});

describe('createDownbeatLoader', () => {
  it("fetches each song's beatmap once", async () => {
    const fetchImpl = vi.fn(() => json({ beats: [0, 1], downbeats: [0] }));
    const load = createDownbeatLoader(fetchImpl as unknown as typeof fetch);
    expect(await load('past-sadness')).toEqual([0]);
    expect(await load('past-sadness')).toEqual([0]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('/songs/past-sadness/beatmap.json');
  });

  it('gives null for a failed request, a network error or a body that is not JSON', async () => {
    const failed = createDownbeatLoader((() => json({}, false)) as unknown as typeof fetch);
    expect(await failed('a')).toBeNull();

    const offline = createDownbeatLoader((() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch);
    expect(await offline('a')).toBeNull();

    const html = createDownbeatLoader(
      (() => Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError('<!doctype')) })) as unknown as typeof fetch,
    );
    expect(await html('a')).toBeNull();
  });
});
