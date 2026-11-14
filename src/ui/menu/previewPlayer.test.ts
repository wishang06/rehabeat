import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongMeta } from '../../songs/model';
import { PreviewPlayer, type PreviewPlayerOptions } from './previewPlayer';

// ---------------------------------------------------------------- fakes

interface Automation {
  kind: 'cancel' | 'set' | 'ramp';
  value?: number;
  time: number;
}

class FakeParam {
  value = 0;
  events: Automation[] = [];
  cancelScheduledValues(time: number) {
    this.events.push({ kind: 'cancel', time });
  }
  setValueAtTime(value: number, time: number) {
    this.events.push({ kind: 'set', value, time });
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.events.push({ kind: 'ramp', value, time });
  }
  /** The ramps after the last cancel. */
  latest(): Automation[] {
    const from = this.events.map((event) => event.kind).lastIndexOf('cancel');
    return this.events.slice(from + 1);
  }
}

class FakeNode {
  connections: unknown[] = [];
  connect(destination: unknown) {
    this.connections.push(destination);
    return destination;
  }
  disconnect() {
    this.connections = [];
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeAudio {
  readyState = 0;
  currentTime = 0;
  preload = '';
  paused = true;
  routed = false;
  loads: string[] = [];
  playResult: () => Promise<void> = () => Promise.resolve();
  private source = '';
  private listeners = new Map<string, Set<() => void>>();

  get src() {
    return this.source;
  }
  set src(url: string) {
    this.source = url;
    this.readyState = 0;
    this.loads.push(url);
    setTimeout(() => {
      if (this.source !== url) return;
      this.readyState = 1;
      this.emit('loadedmetadata');
    }, 30);
  }
  removeAttribute(name: string) {
    if (name === 'src') this.source = '';
  }
  load() {}
  addEventListener(type: string, listener: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
  }
  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }
  play() {
    return this.playResult().then(() => {
      this.paused = false;
    });
  }
  pause() {
    this.paused = true;
  }
}

class FakeContext {
  state: 'running' | 'suspended' | 'closed' = 'running';
  destination = { name: 'speakers' };
  gains: FakeGain[] = [];
  sources: FakeNode[] = [];
  resume = vi.fn(() => {
    this.state = 'running';
    return Promise.resolve();
  });
  /** Fake timers drive Date, so the audio clock moves with them. */
  get currentTime() {
    return Date.now() / 1000;
  }
  createGain() {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  createMediaElementSource(element: FakeAudio) {
    // Like a browser: an element can be routed into a context only once.
    if (element.routed) throw new DOMException('already connected', 'InvalidStateError');
    element.routed = true;
    const node = new FakeNode();
    this.sources.push(node);
    return node;
  }
}

function song(id: string, durationSec = 200): SongMeta {
  return {
    id,
    title: id,
    artist: 'Someone',
    licence: 'CC-BY-4.0',
    sourceUrl: 'https://example.org/song',
    creditLine: `"${id}" by Someone (example.org), CC BY 4.0.`,
    bpm: 72,
    durationSec,
    catalogue: 'steady-flow',
    difficulty: 'steady',
  };
}

const pastSadness = song('past-sadness', 213.39);
const drift = song('drift', 200);
const tide = song('tide', 150);

function setup(overrides: Partial<PreviewPlayerOptions> = {}) {
  let ctx = new FakeContext();
  const audios: FakeAudio[] = [];
  const changes: (string | null)[] = [];
  const getContext = vi.fn(() => ctx as unknown as AudioContext);
  const loadDownbeats = vi.fn((id: string) => Promise.resolve(id === 'past-sadness' ? [59.2, 62.53, 65.86] : null));
  const player = new PreviewPlayer({
    getContext,
    createAudio: () => {
      const audio = new FakeAudio();
      audios.push(audio);
      return audio as unknown as HTMLAudioElement;
    },
    loadDownbeats,
    level: 2.5,
    onChange: (id) => changes.push(id),
    ...overrides,
  });
  return {
    player,
    audios,
    changes,
    getContext,
    loadDownbeats,
    get ctx() {
      return ctx;
    },
    swapContext() {
      ctx = new FakeContext();
      return ctx;
    },
    gain: () => ctx.gains[ctx.gains.length - 1].gain,
  };
}

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);
/** Delay, metadata and a little more: long enough for a requested preview to be playing. */
const UNTIL_PLAYING = 400;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------- tests

describe('PreviewPlayer before user activation', () => {
  it('plays nothing and never touches the AudioContext', async () => {
    const { player, audios, getContext } = setup();
    player.request(pastSadness);
    await advance(2000);
    expect(getContext).not.toHaveBeenCalled();
    expect(audios).toHaveLength(0);
    expect(player.playing).toBeNull();
  });

  it('starts the song asked for once enabled', async () => {
    const { player, audios } = setup();
    player.request(pastSadness);
    await advance(2000);
    player.setEnabled(true);
    await advance(UNTIL_PLAYING);
    expect(player.playing).toBe('past-sadness');
    expect(audios[0].src).toBe('/songs/past-sadness/melody.mp3');
  });

  it('warms up inside the gesture: builds the graph and resumes a suspended context', () => {
    const { player, ctx, audios, getContext } = setup();
    ctx.state = 'suspended';
    player.warmUp();
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(ctx.resume).toHaveBeenCalled();
    expect(audios).toHaveLength(1);
    expect(ctx.sources[0].connections).toEqual([ctx.gains[0]]);
    expect(ctx.gains[0].connections).toEqual([ctx.destination]);
  });
});

describe('PreviewPlayer playing a preview', () => {
  it('waits 250 ms before starting', async () => {
    const { player, audios } = setup();
    player.setEnabled(true);
    player.request(pastSadness);
    await advance(240);
    expect(audios).toHaveLength(0);
    await advance(20);
    expect(audios[0].loads).toEqual(['/songs/past-sadness/melody.mp3']);
  });

  it('starts on the downbeat nearest 30% of the song', async () => {
    const { player, audios } = setup();
    player.setEnabled(true);
    player.request(pastSadness);
    await advance(UNTIL_PLAYING);
    expect(audios[0].currentTime).toBe(62.53);
    expect(audios[0].paused).toBe(false);
  });

  it('starts at 30% of the song when it has no beatmap', async () => {
    const { player, audios } = setup();
    player.setEnabled(true);
    player.request(drift);
    await advance(UNTIL_PLAYING);
    expect(audios[0].currentTime).toBeCloseTo(60);
    expect(player.playing).toBe('drift');
  });

  it('gives up waiting for a slow beatmap and starts at 30%', async () => {
    const { player, audios } = setup({ loadDownbeats: () => new Promise(() => undefined) });
    player.setEnabled(true);
    player.request(pastSadness);
    await advance(UNTIL_PLAYING);
    expect(player.playing).toBeNull();
    await advance(1000);
    expect(player.playing).toBe('past-sadness');
    expect(audios[0].currentTime).toBeCloseTo(64.017, 2);
  });

  it('fades in over 0.5 s to the level, and out over the last 1 s of 10 s', async () => {
    const { player, gain } = setup();
    player.setEnabled(true);
    player.request(pastSadness);
    await advance(UNTIL_PLAYING);

    const [set, fadedIn, held, silent] = gain().latest();
    expect(set).toEqual({ kind: 'set', value: 0, time: expect.any(Number) as number });
    const t0 = set.time;
    expect(fadedIn.kind).toBe('ramp');
    expect(fadedIn.value).toBe(2.5);
    expect(fadedIn.time).toBeCloseTo(t0 + 0.5);
    expect(held.value).toBe(2.5);
    expect(held.time).toBeCloseTo(t0 + 9);
    expect(silent.value).toBe(0);
    expect(silent.time).toBeCloseTo(t0 + 10);
  });

  it('stops after 10 s', async () => {
    const { player, audios, changes } = setup();
    player.setEnabled(true);
    player.request(pastSadness);
    await advance(UNTIL_PLAYING);
    await advance(10_000);
    expect(player.playing).toBeNull();
    expect(audios[0].paused).toBe(true);
    expect(changes).toEqual(['past-sadness', null]);
  });

  it('does nothing when asked again for the song already playing', async () => {
    const { player, gain, audios } = setup();
    player.setEnabled(true);
    player.request(pastSadness);
    await advance(UNTIL_PLAYING);
    const events = gain().events.length;
    player.request(pastSadness);
    await advance(UNTIL_PLAYING);
    expect(gain().events).toHaveLength(events);
    expect(audios[0].loads).toHaveLength(1);
    expect(player.playing).toBe('past-sadness');
  });

  it('plays a song again when asked after its preview ended', async () => {
    const { player, changes } = setup();
    player.setEnabled(true);
    player.request(pastSadness);
    await advance(UNTIL_PLAYING + 10_000);
    player.request(pastSadness);
    await advance(UNTIL_PLAYING);
    expect(changes).toEqual(['past-sadness', null, 'past-sadness']);
  });
});

describe('PreviewPlayer moving between songs', () => {
  it('starts only the last of a quick sweep across cards', async () => {
    const { player, audios } = setup();
    player.setEnabled(true);
    player.request(pastSadness);
    await advance(100);
    player.request(drift);
    await advance(100);
    player.request(tide);
    await advance(UNTIL_PLAYING);
    expect(audios[0].loads).toEqual(['/songs/tide/melody.mp3']);
    expect(player.playing).toBe('tide');
  });

  it('fades the current preview out quickly, then starts the next', async () => {
    const { player, gain, audios, changes } = setup();
    player.setEnabled(true);
    player.request(pastSadness);
    // Past the fade-in, into the hold.
    await advance(UNTIL_PLAYING + 1000);

    const switchedAt = Date.now() / 1000;
    player.request(drift);
    expect(player.playing).toBeNull();
    const [from, to] = gain().latest();
    expect(from).toEqual({ kind: 'set', value: 2.5, time: switchedAt });
    expect(to.value).toBe(0);
    expect(to.time).toBeCloseTo(switchedAt + 0.2);

    await advance(UNTIL_PLAYING);
    expect(audios[0].src).toBe('/songs/drift/melody.mp3');
    expect(player.playing).toBe('drift');
    expect(changes).toEqual(['past-sadness', null, 'drift']);
  });

  it('fades out from wherever the fade-in had got to', async () => {
    const { player, gain } = setup();
    player.setEnabled(true);
    player.request(pastSadness);
    // Playing from 0.28 s; at 0.53 s the 0.5 s fade-in is half done.
    await advance(530);
    player.request(drift);
    const [from] = gain().latest();
    expect(from.kind).toBe('set');
    expect(from.value).toBeCloseTo(1.25);
  });

  it('lets the fade finish before the element jumps to the next song', async () => {
    const { player, audios } = setup({ delayMs: 0 });
    player.setEnabled(true);
    player.request(pastSadness);
    await advance(UNTIL_PLAYING);
    player.request(drift);
    await advance(100);
    expect(audios[0].src).toBe('/songs/past-sadness/melody.mp3');
    await advance(150);
    expect(audios[0].src).toBe('/songs/drift/melody.mp3');
  });

  it('reuses one element and one source node for every song', async () => {
    const { player, audios, ctx } = setup();
    player.setEnabled(true);
    for (const next of [pastSadness, drift, tide, pastSadness]) {
      player.request(next);
      await advance(UNTIL_PLAYING);
    }
    expect(audios).toHaveLength(1);
    expect(ctx.sources).toHaveLength(1);
    expect(player.playing).toBe('past-sadness');
  });

  it('fades out on a request for nothing', async () => {
    const { player, gain } = setup();
    player.setEnabled(true);
    player.request(pastSadness);
    await advance(UNTIL_PLAYING);
    player.request(null);
    expect(player.playing).toBeNull();
    expect(gain().latest().at(-1)?.value).toBe(0);
  });
});

describe('PreviewPlayer stopping', () => {
  it('stop() fades out quickly, pauses, and does not come back', async () => {
    const { player, gain, audios } = setup();
    player.setEnabled(true);
    player.request(pastSadness);
    await advance(UNTIL_PLAYING);

    const stoppedAt = Date.now() / 1000;
    player.stop();
    expect(player.playing).toBeNull();
    const fade = gain().latest();
    expect(fade.at(-1)?.value).toBe(0);
    expect(fade.at(-1)?.time).toBeCloseTo(stoppedAt + 0.2);
    expect(audios[0].paused).toBe(false);

    await advance(300);
    expect(audios[0].paused).toBe(true);
    await advance(5000);
    expect(player.playing).toBeNull();
  });

  it('stop() during the delay means the preview never starts', async () => {
    const { player, audios } = setup();
    player.setEnabled(true);
    player.request(pastSadness);
    await advance(100);
    player.stop();
    await advance(2000);
    expect(audios).toHaveLength(0);
  });

  it('stop() while the file loads means it never becomes audible', async () => {
    const { player, audios, changes } = setup();
    player.setEnabled(true);
    player.request(pastSadness);
    await advance(260);
    expect(audios[0].loads).toHaveLength(1);
    player.stop();
    await advance(2000);
    expect(changes).toEqual([]);
    expect(audios[0].paused).toBe(true);
  });

  it('dispose() fades out, then lets go of the element and the nodes', async () => {
    const { player, audios, ctx } = setup();
    player.setEnabled(true);
    player.request(pastSadness);
    await advance(UNTIL_PLAYING);
    player.dispose();
    expect(player.playing).toBeNull();
    await advance(300);
    expect(audios[0].paused).toBe(true);
    expect(audios[0].src).toBe('');
    expect(ctx.sources[0].connections).toEqual([]);
    expect(ctx.gains[0].connections).toEqual([]);

    player.request(drift);
    await advance(2000);
    expect(player.playing).toBeNull();
    expect(audios).toHaveLength(1);
  });

  it('setEnabled(false) fades out', async () => {
    const { player } = setup();
    player.setEnabled(true);
    player.request(pastSadness);
    await advance(UNTIL_PLAYING);
    player.setEnabled(false);
    expect(player.playing).toBeNull();
  });
});

describe('PreviewPlayer when things go wrong', () => {
  it('fails silently when play() is refused, and tries afresh next time', async () => {
    const { player, audios, changes } = setup();
    player.setEnabled(true);
    player.request(pastSadness);
    await advance(250);
    audios[0].playResult = () => Promise.reject(new DOMException('no gesture', 'NotAllowedError'));
    await advance(UNTIL_PLAYING);
    expect(player.playing).toBeNull();
    expect(changes).toEqual([]);

    audios[0].playResult = () => Promise.resolve();
    player.request(drift);
    await advance(UNTIL_PLAYING);
    expect(player.playing).toBe('drift');
    // The same element, but the file is set again rather than trusted.
    expect(audios).toHaveLength(1);
  });

  it('fails silently when the file never loads', async () => {
    const { player, audios } = setup({ loadTimeoutMs: 500 });
    player.setEnabled(true);
    player.request(pastSadness);
    await advance(255);
    // Stop the fake from ever delivering metadata for this load.
    audios[0].removeAttribute('src');
    await advance(1000);
    expect(player.playing).toBeNull();
  });

  it('plays nothing on a closed context', async () => {
    const { player, ctx, audios } = setup();
    ctx.state = 'closed';
    player.setEnabled(true);
    player.request(pastSadness);
    await advance(UNTIL_PLAYING);
    expect(player.playing).toBeNull();
    expect(audios).toHaveLength(0);
  });

  it('builds a new element on a new context, and releases the old one', async () => {
    const harness = setup();
    const { player, audios } = harness;
    player.setEnabled(true);
    player.request(pastSadness);
    await advance(UNTIL_PLAYING);
    const first = harness.ctx;

    first.state = 'closed';
    const second = harness.swapContext();
    player.request(drift);
    await advance(UNTIL_PLAYING);

    expect(audios).toHaveLength(2);
    expect(audios[0].src).toBe('');
    expect(second.sources).toHaveLength(1);
    expect(audios[1].src).toBe('/songs/drift/melody.mp3');
    expect(player.playing).toBe('drift');
  });

  it('resumes a suspended context when a preview starts', async () => {
    const { player, ctx } = setup();
    ctx.state = 'suspended';
    player.setEnabled(true);
    player.request(pastSadness);
    await advance(UNTIL_PLAYING);
    expect(ctx.resume).toHaveBeenCalled();
    expect(player.playing).toBe('past-sadness');
  });

  it('survives getContext throwing', async () => {
    const { player } = setup({
      getContext: () => {
        throw new Error('no audio here');
      },
    });
    player.setEnabled(true);
    expect(() => player.warmUp()).not.toThrow();
    player.request(pastSadness);
    await advance(UNTIL_PLAYING);
    expect(player.playing).toBeNull();
  });
});
