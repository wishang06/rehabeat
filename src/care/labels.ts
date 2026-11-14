import type { JointLimit } from '../scoring';
import type { JointName } from '../types';

type Part = 'Shoulder' | 'Elbow' | 'Hip' | 'Knee';

const PARTS: readonly Part[] = ['Shoulder', 'Elbow', 'Hip', 'Knee'];

export function partOf(joint: JointName): Part {
  return PARTS.find((part) => joint.endsWith(part))!;
}

/** A joint in words, in the patient's own left and right: "right shoulder". */
export function jointLabel(joint: JointName): string {
  const side = joint.startsWith('left') ? 'left' : 'right';
  return `${side} ${partOf(joint).toLowerCase()}`;
}

export const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** A shoulder is raised; an elbow, hip or knee is bent. */
export function limitVerb(joint: JointName): 'raise' | 'bend' {
  return partOf(joint) === 'Shoulder' ? 'raise' : 'bend';
}

/** A limit the way a doctor says it: "Right shoulder: raise up to 90°", "Left knee: off". */
export function limitText(joint: JointName, limit: JointLimit): string {
  const name = capitalize(jointLabel(joint));
  return limit.kind === 'off' ? `${name}: off` : `${name}: ${limitVerb(joint)} up to ${limit.maxDeg}°`;
}

/** The range a limit's slider covers, in degrees of movement from rest. */
export const LIMIT_SLIDER: Record<Part, { min: number; max: number; step: number }> = {
  Shoulder: { min: 20, max: 180, step: 5 },
  Elbow: { min: 20, max: 150, step: 5 },
  Hip: { min: 20, max: 120, step: 5 },
  Knee: { min: 20, max: 150, step: 5 },
};
