import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoseSample } from '../types';
import { CDN_WASM_FILESET, LOCAL_WASM_FILESET, POSE_MODEL_URL } from './config';
import { standingPose } from './poseFixtures';
import { createPoseTracker } from './poseTracker';
import type { RawLandmark } from './poseSample';

/**
 * The real landmarker needs a browser, so these tests drive the tracker's loop
 * with a stand-in landmarker and a stand-in video element.
 */
const mocks = vi.hoisted(() => ({ createFromOptions: vi.fn() }));

vi.mock('@mediapipe/tasks-vision', () => ({
  PoseLandmarker: { createFromOptions: mocks.createFromOptions },
}));

interface DetectResult {
  landmarks: RawLandmark[][];
  worldLandmarks: RawLandmark[][];
}

const POSE_RESULT: DetectResult = {
  landmarks: [standingPose()],
  worldLandmarks: [standingPose()],
};
const NO_POSE_RESULT: DetectResult = { landmarks: [], worldLandmarks: [] };

function fakeLandmarker(result: DetectResult = POSE_RESULT) {
  return {
    detectForVideo: vi.fn((_video: unknown, _timestampMs: number): DetectResult => result),
    close: vi.fn(),
  };
}

/** A video element reduced to what the tracker touches, with frames fired by hand. */
function fakeVideo() {
  let nextHandle = 1;
  const callbacks = new Map<number, VideoFrameRequestCallback>();
  const element = {
    readyState: 4,
    videoWidth: 640,
    videoHeight: 480,
    currentTime: 0,
    requestVideoFrameCallback(callback: VideoFrameRequestCallback): number {
      callbacks.set(nextHandle, callback);
      return nextHandle++;
    },
    cancelVideoFrameCallback(handle: number): void {
      callbacks.delete(handle);
    },
  };
  return {
    element,
    video: element as unknown as HTMLVideoElement,
    pending: () => callbacks.size,
    /** Presents one frame: runs the callbacks registered so far, as a browser would. */
    present(now: number, metadata: { captureTime?: number; expectedDisplayTime: number }): void {
      const due = [...callbacks.values()];
      callbacks.clear();
      for (const callback of due) callback(now, metadata as VideoFrameCallbackMetadata);
    },
  };
}

/** Presents a frame captured 50 ms before `now`. */
function presentAt(video: ReturnType<typeof fakeVideo>, now: number): void {
  video.present(now, { captureTime: now - 50, expectedDisplayTime: now + 16 });
}

function detectTimestamps(landmarker: ReturnType<typeof fakeLandmarker>): number[] {
  return landmarker.detectForVideo.mock.calls.map((call) => call[1]);
}

let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mocks.createFromOptions.mockReset();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('createPoseTracker: creating the landmarker', () => {
  it('asks for the lite model on the GPU in video mode with one pose', async () => {
    mocks.createFromOptions.mockResolvedValue(fakeLandmarker());
    const tracker = await createPoseTracker({ video: fakeVideo().video, onSample: () => {} });

    expect(tracker.delegate).toBe('GPU');
    expect(mocks.createFromOptions).toHaveBeenCalledTimes(1);
    expect(mocks.createFromOptions).toHaveBeenCalledWith(LOCAL_WASM_FILESET, {
      baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
    expect(POSE_MODEL_URL).toContain('pose_landmarker_lite');
  });

  it('retries on the CPU when GPU creation throws, and reports it', async () => {
    mocks.createFromOptions
      .mockRejectedValueOnce(new Error('no WebGL'))
      .mockResolvedValueOnce(fakeLandmarker());
    const tracker = await createPoseTracker({ video: fakeVideo().video, onSample: () => {} });

    expect(tracker.delegate).toBe('CPU');
    expect(mocks.createFromOptions).toHaveBeenCalledTimes(2);
    expect(mocks.createFromOptions.mock.calls[1][1].baseOptions.delegate).toBe('CPU');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects with the CPU error when both delegates fail', async () => {
    mocks.createFromOptions
      .mockRejectedValueOnce(new Error('no WebGL'))
      .mockRejectedValueOnce(new Error('model download failed'));
    await expect(
      createPoseTracker({ video: fakeVideo().video, onSample: () => {} }),
    ).rejects.toThrow('model download failed');
  });

  it('loads the wasm from the fileset it is given', async () => {
    mocks.createFromOptions.mockResolvedValue(fakeLandmarker());
    await createPoseTracker({
      video: fakeVideo().video,
      onSample: () => {},
      wasmFileset: CDN_WASM_FILESET,
    });
    expect(mocks.createFromOptions.mock.calls[0][0]).toBe(CDN_WASM_FILESET);
  });
});

describe('createPoseTracker: the frame loop', () => {
  it('does nothing until started, and start is idempotent', async () => {
    mocks.createFromOptions.mockResolvedValue(fakeLandmarker());
    const video = fakeVideo();
    const tracker = await createPoseTracker({ video: video.video, onSample: () => {} });
    expect(video.pending()).toBe(0);

    tracker.start();
    tracker.start();
    expect(video.pending()).toBe(1);
  });

  it('emits one sample per frame, stamped with the capture time', async () => {
    const landmarker = fakeLandmarker();
    mocks.createFromOptions.mockResolvedValue(landmarker);
    const video = fakeVideo();
    const samples: PoseSample[] = [];
    const tracker = await createPoseTracker({
      video: video.video,
      toClockTime: (perfMs) => perfMs / 1000 - 2,
      onSample: (sample) => samples.push(sample),
    });
    tracker.start();

    video.present(10_000, { captureTime: 9_940, expectedDisplayTime: 10_016 });
    video.present(10_033, { captureTime: 9_973, expectedDisplayTime: 10_049 });

    expect(samples).toHaveLength(2);
    expect(samples[0].frame.t).toBeCloseTo(7.94, 9);
    expect(samples[1].frame.t).toBeCloseTo(7.973, 9);
    expect(detectTimestamps(landmarker)).toEqual([9_940, 9_973]);
    expect(landmarker.detectForVideo.mock.calls[0][0]).toBe(video.video);
    expect(samples[0].frame.visible).toHaveLength(8);
    expect(samples[0].landmarks).toHaveLength(33);
    expect(samples[0].worldLandmarks).toHaveLength(33);
    expect(samples[0].form.shoulderEarRatio).toBeCloseTo(0.3, 9);
    expect(samples[0].detectMs).toBeGreaterThanOrEqual(0);
  });

  it('maps frame time to seconds when no clock mapping is given', async () => {
    mocks.createFromOptions.mockResolvedValue(fakeLandmarker());
    const video = fakeVideo();
    const samples: PoseSample[] = [];
    const tracker = await createPoseTracker({
      video: video.video,
      onSample: (sample) => samples.push(sample),
    });
    tracker.start();
    video.present(4_000, { captureTime: 3_950, expectedDisplayTime: 4_016 });
    expect(samples[0].frame.t).toBeCloseTo(3.95, 9);
  });

  it('falls back to the expected display time, then to now', async () => {
    mocks.createFromOptions.mockResolvedValue(fakeLandmarker());
    const video = fakeVideo();
    const samples: PoseSample[] = [];
    const tracker = await createPoseTracker({
      video: video.video,
      onSample: (sample) => samples.push(sample),
    });
    tracker.start();
    video.present(4_000, { expectedDisplayTime: 4_016 });
    video.present(4_033, { captureTime: 1.7e12, expectedDisplayTime: Number.NaN });
    expect(samples[0].frame.t).toBeCloseTo(4.016, 9);
    expect(samples[1].frame.t).toBeCloseTo(4.033, 9);
  });

  it('feeds the detector strictly increasing timestamps', async () => {
    const landmarker = fakeLandmarker();
    mocks.createFromOptions.mockResolvedValue(landmarker);
    const video = fakeVideo();
    const tracker = await createPoseTracker({ video: video.video, onSample: () => {} });
    tracker.start();

    video.present(1_000, { captureTime: 950, expectedDisplayTime: 1_016 });
    video.present(1_010, { captureTime: 950, expectedDisplayTime: 1_026 });
    video.present(1_020, { captureTime: 900, expectedDisplayTime: 1_036 });
    video.present(1_033, { captureTime: 983, expectedDisplayTime: 1_049 });

    const timestamps = detectTimestamps(landmarker);
    expect(timestamps).toEqual([950, 951, 952, 983]);
  });

  it('emits an empty sample when no pose is found, then recovers without lag', async () => {
    const landmarker = fakeLandmarker();
    mocks.createFromOptions.mockResolvedValue(landmarker);
    const video = fakeVideo();
    const samples: PoseSample[] = [];
    const tracker = await createPoseTracker({
      video: video.video,
      onSample: (sample) => samples.push(sample),
    });
    tracker.start();

    presentAt(video, 1_000);
    landmarker.detectForVideo.mockReturnValueOnce(NO_POSE_RESULT);
    presentAt(video, 1_033);
    presentAt(video, 1_066);

    expect(samples[1].frame).toEqual({ t: 0.983, angles: {}, visible: [] });
    expect(samples[1].landmarks).toBeNull();
    expect(samples[1].worldLandmarks).toBeNull();
    expect(samples[1].form).toEqual({ trunkLeanDeg: null, shoulderEarRatio: null });
    expect(samples[2].frame.visible).toHaveLength(8);
    expect(samples[2].frame.angles.leftElbow).toBeCloseTo(180, 6);
  });

  it('treats a landmark without visibility as not visible', async () => {
    const bare = standingPose().map(({ x, y, z }) => ({ x, y, z }));
    mocks.createFromOptions.mockResolvedValue(
      fakeLandmarker({ landmarks: [bare], worldLandmarks: [bare] }),
    );
    const video = fakeVideo();
    const samples: PoseSample[] = [];
    const tracker = await createPoseTracker({
      video: video.video,
      onSample: (sample) => samples.push(sample),
    });
    tracker.start();
    presentAt(video, 1_000);

    expect(samples[0].landmarks?.every((landmark) => landmark.visibility === 0)).toBe(true);
    expect(samples[0].frame.visible).toEqual([]);
  });

  it('reports a smoothed frame rate from the interval between callbacks', async () => {
    mocks.createFromOptions.mockResolvedValue(fakeLandmarker());
    const video = fakeVideo();
    const samples: PoseSample[] = [];
    const tracker = await createPoseTracker({
      video: video.video,
      onSample: (sample) => samples.push(sample),
    });
    tracker.start();
    for (let i = 0; i < 40; i++) presentAt(video, 1_000 + i * 40);

    expect(samples[0].fps).toBe(0);
    expect(samples[1].fps).toBeCloseTo(25, 9);
    expect(samples[39].fps).toBeCloseTo(25, 6);
  });

  it('skips a frame while the video has nothing to read', async () => {
    const landmarker = fakeLandmarker();
    mocks.createFromOptions.mockResolvedValue(landmarker);
    const video = fakeVideo();
    const onSample = vi.fn();
    const tracker = await createPoseTracker({ video: video.video, onSample });
    tracker.start();

    video.element.readyState = 1;
    presentAt(video, 1_000);
    expect(landmarker.detectForVideo).not.toHaveBeenCalled();
    expect(onSample).not.toHaveBeenCalled();

    video.element.readyState = 4;
    presentAt(video, 1_033);
    expect(onSample).toHaveBeenCalledTimes(1);
  });
});

describe('createPoseTracker: stopping and restarting', () => {
  it('stops emitting, cancels the pending callback, and can restart', async () => {
    const landmarker = fakeLandmarker();
    mocks.createFromOptions.mockResolvedValue(landmarker);
    const video = fakeVideo();
    const onSample = vi.fn();
    const tracker = await createPoseTracker({ video: video.video, onSample });

    tracker.start();
    presentAt(video, 1_000);
    tracker.stop();
    tracker.stop();
    expect(video.pending()).toBe(0);
    presentAt(video, 1_033);
    expect(onSample).toHaveBeenCalledTimes(1);

    tracker.start();
    expect(video.pending()).toBe(1);
    presentAt(video, 1_066);
    expect(onSample).toHaveBeenCalledTimes(2);
    expect(detectTimestamps(landmarker)).toEqual([950, 1_016]);
  });

  it('keeps detector timestamps increasing across a restart', async () => {
    const landmarker = fakeLandmarker();
    mocks.createFromOptions.mockResolvedValue(landmarker);
    const video = fakeVideo();
    const tracker = await createPoseTracker({ video: video.video, onSample: () => {} });

    tracker.start();
    presentAt(video, 5_000);
    tracker.stop();
    tracker.start();
    presentAt(video, 4_000);

    const [first, second] = detectTimestamps(landmarker);
    expect(second).toBeGreaterThan(first);
  });

  it('does not count the stopped gap as a frame interval', async () => {
    mocks.createFromOptions.mockResolvedValue(fakeLandmarker());
    const video = fakeVideo();
    const samples: PoseSample[] = [];
    const tracker = await createPoseTracker({
      video: video.video,
      onSample: (sample) => samples.push(sample),
    });
    tracker.start();
    presentAt(video, 1_000);
    presentAt(video, 1_040);
    tracker.stop();
    tracker.start();
    presentAt(video, 61_000);
    presentAt(video, 61_040);

    expect(samples.map((sample) => sample.fps)).toEqual([0, 25, 25, 25]);
  });

  it('halts when stop is called from inside onSample', async () => {
    mocks.createFromOptions.mockResolvedValue(fakeLandmarker());
    const video = fakeVideo();
    const samples: PoseSample[] = [];
    const tracker = await createPoseTracker({
      video: video.video,
      onSample: (sample) => {
        samples.push(sample);
        tracker.stop();
      },
    });
    tracker.start();
    presentAt(video, 1_000);
    expect(video.pending()).toBe(0);
    presentAt(video, 1_033);
    expect(samples).toHaveLength(1);
  });

  it('closes the landmarker once on dispose and ignores start afterwards', async () => {
    const landmarker = fakeLandmarker();
    mocks.createFromOptions.mockResolvedValue(landmarker);
    const video = fakeVideo();
    const onSample = vi.fn();
    const tracker = await createPoseTracker({ video: video.video, onSample });

    tracker.start();
    tracker.dispose();
    tracker.dispose();
    expect(landmarker.close).toHaveBeenCalledTimes(1);
    expect(video.pending()).toBe(0);

    tracker.start();
    expect(video.pending()).toBe(0);
    presentAt(video, 1_000);
    expect(onSample).not.toHaveBeenCalled();
    expect(landmarker.detectForVideo).not.toHaveBeenCalled();
  });
});

describe('createPoseTracker: errors inside the loop', () => {
  it('survives a throwing onSample and logs the message once', async () => {
    mocks.createFromOptions.mockResolvedValue(fakeLandmarker());
    const video = fakeVideo();
    let calls = 0;
    const tracker = await createPoseTracker({
      video: video.video,
      onSample: () => {
        calls += 1;
        if (calls <= 3) throw new Error('scoring blew up');
      },
    });
    tracker.start();
    for (let i = 0; i < 6; i++) presentAt(video, 1_000 + i * 33);

    expect(calls).toBe(6);
    expect(video.pending()).toBe(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain('scoring blew up');
  });

  it('survives a throwing detector and logs each distinct message once', async () => {
    const landmarker = fakeLandmarker();
    mocks.createFromOptions.mockResolvedValue(landmarker);
    const video = fakeVideo();
    const onSample = vi.fn();
    const tracker = await createPoseTracker({ video: video.video, onSample });
    tracker.start();

    landmarker.detectForVideo
      .mockImplementationOnce(() => {
        throw new Error('graph error');
      })
      .mockImplementationOnce(() => {
        throw new Error('graph error');
      })
      .mockImplementationOnce(() => {
        throw new Error('context lost');
      });
    for (let i = 0; i < 5; i++) presentAt(video, 1_000 + i * 33);

    expect(onSample).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledTimes(2);
    // A failed frame still consumed its timestamp, so none is ever reused.
    const timestamps = detectTimestamps(landmarker);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
    expect(new Set(timestamps).size).toBe(5);
  });
});

describe('createPoseTracker: without requestVideoFrameCallback', () => {
  function animationFrames() {
    let nextHandle = 1;
    const callbacks = new Map<number, () => void>();
    vi.stubGlobal('requestAnimationFrame', (callback: () => void): number => {
      callbacks.set(nextHandle, callback);
      return nextHandle++;
    });
    vi.stubGlobal('cancelAnimationFrame', (handle: number): void => {
      callbacks.delete(handle);
    });
    return {
      pending: () => callbacks.size,
      tick(): void {
        const due = [...callbacks.values()];
        callbacks.clear();
        for (const callback of due) callback();
      },
    };
  }

  function legacyVideo() {
    const element = { readyState: 4, videoWidth: 640, videoHeight: 480, currentTime: 0 };
    return { element, video: element as unknown as HTMLVideoElement };
  }

  it('polls on animation frames and detects only when the video has advanced', async () => {
    const landmarker = fakeLandmarker();
    mocks.createFromOptions.mockResolvedValue(landmarker);
    const frames = animationFrames();
    let clock = 2_000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const { element, video } = legacyVideo();
    const samples: PoseSample[] = [];
    const tracker = await createPoseTracker({ video, onSample: (sample) => samples.push(sample) });

    tracker.start();
    expect(frames.pending()).toBe(1);

    element.currentTime = 0.033;
    frames.tick();
    clock = 2_016;
    frames.tick();
    frames.tick();
    clock = 2_033;
    element.currentTime = 0.066;
    frames.tick();

    expect(samples).toHaveLength(2);
    expect(samples[0].frame.t).toBeCloseTo(2, 9);
    expect(samples[1].frame.t).toBeCloseTo(2.033, 9);
    expect(detectTimestamps(landmarker)).toEqual([2_000, 2_033]);
    expect(samples[1].fps).toBeCloseTo(1000 / 33, 9);
    expect(frames.pending()).toBe(1);
  });

  it('stops polling on stop', async () => {
    mocks.createFromOptions.mockResolvedValue(fakeLandmarker());
    const frames = animationFrames();
    const { element, video } = legacyVideo();
    const onSample = vi.fn();
    const tracker = await createPoseTracker({ video, onSample });

    tracker.start();
    tracker.stop();
    expect(frames.pending()).toBe(0);
    element.currentTime = 0.5;
    frames.tick();
    expect(onSample).not.toHaveBeenCalled();
  });
});
