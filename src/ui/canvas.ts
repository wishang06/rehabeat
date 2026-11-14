/** Colours used on the overlay canvas. Keep in step with the tokens in index.css. */
export const CANVAS_COLORS = {
  /** White: the player's own skeleton (Calibrate screen). */
  skeletonLine: 'rgba(255, 255, 255, 0.88)',
  skeletonJoint: '#ffffff',
  /** --sun: the target figure to reach for. */
  figure: { fill: 'rgba(255, 201, 52, 0.55)', edge: '#ffe08a', glow: '#ffc934' },
  /** --mint: the target figure once the player is within Good range. */
  figureMatched: { fill: 'rgba(34, 201, 160, 0.55)', edge: '#b5f5e3', glow: '#22c9a0' },
  /** The player's limbs by FeedbackFrame status. Amber leans orange so it never reads as the yellow target. */
  limb: {
    green: '#22c9a0',
    amber: '#ff8a1f',
    red: '#ff5c73',
    grey: '#a59fc2',
    idle: '#ffffff',
  },
  /** White and the --scrim room colour, for text on the camera picture. */
  chalk: '#ffffff',
  scrim: 'rgba(30, 16, 92, 0.86)',
};

/** A sized, cleared overlay canvas, ready to draw on. */
export interface CanvasSurface {
  ctx: CanvasRenderingContext2D;
  /** Size in canvas pixels. */
  width: number;
  height: number;
  /** Canvas pixels per CSS pixel. */
  ratio: number;
  /**
   * True when CSS flips the canvas horizontally (the stage's selfie view).
   * Geometry is drawn in camera-image space and the flip mirrors it along
   * with the video; text has to be flipped back to stay readable (drawText).
   */
  mirrored: boolean;
}

const mirroredCanvases = new WeakMap<HTMLCanvasElement, boolean>();

function isCssMirrored(canvas: HTMLCanvasElement): boolean {
  const match = /^matrix\(\s*(-?[\d.e-]+)/.exec(getComputedStyle(canvas).transform);
  return match !== null && Number.parseFloat(match[1]) < 0;
}

/**
 * Sizes the canvas backing store to its on-screen size and clears it.
 * Returns the 2D context and the size in canvas pixels, or null if the canvas
 * is not laid out yet.
 */
export function prepareCanvas(canvas: HTMLCanvasElement): CanvasSurface | null {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(canvas.clientWidth * ratio);
  const height = Math.round(canvas.clientHeight * ratio);
  if (width === 0 || height === 0) return null;

  if (canvas.width !== width || canvas.height !== height || !mirroredCanvases.has(canvas)) {
    canvas.width = width;
    canvas.height = height;
    // Read once per resize: reading computed style every frame forces style work.
    mirroredCanvases.set(canvas, isCssMirrored(canvas));
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height, ratio, mirrored: mirroredCanvases.get(canvas) ?? false };
}

/**
 * Draws one line of text centred on (x, y) so it reads correctly on screen,
 * flipping it back when CSS mirrors the canvas. Set font and fillStyle first.
 */
export function drawText(surface: CanvasSurface, text: string, x: number, y: number): void {
  const { ctx } = surface;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(x, y);
  if (surface.mirrored) ctx.scale(-1, 1);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}
