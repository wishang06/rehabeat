/**
 * What the body weight field in Stats does when it is typed in, left, or
 * has its unit switched. Kept apart from the component so it can be tested.
 */
import { readWeight, showWeight, type WeightUnit } from '../progress';

export interface WeightFieldState {
  /** The text in the field. */
  draft: string;
  /** Typed in since it was last saved or filled from the saved weight. */
  edited: boolean;
  /** The last attempt to save what was typed was refused. */
  refused: boolean;
}

/** A weight and unit to store. A null weight means "use the default". */
export interface WeightSave {
  kg: number | null;
  unit: WeightUnit;
}

/** The field as it opens: the saved weight in its unit, or empty. */
export function openField(savedKg: number | null, unit: WeightUnit): WeightFieldState {
  return { draft: savedKg === null ? '' : showWeight(savedKg, unit), edited: false, refused: false };
}

export function typeInField(_state: WeightFieldState, text: string): WeightFieldState {
  return { draft: text, edited: true, refused: false };
}

/**
 * Leaving the field (or pressing Enter) saves what was typed. Text that is
 * not a weight stays in the field, marked refused, and nothing is saved. A
 * field that was not typed in writes nothing.
 */
export function leaveField(state: WeightFieldState, unit: WeightUnit): { state: WeightFieldState; save?: WeightSave } {
  if (!state.edited) return { state };
  const reading = readWeight(state.draft, unit);
  if (!reading.ok) return { state: { ...state, refused: true } };
  return { state: openField(reading.kg, unit), save: { kg: reading.kg, unit } };
}

/**
 * Switching the unit. A number typed and not yet saved is read in the new
 * unit, so "154" then "lb" is 154 lb; a saved weight is converted.
 */
export function switchFieldUnit(
  state: WeightFieldState,
  savedKg: number | null,
  next: WeightUnit,
): { state: WeightFieldState; save: WeightSave } {
  if (!state.edited) return { state: openField(savedKg, next), save: { kg: savedKg, unit: next } };
  const reading = readWeight(state.draft, next);
  if (!reading.ok) return { state: { ...state, refused: true }, save: { kg: savedKg, unit: next } };
  return { state: openField(reading.kg, next), save: { kg: reading.kg, unit: next } };
}
