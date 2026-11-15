import { describe, expect, it } from 'vitest';
import { DEFAULT_ZOOM, ZOOM_KEY, frameRect, loadZoom, mapLandmark, saveZoom } from './zoom';

/** A 16:9 stage and a 4:3 camera: cover crops top and bottom, contain letterboxes left and right. */
const STAGE = { width: 1600, height: 900 };
const CAMERA = { width: 640, height: 480 };

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

const blocked = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('SecurityError');
  },
} as unknown as Storage;

describe('frameRect', () => {
  it('at the closest zoom covers the stage, cropping the top and bottom of the camera picture', () => {
    expect(frameRect(STAGE, CAMERA, 0)).toEqual({ x: 0, y: -150, width: 1600, height: 1200 });
  });

  it('at full frame shows the whole camera picture, letterboxed left and right only', () => {
    const rect = frameRect(STAGE, CAMERA, 1);
    expect(rect).toEqual({ x: 200, y: 0, width: 1200, height: 900 });
  });

  it('halfway is the geometric middle of the two scales, still centred', () => {
    const rect = frameRect(STAGE, CAMERA, 0.5);
    const scale = Math.sqrt(2.5 * 1.875);
    expect(rect.width).toBeCloseTo(640 * scale, 6);
    expect(rect.height).toBeCloseTo(480 * scale, 6);
    expect(rect.x).toBeCloseTo((1600 - 640 * scale) / 2, 6);
    expect(rect.y).toBeCloseTo((900 - 480 * scale) / 2, 6);
    // Between the two ends, and with the camera's own shape.
    expect(rect.width).toBeGreaterThan(1200);
    expect(rect.width).toBeLessThan(1600);
    expect(rect.width / rect.height).toBeCloseTo(4 / 3, 9);
  });

  it('keeps zoom inside 0 to 1, and treats a missing zoom as the default', () => {
    expect(frameRect(STAGE, CAMERA, -3)).toEqual(frameRect(STAGE, CAMERA, 0));
    expect(frameRect(STAGE, CAMERA, 9)).toEqual(frameRect(STAGE, CAMERA, 1));
    expect(frameRect(STAGE, CAMERA, Number.NaN)).toEqual(frameRect(STAGE, CAMERA, DEFAULT_ZOOM));
  });

  it('does nothing when the camera already has the stage’s shape', () => {
    const stage = { width: 800, height: 600 };
    const expected = { x: 0, y: 0, width: 800, height: 600 };
    for (const zoom of [0, 0.5, 1]) expect(frameRect(stage, CAMERA, zoom)).toEqual(expected);
  });

  it('falls back to the stage itself before the camera or the stage has a size', () => {
    expect(frameRect(STAGE, { width: 0, height: 0 }, 0.5)).toEqual({ x: 0, y: 0, ...STAGE });
    expect(frameRect({ width: 0, height: 0 }, CAMERA, 0.5)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe('mapLandmark', () => {
  it('maps landmarks to stage pixels at the closest zoom', () => {
    const rect = frameRect(STAGE, CAMERA, 0);
    expect(mapLandmark(rect, { x: 0, y: 0 }, false)).toEqual({ x: 0, y: -150 });
    expect(mapLandmark(rect, { x: 0.5, y: 0.5 }, false)).toEqual({ x: 800, y: 450 });
    expect(mapLandmark(rect, { x: 1, y: 1 }, false)).toEqual({ x: 1600, y: 1050 });
    // A shoulder a quarter of the way in, mirrored for the selfie view: it shows a quarter from the right.
    expect(mapLandmark(rect, { x: 0.25, y: 0.5 }, true)).toEqual({ x: 1200, y: 450 });
  });

  it('maps landmarks to stage pixels halfway', () => {
    const rect = frameRect(STAGE, CAMERA, 0.5);
    const centre = mapLandmark(rect, { x: 0.5, y: 0.5 }, true);
    expect(centre.x).toBeCloseTo(800, 9);
    expect(centre.y).toBeCloseTo(450, 9);
    const corner = mapLandmark(rect, { x: 0, y: 0 }, false);
    expect(corner.x).toBeCloseTo(rect.x, 9);
    expect(corner.y).toBeCloseTo(rect.y, 9);
    const mirrored = mapLandmark(rect, { x: 0, y: 1 }, true);
    expect(mirrored.x).toBeCloseTo(rect.x + rect.width, 9);
    expect(mirrored.y).toBeCloseTo(rect.y + rect.height, 9);
  });

  it('maps landmarks to stage pixels at full frame, where the whole picture is on the stage', () => {
    const rect = frameRect(STAGE, CAMERA, 1);
    expect(mapLandmark(rect, { x: 0, y: 0 }, false)).toEqual({ x: 200, y: 0 });
    expect(mapLandmark(rect, { x: 1, y: 1 }, false)).toEqual({ x: 1400, y: 900 });
    expect(mapLandmark(rect, { x: 0, y: 0 }, true)).toEqual({ x: 1400, y: 0 });
    for (const point of [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0.3, y: 0.9 },
    ]) {
      const mapped = mapLandmark(rect, point, true);
      expect(mapped.x).toBeGreaterThanOrEqual(0);
      expect(mapped.x).toBeLessThanOrEqual(STAGE.width);
      expect(mapped.y).toBeGreaterThanOrEqual(0);
      expect(mapped.y).toBeLessThanOrEqual(STAGE.height);
    }
  });

  it('moves a landmark toward the centre as the zoom goes out', () => {
    const wrist = { x: 0.1, y: 0.05 };
    const xs = [0, 0.5, 1].map((zoom) => mapLandmark(frameRect(STAGE, CAMERA, zoom), wrist, false));
    expect(xs[0].x).toBeLessThan(xs[1].x);
    expect(xs[1].x).toBeLessThan(xs[2].x);
    expect(xs[0].y).toBeLessThan(xs[1].y);
    expect(xs[1].y).toBeLessThan(xs[2].y);
  });
});

describe('loadZoom and saveZoom', () => {
  it('starts in the middle', () => {
    expect(DEFAULT_ZOOM).toBe(0.5);
    expect(loadZoom(memoryStorage())).toBe(0.5);
  });

  it('remembers a zoom', () => {
    const storage = memoryStorage();
    saveZoom(0.8, storage);
    expect(storage.getItem(ZOOM_KEY)).toBe('0.8');
    expect(loadZoom(storage)).toBe(0.8);
  });

  it('reads junk as the default and clamps a number out of range', () => {
    expect(loadZoom(memoryStorage({ [ZOOM_KEY]: 'abc' }))).toBe(0.5);
    expect(loadZoom(memoryStorage({ [ZOOM_KEY]: '' }))).toBe(0.5);
    expect(loadZoom(memoryStorage({ [ZOOM_KEY]: '7' }))).toBe(1);
    expect(loadZoom(memoryStorage({ [ZOOM_KEY]: '-1' }))).toBe(0);
  });

  it('copes with storage that is blocked or missing', () => {
    expect(loadZoom(blocked)).toBe(0.5);
    expect(() => saveZoom(0.3, blocked)).not.toThrow();
    expect(loadZoom(null)).toBe(0.5);
  });
});
