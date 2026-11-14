/** Synthetic test audio: a click track over a soft melody, as a 16-bit PCM WAV. */

export interface ClickTrackOptions {
  bpm: number;
  seconds: number;
  sampleRate?: number;
  /** Time of the first click. */
  firstClickSec?: number;
  seed?: number;
}

/** A tiny seeded random generator (an LCG), so the file is the same on every run. */
function random(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Interleaved float samples in [-1, 1] to a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number, channels: number): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(value * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/**
 * Stereo. Each beat has a short noise burst over a low thump (louder on every fourth
 * beat), and under it a soft sine melody that changes note on every beat over a held A
 * chord: something for Demucs to put in each stem.
 */
export function clickTrackWav(options: ClickTrackOptions): Buffer {
  const sr = options.sampleRate ?? 44100;
  const total = Math.round(options.seconds * sr);
  const firstClick = options.firstClickSec ?? 1.0;
  const rand = random(options.seed ?? 7);
  const mono = new Float32Array(total);
  const period = 60 / options.bpm;
  const melody = [440, 494, 554, 659, 740, 659, 554, 494]; // A major pentatonic, up and down

  for (let i = 0; i < total; i += 1) {
    const t = i / sr;
    mono[i] = 0.05 * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277.18 * t) + Math.sin(2 * Math.PI * 329.63 * t));
  }

  let beat = 0;
  for (let at = firstClick; at < options.seconds - 1; at += period, beat += 1) {
    const start = Math.round(at * sr);
    const accent = beat % 4 === 0;
    const note = melody[beat % melody.length];
    const noteLength = Math.round(period * 0.9 * sr);
    for (let j = 0; j < noteLength && start + j < total; j += 1) {
      const t = j / sr;
      const envelope = Math.min(1, t / 0.01) * Math.exp(-t / 0.35);
      mono[start + j] += 0.12 * envelope * Math.sin(2 * Math.PI * note * t);
    }
    const thumpLength = Math.round(0.12 * sr);
    for (let j = 0; j < thumpLength && start + j < total; j += 1) {
      const t = j / sr;
      mono[start + j] += (accent ? 0.35 : 0.25) * Math.exp(-t / 0.04) * Math.sin(2 * Math.PI * 60 * t);
    }
    const burstLength = Math.round(0.03 * sr);
    for (let j = 0; j < burstLength && start + j < total; j += 1) {
      mono[start + j] += (accent ? 0.35 : 0.22) * Math.exp(-j / (0.006 * sr)) * (rand() * 2 - 1);
    }
  }

  const stereo = new Float32Array(total * 2);
  for (let i = 0; i < total; i += 1) {
    stereo[2 * i] = mono[i];
    stereo[2 * i + 1] = mono[i];
  }
  return encodeWav(stereo, sr, 2);
}
