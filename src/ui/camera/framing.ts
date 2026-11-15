import { LM } from '../../pose/landmarks';
import { isVisible } from '../../pose/visibility';
import type { Landmark } from '../../types';

/** Looser than scoring's: this only asks whether a part of the body is in the picture at all. */
const SEEN = 0.5;
/** The top of the head sits about this far above the nose, as a share of the nose-to-shoulders drop. */
const CROWN_ABOVE_NOSE = 0.6;
/** An ankle lower than this (as a share of the picture's height) has the foot under it out of frame. */
const FEET_LINE = 0.97;

/**
 * True when someone is in the picture but their head or feet are cut off, in
 * normalised camera coordinates. False when there is nobody to judge (no
 * shoulders seen): the "step back into the picture" hint covers that.
 */
export function bodyCutOff(landmarks: readonly Landmark[] | null | undefined): boolean {
  if (!landmarks) return false;
  const shoulders = [landmarks[LM.leftShoulder], landmarks[LM.rightShoulder]].filter((landmark) => isVisible(landmark, SEEN));
  if (shoulders.length === 0) return false;

  const nose = landmarks[LM.nose];
  if (!isVisible(nose, SEEN)) return true;
  const shoulderY = shoulders.reduce((sum, landmark) => sum + landmark.y, 0) / shoulders.length;
  const crown = nose.y - CROWN_ABOVE_NOSE * Math.abs(shoulderY - nose.y);
  if (crown < 0) return true;

  const ankles = [landmarks[LM.leftAnkle], landmarks[LM.rightAnkle]].filter((landmark) => isVisible(landmark, SEEN));
  if (ankles.length === 0) return true;
  return Math.max(...ankles.map((ankle) => ankle.y)) > FEET_LINE;
}
