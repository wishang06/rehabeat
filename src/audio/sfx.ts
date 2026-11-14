/**
 * Arcade sound effects, synthesized with Web Audio: no files to load.
 *
 * Every sound is a short recipe of oscillators and filtered noise, played
 * through one bus (gain, then a compressor so stacked sounds never clip).
 * The bus has its own AudioContext so it stays out of the beat engine's way.
 * It is created on the first press or key, which is when browsers allow
 * sound, and everything before that is silently dropped.
 *
 * Sounds sit high and short so they read over the music without clashing
 * with it: clicks and chirps, not notes held under the melody.
 */

export type SfxName =
  // Menus
  | 'hover'
  | 'nav'
  | 'press'
  | 'confirm'
  | 'back'
  | 'toggle'
  // Play
  | 'count'
  | 'go'
  | 'reach'
  | 'hold'
  | 'lock'
  | 'perfect'
  | 'good'
  | 'miss'
  | 'combo'
  | 'warn'
  // Results
  | 'slam'
  | 'star'
  | 'tick'
  | 'levelUp'
  | 'fanfare';

export interface SfxOptions {
  /** For 'combo' and 'star': which step this is, so each one sits higher than the last. */
  step?: number;
  /** Scales the sound's loudness, 0-1. */
  volume?: number;
}

const MUTE_KEY = 'rehabeat.sfx.muted';
const MASTER_GAIN = 0.42;
/** The same sound twice within this is one sound: hover and focus often land together. */
const REPEAT_GAP_SEC = 0.035;
const FLOOR = 0.0001;

let ctx: AudioContext | null = null;
let bus: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let muted = readMuted();
const lastPlayed = new Map<SfxName, number>();
const listeners = new Set<(muted: boolean) => void>();

function readMuted(): boolean {
  try {
    return globalThis.localStorage?.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Creates or resumes the context. Call from inside a click or key press. */
export function unlockSfx(): void {
  if (typeof AudioContext === 'undefined') return;
  if (!ctx) {
    try {
      ctx = new AudioContext({ latencyHint: 'interactive' });
    } catch {
      return;
    }
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 8;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.12;
    bus = ctx.createGain();
    bus.gain.value = muted ? 0 : MASTER_GAIN;
    bus.connect(compressor).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
}

export function isSfxMuted(): boolean {
  return muted;
}

export function setSfxMuted(next: boolean): void {
  muted = next;
  try {
    globalThis.localStorage?.setItem(MUTE_KEY, next ? '1' : '0');
  } catch {
    // Private mode: the choice lasts for this visit.
  }
  if (ctx && bus) bus.gain.setTargetAtTime(next ? 0 : MASTER_GAIN, ctx.currentTime, 0.01);
  for (const listener of listeners) listener(next);
}

export function onSfxMuteChange(listener: (muted: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Plays a sound now. Does nothing before the page has had a press, or while muted. */
export function playSfx(name: SfxName, options: SfxOptions = {}): void {
  if (!ctx || !bus || muted || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  const last = lastPlayed.get(name);
  if (last !== undefined && now - last < REPEAT_GAP_SEC) return;
  lastPlayed.set(name, now);
  const voice = new Voice(ctx, bus, now + 0.005, options.volume ?? 1);
  RECIPES[name](voice, options.step ?? 0);
}

// ---------------------------------------------------------------------------
// The building blocks.

interface ToneSpec {
  type?: OscillatorType;
  freq: number;
  /** Glide to this frequency over the sound. */
  to?: number;
  at?: number;
  dur: number;
  gain: number;
  attack?: number;
  detune?: number;
}

interface NoiseSpec {
  at?: number;
  dur: number;
  gain: number;
  filter?: BiquadFilterType;
  freq: number;
  /** Sweep the filter to this frequency. */
  to?: number;
  q?: number;
}

class Voice {
  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
    private readonly t0: number,
    private readonly level: number,
  ) {}

  tone({ type = 'sine', freq, to, at = 0, dur, gain, attack = 0.004, detune = 0 }: ToneSpec): void {
    const start = this.t0 + at;
    const end = start + dur;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), end);
    osc.detune.value = detune;
    const env = this.envelope(start, end, gain, attack);
    osc.connect(env);
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
    };
    osc.start(start);
    osc.stop(end + 0.02);
  }

  noise({ at = 0, dur, gain, filter = 'bandpass', freq, to, q = 1 }: NoiseSpec): void {
    const start = this.t0 + at;
    const end = start + dur;
    const source = this.ctx.createBufferSource();
    source.buffer = noise(this.ctx);
    source.loop = true;
    const shape = this.ctx.createBiquadFilter();
    shape.type = filter;
    shape.Q.value = q;
    shape.frequency.setValueAtTime(freq, start);
    if (to !== undefined) shape.frequency.exponentialRampToValueAtTime(Math.max(20, to), end);
    const env = this.envelope(start, end, gain, 0.002);
    source.connect(shape).connect(env);
    source.onended = () => {
      source.disconnect();
      shape.disconnect();
      env.disconnect();
    };
    source.start(start, Math.random());
    source.stop(end + 0.02);
  }

  /** Notes one after another, `gap` seconds apart. */
  arp(freqs: number[], gap: number, spec: Omit<ToneSpec, 'freq' | 'at'> & { at?: number }): void {
    freqs.forEach((freq, index) => this.tone({ ...spec, freq, at: (spec.at ?? 0) + index * gap }));
  }

  private envelope(start: number, end: number, gain: number, attack: number): GainNode {
    const env = this.ctx.createGain();
    const peak = Math.max(FLOOR, gain * this.level);
    env.gain.setValueAtTime(FLOOR, start);
    env.gain.exponentialRampToValueAtTime(peak, start + Math.min(attack, (end - start) / 2));
    env.gain.exponentialRampToValueAtTime(FLOOR, end);
    env.connect(this.out);
    return env;
  }
}

function noise(context: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer;
  const length = context.sampleRate;
  noiseBuffer = context.createBuffer(1, length, context.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

/** Semitones above A4. */
const note = (semitones: number) => 440 * 2 ** (semitones / 12);

// A bright major pentatonic run, for things that go up.
const SCALE = [0, 2, 4, 7, 9];
const scaleStep = (step: number, base = 3) => note(base + SCALE[step % 5] + 12 * Math.floor(step / 5));

// ---------------------------------------------------------------------------
// The recipes.

const RECIPES: Record<SfxName, (v: Voice, step: number) => void> = {
  // A dry tick, barely there: the cursor passing over something.
  hover: (v) => {
    v.tone({ type: 'triangle', freq: 2400, to: 2000, dur: 0.03, gain: 0.12 });
  },

  // Keyboard or arrow movement between items: a short square blip.
  nav: (v) => {
    v.tone({ type: 'square', freq: 1320, dur: 0.035, gain: 0.07 });
    v.tone({ type: 'sine', freq: 2640, dur: 0.025, gain: 0.05 });
  },

  // An ordinary button: a click with a little body.
  press: (v) => {
    v.noise({ dur: 0.025, gain: 0.25, filter: 'highpass', freq: 3000 });
    v.tone({ type: 'triangle', freq: 880, to: 1320, dur: 0.07, gain: 0.22 });
  },

  // The primary action: an upward chirp and a sparkle, like inserting a coin.
  confirm: (v) => {
    v.noise({ dur: 0.04, gain: 0.25, filter: 'highpass', freq: 2500 });
    v.tone({ type: 'square', freq: 988, dur: 0.06, gain: 0.12 });
    v.tone({ type: 'square', freq: 1319, at: 0.06, dur: 0.2, gain: 0.12 });
    v.tone({ type: 'sine', freq: 2637, at: 0.06, dur: 0.25, gain: 0.08 });
    v.noise({ at: 0.06, dur: 0.22, gain: 0.05, filter: 'bandpass', freq: 6000, to: 10000, q: 2 });
  },

  // Going back: the chirp, downward.
  back: (v) => {
    v.tone({ type: 'triangle', freq: 1100, to: 520, dur: 0.12, gain: 0.22 });
    v.noise({ dur: 0.03, gain: 0.12, filter: 'highpass', freq: 2500 });
  },

  toggle: (v) => {
    v.tone({ type: 'square', freq: 660, dur: 0.04, gain: 0.1 });
    v.tone({ type: 'square', freq: 990, at: 0.045, dur: 0.05, gain: 0.1 });
  },

  // Count-in 3, 2, 1: a woodblock-ish knock.
  count: (v) => {
    v.tone({ type: 'sine', freq: 1760, to: 1200, dur: 0.08, gain: 0.35, attack: 0.001 });
    v.noise({ dur: 0.02, gain: 0.15, filter: 'bandpass', freq: 3500, q: 3 });
  },

  // GO: a rising sweep with a crash on top.
  go: (v) => {
    v.tone({ type: 'sawtooth', freq: 220, to: 1760, dur: 0.22, gain: 0.12 });
    v.tone({ type: 'square', freq: 1760, at: 0.2, dur: 0.25, gain: 0.1 });
    v.noise({ at: 0.18, dur: 0.5, gain: 0.18, filter: 'highpass', freq: 5000 });
  },

  // The reach phase starts: a soft whoosh along the lane.
  reach: (v) => {
    v.noise({ dur: 0.22, gain: 0.12, filter: 'bandpass', freq: 600, to: 4000, q: 1.5 });
  },

  // The hold phase starts: a short bright ping.
  hold: (v) => {
    v.tone({ type: 'triangle', freq: 1568, dur: 0.12, gain: 0.14 });
    v.tone({ type: 'sine', freq: 3136, dur: 0.08, gain: 0.06 });
  },

  // The pose locks into the Perfect band: a quick two-step up.
  lock: (v) => {
    v.arp([2093, 2794], 0.04, { type: 'sine', dur: 0.08, gain: 0.1 });
  },

  // PERFECT: a shimmering run up, a bell on top and a sparkle tail.
  perfect: (v) => {
    v.noise({ dur: 0.05, gain: 0.3, filter: 'highpass', freq: 4000 });
    v.arp([note(15), note(19), note(22), note(27)], 0.045, { type: 'square', dur: 0.12, gain: 0.08 });
    v.tone({ type: 'sine', freq: note(27), at: 0.18, dur: 0.6, gain: 0.16 });
    v.tone({ type: 'sine', freq: note(39), at: 0.18, dur: 0.4, gain: 0.06 });
    v.noise({ at: 0.15, dur: 0.5, gain: 0.07, filter: 'bandpass', freq: 8000, to: 12000, q: 4 });
  },

  // GOOD: a friendly two-note chirp.
  good: (v) => {
    v.noise({ dur: 0.03, gain: 0.15, filter: 'highpass', freq: 3500 });
    v.tone({ type: 'triangle', freq: note(15), dur: 0.08, gain: 0.18 });
    v.tone({ type: 'triangle', freq: note(22), at: 0.07, dur: 0.18, gain: 0.18 });
  },

  // MISS: a short dull buzz, down. Disappointing, not punishing.
  miss: (v) => {
    v.tone({ type: 'sawtooth', freq: 200, to: 90, dur: 0.22, gain: 0.12 });
    v.noise({ dur: 0.12, gain: 0.1, filter: 'lowpass', freq: 800 });
  },

  // Combo milestone: a run that starts higher each time.
  combo: (v, step) => {
    const start = Math.min(step, 8);
    const freqs = [0, 1, 2, 3].map((i) => scaleStep(start + i, 3));
    v.arp(freqs, 0.04, { type: 'square', dur: 0.09, gain: 0.07 });
    v.tone({ type: 'sine', freq: freqs[3] * 2, at: 0.16, dur: 0.3, gain: 0.08 });
  },

  // Step back: two low warning beeps.
  warn: (v) => {
    v.tone({ type: 'square', freq: 440, dur: 0.09, gain: 0.08 });
    v.tone({ type: 'square', freq: 440, at: 0.14, dur: 0.09, gain: 0.08 });
  },

  // The grade lands: a low thump and a crash.
  slam: (v) => {
    v.tone({ type: 'sine', freq: 140, to: 40, dur: 0.35, gain: 0.6, attack: 0.002 });
    v.noise({ dur: 0.4, gain: 0.2, filter: 'highpass', freq: 3000 });
    v.noise({ dur: 0.08, gain: 0.3, filter: 'lowpass', freq: 1200 });
  },

  // One star: each a step up the scale.
  star: (v, step) => {
    const freq = scaleStep(step * 2, 15);
    v.tone({ type: 'square', freq, dur: 0.07, gain: 0.08 });
    v.tone({ type: 'sine', freq: freq * 2, dur: 0.35, gain: 0.1 });
    v.noise({ dur: 0.2, gain: 0.05, filter: 'bandpass', freq: 9000, q: 3 });
  },

  // Numbers rolling up.
  tick: (v) => {
    v.tone({ type: 'square', freq: 1800, dur: 0.015, gain: 0.04 });
  },

  // Level up: a short fanfare.
  levelUp: (v) => {
    v.arp([note(3), note(7), note(10), note(15)], 0.08, { type: 'square', dur: 0.1, gain: 0.08 });
    v.tone({ type: 'square', freq: note(15), at: 0.32, dur: 0.45, gain: 0.08 });
    v.tone({ type: 'square', freq: note(19), at: 0.32, dur: 0.45, gain: 0.06 });
    v.tone({ type: 'sine', freq: note(27), at: 0.32, dur: 0.6, gain: 0.08 });
    v.noise({ at: 0.3, dur: 0.6, gain: 0.08, filter: 'highpass', freq: 6000 });
  },

  // A finished routine: a bright ta-da.
  fanfare: (v) => {
    v.tone({ type: 'square', freq: note(10), dur: 0.1, gain: 0.08 });
    v.tone({ type: 'square', freq: note(10), at: 0.12, dur: 0.08, gain: 0.08 });
    v.tone({ type: 'square', freq: note(15), at: 0.22, dur: 0.5, gain: 0.09 });
    v.tone({ type: 'square', freq: note(19), at: 0.22, dur: 0.5, gain: 0.06 });
    v.tone({ type: 'sine', freq: note(22), at: 0.22, dur: 0.6, gain: 0.08 });
    v.noise({ at: 0.2, dur: 0.5, gain: 0.1, filter: 'highpass', freq: 5000 });
  },
};
