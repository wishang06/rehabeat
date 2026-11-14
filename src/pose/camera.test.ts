import { afterEach, describe, expect, it, vi } from 'vitest';
import { openCamera, stopCamera } from './camera';

/**
 * There is no camera or DOM under Node, so these tests stand in a stream, a
 * video element and navigator.mediaDevices that record what openCamera does.
 */
function fakeStream() {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  return { tracks, stream: { getTracks: () => tracks } as unknown as MediaStream };
}

function fakeVideo(play: () => Promise<void> = async () => {}) {
  const listeners = new Map<string, Set<() => void>>();
  const element = {
    playsInline: false,
    muted: false,
    srcObject: null as MediaStream | null,
    videoWidth: 0,
    videoHeight: 0,
    play: vi.fn(play),
    addEventListener(name: string, listener: () => void, options?: { signal?: AbortSignal }): void {
      const group = listeners.get(name) ?? new Set<() => void>();
      listeners.set(name, group);
      group.add(listener);
      options?.signal?.addEventListener('abort', () => group.delete(listener));
    },
  };
  return {
    element,
    video: element as unknown as HTMLVideoElement,
    listenerCount: () => [...listeners.values()].reduce((sum, group) => sum + group.size, 0),
    /** The camera's first frame arrives: the video learns its size and says so. */
    deliverFrame(width = 640, height = 480): void {
      element.videoWidth = width;
      element.videoHeight = height;
      for (const listener of listeners.get('loadedmetadata') ?? []) listener();
    },
  };
}

type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

function stubGetUserMedia(getUserMedia: GetUserMedia) {
  const spy = vi.fn(getUserMedia);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: spy } });
  return spy;
}

/** Lets promise callbacks that are already queued run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('openCamera', () => {
  it('asks for 640x480 user-facing video without audio', async () => {
    const { stream } = fakeStream();
    const getUserMedia = stubGetUserMedia(async () => stream);
    const video = fakeVideo();
    video.element.videoWidth = 640;
    video.element.videoHeight = 480;

    await openCamera(video.video);

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    });
  });

  it('attaches the stream inline and muted, and plays it', async () => {
    const { stream, tracks } = fakeStream();
    stubGetUserMedia(async () => stream);
    const video = fakeVideo();
    video.element.videoWidth = 640;
    video.element.videoHeight = 480;

    await expect(openCamera(video.video)).resolves.toBe(stream);

    expect(video.element.srcObject).toBe(stream);
    expect(video.element.playsInline).toBe(true);
    expect(video.element.muted).toBe(true);
    expect(video.element.play).toHaveBeenCalledTimes(1);
    expect(tracks[0].stop).not.toHaveBeenCalled();
  });

  it('keeps waiting through the 2x2 placeholder a muted camera track shows', async () => {
    const { stream } = fakeStream();
    stubGetUserMedia(async () => stream);
    const video = fakeVideo();
    let resolved = false;
    const opening = openCamera(video.video).then((result) => {
      resolved = true;
      return result;
    });

    await settle();
    video.deliverFrame(2, 2);
    await settle();
    expect(resolved).toBe(false);

    video.deliverFrame(640, 480);
    await expect(opening).resolves.toBe(stream);
  });

  it('waits for non-zero dimensions before resolving', async () => {
    const { stream } = fakeStream();
    stubGetUserMedia(async () => stream);
    const video = fakeVideo();
    let resolved = false;
    const opening = openCamera(video.video).then((result) => {
      resolved = true;
      return result;
    });

    await settle();
    expect(video.element.play).toHaveBeenCalledTimes(1);
    expect(resolved).toBe(false);
    expect(video.listenerCount()).toBeGreaterThan(0);

    video.deliverFrame();
    await expect(opening).resolves.toBe(stream);
    expect(video.listenerCount()).toBe(0);
  });

  it('lets a getUserMedia error through unchanged and leaves the video alone', async () => {
    const denied = new DOMException('Permission denied', 'NotAllowedError');
    stubGetUserMedia(async () => {
      throw denied;
    });
    const video = fakeVideo();

    await expect(openCamera(video.video)).rejects.toBe(denied);
    expect(video.element.srcObject).toBeNull();
    expect(video.element.play).not.toHaveBeenCalled();
  });

  it('releases the camera when playback fails', async () => {
    const { stream, tracks } = fakeStream();
    stubGetUserMedia(async () => stream);
    const blocked = new DOMException('play() was interrupted', 'AbortError');
    const video = fakeVideo(async () => {
      throw blocked;
    });

    await expect(openCamera(video.video)).rejects.toBe(blocked);
    expect(tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(tracks[1].stop).toHaveBeenCalledTimes(1);
    expect(video.element.srcObject).toBeNull();
  });

  it('does not detach a newer stream when an older attempt fails', async () => {
    const older = fakeStream();
    const newer = fakeStream();
    stubGetUserMedia(async () => older.stream);
    const video = fakeVideo(async () => {
      // A second openCamera call took over the element while this one was starting.
      video.element.srcObject = newer.stream;
      throw new DOMException('play() was interrupted', 'AbortError');
    });

    await expect(openCamera(video.video)).rejects.toThrow('interrupted');
    expect(older.tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(newer.tracks[0].stop).not.toHaveBeenCalled();
    expect(video.element.srcObject).toBe(newer.stream);
  });

  it('gives up and releases the camera when no frame ever arrives', async () => {
    vi.useFakeTimers();
    const { stream, tracks } = fakeStream();
    stubGetUserMedia(async () => stream);
    const video = fakeVideo();

    const outcome = expect(openCamera(video.video)).rejects.toThrow('did not deliver any video');
    await vi.advanceTimersByTimeAsync(10_000);
    await outcome;

    expect(tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(video.element.srcObject).toBeNull();
    expect(video.listenerCount()).toBe(0);
  });

  it('explains itself when the page is not a secure context', async () => {
    vi.stubGlobal('navigator', {});
    await expect(openCamera(fakeVideo().video)).rejects.toThrow('secure page');
  });
});

describe('stopCamera', () => {
  it('stops every track', () => {
    const { stream, tracks } = fakeStream();
    stopCamera(stream);
    expect(tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(tracks[1].stop).toHaveBeenCalledTimes(1);
  });
});
