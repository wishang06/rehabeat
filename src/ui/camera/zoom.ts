/**
 * Camera zoom: how much of the camera picture the stage shows. At 0 the
 * picture covers the stage, cropped to its shape (the closest view); at 1 it
 * is the camera's full frame, letterboxed on the stage colour. The stage
 * always uses DEFAULT_ZOOM, halfway between the two: there is no control for
 * it and it never changes by itself.
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

function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return DEFAULT_ZOOM;
  return Math.min(1, Math.max(0, zoom));
}

/**
 * The camera picture's rectangle on the stage at `zoom`. The scale runs
 * geometrically from cover to contain, so equal steps of zoom look like equal
 * amounts; the picture stays centred and keeps its shape.
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
