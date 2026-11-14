import { songUrls } from '../../songs/library';
import type { SongMeta } from '../../songs/model';
import {
  PREVIEW_DELAY_MS,
  PREVIEW_SEC,
  PREVIEW_STOP_SEC,
  applySteps,
  choosePreviewStart,
  envelopeEnd,
  fadeOutSteps,
  previewEnvelope,
  type GainStep,
} from './previewTiming';

export interface PreviewPlayerOptions {
  /** The shared AudioContext. Called only when a preview starts, or inside the page's first activating gesture. */
  getContext(): AudioContext;
  /** A new <audio> element. Called once, and again only if the context changes. */
  createAudio(): HTMLAudioElement;
  /** A song's downbeats, or null to start at 30% of the song. */
  loadDownbeats(songId: string): Promise<readonly number[] | null>;
  /** The gain a preview fades up to. */
  level: number;
  /** Called whenever the audible preview changes (a song id, or null for silence). */
  onChange?(playingId: string | null): void;
  /** How long a card must stay selected before its preview starts. */
  delayMs?: number;
  /** How long to wait for a beatmap before starting at 30% without it. */
  beatmapWaitMs?: number;
  /** How long to wait for the audio to load before giving up on a preview. */
  loadTimeoutMs?: number;
}

interface Graph {
  ctx: AudioContext;
  audio: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  /** The URL last given to the element, or null to force a reload. */
  url: string | null;
}

/** HTMLMediaElement.HAVE_METADATA, spelled out so this module runs outside a browser. */
const HAVE_METADATA = 1;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function orNullAfter<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

function release(graph: Graph): void {
  try {
    graph.audio.pause();
    // Drops the half-downloaded file.
    graph.audio.removeAttribute('src');
    graph.audio.load();
    graph.source.disconnect();
    graph.gain.disconnect();
  } catch {
    // Already torn down along with its context.
  }
}

/**
 * Plays one song preview at a time: 10 s of a song's melody stem from the
 * downbeat nearest 30% of the way in, faded in and out.
 *
 * The stem streams through one reused <audio> element routed into the shared
 * AudioContext (MediaElementAudioSourceNode, then a GainNode), so a long file
 * plays without being decoded whole. Nothing is heard until setEnabled(true),
 * which the menu calls once the page has had user activation.
 */
export class PreviewPlayer {
  private readonly options: PreviewPlayerOptions;
  private enabled = false;
  private disposed = false;
  /** The song asked for: plays after the delay, or once enabled. */
  private wanted: SongMeta | null = null;
  private delayTimer: ReturnType<typeof setTimeout> | null = null;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  private pauseTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped by every start and every fade-out, so a start still in flight knows it has been overtaken. */
  private generation = 0;
  private startingId: string | null = null;
  private playingId: string | null = null;
  private graph: Graph | null = null;
  /** What the gain was last told to do, for fading out from wherever it is. */
  private envelope: GainStep[] = [];

  constructor(options: PreviewPlayerOptions) {
    this.options = options;
  }

  /** The song whose preview is audible (fading in or holding), or null. */
  get playing(): string | null {
    return this.playingId;
  }

  /**
   * Asks for `song`'s preview, replacing any other: the current one fades out
   * quickly and the new one starts after a short delay. Asking again for the
   * song that is already starting or playing does nothing. Null fades out.
   */
  request(song: SongMeta | null): void {
    if (this.disposed) return;
    const id = song?.id ?? null;
    const underway = this.delayTimer !== null || this.startingId === id || this.playingId === id;
    if (id !== null && id === this.wanted?.id && underway) return;

    this.wanted = song;
    this.clearDelay();
    this.fadeOut(PREVIEW_STOP_SEC);
    if (!song) return;
    // Warm the beatmap cache while the delay runs.
    void this.options.loadDownbeats(song.id).catch(() => null);
    if (this.enabled) this.schedule();
  }

  /** Fades out now and forgets the request: for a pick, a hidden page or leaving the menu. */
  stop(fadeSec = PREVIEW_STOP_SEC): void {
    this.wanted = null;
    this.clearDelay();
    this.fadeOut(fadeSec);
  }

  /** Lets previews play (the page has had user activation). A song already asked for starts after the delay. */
  setEnabled(enabled: boolean): void {
    if (this.disposed) return;
    this.enabled = enabled;
    if (!enabled) {
      this.clearDelay();
      this.fadeOut(PREVIEW_STOP_SEC);
      return;
    }
    if (this.wanted && this.delayTimer === null && this.startingId === null && this.playingId === null) this.schedule();
  }

  /**
   * Builds the audio graph and resumes the context. Call it inside the page's
   * first click or key press: some browsers only let a context start there.
   */
  warmUp(): void {
    if (this.disposed) return;
    try {
      const graph = this.ensureGraph();
      if (graph) this.resume(graph.ctx);
    } catch {
      // No context to be had: previews stay silent.
    }
  }

  /** Stops with a quick fade, then lets go of the element and the audio nodes. */
  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.enabled = false;
    this.clearPause();
    const graph = this.graph;
    this.graph = null;
    if (graph) setTimeout(() => release(graph), PREVIEW_STOP_SEC * 1000 + 50);
  }

  private schedule(): void {
    this.clearDelay();
    this.delayTimer = setTimeout(() => {
      this.delayTimer = null;
      const song = this.wanted;
      if (song && this.enabled && !this.disposed) void this.start(song);
    }, this.options.delayMs ?? PREVIEW_DELAY_MS);
  }

  private async start(song: SongMeta): Promise<void> {
    this.generation += 1;
    const generation = this.generation;
    const current = () => generation === this.generation && !this.disposed;
    this.startingId = song.id;
    let graph: Graph | null = null;

    try {
      graph = this.ensureGraph();
      if (!graph) return;
      this.resume(graph.ctx);
      const { audio, gain } = graph;

      // Let the previous preview finish fading, then hold the element silent.
      const fading = Math.min(envelopeEnd(this.envelope) - graph.ctx.currentTime, PREVIEW_STOP_SEC);
      if (fading > 0) {
        await sleep(fading * 1000);
        if (!current()) return;
      }
      this.clearPause();
      audio.pause();
      this.envelope = [{ at: graph.ctx.currentTime, value: 0 }];
      applySteps(gain.gain, this.envelope);

      const downbeats = await orNullAfter(this.options.loadDownbeats(song.id), this.options.beatmapWaitMs ?? 800);
      if (!current()) return;

      const url = songUrls(song.id).melody;
      if (graph.url !== url) {
        audio.src = url;
        graph.url = url;
      }
      await this.seek(audio, choosePreviewStart(song.durationSec, downbeats), current);
      if (!current()) return;

      await audio.play();
      if (!current()) return;

      this.envelope = previewEnvelope(graph.ctx.currentTime, this.options.level);
      applySteps(gain.gain, this.envelope);
      this.startingId = null;
      this.setPlaying(song.id);
      this.endTimer = setTimeout(() => this.finish(generation), PREVIEW_SEC * 1000 + 50);
    } catch {
      // play() was refused, the file would not load or there was no context:
      // no preview, and no fuss. Forget the URL so the next try reloads it.
      if (graph) graph.url = null;
      if (current()) this.graph?.audio.pause();
    } finally {
      if (generation === this.generation && this.startingId === song.id) this.startingId = null;
    }
  }

  /** Seeks to `sec`, first waiting for the file's metadata if it has none yet. */
  private seek(audio: HTMLAudioElement, sec: number, current: () => boolean): Promise<void> {
    if (audio.readyState >= HAVE_METADATA) {
      audio.currentTime = sec;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const settle = () => {
        clearTimeout(timer);
        audio.removeEventListener('loadedmetadata', onReady);
        audio.removeEventListener('error', onError);
      };
      const onReady = () => {
        settle();
        // A newer start may have taken the element over while this one waited.
        if (current()) audio.currentTime = sec;
        resolve();
      };
      const onError = () => {
        settle();
        reject(new Error('The preview audio did not load.'));
      };
      const timer = setTimeout(onError, this.options.loadTimeoutMs ?? 8000);
      audio.addEventListener('loadedmetadata', onReady);
      audio.addEventListener('error', onError);
    });
  }

  /** The preview ran its 10 s. */
  private finish(generation: number): void {
    if (generation !== this.generation) return;
    this.endTimer = null;
    this.graph?.audio.pause();
    this.setPlaying(null);
  }

  /** Fades whatever is playing to silence, then pauses the element. Also cancels a start in flight. */
  private fadeOut(fadeSec: number): void {
    this.generation += 1;
    this.startingId = null;
    if (this.endTimer !== null) {
      clearTimeout(this.endTimer);
      this.endTimer = null;
    }

    const graph = this.graph;
    if (graph && graph.ctx.state !== 'closed') {
      try {
        this.envelope = fadeOutSteps(this.envelope, graph.ctx.currentTime, fadeSec);
        applySteps(graph.gain.gain, this.envelope);
      } catch {
        // The context went away under us.
      }
      const generation = this.generation;
      this.clearPause();
      this.pauseTimer = setTimeout(() => {
        this.pauseTimer = null;
        // A newer start pauses the element itself once the fade is done.
        if (generation === this.generation) graph.audio.pause();
      }, fadeSec * 1000 + 30);
    }
    this.setPlaying(null);
  }

  private ensureGraph(): Graph | null {
    const ctx = this.options.getContext();
    if (this.graph && this.graph.ctx === ctx && ctx.state !== 'closed') return this.graph;
    if (this.graph) {
      release(this.graph);
      this.graph = null;
      this.envelope = [];
    }
    if (ctx.state === 'closed') return null;

    const audio = this.options.createAudio();
    audio.preload = 'auto';
    // An element routed into a context is heard only through it.
    const source = ctx.createMediaElementSource(audio);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(ctx.destination);
    this.graph = { ctx, audio, source, gain, url: null };
    return this.graph;
  }

  private resume(ctx: AudioContext): void {
    if (ctx.state !== 'suspended') return;
    ctx.resume().catch(() => undefined);
  }

  private setPlaying(id: string | null): void {
    if (id === this.playingId) return;
    this.playingId = id;
    this.options.onChange?.(id);
  }

  private clearDelay(): void {
    if (this.delayTimer === null) return;
    clearTimeout(this.delayTimer);
    this.delayTimer = null;
  }

  private clearPause(): void {
    if (this.pauseTimer === null) return;
    clearTimeout(this.pauseTimer);
    this.pauseTimer = null;
  }
}
