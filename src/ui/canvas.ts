/** Colours used on the overlay canvas. Keep in step with the tokens in index.css. */
export const CANVAS_COLORS = {
  /** --chalk: the player's own skeleton (Calibrate screen). */
  skeletonLine: 'rgba(246, 241, 231, 0.82)',
  skeletonJoint: '#f6f1e7',
  /** --brass: the target figure to reach for. */
  figure: { fill: 'rgba(242, 178, 76, 0.55)', edge: '#ffd27a', glow: '#f2b24c' },
  /** --on-target: the target figure once the player is within Good range. */
  figureMatched: { fill: 'rgba(134, 219, 166, 0.55)', edge: '#c9f5da', glow: '#86dba6' },
  /** The player's limbs by FeedbackFrame status. Amber leans orange so it never reads as the gold target. */
  limb: {
    green: '#86dba6',
    amber: '#ff9a3d',
    red: '#ff5f57',
    grey: '#8d8880',
    idle: '#f6f1e7',
  },
  /** --chalk and the --scrim studio colour, for text on the camera picture. */
  chalk: '#f6f1e7',
  scrim: 'rgba(20, 17, 14, 0.84)',
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
