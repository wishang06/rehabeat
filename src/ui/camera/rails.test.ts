import { describe, expect, it } from 'vitest';
import { MAX_RAIL_PX, MIN_RAIL_PX, stageLayout, shownRect } from './rails';

const CAMERA = { width: 640, height: 480 };

describe('stageLayout', () => {
  it('gives the rails the black bars a 4:3 picture leaves on a wide stage', () => {
    // 900 tall: a 4:3 picture is 1200 wide, leaving 2 x 260.
    const layout = stageLayout({ width: 1720, height: 900 }, CAMERA, true);
    expect(layout.rail).toBe(260);
    expect(layout.picture).toEqual({ x: 260, y: 0, width: 1200, height: 900 });
  });

  it('keeps the rails wide enough for the HUD panels, at the picture’s expense', () => {
    const layout = stageLayout({ width: 1248, height: 656 }, CAMERA, true);
    expect(layout.rail).toBe(MIN_RAIL_PX);
    expect(layout.picture.width).toBe(1248 - 2 * MIN_RAIL_PX);
  });

  it('caps the rails on a very wide stage so the picture area stays wide', () => {
    expect(stageLayout({ width: 3000, height: 900 }, CAMERA, true).rail).toBe(MAX_RAIL_PX);
  });

  it('follows the camera’s shape: a 16:9 camera leaves less room', () => {
    const wide = stageLayout({ width: 1720, height: 900 }, { width: 1280, height: 720 }, true);
    expect(wide.rail).toBe(MIN_RAIL_PX);
  });

  it('has no rails when they are off, on a narrow stage, or before the stage has a size', () => {
    const stage = { width: 1720, height: 900 };
    expect(stageLayout(stage, CAMERA, false)).toEqual({ rail: 0, picture: { x: 0, y: 0, width: 1720, height: 900 } });
    expect(stageLayout({ width: 900, height: 700 }, CAMERA, true).rail).toBe(0);
    // A 1024 x 768 window: the rails would leave a picture narrower than it is tall.
    expect(stageLayout({ width: 992, height: 672 }, CAMERA, true).rail).toBe(0);
    // A 1280 x 720 window keeps them.
    expect(stageLayout({ width: 1248, height: 624 }, CAMERA, true).rail).toBe(MIN_RAIL_PX);
    expect(stageLayout({ width: 0, height: 0 }, CAMERA, true).rail).toBe(0);
  });

  it('assumes a 4:3 camera before the camera has reported its size', () => {
    expect(stageLayout({ width: 1720, height: 900 }, { width: 0, height: 0 }, true).rail).toBe(260);
  });
});

describe('shownRect', () => {
  it('is the camera frame itself when the frame sits inside the picture area', () => {
    // A rail of 240 px; the frame is letterboxed 16 px in from each side and 10 px from the top.
    const picture = { x: 240, y: 0, width: 960, height: 700 };
    expect(shownRect(picture, { x: 16, y: 10, width: 928, height: 680 })).toEqual({ x: 256, y: 10, width: 928, height: 680 });
  });

  it('is clipped to the picture area when the frame is zoomed past it', () => {
    const picture = { x: 240, y: 0, width: 960, height: 700 };
    expect(shownRect(picture, { x: -40, y: -25, width: 1040, height: 750 })).toEqual({ x: 240, y: 0, width: 960, height: 700 });
    // Wider than the area, shorter than it.
    expect(shownRect(picture, { x: -40, y: 30, width: 1040, height: 640 })).toEqual({ x: 240, y: 30, width: 960, height: 640 });
  });

  it('is the whole stage without rails and before the camera has a size', () => {
    const stage = { x: 0, y: 0, width: 1024, height: 600 };
    expect(shownRect(stage, { x: 0, y: 0, width: 1024, height: 600 })).toEqual(stage);
  });

  it('is never negative', () => {
    expect(shownRect({ x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});
