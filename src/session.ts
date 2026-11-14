import { BeatEngine, MasterClock, scheduleClick } from './audio';
import { createPoseTracker, openCamera, stopCamera, type PoseTracker } from './pose';
import { songUrls } from './songs/library';
import type { PoseSample } from './types';

export type StartStep = 'sound' | 'camera' | 'model' | 'song';

type SampleListener = (sample: PoseSample) => void;

/**
 * Camera, pose tracking and the shared audio clock. It starts on the first
 * song pick and stays alive while the player moves between the menu,
 * Calibrate and Play. Each song gets its own BeatEngine on the same context.
 */
export interface Session {
  ctx: AudioContext;
  clock: MasterClock;
  tracker: PoseTracker;
  stream: MediaStream;
  /** The most recent pose sample, or null before the first video frame. */
  latest(): PoseSample | null;
  /** Calls `listener` for every video frame. Returns the unsubscribe function. */
  subscribe(listener: SampleListener): () => void;
  /** A one-off click at a master-clock time, for calibration. */
  playClick(when: number, accent?: boolean): void;
  /** Stops the camera and pose tracking. The audio context belongs to the caller and stays open. */
  dispose(): void;
}

/**
 * Starts sound, camera and pose tracking, in that order.
 *
 * Call it from a click or key press, or the browser keeps `ctx` suspended.
 * Video frames are stamped on the audio clock so that audio, scoring and
 * visuals all share one timeline.
 */
export async function startSession(
  video: HTMLVideoElement,
  ctx: AudioContext,
  onStep: (step: StartStep) => void,
): Promise<Session> {
  const listeners = new Set<SampleListener>();
  let latest: PoseSample | null = null;
  let stream: MediaStream | null = null;

  try {
    onStep('sound');
    if (ctx.state === 'suspended') await ctx.resume();
    const clock = new MasterClock(ctx);

    onStep('camera');
    stream = await openCamera(video);

    onStep('model');
    const tracker = await createPoseTracker({
      video,
      toClockTime: (perfMs) => clock.fromPerformanceTime(perfMs),
      onSample: (sample) => {
        latest = sample;
        for (const listener of listeners) listener(sample);
      },
    });
    tracker.start();

    const startedStream = stream;
    return {
      ctx,
      clock,
      tracker,
      stream: startedStream,
      latest: () => latest,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      playClick(when, accent = false) {
        scheduleClick(ctx, ctx.destination, when, { accent });
      },
      dispose() {
        listeners.clear();
        tracker.dispose();
        stopCamera(startedStream);
      },
    };
  } catch (error) {
    if (stream) stopCamera(stream);
    throw error;
  }
}

/** Loads a song's beatmap and stems into a BeatEngine on the shared audio context. */
export function loadSong(ctx: AudioContext, songId: string): Promise<BeatEngine> {
  const urls = songUrls(songId);
  return BeatEngine.create({ ctx, beatmapUrl: urls.beatmap, stemsBaseUrl: urls.folder });
}

/** Turns a start-up failure into something the player can act on. */
export function describeStartError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return "Camera access is blocked. Allow the camera for this page in your browser's site settings, then try again.";
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found. Connect one, then try again.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The camera is busy in another app. Close that app, then try again.';
    default:
      break;
  }

  const message = error instanceof Error ? error.message : '';
  if (message.includes('did not deliver any video frames')) {
    return 'The camera opened but sent no picture. Check that nothing else is using or covering it, then try again.';
  }
  // A failed download surfaces as a TypeError from fetch.
  if (name === 'TypeError' || /fetch|network/i.test(message)) {
    return "Rehabeat couldn't download pose tracking. Check your connection, then try again.";
  }
  return message
    ? `Rehabeat couldn't start: ${message.replace(/\.$/, '')}. Try again.`
    : "Rehabeat couldn't start. Try again.";
}
