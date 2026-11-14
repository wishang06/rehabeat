import { withTimeout } from './withTimeout';

const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  // `ideal` rather than exact, so a camera without a 640x480 mode still opens.
  // The frame rate is asked for so that a camera offering several picks 30:
  // every frame interval is time in which a beat can't be measured.
  video: {
    facingMode: 'user',
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 30 },
  },
};

/** How long an opened camera gets to show its first frame. */
const FIRST_FRAME_TIMEOUT_MS = 10_000;

const SIZE_EVENTS = ['loadedmetadata', 'loadeddata', 'resize', 'playing'] as const;

/**
 * Chrome shows a 2x2 black frame while a camera track is muted, which includes
 * the moment before the first real frame arrives. Nothing that small is a picture.
 */
const PLACEHOLDER_FRAME_PX = 2;

/** True when the video holds a real camera frame: not empty, and not the muted-track placeholder. */
export function hasFrameSize(video: Pick<HTMLVideoElement, 'videoWidth' | 'videoHeight'>): boolean {
  return video.videoWidth > PLACEHOLDER_FRAME_PX && video.videoHeight > PLACEHOLDER_FRAME_PX;
}

/** Resolves when the video holds a real frame. Aborting `signal` stops the wait. */
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
 * `video`, and resolves once the video is playing a real frame.
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
