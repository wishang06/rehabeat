import { describe, expect, it } from 'vitest';
import { loadStems } from './stems';

type Decoder = Parameters<typeof loadStems>[0];

/** "Decodes" any body into a buffer whose duration is the byte count; bodies starting with '<' fail. */
const decoder: Decoder = {
  decodeAudioData: async (data: ArrayBuffer) => {
    if (new Uint8Array(data)[0] === '<'.charCodeAt(0)) throw new Error('EncodingError');
    return { duration: data.byteLength } as AudioBuffer;
  },
};

const audio = (bytes: number): Response =>
  new Response(new Uint8Array(bytes).fill(0xff), { headers: { 'content-type': 'audio/mpeg' } });

const indexHtml = (): Response =>
  new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

/** A fetch that answers by file name and records what was requested. */
function routes(table: Record<string, () => Response>): { fetchImpl: typeof fetch; requested: string[] } {
  const requested: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    const name = url.slice(url.lastIndexOf('/') + 1);
    const respond = table[name];
    if (!respond) throw new TypeError('Failed to fetch');
    return respond();
  };
  return { fetchImpl, requested };
}

describe('loadStems', () => {
  it('decodes both stems', async () => {
    const { fetchImpl, requested } = routes({ 'drums.mp3': () => audio(8), 'melody.mp3': () => audio(12) });

    const stems = await loadStems(decoder, '/stems', fetchImpl);

    expect(stems?.drums.duration).toBe(8);
    expect(stems?.melody.duration).toBe(12);
    expect([...requested].sort()).toEqual(['/stems/drums.mp3', '/stems/melody.mp3']);
  });

  it('defaults to /stems and tolerates a trailing slash on the base url', async () => {
    const { fetchImpl, requested } = routes({ 'drums.mp3': () => audio(8), 'melody.mp3': () => audio(8) });

    await loadStems(decoder, undefined, fetchImpl);
    await loadStems(decoder, '/music/', fetchImpl);

    expect([...requested].sort()).toEqual([
      '/music/drums.mp3',
      '/music/melody.mp3',
      '/stems/drums.mp3',
      '/stems/melody.mp3',
    ]);
  });

  it('returns null when a stem cannot be fetched', async () => {
    const { fetchImpl } = routes({ 'drums.mp3': () => audio(8) });
    expect(await loadStems(decoder, '/stems', fetchImpl)).toBeNull();
  });

  it('returns null when a stem answers with an error status', async () => {
    const { fetchImpl } = routes({
      'drums.mp3': () => audio(8),
      'melody.mp3': () => new Response('Not found', { status: 404 }),
    });
    expect(await loadStems(decoder, '/stems', fetchImpl)).toBeNull();
  });

  it('returns null when the dev server answers a missing stem with index.html', async () => {
    let decodeCalls = 0;
    const countingDecoder: Decoder = {
      decodeAudioData: async (data: ArrayBuffer) => {
        decodeCalls += 1;
        return decoder.decodeAudioData(data);
      },
    };
    const { fetchImpl } = routes({ 'drums.mp3': indexHtml, 'melody.mp3': indexHtml });

    expect(await loadStems(countingDecoder, '/stems', fetchImpl)).toBeNull();
    expect(decodeCalls).toBe(0);
  });

  it('returns null when a body with no content type fails to decode', async () => {
    const { fetchImpl } = routes({
      'drums.mp3': () => audio(8),
      'melody.mp3': () => new Response(new TextEncoder().encode('<html></html>')),
    });
    expect(await loadStems(decoder, '/stems', fetchImpl)).toBeNull();
  });

  it('returns null rather than throwing when fetch itself throws synchronously', async () => {
    const throwingFetch: typeof fetch = () => {
      throw new Error('fetch is unavailable');
    };
    expect(await loadStems(decoder, '/stems', throwingFetch)).toBeNull();
  });
});
