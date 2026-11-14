import { withTimeout } from './withTimeout';

const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  // `ideal` rather than exact, so a camera without a 640x480 mode still opens.
  video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
};

/** How long an opened camera gets to show its first frame. */
const FIRST_FRAME_TIMEOUT_MS = 10_000;

const SIZE_EVENTS = ['loadedmetadata', 'loadeddata', 'resize', 'playing'] as const;

function hasFrameSize(video: HTMLVideoElement): boolean {
  return video.videoWidth > 0 && video.videoHeight > 0;
}

/** Resolves when the video reports non-zero dimensions. Aborting `signal` stops the wait. */
function waitForFrameSize(video: HTMLVideoElement, signal: AbortSignal): Promise<void> {
  if (hasFrameSize(video)) return Promise.resolve();
  return new Promise((resolve) => {
    const check = (): void => {
      if (hasFrameSize(video)) resolve();
    };
    for (const name of SIZE_EVENTS) video.addEventListener(name, check, { signal });
  });
}

async function startPlayback(video: HTMLVideoElement, signal: AbortSignal): Promise<void> {
  await video.play();
  await waitForFrameSize(video, signal);
}

/**
 * Opens the user-facing camera at 640x480 without audio, attaches it to
 * `video`, and resolves once the video is playing with non-zero dimensions.
 * getUserMedia errors (NotAllowedError, NotFoundError, ...) propagate unchanged.
 */
export async function openCamera(video: HTMLVideoElement): Promise<MediaStream> {
  // navigator.mediaDevices only exists in secure contexts.
  if (!('mediaDevices' in navigator)) {
    throw new Error('Camera access needs a secure page (https or localhost).');
  }
  const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);

  video.playsInline = true;
  video.muted = true;
  video.srcObject = stream;

  const waiting = new AbortController();
  try {
    // A camera that opens but never delivers a frame would otherwise hang here for good.
    await withTimeout(
      startPlayback(video, waiting.signal),
      FIRST_FRAME_TIMEOUT_MS,
      'The camera opened but did not deliver any video frames.',
    );
  } catch (error) {
    stopCamera(stream);
    // A later openCamera call may already have attached its own stream.
    if (video.srcObject === stream) video.srcObject = null;
    throw error;
  } finally {
    // Drops any listeners still waiting for a frame size.
    waiting.abort();
  }
  return stream;
}

/** Stops every track, which also turns the camera light off. */
export function stopCamera(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}
