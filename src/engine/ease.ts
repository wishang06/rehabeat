/** How long the target figure takes to move from one pose to the next. See StickEaser in stick.ts. */
export const POSE_EASE_MS = 150;

export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 3;
}
