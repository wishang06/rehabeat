import { OneEuroFilter } from '../pose/oneEuro';
import type { Landmark } from '../types';

/**
 * Tuned on normalised image coordinates: a resting joint is held to a low
 * cutoff, and one crossing the picture in a second keeps up with it.
 */
const FILTER = { minCutoff: 0.8, beta: 4, dCutoff: 1 };

/**
 * Steadies the image landmarks the overlay draws on. The detector's raw
 * points shake by a few pixels from frame to frame, and arrive at the
 * camera's rate, not the screen's; drawn as they come, anything pinned to
 * them trembles. This runs every display frame, so what it returns also moves
 * smoothly between camera frames.
 *
 * Only x and y are filtered. Scoring never sees these: it has its own
 * smoothing, on joint angles.
 */
export class LandmarkSmoother {
  private filters: { x: OneEuroFilter; y: OneEuroFilter }[] = [];

  /** `landmarks` is the latest sample's, or null when there is no pose: the next pose then starts fresh. */
  update(landmarks: Landmark[] | null, nowMs: number): Landmark[] | null {
    if (!landmarks) {
      this.filters = [];
      return null;
    }
    const seconds = nowMs / 1000;
    return landmarks.map((landmark, index) => {
      const filter = (this.filters[index] ??= { x: new OneEuroFilter(FILTER), y: new OneEuroFilter(FILTER) });
      return { ...landmark, x: filter.x.filter(landmark.x, seconds), y: filter.y.filter(landmark.y, seconds) };
    });
  }
}
