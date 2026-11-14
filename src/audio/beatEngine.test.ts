import { afterEach, describe, expect, it, vi } from 'vitest';
import { BeatEngine, STEM_GAIN } from './beatEngine';

/*
 * Web Audio does not exist in the test environment, so the engine runs
 * against a hand-written context that only records what it was asked to do.
 */

/** Rounds away floating-point noise so recorded automation calls compare cleanly. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

class FakeParam {
  value: number;
  readonly calls: string[] = [];

  constructor(value: number) {
    this.value = value;
  }

  setValueAtTime(value: number, time: number): void {
    this.calls.push(`set ${round(value)}@${round(time)}`);
  }

  linearRampToValueAtTime(value: number, time: number): void {
    this.calls.push(`ramp ${round(value)}@${round(time)}`);
  }

  exponentialRampToValueAtTime(value: number, time: number): void {
    this.calls.push(`decay ${round(value)}@${round(time)}`);
  }

  cancelScheduledValues(time: number): void {
    this.calls.push(`cancel@${round(time)}`);
  }
}

class FakeNode {
  readonly outputs: FakeNode[] = [];

  connect(target: FakeNode): FakeNode {
    this.outputs.push(target);
    return target;
  }

  disconnect(): void {
    this.outputs.length = 0;
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);
}

class FakeSource extends FakeNode {
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  onended: (() => void) | null = null;

  start(when: number): void {
    this.startedAt = when;
  }

  stop(when = Number.NaN): void {
    this.stoppedAt = when;
  }
}

class FakeOscillator extends FakeSource {
  readonly frequency = new FakeParam(440);
}

class FakeBufferSource extends FakeSource {
  buffer: { duration: number } | null = null;
  loop = false;
  loopEnd = 0;
}

class FakeContext {
  currentTime = 0;
  state: 'suspended' | 'running' | 'closed' = 'running';
  readonly destination = new FakeNode();
  readonly gains: FakeGain[] = [];
  readonly oscillators: FakeOscillator[] = [];
  readonly sources: FakeBufferSource[] = [];

  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }

  createOscillator(): FakeOscillator {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }

  createBufferSource(): FakeBufferSource {
    const source = new FakeBufferSource();
    this.sources.push(source);
    return source;
  }

  /** One byte of "audio" decodes to one second. */
  async decodeAudioData(data: ArrayBuffer): Promise<{ duration: number }> {
    return { duration: data.byteLength };
  }

  async resume(): Promise<void> {
    this.state = 'running';
  }

  async close(): Promise<void> {
    this.state = 'closed';
  }
}

const SECONDS_PER_BEAT = 60 / 72;

const missing = (): Response =>
  new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } });

const audio = (seconds: number): Response =>
  new Response(new Uint8Array(seconds), { headers: { 'content-type': 'audio/mpeg' } });

/** Serves the given files by path; everything else gets the dev server's index.html. */
function serve(files: Record<string, () => Response>): void {
  const fakeFetch: typeof fetch = async (input) => (files[String(input)] ?? missing)();
  vi.stubGlobal('fetch', fakeFetch);
}

/** 120 BPM, four beats in a 2 s bar. */
const BEATMAP_JSON = JSON.stringify({ bpm: 120, offset: 0, beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5] });

const STEM_FILES = {
  '/beatmap.json': () => new Response(BEATMAP_JSON),
  '/stems/drums.mp3': () => audio(2),
  '/stems/melody.mp3': () => audio(3),
};

async function createEngine(files: Record<string, () => Response> = {}): Promise<{ engine: BeatEngine; ctx: FakeContext }> {
  serve(files);
  const ctx = new FakeContext();
  const engine = await BeatEngine.create({ ctx: ctx as unknown as AudioContext });
  return { engine, ctx };
}

/** Moves the context clock and the scheduler timer forward together, 25 ms at a time. */
function advance(ctx: FakeContext, seconds: number): void {
  const steps = Math.round(seconds / 0.025);
  for (let i = 0; i < steps; i += 1) {
    ctx.currentTime += 0.025;
    vi.advanceTimersByTime(25);
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('BeatEngine.create', () => {
  it('falls back to click mode and a generated beatmap when nothing is served', async () => {
    const { engine, ctx } = await createEngine();
    expect(engine.mode).toBe('click');
    expect(engine.beatmapSource).toBe('generated');
    expect(engine.grid.bpm).toBe(72);
    expect(engine.ctx).toBe(ctx);
    expect(engine.clock.now()).toBe(0);
  });

  it('uses stems mode and the beatmap file when both are served', async () => {
    const { engine } = await createEngine(STEM_FILES);
    expect(engine.mode).toBe('stems');
    expect(engine.beatmapSource).toBe('file');
    expect(engine.grid.bpm).toBe(120);
  });

  it('builds the grid to loop over the shorter stem', async () => {
    const { engine } = await createEngine(STEM_FILES);
    expect(engine.grid.timeOfBeat(3)).toBe(1.5);
    expect(engine.grid.timeOfBeat(4)).toBe(2);
    expect(engine.grid.timeOfBeat(9)).toBe(4.5);
    expect(engine.grid.beatAt(6.25)).toBe(12.5);
  });

  it('stays in click mode when only one stem is served', async () => {
    const { engine } = await createEngine({ '/stems/drums.mp3': () => audio(2) });
    expect(engine.mode).toBe('click');
  });

  it('stays in click mode when a stem decodes to nothing', async () => {
    const { engine } = await createEngine({ ...STEM_FILES, '/stems/melody.mp3': () => audio(0) });
    expect(engine.mode).toBe('click');
  });

  it('requests the urls it was given', async () => {
    serve({
      '/songs/a.json': () => new Response(BEATMAP_JSON),
      '/songs/a/drums.mp3': () => audio(2),
      '/songs/a/melody.mp3': () => audio(2),
    });
    const ctx = new FakeContext() as unknown as AudioContext;
    const engine = await BeatEngine.create({ ctx, beatmapUrl: '/songs/a.json', stemsBaseUrl: '/songs/a' });
    expect(engine.mode).toBe('stems');
    expect(engine.beatmapSource).toBe('file');
  });

  it('makes no requests when told there is no beatmap and no stems', async () => {
    const requested: string[] = [];
    const recordingFetch: typeof fetch = async (input) => {
      requested.push(String(input));
      return STEM_FILES['/beatmap.json']();
    };
    vi.stubGlobal('fetch', recordingFetch);
    const ctx = new FakeContext() as unknown as AudioContext;
    const engine = await BeatEngine.create({ ctx, beatmapUrl: null, stemsBaseUrl: null });
    expect(requested).toEqual([]);
    expect(engine.mode).toBe('click');
    expect(engine.beatmapSource).toBe('generated');
    expect(engine.grid.bpm).toBe(72);
  });

  it('creates its own AudioContext when none is given, and closes it on dispose', async () => {
    serve({});
    vi.stubGlobal('AudioContext', FakeContext);
    const engine = await BeatEngine.create();
    const ctx = engine.ctx as unknown as FakeContext;
    expect(ctx).toBeInstanceOf(FakeContext);

    engine.dispose();
    expect(ctx.state).toBe('closed');
  });

  it('leaves a context it was given open on dispose', async () => {
    const { engine, ctx } = await createEngine();
    engine.dispose();
    expect(ctx.state).toBe('running');
  });
});

describe('BeatEngine timeline', () => {
  it('is parked at track time 0 before start', async () => {
    const { engine, ctx } = await createEngine();
    ctx.currentTime = 3;

    expect(engine.running).toBe(false);
    expect(engine.startTime).toBeNull();
    expect(engine.trackTime()).toBe(0);
    expect(engine.trackTime(123)).toBe(0);
    expect(engine.beatPosition()).toBe(0);
    expect(engine.beatPosition(123)).toBe(0);
    expect(engine.clockTimeOfBeat(0)).toBeCloseTo(3, 3);
    expect(engine.clockTimeOfBeat(4)).toBeCloseTo(3 + 4 * SECONDS_PER_BEAT, 3);
  });

  it('starts the track after the default 0.25 s delay', async () => {
    const { engine, ctx } = await createEngine();
    ctx.currentTime = 10;

    engine.start();

    expect(engine.running).toBe(true);
    expect(engine.startTime).toBe(10.25);
    expect(engine.trackTime(10.25)).toBe(0);
    expect(engine.trackTime(10)).toBe(-0.25);
    expect(engine.trackTime(12.25)).toBe(2);
    expect(engine.trackTime()).toBeCloseTo(-0.25, 3);
    engine.stop();
  });

  it('honours a custom start delay', async () => {
    const { engine, ctx } = await createEngine();
    ctx.currentTime = 10;
    engine.start(2);
    expect(engine.startTime).toBe(12);
    engine.stop();
  });

  it('maps between clock time and beats while running', async () => {
    const { engine, ctx } = await createEngine();
    ctx.currentTime = 10;
    engine.start();

    expect(engine.clockTimeOfBeat(0)).toBe(10.25);
    expect(engine.clockTimeOfBeat(6)).toBeCloseTo(10.25 + 6 * SECONDS_PER_BEAT, 9);
    expect(engine.beatPosition(10.25 + 6 * SECONDS_PER_BEAT)).toBeCloseTo(6, 9);
    expect(engine.beatPosition(10.25 + 2.5 * SECONDS_PER_BEAT)).toBeCloseTo(2.5, 9);
    expect(engine.beatPosition(10)).toBeCloseTo(-0.3, 9);
    expect(engine.beatPosition(engine.clockTimeOfBeat(41.75))).toBeCloseTo(41.75, 9);
    engine.stop();
  });

  it('parks again on stop and can be started again', async () => {
    const { engine, ctx } = await createEngine();
    ctx.currentTime = 10;
    engine.start();
    engine.stop();

    expect(engine.running).toBe(false);
    expect(engine.startTime).toBeNull();
    expect(engine.trackTime(50)).toBe(0);

    ctx.currentTime = 20;
    engine.start(0.5);
    expect(engine.running).toBe(true);
    expect(engine.startTime).toBe(20.5);
    engine.stop();
  });

  it('restarts from the top when started while running', async () => {
    const { engine, ctx } = await createEngine();
    ctx.currentTime = 10;
    engine.start();
    ctx.currentTime = 14;
    engine.start();
    expect(engine.startTime).toBe(14.25);
    expect(engine.trackTime(14.25)).toBe(0);
    engine.stop();
  });

  it('does not start once disposed', async () => {
    const { engine, ctx } = await createEngine();
    engine.dispose();
    engine.start();
    engine.playClick(1);
    expect(engine.running).toBe(false);
    expect(ctx.oscillators).toHaveLength(0);
  });

  it('resumes a suspended context', async () => {
    const { engine, ctx } = await createEngine();
    ctx.state = 'suspended';
    await engine.resume();
    expect(ctx.state).toBe('running');
  });
});

describe('BeatEngine in click mode', () => {
  it('clicks every beat exactly once, on time, accenting every fourth', async () => {
    vi.useFakeTimers();
    const { engine, ctx } = await createEngine();
    ctx.currentTime = 1;

    engine.start();
    advance(ctx, 5);

    // Track time is now 4.75 s, so the 150 ms lookahead covers beats 0-5 (beat 6 is at 5.0 s).
    expect(ctx.oscillators).toHaveLength(6);
    ctx.oscillators.forEach((oscillator, index) => {
      expect(oscillator.startedAt).toBeCloseTo(1.25 + index * SECONDS_PER_BEAT, 9);
      expect(oscillator.startedAt).toBeCloseTo(engine.clockTimeOfBeat(index), 9);
    });
    expect(ctx.oscillators.map((oscillator) => oscillator.frequency.value)).toEqual([
      1500, 1000, 1000, 1000, 1500, 1000,
    ]);
    engine.stop();
  });

  it('schedules each click ahead of time, never late', async () => {
    vi.useFakeTimers();
    const { engine, ctx } = await createEngine();
    engine.start();

    const scheduledAt: number[] = [];
    for (let step = 0; step < 160; step += 1) {
      ctx.currentTime += 0.025;
      vi.advanceTimersByTime(25);
      while (scheduledAt.length < ctx.oscillators.length) scheduledAt.push(ctx.currentTime);
    }

    expect(ctx.oscillators.length).toBeGreaterThan(3);
    ctx.oscillators.forEach((oscillator, index) => {
      const lead = (oscillator.startedAt ?? 0) - scheduledAt[index];
      expect(lead).toBeGreaterThan(0.12);
      expect(lead).toBeLessThanOrEqual(0.15 + 1e-9);
    });
    engine.stop();
  });

  it('routes clicks through the run output to the speakers', async () => {
    vi.useFakeTimers();
    const { engine, ctx } = await createEngine();
    engine.start(0);

    const [oscillator] = ctx.oscillators;
    const envelope = oscillator.outputs[0];
    const output = envelope.outputs[0];
    expect(output.outputs).toEqual([ctx.destination]);
    engine.stop();
  });

  it('leaves the click track at its own level: the stem gain is for the stems', async () => {
    vi.useFakeTimers();
    const { engine, ctx } = await createEngine();
    engine.start(0);

    const output = ctx.oscillators[0].outputs[0].outputs[0] as FakeGain;
    expect(output.gain.value).toBe(1);
    engine.stop();
  });

  it('stops scheduling and silences pending clicks on stop', async () => {
    vi.useFakeTimers();
    const { engine, ctx } = await createEngine();
    engine.start(0);
    advance(ctx, 1);
    const clicksBeforeStop = ctx.oscillators.length;
    const output = ctx.oscillators[0].outputs[0].outputs[0];

    engine.stop();
    advance(ctx, 3);

    expect(ctx.oscillators).toHaveLength(clicksBeforeStop);
    expect(output.outputs).toEqual([]);
  });

  it('starts again from beat 0 after a stop', async () => {
    vi.useFakeTimers();
    const { engine, ctx } = await createEngine();
    engine.start();
    advance(ctx, 2);
    engine.stop();
    const clicksInFirstRun = ctx.oscillators.length;

    engine.start();
    const restartedAt = engine.startTime ?? 0;
    advance(ctx, 1);

    const secondRun = ctx.oscillators.slice(clicksInFirstRun);
    expect(secondRun.map((oscillator) => oscillator.frequency.value)).toEqual([1500, 1000]);
    expect(secondRun[0].startedAt).toBeCloseTo(restartedAt, 9);
    expect(secondRun[1].startedAt).toBeCloseTo(restartedAt + SECONDS_PER_BEAT, 9);
    engine.stop();
  });

  it('only records the melody state', async () => {
    const { engine, ctx } = await createEngine();
    engine.start();
    const gainsBefore = ctx.gains.map((gain) => gain.gain.calls.length);

    expect(engine.melodyActive).toBe(false);
    engine.setMelodyActive(true);
    expect(engine.melodyActive).toBe(true);
    engine.setMelodyActive(false);
    expect(engine.melodyActive).toBe(false);

    expect(ctx.gains.map((gain) => gain.gain.calls.length)).toEqual(gainsBefore);
    expect(ctx.sources).toHaveLength(0);
    engine.stop();
  });

  it('plays a one-off click at the requested time whether or not it is running', async () => {
    const { engine, ctx } = await createEngine();
    ctx.currentTime = 2;

    engine.playClick(3.5);
    engine.playClick(4.5, true);

    expect(engine.running).toBe(false);
    expect(ctx.oscillators.map((oscillator) => oscillator.startedAt)).toEqual([3.5, 4.5]);
    expect(ctx.oscillators.map((oscillator) => oscillator.frequency.value)).toEqual([1000, 1500]);
    expect(ctx.oscillators[0].outputs[0].outputs).toEqual([ctx.destination]);
  });

  it('disconnects a click once it has ended', async () => {
    const { engine, ctx } = await createEngine();
    engine.playClick(1);
    const [oscillator] = ctx.oscillators;
    const envelope = oscillator.outputs[0];

    oscillator.onended?.();

    expect(oscillator.outputs).toEqual([]);
    expect(envelope.outputs).toEqual([]);
  });
});

describe('BeatEngine in stems mode', () => {
  it('starts both stems at the same instant, looping over the shorter one', async () => {
    const { engine, ctx } = await createEngine(STEM_FILES);
    ctx.currentTime = 5;

    engine.start();

    expect(ctx.sources).toHaveLength(2);
    const [drums, melody] = ctx.sources;
    expect(drums.buffer?.duration).toBe(2);
    expect(melody.buffer?.duration).toBe(3);
    for (const source of ctx.sources) {
      expect(source.startedAt).toBe(5.25);
      expect(source.loop).toBe(true);
      expect(source.loopEnd).toBe(2);
    }
    engine.stop();
  });

  it('loops where the last full beat ends rather than at the end of the file', async () => {
    // Four beats from 0.25 s at 120 BPM in 3 s of audio: the fourth beat ends at 2.25 s.
    const { engine, ctx } = await createEngine({
      '/beatmap.json': () =>
        new Response(JSON.stringify({ bpm: 120, offset: 0.25, beats: [0.25, 0.75, 1.25, 1.75] })),
      '/stems/drums.mp3': () => audio(3),
      '/stems/melody.mp3': () => audio(3),
    });
    engine.start(0);

    for (const source of ctx.sources) expect(source.loopEnd).toBe(2);
    expect(engine.loopLength).toBe(2);
    // The first beat of the second pass lands exactly one beat after the last beat of the first.
    expect(engine.grid.timeOfBeat(3)).toBe(1.75);
    expect(engine.grid.timeOfBeat(4)).toBe(2.25);
    expect(engine.grid.timeOfBeat(8)).toBe(4.25);
    engine.stop();
  });

  it('has no loop length in click mode', async () => {
    const { engine } = await createEngine();
    expect(engine.loopLength).toBeNull();
  });

  it('raises both stems 2.5x on their way to the speakers', async () => {
    const { engine, ctx } = await createEngine(STEM_FILES);
    engine.start();

    const [drums, melody] = ctx.sources;
    const output = drums.outputs[0] as FakeGain;
    const melodyGain = melody.outputs[0] as FakeGain;
    // The melody reaches the same output as the drums, so one gain lifts both.
    expect(melodyGain.outputs).toEqual([output]);
    expect(output.gain.value).toBe(2.5);
    expect(STEM_GAIN).toBe(2.5);
    engine.stop();
  });

  it('plays the drums straight through and the melody through a gain that starts at 0', async () => {
    const { engine, ctx } = await createEngine(STEM_FILES);
    engine.start();

    const [drums, melody] = ctx.sources;
    const output = drums.outputs[0] as FakeGain;
    const melodyGain = melody.outputs[0] as FakeGain;
    expect(output.outputs).toEqual([ctx.destination]);
    expect(melodyGain).not.toBe(output);
    expect(melodyGain.gain.value).toBe(0);
    expect(melodyGain.outputs).toEqual([output]);
    engine.stop();
  });

  it('plays no click track', async () => {
    vi.useFakeTimers();
    const { engine, ctx } = await createEngine(STEM_FILES);
    engine.start();
    advance(ctx, 3);
    expect(ctx.oscillators).toHaveLength(0);
    engine.stop();
  });

  it('fades the melody only when the state changes', async () => {
    const { engine, ctx } = await createEngine(STEM_FILES);
    ctx.currentTime = 5;
    engine.start();
    const melodyGain = ctx.sources[1].outputs[0] as FakeGain;

    ctx.currentTime = 6;
    for (let frame = 0; frame < 30; frame += 1) engine.setMelodyActive(false);
    expect(melodyGain.gain.calls).toEqual([]);

    for (let frame = 0; frame < 30; frame += 1) engine.setMelodyActive(true);
    expect(engine.melodyActive).toBe(true);
    expect(melodyGain.gain.calls).toEqual(['cancel@6', 'set 0@6', 'ramp 1@6.3']);

    ctx.currentTime = 8;
    for (let frame = 0; frame < 30; frame += 1) engine.setMelodyActive(false);
    expect(engine.melodyActive).toBe(false);
    expect(melodyGain.gain.calls.slice(3)).toEqual(['cancel@8', 'set 1@8', 'ramp 0@8.3']);
    engine.stop();
  });

  it('reverses a melody fade from where it had got to', async () => {
    const { engine, ctx } = await createEngine(STEM_FILES);
    ctx.currentTime = 5;
    engine.start();
    const melodyGain = ctx.sources[1].outputs[0] as FakeGain;

    ctx.currentTime = 6;
    engine.setMelodyActive(true);
    ctx.currentTime = 6.15;
    engine.setMelodyActive(false);

    expect(melodyGain.gain.calls.slice(3)).toEqual(['cancel@6.15', 'set 0.5@6.15', 'ramp 0@6.45']);
    engine.stop();
  });

  it('starts every run with the melody silent', async () => {
    const { engine, ctx } = await createEngine(STEM_FILES);
    engine.setMelodyActive(true);
    engine.start();
    expect(engine.melodyActive).toBe(false);

    engine.setMelodyActive(true);
    engine.stop();
    expect(engine.melodyActive).toBe(false);

    engine.start();
    const secondRunMelodyGain = ctx.sources[3].outputs[0] as FakeGain;
    expect(secondRunMelodyGain.gain.value).toBe(0);
    expect(secondRunMelodyGain.gain.calls).toEqual([]);
    engine.setMelodyActive(true);
    expect(secondRunMelodyGain.gain.calls).toHaveLength(3);
    engine.stop();
  });

  it('fades out, stops both stems together and then disconnects them on stop', async () => {
    const { engine, ctx } = await createEngine(STEM_FILES);
    ctx.currentTime = 5;
    engine.start();
    const [drums, melody] = ctx.sources;
    const output = drums.outputs[0] as FakeGain;
    const melodyGain = melody.outputs[0] as FakeGain;

    ctx.currentTime = 9;
    engine.stop();

    // The fade starts from the level the stems were playing at.
    expect(output.gain.calls).toEqual(['set 2.5@9', 'ramp 0@9.03']);
    expect(drums.stoppedAt).toBeCloseTo(9.03, 9);
    expect(melody.stoppedAt).toBe(drums.stoppedAt);
    expect(output.outputs).toEqual([ctx.destination]);

    drums.onended?.();
    expect(drums.outputs).toEqual([]);
    expect(melody.outputs).toEqual([]);
    expect(melodyGain.outputs).toEqual([]);
    expect(output.outputs).toEqual([]);
  });

  it('cuts the stems at once when the context is not running', async () => {
    const { engine, ctx } = await createEngine(STEM_FILES);
    engine.start();
    const [drums, melody] = ctx.sources;
    const output = drums.outputs[0] as FakeGain;

    ctx.state = 'suspended';
    engine.stop();

    expect(drums.stoppedAt).toBeNaN();
    expect(melody.stoppedAt).toBeNaN();
    expect(output.outputs).toEqual([]);
  });

  it('keeps the beat position continuous across the loop point', async () => {
    const { engine, ctx } = await createEngine(STEM_FILES);
    ctx.currentTime = 0;
    engine.start(0);

    expect(engine.beatPosition(1.75)).toBe(3.5);
    expect(engine.beatPosition(2)).toBe(4);
    expect(engine.beatPosition(5.25)).toBe(10.5);
    expect(engine.clockTimeOfBeat(8)).toBe(4);
    engine.stop();
  });
});
