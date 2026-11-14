import type { Beatmap } from '../types';
import { BeatGrid } from './beatGrid';
import { generateBeatmap, loadBeatmap, type BeatmapSource, type LoadedBeatmap } from './beatmap';
import { BeatScheduler } from './beatScheduler';
import { scheduleClick } from './clickTrack';
import { MasterClock } from './clock';
import { GainFader } from './gainFader';
import { beatAlignedLoopLength } from './loopPoint';
import { loadStems, type Stems } from './stems';

export type BeatEngineMode = 'stems' | 'click';

export interface BeatEngineOptions {
  /** An existing context to play through. The engine creates (and later closes) its own when omitted. */
  ctx?: AudioContext;
  /** Where the beatmap is served. null means there is none: no request is made and the generated grid is used. */
  beatmapUrl?: string | null;
  /** Folder serving drums.mp3 and melody.mp3. null means there are none: no request is made and the click track is used. */
  stemsBaseUrl?: string | null;
}

const DEFAULT_START_DELAY_SEC = 0.25;
const SCHEDULER_INTERVAL_MS = 25;
const SCHEDULER_LOOKAHEAD_SEC = 0.15;
const BEATS_PER_ACCENT = 4;
const MELODY_RAMP_SEC = 0.3;
/** Long enough to avoid the pop of cutting a waveform mid-cycle, short enough to feel instant. */
const STOP_FADE_SEC = 0.03;

/** Everything that exists only between one start() and the next stop(). */
interface Run {
  startTime: number;
  /** All of this run's audio passes through here on its way to the speakers. */
  output: GainNode;
  sources: AudioBufferSourceNode[];
  /** Every node to disconnect once the run is silent. */
  nodes: AudioNode[];
  melody: GainFader | null;
  timer: ReturnType<typeof setInterval> | null;
}

/**
 * Plays the backing track and owns the timeline everything else is scored
 * against. In 'stems' mode it loops the drum and melody stems over a whole
 * number of beats; in 'click' mode (no stems found) it synthesizes a click on
 * every beat.
 *
 * Before start() and after stop() the track is parked at time 0: see
 * trackTime, beatPosition and clockTimeOfBeat.
 */
export class BeatEngine {
  /** Builds the AudioContext (unless given one), loads the beatmap and tries to load the stems. */
  static async create(options: BeatEngineOptions = {}): Promise<BeatEngine> {
    const ctx = options.ctx ?? new AudioContext();
    const generated: LoadedBeatmap = { beatmap: generateBeatmap(), source: 'generated' };
    const [loaded, stems] = await Promise.all([
      options.beatmapUrl === null ? generated : loadBeatmap(options.beatmapUrl),
      options.stemsBaseUrl === null ? null : loadStems(ctx, options.stemsBaseUrl),
    ]);
    return new BeatEngine(ctx, loaded.beatmap, loaded.source, stems, options.ctx === undefined);
  }

  readonly ctx: AudioContext;
  readonly clock: MasterClock;
  readonly grid: BeatGrid;
  readonly mode: BeatEngineMode;
  readonly beatmapSource: BeatmapSource;

  private readonly stems: Stems | null;
  private readonly loopDuration: number;
  private readonly ownsContext: boolean;
  private run: Run | null = null;
  private melodyOn = false;
  private disposed = false;

  private constructor(
    ctx: AudioContext,
    beatmap: Beatmap,
    beatmapSource: BeatmapSource,
    stems: Stems | null,
    ownsContext: boolean,
  ) {
    this.ctx = ctx;
    this.clock = new MasterClock(ctx);
    this.beatmapSource = beatmapSource;
    this.ownsContext = ownsContext;

    // Both stems loop over the same length so they can never drift apart. That
    // length is a whole number of beats taken from the beatmap, not the length of
    // the files, so the beat grid stays continuous where the audio wraps.
    const audioDuration = stems ? Math.min(stems.drums.duration, stems.melody.duration) : 0;
    const loopDuration = audioDuration > 0 ? beatAlignedLoopLength(beatmap, audioDuration) : 0;
    const loops = loopDuration > 0;
    this.stems = loops ? stems : null;
    this.loopDuration = loopDuration;
    this.mode = loops ? 'stems' : 'click';
    this.grid = new BeatGrid(beatmap, loops ? { loopDuration } : {});
  }

  get running(): boolean {
    return this.run !== null;
  }

  /** Seconds of each stem that play before they wrap to the start, or null in click mode. */
  get loopLength(): number | null {
    return this.stems ? this.loopDuration : null;
  }

  /** Master-clock time at which track time 0 plays, or null while stopped. */
  get startTime(): number | null {
    return this.run ? this.run.startTime : null;
  }

  /** The last state given to setMelodyActive. Always false right after start() and stop(). */
  get melodyActive(): boolean {
    return this.melodyOn;
  }

  /** Resumes the AudioContext. Browsers only allow this from a user gesture. */
  async resume(): Promise<void> {
    if (this.ctx.state === 'running' || this.ctx.state === 'closed') return;
    await this.ctx.resume();
  }

  /**
   * Starts the track so that track time 0 plays `delaySec` from now, with the
   * melody silent. Calling it while already running restarts from the top.
   */
  start(delaySec = DEFAULT_START_DELAY_SEC): void {
    if (this.disposed) return;
    this.stop();
    this.melodyOn = false;
    const startTime = this.ctx.currentTime + Math.max(0, delaySec);
    const output = this.ctx.createGain();
    output.connect(this.ctx.destination);
    this.run = this.stems
      ? this.startStems(this.stems, output, startTime)
      : this.startClicks(output, startTime);
  }

  /** Stops audio and scheduling. start() may be called again. */
  stop(): void {
    const run = this.run;
    if (!run) return;
    this.run = null;
    this.melodyOn = false;
    if (run.timer !== null) clearInterval(run.timer);

    const release = () => {
      for (const node of run.nodes) node.disconnect();
    };
    if (run.sources.length === 0 || this.ctx.state !== 'running') {
      for (const source of run.sources) source.stop();
      release();
      return;
    }
    const now = this.ctx.currentTime;
    const silentAt = now + STOP_FADE_SEC;
    run.output.gain.setValueAtTime(1, now);
    run.output.gain.linearRampToValueAtTime(0, silentAt);
    run.sources[0].onended = release;
    for (const source of run.sources) source.stop(silentAt);
  }

  /**
   * Seconds into the track at master-clock time `clockTime` (default: what is
   * audible now). Negative during the lead-in before track time 0. It keeps
   * growing across loops. While stopped it is always 0.
   */
  trackTime(clockTime: number = this.clock.audibleNow()): number {
    return this.run ? clockTime - this.run.startTime : 0;
  }

  /**
   * Fractional beat index at `clockTime` (default: what is audible now).
   * While stopped it is the beat position of track time 0.
   */
  beatPosition(clockTime?: number): number {
    return this.grid.beatAt(this.trackTime(clockTime));
  }

  /**
   * Master-clock time at which a beat plays. While stopped there is no such
   * time yet, so this answers as if the track were parked at time 0 right now:
   * the beat stays grid.timeOfBeat(beatIndex) seconds ahead of
   * clock.audibleNow(). Do not keep a value obtained while stopped.
   */
  clockTimeOfBeat(beatIndex: number): number {
    const origin = this.run ? this.run.startTime : this.clock.audibleNow();
    return origin + this.grid.timeOfBeat(beatIndex);
  }

  /**
   * "The music follows you": fades the melody stem in or out over 300 ms.
   * Cheap to call every frame; a fade is only scheduled when the state
   * changes. In click mode, and while stopped, it only records the state.
   */
  setMelodyActive(active: boolean): void {
    this.melodyOn = active;
    this.run?.melody?.setActive(active, this.ctx.currentTime);
  }

  /** One-off click at a master-clock time. Works whether or not the engine is running. */
  playClick(when: number, accent = false): void {
    if (this.disposed) return;
    scheduleClick(this.ctx, this.ctx.destination, when, { accent });
  }

  /** Stops everything for good. Closes the AudioContext if the engine created it. */
  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    if (this.ownsContext) void this.ctx.close().catch(() => undefined);
  }

  private startStems(stems: Stems, output: GainNode, startTime: number): Run {
    const melodyGain = this.ctx.createGain();
    melodyGain.gain.value = 0;
    melodyGain.connect(output);

    const drums = this.createLoop(stems.drums, output);
    const melody = this.createLoop(stems.melody, melodyGain);
    drums.start(startTime);
    melody.start(startTime);

    return {
      startTime,
      output,
      sources: [drums, melody],
      nodes: [drums, melody, melodyGain, output],
      melody: new GainFader(melodyGain.gain, MELODY_RAMP_SEC),
      timer: null,
    };
  }

  private createLoop(buffer: AudioBuffer, destination: AudioNode): AudioBufferSourceNode {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopEnd = this.loopDuration;
    source.connect(destination);
    return source;
  }

  private startClicks(output: GainNode, startTime: number): Run {
    const scheduler = new BeatScheduler(this.grid, SCHEDULER_LOOKAHEAD_SEC);
    const scheduleDueBeats = () => {
      for (const beat of scheduler.due(this.ctx.currentTime - startTime)) {
        const accent = beat.index % BEATS_PER_ACCENT === 0;
        scheduleClick(this.ctx, output, startTime + beat.time, { accent });
      }
    };
    scheduleDueBeats();
    return {
      startTime,
      output,
      sources: [],
      nodes: [output],
      melody: null,
      timer: setInterval(scheduleDueBeats, SCHEDULER_INTERVAL_MS),
    };
  }
}
