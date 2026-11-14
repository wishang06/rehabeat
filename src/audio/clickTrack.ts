export interface ClickOptions {
  /** Higher pitch, for the first beat of a bar. */
  accent?: boolean;
  /** Peak gain, 0-1. */
  volume?: number;
}

const PITCH_HZ = 1000;
const ACCENT_PITCH_HZ = 1500;
const DEFAULT_VOLUME = 0.6;
const ATTACK_SEC = 0.003;
const DECAY_SEC = 0.06;
/** An exponential ramp cannot reach zero, so the decay ends at -80 dB. */
const DECAY_FLOOR = 0.0001;

/** Schedules one short synthesized click at master-clock time `when`. */
export function scheduleClick(
  ctx: BaseAudioContext,
  destination: AudioNode,
  when: number,
  options: ClickOptions = {},
): void {
  const { accent = false, volume = DEFAULT_VOLUME } = options;
  if (!(volume > 0)) return;

  // A start time already in the past plays at once, so the envelope has to begin now too.
  const start = Math.max(when, ctx.currentTime);
  const peak = start + ATTACK_SEC;
  const end = peak + DECAY_SEC;

  const oscillator = ctx.createOscillator();
  oscillator.frequency.value = accent ? ACCENT_PITCH_HZ : PITCH_HZ;

  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0, start);
  envelope.gain.linearRampToValueAtTime(volume, peak);
  envelope.gain.exponentialRampToValueAtTime(DECAY_FLOOR, end);

  oscillator.connect(envelope).connect(destination);
  oscillator.onended = () => {
    oscillator.disconnect();
    envelope.disconnect();
  };
  oscillator.start(start);
  oscillator.stop(end);
}
