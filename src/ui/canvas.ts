/** Colours used on the overlay canvas. Keep in step with the tokens in index.css. */
export const CANVAS_COLORS = {
  skeletonLine: 'rgba(244, 241, 234, 0.85)',
  skeletonJoint: '#f4f1ea',
  ghost: '#ffb454',
  ghostMatched: '#7be0a4',
};

/**
 * Sizes the canvas backing store to its on-screen size and clears it.
 * Returns the 2D context and the size in canvas pixels, or null if the canvas
 * is not laid out yet.
 */
export function prepareCanvas(
  canvas: HTMLCanvasElement,
): { ctx: CanvasRenderingContext2D; width: number; height: number } | null {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(canvas.clientWidth * ratio);
  const height = Math.round(canvas.clientHeight * ratio);
  if (width === 0 || height === 0) return null;

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}
