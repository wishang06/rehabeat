import type { Landmark } from '../types';

/** True when the landmark exists and is at least `minVisibility` visible. */
export function isVisible(
  landmark: Landmark | undefined,
  minVisibility: number,
): landmark is Landmark {
  return landmark !== undefined && landmark.visibility >= minVisibility;
}
