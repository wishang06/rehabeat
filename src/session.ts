import { hasBeatmap, hasStems } from 'virtual:public-assets';
import { BeatEngine } from './audio';
import { createPoseTracker, openCamera, stopCamera, type PoseTracker } from './pose';
import type { PoseSample } from './types';

export type StartStep = 'sound' | 'camera' | 'model';

type SampleListener = (sample: PoseSample) => void;

/** Everything that stays alive across the Calibrate and Play screens. */
export interface Session {
  engine: BeatEngine;
  tracker: PoseTracker;
  stream: MediaStream;
  /** The most recent pose sample, or null before the first video frame. */
  latest(): PoseSample | null;
  /** Calls `listener` for every video frame. Returns the unsubscribe function. */
  subscribe(listener: SampleListener): () => void;
  dispose(): void;
}

/**
 * Starts sound, camera and pose tracking, in that order.
 *
 * `ctx` must have been created inside the click that led here, or the browser
 * will keep it suspended. Video frames are stamped on the audio clock so that
 * audio, scoring and visuals all share one timeline.
 */
export async function startSession(
  video: HTMLVideoElement,
  ctx: AudioContext,
  onStep: (step: StartStep) => void,
): Promise<Session> {
  const listeners = new Set<SampleListener>();
  let latest: PoseSample | null = null;
  let engine: BeatEngine | null = null;
  let stream: MediaStream | null = null;

  try {
    onStep('sound');
    // Only request the optional audio files that exist; a missing one means the fallback.
    const base = import.meta.env.BASE_URL;
    engine = await BeatEngine.create({
      ctx,
      beatmapUrl: hasBeatmap ? `${base}beatmap.json` : null,
      stemsBaseUrl: hasStems ? `${base}stems` : null,
    });
    await engine.resume();

    onStep('camera');
    stream = await openCamera(video);

    onStep('model');
    const clock = engine.clock;
    const tracker = await createPoseTracker({
      video,
      toClockTime: (perfMs) => clock.fromPerformanceTime(perfMs),
      onSample: (sample) => {
        latest = sample;
        for (const listener of listeners) listener(sample);
      },
    });
    tracker.start();

    const startedEngine = engine;
    const startedStream = stream;
    return {
      engine: startedEngine,
      tracker,
      stream: startedStream,
      latest: () => latest,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      dispose() {
        listeners.clear();
        tracker.dispose();
        stopCamera(startedStream);
        startedEngine.dispose();
        closeContext(ctx);
      },
    };
  } catch (error) {
    if (stream) stopCamera(stream);
    engine?.dispose();
    closeContext(ctx);
    throw error;
  }
}

/** The engine leaves a context it was handed open, so the session closes it. */
function closeContext(ctx: AudioContext): void {
  if (ctx.state !== 'closed') void ctx.close().catch(() => undefined);
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
      return `Rehabeat couldn't start${error instanceof Error && error.message ? `: ${error.message}` : '.'} Check your connection and try again.`;
  }
}
