import type { FrameRect, Size } from './zoom';

/** Rails narrower than this can't hold the HUD panels: the HUD goes back over the picture. */
export const MIN_RAIL_PX = 240;
/** Rails wider than this would only shrink the picture. */
export const MAX_RAIL_PX = 336;
/**
 * The picture between the narrowest rails must be at least this wide for its
 * height (1 is square). Narrower than that (a phone, a small or tall window),
 * rails would squeeze the picture, so the HUD stays over it.
 */
export const MIN_PICTURE_ASPECT = 1;

export interface StageLayout {
  /** Each side rail's width in pixels; 0 when the HUD sits over the picture. */
  rail: number;
  /** Where the camera picture may go: the stage between the rails. The zoom places the picture inside it. */
  picture: FrameRect;
}

/**
 * Splits the Play and Calibrate stage into a rail each side for the HUD
 * panels and the picture between them. The rails take the space a camera
 * picture fitted to the stage's height would leave, within MIN_RAIL_PX and
 * MAX_RAIL_PX. `video` is the camera's size (its shape decides the rails).
 */
export function stageLayout(stage: Size, video: Size, rails: boolean): StageLayout {
  const whole: StageLayout = { rail: 0, picture: { x: 0, y: 0, width: stage.width, height: stage.height } };
  if (!rails || stage.height <= 0 || stage.width - 2 * MIN_RAIL_PX < stage.height * MIN_PICTURE_ASPECT) return whole;
  const aspect = video.width > 0 && video.height > 0 ? video.width / video.height : 4 / 3;
  const leftOver = (stage.width - stage.height * aspect) / 2;
  const rail = Math.round(Math.min(MAX_RAIL_PX, Math.max(MIN_RAIL_PX, leftOver)));
  return { rail, picture: { x: rail, y: 0, width: stage.width - 2 * rail, height: stage.height } };
}

/**
 * The part of the camera picture that shows, in stage pixels: the camera
 * frame (`frame`, placed inside `picture` by the zoom) clipped to where the
 * picture may go. The HUD's beat frame and burst are laid on this rectangle,
 * so they sit on the edge of what the player sees, not on the black beside it.
 */
export function shownRect(picture: FrameRect, frame: FrameRect): FrameRect {
  const left = Math.max(0, frame.x);
  const top = Math.max(0, frame.y);
  const right = Math.min(picture.width, frame.x + frame.width);
  const bottom = Math.min(picture.height, frame.y + frame.height);
  return {
    x: picture.x + left,
    y: picture.y + top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}
