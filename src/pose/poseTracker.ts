import { PoseLandmarker } from '@mediapipe/tasks-vision';
import type { PoseSample } from '../types';
import { AngleSmoother } from './angleSmoother';
import { hasFrameSize } from './camera';
import { LOCAL_WASM_FILESET, POSE_MODEL_URL } from './config';
import type { WasmFileset } from './config';
import { createErrorLogger } from './errorLog';
import { nextDetectTimestamp, pickFrameTime, smoothFps } from './frameTime';
import { buildPoseSample, normaliseLandmarks } from './poseSample';

export type PoseDelegate = 'GPU' | 'CPU';

export interface PoseTrackerOptions {
  video: HTMLVideoElement;
  /**
   * Maps a performance.now()-timeline timestamp in ms to master-clock seconds.
   * Default: ms / 1000.
   */
  toClockTime?: (perfMs: number) => number;
  onSample: (sample: PoseSample) => void;
  /** Where to load the MediaPipe wasm runtime from. Default: LOCAL_WASM_FILESET. */
  wasmFileset?: WasmFileset;
}

export interface PoseTracker {
  readonly delegate: PoseDelegate;
  /** Idempotent. */
  start(): void;
  /** Idempotent; the tracker can be started again afterwards. */
  stop(): void;
  /** Stops and closes the landmarker. The tracker cannot be used afterwards. */
  dispose(): void;
}

/** HTMLMediaElement.HAVE_CURRENT_DATA: the video holds a frame that can be read. */
const HAVE_CURRENT_DATA = 2;

function createLandmarker(fileset: WasmFileset, delegate: PoseDelegate): Promise<PoseLandmarker> {
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
  });
}

async function createLandmarkerWithFallback(
  fileset: WasmFileset,
): Promise<{ landmarker: PoseLandmarker; delegate: PoseDelegate }> {
  try {
    return { landmarker: await createLandmarker(fileset, 'GPU'), delegate: 'GPU' };
  } catch (error) {
    console.warn('[pose] GPU delegate failed, retrying on CPU:', error);
    return { landmarker: await createLandmarker(fileset, 'CPU'), delegate: 'CPU' };
  }
}

export async function createPoseTracker(options: PoseTrackerOptions): Promise<PoseTracker> {
  const { video, onSample } = options;
  const toClockTime = options.toClockTime ?? ((perfMs: number) => perfMs / 1000);
  const { landmarker, delegate } = await createLandmarkerWithFallback(
    options.wasmFileset ?? LOCAL_WASM_FILESET,
  );

  const smoother = new AngleSmoother();
  const logError = createErrorLogger();
  const hasVideoFrameCallback = typeof video.requestVideoFrameCallback === 'function';

  let running = false;
  let disposed = false;
  let pendingHandle: number | null = null;
  // Kept across stop/start: the landmarker needs increasing timestamps for its whole life.
  let lastDetectMs: number | null = null;
  let lastCallbackMs: number | null = null;
  let lastVideoTime = -1;
  let fps = 0;

  const processFrame = (frameMs: number, callbackMs: number): void => {
    if (video.readyState < HAVE_CURRENT_DATA || !hasFrameSize(video)) return;

    if (lastCallbackMs !== null) fps = smoothFps(fps, callbackMs - lastCallbackMs);
    lastCallbackMs = callbackMs;

    lastDetectMs = nextDetectTimestamp(frameMs, lastDetectMs);
    const detectStart = performance.now();
    const result = landmarker.detectForVideo(video, lastDetectMs);
    const detectMs = performance.now() - detectStart;

    onSample(
      buildPoseSample(
        {
          t: toClockTime(frameMs),
          filterSeconds: frameMs / 1000,
          landmarks: normaliseLandmarks(result.landmarks[0]),
          worldLandmarks: normaliseLandmarks(result.worldLandmarks[0]),
          detectMs,
          fps,
        },
        smoother,
      ),
    );
  };

  const processFrameSafely = (frameMs: number, callbackMs: number): void => {
    try {
      processFrame(frameMs, callbackMs);
    } catch (error) {
      logError(error);
    }
  };

  // Both loops re-register before doing any work, so the handle that stop()
  // cancels is always the live one, even when stop() is called from onSample.
  const onVideoFrame: VideoFrameRequestCallback = (now, metadata) => {
    if (!running) return;
    pendingHandle = video.requestVideoFrameCallback(onVideoFrame);
    processFrameSafely(pickFrameTime(now, metadata), now);
  };

  const onAnimationFrame = (): void => {
    if (!running) return;
    pendingHandle = requestAnimationFrame(onAnimationFrame);
    if (video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;
    const now = performance.now();
    processFrameSafely(now, now);
  };

  const stop = (): void => {
    running = false;
    if (pendingHandle === null) return;
    if (hasVideoFrameCallback) video.cancelVideoFrameCallback(pendingHandle);
    else cancelAnimationFrame(pendingHandle);
    pendingHandle = null;
  };

  return {
    delegate,

    start(): void {
      if (disposed) {
        console.warn('[pose] start() ignored: the tracker has been disposed');
        return;
      }
      if (running) return;
      running = true;
      // The gap since the last frame is neither a frame interval nor a smoothing step.
      lastCallbackMs = null;
      smoother.reset();
      pendingHandle = hasVideoFrameCallback
        ? video.requestVideoFrameCallback(onVideoFrame)
        : requestAnimationFrame(onAnimationFrame);
    },

    stop,

    dispose(): void {
      stop();
      if (disposed) return;
      disposed = true;
      landmarker.close();
    },
  };
}
