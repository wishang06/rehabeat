import type { Landmark } from '../types';
import { SKELETON_BONES } from './landmarks';
import { isVisible } from './visibility';

/** Looser than MIN_VISIBILITY: the overlay should show limbs before they are scoreable. */
export const SKELETON_MIN_VISIBILITY = 0.5;

const DEFAULT_LINE_COLOR = '#35e0a1';
const DEFAULT_JOINT_COLOR = '#ffffff';
const DEFAULT_LINE_WIDTH = 4;

export interface SkeletonOptions {
  /** Canvas size in pixels; normalised landmarks are scaled to it. */
  width: number;
  height: number;
  minVisibility?: number;
  lineColor?: string;
  jointColor?: string;
  lineWidth?: number;
}

export interface SkeletonLayout {
  /** [x1, y1, x2, y2] in canvas pixels: one per bone with both endpoints visible. */
  bones: [number, number, number, number][];
  /** [x, y] in canvas pixels: one per visible bone endpoint. */
  joints: [number, number][];
}

/** Where the skeleton goes on a width x height canvas. Never mirrors. */
export function layoutSkeleton(
  landmarks: Landmark[],
  width: number,
  height: number,
  minVisibility: number = SKELETON_MIN_VISIBILITY,
): SkeletonLayout {
  const bones: SkeletonLayout['bones'] = [];
  const jointIndices = new Set<number>();

  for (const [fromIndex, toIndex] of SKELETON_BONES) {
    const from = landmarks[fromIndex];
    const to = landmarks[toIndex];
    const fromVisible = isVisible(from, minVisibility);
    const toVisible = isVisible(to, minVisibility);
    if (fromVisible) jointIndices.add(fromIndex);
    if (toVisible) jointIndices.add(toIndex);
    if (fromVisible && toVisible) {
      bones.push([from.x * width, from.y * height, to.x * width, to.y * height]);
    }
  }

  const joints: SkeletonLayout['joints'] = [];
  for (const index of jointIndices) {
    const { x, y } = landmarks[index];
    joints.push([x * width, y * height]);
  }
  return { bones, joints };
}

/**
 * Draws the skeleton over whatever is already on the canvas. It neither clears
 * nor mirrors: the UI mirrors the video and the canvas together with CSS.
 */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  options: SkeletonOptions,
): void {
  const { bones, joints } = layoutSkeleton(
    landmarks,
    options.width,
    options.height,
    options.minVisibility,
  );
  const lineWidth = options.lineWidth ?? DEFAULT_LINE_WIDTH;
  const jointRadius = Math.max(2, lineWidth);

  ctx.save();

  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.strokeStyle = options.lineColor ?? DEFAULT_LINE_COLOR;
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of bones) {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();

  ctx.fillStyle = options.jointColor ?? DEFAULT_JOINT_COLOR;
  ctx.beginPath();
  for (const [x, y] of joints) {
    // Start each circle on its own edge so fill() does not join the dots.
    ctx.moveTo(x + jointRadius, y);
    ctx.arc(x, y, jointRadius, 0, 2 * Math.PI);
  }
  ctx.fill();

  ctx.restore();
}
