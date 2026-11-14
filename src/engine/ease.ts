import { JOINT_NAMES } from '../types';
import type { SilhouettePose } from './silhouette';

/** How long the target figure takes to move from one pose to the next. */
export const POSE_EASE_MS = 150;

/** What the target figure shows: a pose, and how far it has moved off the body (0 on it, 1 beside it). */
export interface FigureState {
  pose: SilhouettePose;
  offset: number;
}

export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 3;
}

function mix(from: FigureState, to: FigureState, t: number): FigureState {
  const pose = {} as SilhouettePose;
  for (const joint of JOINT_NAMES) pose[joint] = from.pose[joint] + (to.pose[joint] - from.pose[joint]) * t;
  return { pose, offset: from.offset + (to.offset - from.offset) * t };
}

function same(a: FigureState, b: FigureState): boolean {
  return a.offset === b.offset && JOINT_NAMES.every((joint) => a.pose[joint] === b.pose[joint]);
}

/**
 * Eases the figure between targets over POSE_EASE_MS so a new move flows in
 * rather than snapping. Times are milliseconds on any steady clock.
 */
export class FigureEaser {
  private from: FigureState | null = null;
  private to: FigureState | null = null;
  private start = 0;
  private shown: FigureState | null = null;

  update(target: FigureState, nowMs: number): FigureState {
    if (!this.to || !this.shown) {
      this.from = this.to = this.shown = target;
      return target;
    }
    if (!same(target, this.to)) {
      this.from = this.shown;
      this.to = target;
      this.start = nowMs;
    }
    const t = (nowMs - this.start) / POSE_EASE_MS;
    this.shown = t >= 1 || !this.from ? this.to : mix(this.from, this.to, easeOutCubic(t));
    return this.shown;
  }
}
