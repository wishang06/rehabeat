/**
 * Camera zoom: how much of the camera picture the stage shows. At 0 the
 * picture covers the stage, cropped to its shape (the closest view); at 1 it
 * is the camera's full frame, letterboxed on the stage colour. The player
 * sets it with the slider on the Calibrate screen; it is never changed
 * automatically.
 *
 * The rectangle from frameRect is given to the element that holds both the
 * video and the overlay canvas (see Stage.tsx), so the picture, the gold
 * figure, the player's skeleton and the hint arrow all move together.
 */

export interface Size {
  width: number;
  height: number;
}

/** Where the camera picture sits on the stage, in stage pixels. It can reach past the stage's edges. */
export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_ZOOM = 0.5;
export const ZOOM_KEY = 'rehabeat.cameraZoom';

function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return DEFAULT_ZOOM;
  return Math.min(1, Math.max(0, zoom));
}

/**
 * The camera picture's rectangle on the stage at `zoom`. The scale runs
 * geometrically from cover to contain, so each step of the slider looks like
 * the same amount of zoom; the picture stays centred and keeps its shape.
 */
export function frameRect(stage: Size, video: Size, zoom: number): FrameRect {
  if (stage.width <= 0 || stage.height <= 0 || video.width <= 0 || video.height <= 0) {
    return { x: 0, y: 0, width: Math.max(0, stage.width), height: Math.max(0, stage.height) };
  }
  const across = stage.width / video.width;
  const down = stage.height / video.height;
  const cover = Math.max(across, down);
  const contain = Math.min(across, down);
  const scale = cover * (contain / cover) ** clampZoom(zoom);
  const width = video.width * scale;
  const height = video.height * scale;
  return { x: (stage.width - width) / 2, y: (stage.height - height) / 2, width, height };
}

/**
 * A normalised camera landmark (0 to 1 across the camera picture) in stage
 * pixels, through `rect`. `mirrored` is the selfie view: the stage flips the
 * picture and its canvas horizontally about the rectangle's centre.
 */
export function mapLandmark(rect: FrameRect, point: { x: number; y: number }, mirrored: boolean): { x: number; y: number } {
  const across = mirrored ? 1 - point.x : point.x;
  return { x: rect.x + across * rect.width, y: rect.y + point.y * rect.height };
}

function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The zoom saved on this browser, or the default. Never throws. */
export function loadZoom(storage: Storage | null = defaultStorage()): number {
  try {
    const raw = storage?.getItem(ZOOM_KEY);
    if (raw === null || raw === undefined || raw.trim() === '') return DEFAULT_ZOOM;
    return clampZoom(Number(raw));
  } catch {
    return DEFAULT_ZOOM;
  }
}

/** Saves the zoom on this browser. Blocked storage just means it is not remembered. */
export function saveZoom(zoom: number, storage: Storage | null = defaultStorage()): void {
  try {
    storage?.setItem(ZOOM_KEY, String(clampZoom(zoom)));
  } catch {
    // Not remembered; the slider still works for this visit.
  }
}
