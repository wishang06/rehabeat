export interface Stems {
  drums: AudioBuffer;
  melody: AudioBuffer;
}

type AudioDecoder = Pick<BaseAudioContext, 'decodeAudioData'>;

/**
 * Rules out failed requests and text bodies before decoding: the dev server
 * answers a missing file with index.html and status 200.
 */
function mayBeAudio(response: Response): boolean {
  const contentType = response.headers.get('content-type') ?? '';
  return response.ok && !contentType.toLowerCase().startsWith('text/');
}

async function loadStem(
  ctx: AudioDecoder,
  url: string,
  fetchImpl: typeof fetch,
): Promise<AudioBuffer | null> {
  try {
    const response = await fetchImpl(url);
    if (!mayBeAudio(response)) return null;
    return await ctx.decodeAudioData(await response.arrayBuffer());
  } catch {
    // Network failure, or bytes that are not decodable audio.
    return null;
  }
}

/**
 * Loads `${baseUrl}/drums.mp3` and `${baseUrl}/melody.mp3`. Returns null when
 * either is missing, is not audio or fails to decode. Never throws.
 */
export async function loadStems(
  ctx: AudioDecoder,
  baseUrl = '/stems',
  fetchImpl: typeof fetch = fetch,
): Promise<Stems | null> {
  const base = baseUrl.replace(/\/+$/, '');
  const [drums, melody] = await Promise.all([
    loadStem(ctx, `${base}/drums.mp3`, fetchImpl),
    loadStem(ctx, `${base}/melody.mp3`, fetchImpl),
  ]);
  return drums && melody ? { drums, melody } : null;
}
